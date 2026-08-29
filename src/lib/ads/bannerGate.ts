/**
 * Kapan banner AdMob boleh tampil.
 *
 * Dipisah dari `useAdBanner` dengan alasan yang sama seperti `appOpenGate`:
 * keputusan "iklan ini boleh muncul atau tidak" adalah aturan kebijakan, dan
 * aturan kebijakan harus bisa diuji tanpa menyeret plugin AdMob.
 */

export interface BannerContext {
  /** User sudah masuk akun. */
  signedIn: boolean
  /** Layar tab sedang tampil — bukan editor, pemindai, merge, atau paywall. */
  onTabs: boolean
  /** Ada halaman hasil pindai yang menunggu ditinjau. */
  reviewingScan: boolean
  /**
   * Ada lembar (bottom sheet) yang menutupi layar tab.
   *
   * Banner adalah view native yang menempel di bawah layar, di *atas* WebView,
   * jadi ia tidak ikut tertutup oleh lembar yang digambar di dalam WebView —
   * ia justru menimpanya.
   */
  sheetOpen: boolean
}

/**
 * Banner hanya di layar tab yang benar-benar terlihat (CLAUDE.md Bagian 6:
 * "Banner di layar tab saja").
 *
 * `sheetOpen` ada di sini karena `onTabs` saja tidak cukup: sebuah lembar
 * muncul di atas layar tab tanpa mengganti layarnya, jadi selama gerbangnya
 * cuma menanyakan layar apa yang aktif, banner tetap tampil dan duduk persis
 * di atas tombol aksi lembar itu — yang dilaporkan Boss Ali dari HP pada
 * 26 Agustus 2026: banner menutupi tombol "Ekspor 3 PDF" tepat saat user
 * hendak menekannya.
 */
export function shouldShowBanner(context: BannerContext): boolean {
  return context.signedIn && context.onTabs && !context.reviewingScan && !context.sheetOpen
}
