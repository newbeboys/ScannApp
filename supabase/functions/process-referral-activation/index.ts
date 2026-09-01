import { errorResponse, handler, json, serviceClient } from '../_shared/http.ts'
import { extendExpiry, nextProPlan, REFERRED_USER_BONUS_DAYS, unclaimedMilestones } from '../_shared/referral.ts'

Deno.serve(
  handler(async (_request, user) => {
    const db = serviceClient()

    const { data: caller } = await db
      .from('profiles')
      .select('referred_by')
      .eq('id', user.id)
      .maybeSingle()

    const referrerId = caller?.referred_by as string | null | undefined

    // Not a referred account -- nothing to do, and nothing written. This
    // function's only job is referral bookkeeping, not general activity
    // tracking for every user.
    if (!referrerId) return json({ activated: false })

    // Idempotent bookkeeping: only ever set once (guarded by `.is(..., null)`
    // below), harmless to repeat on every call.
    await db
      .from('profiles')
      .update({ first_scan_completed_at: new Date().toISOString() })
      .eq('id', user.id)
      .is('first_scan_completed_at', null)

    // Flip this event to activated -- but only the first time. Zero rows
    // updated means a previous call already did this; stop here rather than
    // re-granting a reward that already went out.
    const { data: justActivated, error: activateError } = await db
      .from('referral_events')
      .update({ activated: true, activated_at: new Date().toISOString() })
      .eq('referrer_id', referrerId)
      .eq('referred_id', user.id)
      .eq('activated', false)
      .select('id')

    if (activateError) {
      console.error(activateError)
      return errorResponse('DB_ERROR', 'Gagal mencatat aktivasi referral.', 500)
    }

    if (!justActivated || justActivated.length === 0) {
      return json({ activated: false })
    }

    const eventId = justActivated[0].id as string

    // "Give X get Y": the referred user's own bonus, unconditional on
    // whether this activation also crosses a referrer milestone below.
    const { data: referredProfile } = await db
      .from('profiles')
      .select('id, tier, tier_expires_at, pro_plan')
      .eq('id', user.id)
      .maybeSingle()

    if (referredProfile) {
      const { error: bonusError } = await db
        .from('profiles')
        .update({
          tier: 'pro',
          tier_expires_at: extendExpiry(referredProfile, REFERRED_USER_BONUS_DAYS),
          pro_plan: nextProPlan(referredProfile),
        })
        .eq('id', user.id)

      if (bonusError) {
        console.error(bonusError)
        return errorResponse('DB_ERROR', 'Gagal memberikan bonus referral untuk akun ini.', 500)
      }
    }

    // Milestone check for the referrer. See unclaimedMilestones() for why this
    // is >= plus an idempotent per-milestone ledger, not a single exact-match
    // lookup -- concurrent activations from different referred users of the
    // same referrer can otherwise make a milestone silently unreachable.
    const { count } = await db
      .from('referral_events')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_id', referrerId)
      .eq('activated', true)

    const { data: milestones } = await db
      .from('referral_milestones')
      .select('referral_count_required, pro_days_reward')
      .eq('active', true)

    const { data: grantRows } = await db
      .from('referral_milestone_grants')
      .select('referral_count_required')
      .eq('referrer_id', referrerId)

    const grantedCounts = (grantRows ?? []).map((row) => row.referral_count_required as number)
    const pending = unclaimedMilestones(count ?? 0, milestones ?? [], grantedCounts)

    let milestoneReached: number | null = null

    for (const milestone of pending) {
      // Idempotent claim: the primary key (referrer_id, referral_count_required)
      // rejects a second insert for the same milestone. 23505 here means a
      // concurrent request already claimed it -- skip without granting twice,
      // same convention as confirm-upload/index.ts and revenuecat-webhook/index.ts.
      const { error: claimError } = await db
        .from('referral_milestone_grants')
        .insert({ referrer_id: referrerId, referral_count_required: milestone.referral_count_required })

      if (claimError) {
        if (claimError.code === '23505') continue
        console.error(claimError)
        return errorResponse('DB_ERROR', 'Gagal mencatat klaim milestone referral.', 500)
      }

      const { data: referrerProfile } = await db
        .from('profiles')
        .select('id, tier, tier_expires_at, pro_plan')
        .eq('id', referrerId)
        .maybeSingle()

      if (!referrerProfile) continue

      const { error: milestoneError } = await db
        .from('profiles')
        .update({
          tier: 'pro',
          tier_expires_at: extendExpiry(referrerProfile, milestone.pro_days_reward),
          pro_plan: nextProPlan(referrerProfile),
        })
        .eq('id', referrerId)

      if (milestoneError) {
        console.error(milestoneError)
        return errorResponse('DB_ERROR', 'Gagal memberikan bonus milestone referral.', 500)
      }

      milestoneReached = milestone.referral_count_required
    }

    if (milestoneReached !== null) {
      const { error: rewardFlagError } = await db
        .from('referral_events')
        .update({ reward_granted: true })
        .eq('id', eventId)

      if (rewardFlagError) {
        console.error(rewardFlagError)
        return errorResponse('DB_ERROR', 'Gagal mencatat status reward referral.', 500)
      }
    }

    // NOTE: the steps above are separate round-trips, not one transaction --
    // same trade-off confirm-upload already makes. A network drop between
    // "activated=true" and "reward granted" leaves the event activated but
    // unrewarded, with no automatic retry (the client's local flag stops
    // calling again after any 200 response). Accepted for v1, same risk
    // class as confirm-upload's documented R2-orphan gap.
    return json({ activated: true, milestone_reached: milestoneReached })
  }),
)
