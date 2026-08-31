import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke } },
}))

const { callFunction } = await import('./edgeFunctionClient')

beforeEach(() => {
  invoke.mockReset()
})

describe('callFunction', () => {
  it('returns the data the function responded with', async () => {
    invoke.mockResolvedValue({ data: { activated: true }, error: null })

    const result = await callFunction<{ activated: boolean }>('process-referral-activation', {})

    expect(result).toEqual({ activated: true })
    expect(invoke).toHaveBeenCalledWith('process-referral-activation', { body: {} })
  })

  it('surfaces the server message when the Edge Function reports one', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { context: new Response(JSON.stringify({ message: 'Kuota penuh.' })) },
    })

    await expect(callFunction('generate-upload-url', {})).rejects.toThrow('Kuota penuh.')
  })

  it('falls back to a generic message when the error carries none', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: undefined } })

    await expect(callFunction('generate-upload-url', {})).rejects.toThrow(
      'Gagal menghubungi server. Periksa koneksi lalu coba lagi.',
    )
  })
})
