import type { DocumentEntry } from './documentEntries'

/** Judul yang tampil untuk satu entri, dari sisi manapun ia berasal. */
function titleOf(entry: DocumentEntry): string {
  return entry.kind === 'local' ? entry.document.title : entry.backup.title
}

/**
 * Menyaring daftar dokumen berdasarkan judul: cocok sebagian, tanpa peduli
 * huruf besar/kecil. Query kosong (atau cuma spasi) mengembalikan `entries`
 * apa adanya.
 *
 * Ikut menyaring baris "Di cloud" lewat judul cadangannya -- dokumen yang
 * belum dipulihkan ke HP tetap harus bisa ditemukan, bukan cuma yang sudah
 * ada page file-nya di sini.
 */
export function filterEntriesByQuery(entries: DocumentEntry[], query: string): DocumentEntry[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return entries

  return entries.filter((entry) => titleOf(entry).toLowerCase().includes(needle))
}
