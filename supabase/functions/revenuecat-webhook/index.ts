import { CORS_HEADERS, errorResponse, json, serviceClient } from '../_shared/http.ts'
import { QUOTA_BYTES } from '../_shared/quota.ts'
import {
  resolveProfileUpdate,
  type ProductIds,
  type ProfileState,
  type SubscriptionEvent,
} from '../_shared/subscriptionEvents.ts'
import { verifyWebhookSignature } from '../_shared/webhookSignature.ts'

/** RevenueCat's own name for the header — see webhookSignature.ts for the format. */
const SIGNATURE_HEADER = 'X-RevenueCat-Webhook-Signature'

/**
 * Product ids, overridable so Play Console can be renamed without a code
 * change. Defaults match `.env.example` and the client's own config.
 */
const PRODUCTS: ProductIds = {
  monthly: Deno.env.get('REVENUECAT_PRODUCT_MONTHLY') ?? 'scannapp_pro_monthly',
  yearly: Deno.env.get('REVENUECAT_PRODUCT_YEARLY') ?? 'scannapp_pro_yearly',
}

/** Shape of the parts of the RevenueCat webhook body we rely on. */
interface RevenueCatBody {
  event?: {
    id?: string
    type?: string
    app_user_id?: string
    original_app_user_id?: string
    product_id?: string
    store?: string
    environment?: string
    event_timestamp_ms?: number
    expiration_at_ms?: number | null
  }
}

/** Closes out an event so retries of it become no-ops. */
async function markApplied(
  db: ReturnType<typeof serviceClient>,
  eventId: string,
): Promise<void> {
  await db.from('subscription_events').update({ applied: true }).eq('event_id', eventId)
}

/**
 * RevenueCat webhook receiver — the only path by which a purchase changes
 * `profiles.tier`.
 *
 * Unlike the Fase 4 functions this does not use `handler()`: the caller is
 * RevenueCat's server, not a signed-in user, so there is no JWT to verify.
 * Authenticity comes from RevenueCat's HMAC webhook signing instead — see
 * `_shared/webhookSignature.ts`. `REVENUECAT_WEBHOOK_SECRET` holds the
 * *signing secret* from the integration's "HMAC webhook signing" toggle in
 * the RevenueCat dashboard, not a bearer value pasted into an Authorization
 * header.
 */
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const signingSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET')
  if (!signingSecret) {
    // Refuse rather than accept everything: an unset secret would turn this
    // endpoint into a way for anyone to grant themselves Pro.
    console.error('REVENUECAT_WEBHOOK_SECRET belum diset.')
    return errorResponse('NOT_CONFIGURED', 'Webhook belum dikonfigurasi.', 503)
  }

  // Read the body as text FIRST, and verify against those exact bytes. Calling
  // request.json() here and reserialising it later would compute the HMAC
  // over different bytes than RevenueCat signed (key order, whitespace, and
  // unicode escaping can all change on a parse/stringify round trip) and
  // reject every genuine delivery.
  const rawBody = await request.text()

  const verification = await verifyWebhookSignature(
    signingSecret,
    request.headers.get(SIGNATURE_HEADER),
    rawBody,
  )

  if (!verification.ok) {
    console.warn(`Webhook ditolak: ${verification.reason}`)
    return errorResponse('UNAUTHORIZED', 'Signature webhook tidak valid.', 401)
  }

  let body: RevenueCatBody
  try {
    body = JSON.parse(rawBody)
  } catch {
    // Reaching this after a verified signature would be surprising —
    // RevenueCat always signs valid JSON — but a parse failure is still a
    // problem with the body, not with us, so it stays a 400 rather than
    // falling into the catch-all 500 below.
    return errorResponse('BAD_REQUEST', 'Body webhook bukan JSON yang valid.', 400)
  }

  try {
    const raw = body.event

    if (!raw?.id || !raw.type) {
      return errorResponse('BAD_REQUEST', 'Body webhook tidak lengkap.', 400)
    }

    // app_user_id is the Supabase user id, set by Purchases.logIn() at sign-in.
    const userId = raw.app_user_id ?? raw.original_app_user_id ?? null
    const db = serviceClient()

    // Idempotency first: RevenueCat retries failed deliveries, and a RENEWAL
    // applied twice would extend Pro twice. The primary key on event_id is
    // what actually enforces this — a duplicate insert conflicts and stops here.
    const { error: insertError } = await db.from('subscription_events').insert({
      event_id: raw.id,
      user_id: userId,
      event_type: raw.type,
      product_id: raw.product_id ?? null,
      store: raw.store ?? null,
      environment: raw.environment ?? null,
      event_at: new Date(raw.event_timestamp_ms ?? Date.now()).toISOString(),
      expires_at: raw.expiration_at_ms ? new Date(raw.expiration_at_ms).toISOString() : null,
      payload: body,
    })

    if (insertError) {
      // 23505 = unique violation, so this event id arrived before. Whether it
      // is safe to stop depends on whether the tier change actually landed:
      // an earlier attempt may have recorded the event and then failed to
      // update the profile. Replaying that is correct; replaying a completed
      // event would extend Pro a second time.
      if (insertError.code !== '23505') {
        console.error(insertError)
        return errorResponse('DB_ERROR', 'Gagal mencatat event langganan.', 500)
      }

      const { data: previous } = await db
        .from('subscription_events')
        .select('applied')
        .eq('event_id', raw.id)
        .maybeSingle<{ applied: boolean }>()

      if (previous?.applied !== false) return json({ ok: true, duplicate: true })
    }

    if (!userId) {
      // Recorded for audit, but there is no profile to update.
      console.warn(`Event ${raw.id} tanpa app_user_id.`)
      await markApplied(db, raw.id)
      return json({ ok: true, applied: false })
    }

    const { data: profile } = await db
      .from('profiles')
      .select('tier, tier_expires_at, pro_plan')
      .eq('id', userId)
      .maybeSingle<ProfileState>()

    if (!profile) {
      console.warn(`Event ${raw.id}: profil ${userId} tidak ditemukan.`)
      await markApplied(db, raw.id)
      return json({ ok: true, applied: false })
    }

    const event: SubscriptionEvent = {
      type: raw.type,
      appUserId: userId,
      productId: raw.product_id ?? null,
      expiresAtMs: raw.expiration_at_ms ?? null,
      eventAtMs: raw.event_timestamp_ms ?? Date.now(),
    }

    const update = resolveProfileUpdate(profile, event, PRODUCTS)
    if (!update) {
      // Nothing to change is a finished outcome, not a pending one — mark it
      // so a retry does not keep re-reading the profile forever.
      await markApplied(db, raw.id)
      return json({ ok: true, applied: false })
    }

    const { error: updateError } = await db
      .from('profiles')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', userId)

    if (updateError) {
      console.error(updateError)
      // Left unapplied on purpose: returning 500 makes RevenueCat retry, and
      // the retry will find `applied = false` and try the update again.
      return errorResponse('DB_ERROR', 'Gagal memperbarui tier.', 500)
    }

    // Keep the stored quota in step with the new plan, so the backup functions
    // and the in-app indicator agree straight away.
    await db
      .from('storage_usage')
      .update({
        quota_bytes: update.pro_plan ? QUOTA_BYTES[update.pro_plan] : QUOTA_BYTES.basic,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)

    await markApplied(db, raw.id)

    return json({ ok: true, applied: true, tier: update.tier })
  } catch (caught) {
    console.error(caught)
    return errorResponse('INTERNAL_ERROR', 'Terjadi kesalahan di server.', 500)
  }
})
