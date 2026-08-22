import { describe, expect, it } from 'vitest'
import { createResumeTracker, OWN_FLOW_GRACE_MS, RESUME_AWAY_MS } from './appOpenGate'

describe('createResumeTracker', () => {
  it('menampilkan iklan saat user kembali setelah pergi lebih dari 5 detik', () => {
    const tracker = createResumeTracker()
    tracker.hidden(0)

    expect(tracker.visible('basic', RESUME_AWAY_MS + 1)).toBe(true)
  })

  it('tidak menampilkan iklan untuk perpindahan sekejap', () => {
    const tracker = createResumeTracker()
    tracker.hidden(0)

    expect(tracker.visible('basic', 3000)).toBe(false)
  })

  it('menghitung tepat 5 detik sebagai cukup lama', () => {
    const tracker = createResumeTracker()
    tracker.hidden(0)

    expect(tracker.visible('basic', RESUME_AWAY_MS)).toBe(true)
  })

  /**
   * Kasus yang paling menentukan. Pemindai ML Kit, share sheet Android, file
   * picker dan alur pembelian semuanya activity terpisah — WebView melihatnya
   * persis seperti user pergi ke aplikasi lain. Tanpa penanda ini, tiap selesai
   * memindai user langsung disambut iklan layar penuh.
   */
  it('tidak menampilkan iklan setelah alur yang kita sendiri yang memulai', () => {
    const tracker = createResumeTracker()
    tracker.leaveForOwnFlow(0)
    tracker.hidden(0)

    expect(tracker.visible('basic', 60_000)).toBe(false)
  })

  /**
   * Iklan layar penuh milik AdMob juga activity terpisah. Tanpa penandaan yang
   * sama, menutup interstitial setelah lebih dari 5 detik akan langsung
   * memanggil App Open ad di atasnya — dan App Open ad menutup dirinya sendiri
   * dengan cara yang sama, jadi iklannya bisa beruntun tanpa henti.
   */
  it('tidak memicu iklan lagi setelah iklan layar penuh kita sendiri ditutup', () => {
    const tracker = createResumeTracker()
    tracker.leaveForOwnFlow(0)
    tracker.hidden(10)

    expect(tracker.visible('basic', 30_000)).toBe(false)
  })

  /**
   * Penanda dipasang sebelum panggilan yang mengirim user pergi, karena
   * setelah di-await kita tidak kebagian giliran lagi. Panggilan itu bisa
   * gagal tanpa pernah berpindah aplikasi — dan penanda yang nyangkut akan
   * diam-diam memakan kepergian sungguhan berikutnya.
   */
  it('melupakan alur internal yang ternyata tidak jadi berpindah aplikasi', () => {
    const tracker = createResumeTracker()
    tracker.leaveForOwnFlow(0)

    // Panggilannya gagal; aplikasi tidak ke mana-mana. Jauh setelah itu user
    // benar-benar pergi sendiri.
    tracker.hidden(OWN_FLOW_GRACE_MS + 1)

    expect(tracker.visible('basic', OWN_FLOW_GRACE_MS + 60_000)).toBe(true)
  })

  it('kembali normal setelah satu alur internal selesai', () => {
    const tracker = createResumeTracker()
    tracker.leaveForOwnFlow(0)
    tracker.hidden(0)
    tracker.visible('basic', 60_000)

    // Kali ini user benar-benar pergi sendiri.
    tracker.hidden(100_000)
    expect(tracker.visible('basic', 160_000)).toBe(true)
  })

  it('tidak menampilkan apa pun tanpa kepergian yang tercatat', () => {
    const tracker = createResumeTracker()

    expect(tracker.visible('basic', 999_999)).toBe(false)
  })

  it('tidak menampilkan iklan dua kali untuk satu kali kepergian', () => {
    const tracker = createResumeTracker()
    tracker.hidden(0)

    expect(tracker.visible('basic', 60_000)).toBe(true)
    expect(tracker.visible('basic', 61_000)).toBe(false)
  })

  it('tidak pernah menampilkan iklan untuk Pro', () => {
    const tracker = createResumeTracker()
    tracker.hidden(0)

    expect(tracker.visible('pro', 60_000)).toBe(false)
  })

  /** Kepergian selama Pro tidak boleh menumpuk lalu meledak saat jadi Basic. */
  it('tidak menyimpan kepergian yang terjadi selama Pro', () => {
    const tracker = createResumeTracker()
    tracker.hidden(0)
    tracker.visible('pro', 60_000)

    expect(tracker.visible('basic', 120_000)).toBe(false)
  })
})
