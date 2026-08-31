import { supabase } from './supabase'

/** Errors carry an Indonesian message straight from the Edge Function. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })

  if (error) {
    // Supabase wraps non-2xx responses; dig out our own message when present.
    const context = (error as { context?: Response }).context
    const parsed = await context
      ?.json()
      .catch(() => null)
      .then((value: { message?: string } | null) => value?.message)

    throw new Error(parsed ?? 'Gagal menghubungi server. Periksa koneksi lalu coba lagi.')
  }

  return data as T
}
