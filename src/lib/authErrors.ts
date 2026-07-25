const GENERIC = 'Terjadi kesalahan. Coba lagi sebentar lagi.'

/**
 * Supabase returns English strings that mean nothing to our users, and its
 * wording shifts between releases — so match loosely on a distinctive
 * fragment rather than the whole sentence.
 */
const RULES: { match: string; message: string }[] = [
  {
    match: 'invalid login credentials',
    message: 'Email atau password salah.',
  },
  {
    match: 'email not confirmed',
    message: 'Email ini belum diverifikasi. Buka email verifikasi dari kami, lalu coba masuk lagi.',
  },
  {
    match: 'already registered',
    message: 'Email ini sudah terdaftar. Coba masuk atau pakai "Lupa password".',
  },
  {
    match: 'password should be at least',
    message: 'Password minimal 6 karakter.',
  },
  {
    match: 'unable to validate email address',
    message: 'Format email tidak valid.',
  },
  {
    match: 'invalid email',
    message: 'Format email tidak valid.',
  },
  {
    match: 'for security purposes',
    message: 'Terlalu sering mencoba. Mohon tunggu sebentar sebelum mencoba lagi.',
  },
  {
    match: 'rate limit',
    message: 'Terlalu sering mencoba. Mohon tunggu sebentar sebelum mencoba lagi.',
  },
  {
    match: 'failed to fetch',
    message: 'Tidak ada koneksi internet. Periksa jaringan lalu coba lagi.',
  },
  {
    match: 'network',
    message: 'Tidak ada koneksi internet. Periksa jaringan lalu coba lagi.',
  },
]

/** Maps a Supabase auth error to a message worth showing a user. */
export function translateAuthError(error: { message?: string } | null | undefined): string {
  const raw = error?.message?.toLowerCase()
  if (!raw) return GENERIC

  return RULES.find((rule) => raw.includes(rule.match))?.message ?? GENERIC
}
