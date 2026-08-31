import { handler, json, serviceClient } from '../_shared/http.ts'
import { extendExpiry, matchedMilestone, nextProPlan, REFERRED_USER_BONUS_DAYS } from '../_shared/referral.ts'

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
    const { data: justActivated } = await db
      .from('referral_events')
      .update({ activated: true, activated_at: new Date().toISOString() })
      .eq('referrer_id', referrerId)
      .eq('referred_id', user.id)
      .eq('activated', false)
      .select('id')

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
      await db
        .from('profiles')
        .update({
          tier: 'pro',
          tier_expires_at: extendExpiry(referredProfile, REFERRED_USER_BONUS_DAYS),
          pro_plan: nextProPlan(referredProfile),
        })
        .eq('id', user.id)
    }

    // Milestone check for the referrer.
    const { count } = await db
      .from('referral_events')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_id', referrerId)
      .eq('activated', true)

    const { data: milestones } = await db
      .from('referral_milestones')
      .select('referral_count_required, pro_days_reward')
      .eq('active', true)

    const milestone = matchedMilestone(count ?? 0, milestones ?? [])
    let milestoneReached: number | null = null

    if (milestone) {
      const { data: referrerProfile } = await db
        .from('profiles')
        .select('id, tier, tier_expires_at, pro_plan')
        .eq('id', referrerId)
        .maybeSingle()

      if (referrerProfile) {
        await db
          .from('profiles')
          .update({
            tier: 'pro',
            tier_expires_at: extendExpiry(referrerProfile, milestone.pro_days_reward),
            pro_plan: nextProPlan(referrerProfile),
          })
          .eq('id', referrerId)

        await db.from('referral_events').update({ reward_granted: true }).eq('id', eventId)
        milestoneReached = milestone.referral_count_required
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
