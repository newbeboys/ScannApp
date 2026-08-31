import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ReferralProgress } from '../lib/referralApi'
import { ReferralScreen } from './ReferralScreen'

const PROGRESS: ReferralProgress = {
  activatedCount: 6,
  milestones: [
    { count: 5, proDays: 7 },
    { count: 15, proDays: 25 },
    { count: 30, proDays: 60 },
  ],
}

describe('ReferralScreen', () => {
  it('shows the referral code', async () => {
    const screen = await render(
      <ReferralScreen
        referralCode="K7M2N9PQ"
        onBack={() => {}}
        onError={() => {}}
        fetchProgress={async () => PROGRESS}
        shareCode={async () => {}}
      />,
    )

    await expect.element(screen.getByText('K7M2N9PQ')).toBeVisible()
  })

  it('marks a milestone already crossed as reached', async () => {
    const screen = await render(
      <ReferralScreen
        referralCode="K7M2N9PQ"
        onBack={() => {}}
        onError={() => {}}
        fetchProgress={async () => PROGRESS}
        shareCode={async () => {}}
      />,
    )

    await expect.element(screen.getByText(/5 orang.*7 hari Pro.*Tercapai/)).toBeVisible()
  })

  it('does not mark an unreached milestone as reached', async () => {
    const screen = await render(
      <ReferralScreen
        referralCode="K7M2N9PQ"
        onBack={() => {}}
        onError={() => {}}
        fetchProgress={async () => PROGRESS}
        shareCode={async () => {}}
      />,
    )

    await expect.element(screen.getByText(/15 orang.*25 hari Pro/)).not.toHaveTextContent('Tercapai')
  })

  it('reports an error when progress fails to load', async () => {
    const onError = vi.fn()
    await render(
      <ReferralScreen
        referralCode="K7M2N9PQ"
        onBack={() => {}}
        onError={onError}
        fetchProgress={async () => {
          throw new Error('network down')
        }}
        shareCode={async () => {}}
      />,
    )

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Gagal memuat progres referral.'))
  })
})
