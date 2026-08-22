/**
 * Tugas sekali jalan, BUKAN bagian aplikasi.
 *
 * Bucket R2 tidak punya kebijakan CORS secara bawaan, sehingga PUT dari
 * WebView/browser ke signed URL diblokir preflight. Skrip ini memasang
 * kebijakannya lewat S3 PutBucketCors memakai kredensial R2 yang sudah
 * tersimpan di Edge Function Secrets — supaya kunci itu tidak pernah perlu
 * disalin ke mesin siapa pun.
 *
 * Cara pakai: deploy, panggil sekali, lalu hapus deployment-nya. Sumbernya
 * disimpan di repo agar setup ini bisa diulang kalau bucket dibuat ulang.
 */
import { AwsClient } from 'npm:aws4fetch@1.0.20'

// Android WebView Capacitor memakai https://localhost; sisanya untuk `npm run dev`.
const ALLOWED_ORIGINS = [
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'http://localhost:5173',
  'http://localhost:5199',
]

const CORS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration>
  <CORSRule>
${ALLOWED_ORIGINS.map((origin) => `    <AllowedOrigin>${origin}</AllowedOrigin>`).join('\n')}
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`

Deno.serve(async () => {
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')!
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')!
  const endpoint = Deno.env.get('R2_ENDPOINT')!.replace(/\/+$/, '')
  const bucket = Deno.env.get('R2_BUCKET_NAME')!

  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' })
  const base = endpoint.endsWith(`/${bucket}`) ? endpoint : `${endpoint}/${bucket}`

  const response = await client.fetch(`${base}?cors`, {
    method: 'PUT',
    body: CORS_XML,
    headers: { 'Content-Type': 'application/xml' },
  })

  return new Response(
    JSON.stringify({
      status: response.status,
      ok: response.ok,
      body: await response.text(),
      origins: ALLOWED_ORIGINS,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
