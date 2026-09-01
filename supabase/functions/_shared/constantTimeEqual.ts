/**
 * Constant-time string comparison, for anywhere a request carries a shared
 * secret instead of a user JWT — RevenueCat's webhook HMAC digest
 * (`webhookSignature.ts`), the cron job's `x-cron-secret`
 * (`orphanCleanup.ts`), and any future one.
 *
 * A length mismatch returns immediately rather than padding to a common
 * length first: every caller here compares secrets long enough (32+ random
 * bytes, or a hex HMAC digest) that knowing the length alone gives an
 * attacker nothing worth trading a variable-time compare for.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bytesA = new TextEncoder().encode(a)
  const bytesB = new TextEncoder().encode(b)
  if (bytesA.length !== bytesB.length) return false

  let diff = 0
  for (let i = 0; i < bytesA.length; i += 1) diff |= bytesA[i] ^ bytesB[i]
  return diff === 0
}
