import { callFunction } from './edgeFunctionClient'
import { supabase } from './supabase'

export interface ReferralMilestone {
  count: number
  proDays: number
}

export interface ReferralProgress {
  activatedCount: number
  milestones: ReferralMilestone[]
}

interface MilestoneRow {
  referral_count_required: number
  pro_days_reward: number
}

/**
 * Own referral progress: how many invited friends have activated, and the
 * milestone ladder. RLS already scopes `referral_events` to rows where the
 * caller is the referrer, so no id has to be passed in.
 */
export async function fetchReferralProgress(): Promise<ReferralProgress> {
  const [
    { count, error: countError },
    { data: milestoneRows, error: milestonesError },
  ] = await Promise.all([
    supabase.from('referral_events').select('id', { count: 'exact', head: true }).eq('activated', true),
    supabase
      .from('referral_milestones')
      .select('referral_count_required, pro_days_reward')
      .eq('active', true)
      .order('referral_count_required', { ascending: true }),
  ])

  if (countError) throw countError
  if (milestonesError) throw milestonesError

  return {
    activatedCount: count ?? 0,
    milestones: ((milestoneRows ?? []) as MilestoneRow[]).map((row) => ({
      count: row.referral_count_required,
      proDays: row.pro_days_reward,
    })),
  }
}

/** Tells the server this install just finished its first scan, so a pending referral (if any) can activate. */
export async function triggerReferralActivation(): Promise<void> {
  await callFunction('process-referral-activation', {})
}
