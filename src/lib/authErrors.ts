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
  /*
    Recovery OTP. Supabase words the same failure at least three ways —
    "Token has expired or is invalid", a bare "Invalid token", and the
    `otp_expired` error code — and deliberately refuses to say which of the two
    it was, so the user is not told whether the code merely mistyped or the
    whole window has closed. One message that covers both, and points at the
    way out, beats guessing.
  */
  {
    match: 'token has expired or is invalid',
    message: 'Kode verifikasi salah atau sudah kedaluwarsa. Minta kode baru.',
  },
  {
    match: 'otp_expired',
    message: 'Kode verifikasi sudah kedaluwarsa. Minta kode baru.',
  },
  {
    match: 'invalid token',
    message: 'Kode verifikasi salah atau sudah kedaluwarsa. Minta kode baru.',
  },
  {
    match: 'token has expired',
    message: 'Kode verifikasi sudah kedaluwarsa. Minta kode baru.',
  },
  {
    // "Email link is invalid or has expired" — the same rejection worded for
    // the magic-link flow, which the recovery endpoint still falls back to.
    match: 'invalid or has expired',
    message: 'Kode verifikasi salah atau sudah kedaluwarsa. Minta kode baru.',
  },
  {
    match: 'should be different from the old password',
    message: 'Password baru harus berbeda dari password lama.',
  },
  {
    // The recovery session was revoked or expired between the code and the save.
    match: 'auth session missing',
    message: 'Sesi pemulihan sudah berakhir. Ulangi dari "Lupa password".',
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
