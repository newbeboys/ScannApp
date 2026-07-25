import { AwsClient } from 'npm:aws4fetch@1.0.20'

/** Short-lived on purpose: a leaked link stops working within minutes. */
export const SIGNED_URL_TTL_SECONDS = 600

function config() {
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')
  const endpoint = Deno.env.get('R2_ENDPOINT')
  const bucket = Deno.env.get('R2_BUCKET_NAME')

  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) {
    throw new Error('Secret R2 belum lengkap di Edge Function Secrets.')
  }

  return {
    client: new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' }),
    // The endpoint may or may not already include the bucket; normalise both.
    base: endpoint.replace(/\/+$/, '').endsWith(`/${bucket}`)
      ? endpoint.replace(/\/+$/, '')
      : `${endpoint.replace(/\/+$/, '')}/${bucket}`,
  }
}

function objectUrl(base: string, objectKey: string): string {
  return `${base}/${objectKey.split('/').map(encodeURIComponent).join('/')}`
}

/** Presigns a URL the client uses to talk to R2 directly, never through us. */
async function presign(objectKey: string, method: 'PUT' | 'GET'): Promise<string> {
  const { client, base } = config()

  const url = new URL(objectUrl(base, objectKey))
  url.searchParams.set('X-Amz-Expires', String(SIGNED_URL_TTL_SECONDS))

  const signed = await client.sign(url.toString(), {
    method,
    aws: { signQuery: true },
  })

  return signed.url
}

export function presignUpload(objectKey: string): Promise<string> {
  return presign(objectKey, 'PUT')
}

export function presignDownload(objectKey: string): Promise<string> {
  return presign(objectKey, 'GET')
}

/**
 * Deletes the object. An object that is already gone counts as success so the
 * caller stays idempotent — the database row still has to be cleaned up.
 */
export async function deleteObject(objectKey: string): Promise<void> {
  const { client, base } = config()

  const response = await client.fetch(objectUrl(base, objectKey), { method: 'DELETE' })

  if (!response.ok && response.status !== 404) {
    throw new Error(`Gagal menghapus object R2: ${response.status}`)
  }
}
