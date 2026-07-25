import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

export function errorResponse(code: string, message: string, status: number): Response {
  return json({ error: code, message }, status)
}

/**
 * Service-role client. Writes to `storage_usage` and `scan_documents` have to
 * bypass RLS, which is exactly why those tables have no client-facing write
 * policies — every mutation goes through a function that checked the caller
 * first. The secret name is fixed by CLAUDE.md Bagian 7.
 */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('ScannAppsecret')

  if (!url || !key) throw new Error('SUPABASE_URL atau ScannAppsecret belum diset.')

  return createClient(url, key, { auth: { persistSession: false } })
}

/**
 * Resolves the caller from their JWT. Returns null when the token is missing,
 * expired, or forged — callers must treat that as 401 and stop.
 */
export async function authenticate(request: Request): Promise<{ id: string } | null> {
  const header = request.headers.get('Authorization')
  const token = header?.replace(/^Bearer\s+/i, '')
  if (!token) return null

  const { data, error } = await serviceClient().auth.getUser(token)
  if (error || !data.user) return null

  return { id: data.user.id }
}

/** Wraps a handler with CORS preflight, auth, and uniform error reporting. */
export function handler(
  run: (request: Request, user: { id: string }) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (request.method === 'OPTIONS') {
      return new Response('ok', { headers: CORS_HEADERS })
    }

    try {
      const user = await authenticate(request)
      if (!user) {
        return errorResponse('UNAUTHORIZED', 'Sesi tidak valid. Masuk lagi lalu coba ulang.', 401)
      }

      return await run(request, user)
    } catch (caught) {
      console.error(caught)
      return errorResponse('INTERNAL_ERROR', 'Terjadi kesalahan di server.', 500)
    }
  }
}
