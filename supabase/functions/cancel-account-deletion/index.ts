/**
 * Calls off a pending account deletion, any time inside the 7-day grace period.
 *
 * BACKEND_API_DESIGN.md Bagian 12.
 */
import { errorResponse, handler, json, serviceClient } from '../_shared/http.ts'

Deno.serve(
  handler(async (_request, user) => {
    const db = serviceClient()

    // Idempotent on purpose: a user who taps "Batalkan Penghapusan" twice, or
    // whose first tap succeeded on a connection that dropped before the reply
    // arrived, must see success — not an error implying the account is still
    // scheduled for deletion when it is not.
    const { error } = await db
      .from('profiles')
      .update({ deletion_requested_at: null, updated_at: new Date().toISOString() })
      .eq('id', user.id)

    if (error) {
      console.error(error)
      return errorResponse('DB_ERROR', 'Gagal membatalkan penghapusan akun.', 500)
    }

    console.log(JSON.stringify({ event: 'deletion_cancelled', userId: user.id }))

    return json({ status: 'ok' })
  }),
)
