import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const from = vi.fn()

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke }, from },
}))

const { fetchReferralProgress, triggerReferralActivation } = await import('./referralApi')

beforeEach(() => {
  invoke.mockReset()
  from.mockReset()
})

describe('fetchReferralProgress', () => {
  /** Mimics the PostgREST count-only builder: select+eq resolves directly. */
  function countBuilder(count: number) {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(async () => ({ data: null, count, error: null })),
    }
    return builder
  }

  /** Mimics the milestone list builder: select+eq chain, order resolves. */
  function milestoneBuilder(rows: Record<string, unknown>[]) {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      order: vi.fn(async () => ({ data: rows, error: null })),
    }
    return builder
  }

  it('reports the activated count and the milestone ladder', async () => {
    from.mockImplementation((table: string) =>
      table === 'referral_events'
        ? countBuilder(6)
        : milestoneBuilder([
            { referral_count_required: 5, pro_days_reward: 7 },
            { referral_count_required: 15, pro_days_reward: 25 },
            { referral_count_required: 30, pro_days_reward: 60 },
          ]),
    )

    const progress = await fetchReferralProgress()

    expect(progress.activatedCount).toBe(6)
    expect(progress.milestones).toEqual([
      { count: 5, proDays: 7 },
      { count: 15, proDays: 25 },
      { count: 30, proDays: 60 },
    ])
  })

  it('reads zero activations as zero, not null', async () => {
    from.mockImplementation((table: string) =>
      table === 'referral_events' ? countBuilder(0) : milestoneBuilder([]),
    )

    expect((await fetchReferralProgress()).activatedCount).toBe(0)
  })
})

describe('triggerReferralActivation', () => {
  it('calls the Edge Function with no body', async () => {
    invoke.mockResolvedValue({ data: { activated: false }, error: null })

    await triggerReferralActivation()

    expect(invoke).toHaveBeenCalledWith('process-referral-activation', { body: {} })
  })
})
