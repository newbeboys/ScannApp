/**
 * Verifies RevenueCat's HMAC webhook signatures.
 *
 * @see https://www.revenuecat.com/docs/integrations/webhooks
 *
 * Every delivery carries `X-RevenueCat-Webhook-Signature: t=<unix_seconds>,
 * v1=<hmac_sha256_hex>`. The HMAC is computed over `"{t}.{raw_body}"` using the
 * integration's signing secret — the *exact bytes* of the request body, before
 * any JSON parsing. This is why callers must pass `rawBody` from
 * `request.text()`, never from re-stringifying a parsed object: JSON.parse
 * followed by JSON.stringify can reorder keys, change whitespace, or
 * re-escape unicode, producing different bytes than what RevenueCat signed —
 * which would reject genuine, unmodified requests.
 *
 * Uses Web Crypto (`crypto.subtle`), available as a global in both the Deno
 * Edge Function runtime and Node 19+, so this file needs no Deno-only APIs and
 * the same test suite that covers it in Vitest covers the real code path.
 */

export interface ParsedSignature {
  timestampSeconds: number
  /** Lowercased hex digest from the header. */
  signatureHex: string
}

const HEADER_SHAPE = /^t=(\d+),v1=([0-9a-fA-F]+)$/

/**
 * Parses `t=<unix_seconds>,v1=<hex>`.
 *
 * Returns null for anything that does not match that exact shape — a
 * malformed or absent header is treated identically by the caller. Trying to
 * salvage a partial match would only make the parser more permissive than the
 * format RevenueCat actually sends.
 */
export function parseSignatureHeader(header: string | null): ParsedSignature | null {
  if (!header) return null

  const match = HEADER_SHAPE.exec(header.trim())
  if (!match) return null

  const timestampSeconds = Number(match[1])
  if (!Number.isSafeInteger(timestampSeconds)) return null

  return { timestampSeconds, signatureHex: match[2].toLowerCase() }
}

/**
 * True when a delivery's timestamp is close enough to now to trust.
 *
 * Rejects both directions of skew. An old timestamp is a replayed request; a
 * timestamp in the future is not something a genuine delivery should ever
 * carry, so it is rejected the same way rather than given the benefit of the
 * doubt.
 */
export function isWithinTolerance(
  timestampSeconds: number,
  now: Date,
  toleranceSeconds: number,
): boolean {
  const deltaSeconds = Math.abs(now.getTime() / 1000 - timestampSeconds)
  return deltaSeconds <= toleranceSeconds
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** HMAC-SHA256 of `"{timestampSeconds}.{rawBody}"`, hex-encoded. */
async function computeSignature(
  secret: string,
  timestampSeconds: number,
  rawBody: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestampSeconds}.${rawBody}`),
  )

  return toHex(digest)
}

/**
 * Constant-time comparison of two equal-shape hex strings.
 *
 * Both inputs come from `[0-9a-f]+` sources (the parsed header and our own hex
 * encoder), so a length mismatch is a genuine "different value" rather than an
 * attempt to leak length through an early return — see the identical
 * reasoning historically used for the bearer-secret comparison this replaces.
 */
function hexEqual(a: string, b: string): boolean {
  const bytesA = new TextEncoder().encode(a)
  const bytesB = new TextEncoder().encode(b)
  if (bytesA.length !== bytesB.length) return false

  let diff = 0
  for (let i = 0; i < bytesA.length; i += 1) diff |= bytesA[i] ^ bytesB[i]
  return diff === 0
}

export type VerifyFailureReason =
  | 'missing_header'
  | 'malformed_header'
  | 'stale_timestamp'
  | 'signature_mismatch'

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailureReason }

/**
 * Verifies one RevenueCat webhook delivery end to end: header shape, replay
 * window, then the signature itself.
 *
 * Order matters here for cost, not correctness: shape and timestamp checks
 * are free, so they run before the HMAC computation. A flood of malformed or
 * stale requests never reaches `crypto.subtle`.
 */
export async function verifyWebhookSignature(
  secret: string,
  header: string | null,
  rawBody: string,
  now: Date = new Date(),
  toleranceSeconds = 300,
): Promise<VerifyResult> {
  const parsed = parseSignatureHeader(header)
  if (!parsed) return { ok: false, reason: header ? 'malformed_header' : 'missing_header' }

  if (!isWithinTolerance(parsed.timestampSeconds, now, toleranceSeconds)) {
    return { ok: false, reason: 'stale_timestamp' }
  }

  const expected = await computeSignature(secret, parsed.timestampSeconds, rawBody)
  if (!hexEqual(parsed.signatureHex, expected)) {
    return { ok: false, reason: 'signature_mismatch' }
  }

  return { ok: true }
}
