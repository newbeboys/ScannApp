import { useEffect, useState } from 'react'
import { ArrowRightIcon, CheckIcon, ChevronLeftIcon } from '../components/Icons'
import type { PlanId } from '../lib/purchases/purchaseConfig'
import {
  loadPlans,
  purchasePlan,
  restorePurchases,
  type PlanOption,
} from '../lib/purchases/purchasesService'
import { limitRows } from '../lib/upgradeLedger'

interface UpgradeScreenProps {
  onClose: () => void
  /** Called after a purchase or restore succeeds, so the profile is re-read. */
  onUpgraded: () => void
  onNotice: (message: string) => void
}

const PLAN_LABELS: Record<PlanId, { name: string; per: string }> = {
  monthly: { name: 'Bulanan', per: '/bulan' },
  yearly: { name: 'Tahunan', per: '/tahun' },
}

export function UpgradeScreen({ onClose, onUpgraded, onNotice }: UpgradeScreenProps) {
  const [plans, setPlans] = useState<PlanOption[] | null>(null)
  // Yearly first: it is the better deal per month and carries the larger quota.
  const [selected, setSelected] = useState<PlanId>('yearly')
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadPlans().then((loaded) => {
      if (!cancelled) setPlans(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const chosen = plans?.find((plan) => plan.id === selected) ?? null

  const run = async (action: () => Promise<Awaited<ReturnType<typeof purchasePlan>>>) => {
    setIsBusy(true)
    try {
      const outcome = await action()
      if (outcome.status === 'purchased') {
        // The tier itself arrives via the webhook, so refresh rather than
        // assume — see spec Fase 5 Bagian 2.
        onUpgraded()
        onNotice('Terima kasih! Pro sedang diaktifkan.')
        onClose()
        return
      }
      if (outcome.status === 'unavailable') onNotice(outcome.message)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="screen screen--flow">
      <header className="flow-header">
        <button type="button" className="icon-button" onClick={onClose} aria-label="Kembali">
          <ChevronLeftIcon size={20} />
        </button>
        <div className="flow-header__titles">
          <h1>Naik ke Pro</h1>
          <p>Batas Basic yang hilang</p>
        </div>
      </header>

      <section className="card upgrade-ledger">
        <span className="pro-badge">Pro</span>
        <ul>
          {limitRows(selected).map((row) => (
            <li key={row.label}>
              <p className="upgrade-ledger__label">{row.label}</p>
              <div className="upgrade-ledger__change">
                <span className="upgrade-ledger__from">{row.basic}</span>
                <ArrowRightIcon size={15} className="upgrade-ledger__arrow" />
                <span className="upgrade-ledger__to">{row.pro}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="plan-picker" role="radiogroup" aria-label="Pilih paket">
        {(['yearly', 'monthly'] as const).map((id) => {
          const plan = plans?.find((entry) => entry.id === id)
          const active = selected === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`plan-option${active ? ' plan-option--active' : ''}`}
              onClick={() => setSelected(id)}
            >
              <span className="plan-option__check">{active && <CheckIcon size={13} />}</span>
              <span className="plan-option__body">
                <span className="plan-option__name">{PLAN_LABELS[id].name}</span>
                <span className="plan-option__price">
                  {plan ? plan.priceString : '…'}
                  <span className="plan-option__per">{PLAN_LABELS[id].per}</span>
                </span>
              </span>
              {/* Rp 15.000 x 12 = Rp 180.000 vs Rp 150.000 setahun. */}
              {id === 'yearly' && <span className="plan-option__save">Hemat 17%</span>}
            </button>
          )
        })}
      </div>

      <div className="flow-footer upgrade-footer">
        <button
          type="button"
          className="button button--upgrade"
          disabled={isBusy || chosen === null}
          onClick={() => chosen && run(() => purchasePlan(chosen))}
        >
          {isBusy ? 'Memproses…' : `Langganan ${PLAN_LABELS[selected].name}`}
        </button>

        <button
          type="button"
          className="link-button"
          disabled={isBusy}
          onClick={() => run(restorePurchases)}
        >
          Pulihkan pembelian
        </button>

        <p className="upgrade-terms">
          Langganan diperpanjang otomatis sampai dibatalkan. Batalkan kapan saja lewat Google Play
          &rsaquo; Langganan. Pembayaran ditagih ke akun Google Play kamu.
        </p>
      </div>
    </div>
  )
}
