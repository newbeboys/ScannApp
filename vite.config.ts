import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    /*
      WAJIB dikunci — jangan hapus.

      Default Vite 8 adalah `baseline-widely-available`, yang berarti Chrome 111
      (Maret 2023). Aplikasi ini punya minSdkVersion 24 (Android 7), dan Android
      System WebView di HP lama bisa jauh lebih tua dari itu.

      Bahayanya tidak kelihatan: kalau WebView tidak mengenali satu saja operator
      di bundel (mis. `||=`, Chrome 85), yang gagal bukan satu baris melainkan
      SELURUH modul — React tidak pernah mount, tidak ada crash, tidak ada pesan
      error. Yang dilihat user cuma layar putih kosong.

      Kenapa chrome73 dan bukan lebih rendah: target hanya menurunkan SINTAKS,
      built-in tidak ikut di-polyfill. Lantai sebenarnya ditentukan built-in yang
      betul-betul dipakai kode ini dan dependency-nya — `Object.fromEntries`
      (Chrome 73, src/App.tsx), `globalThis` (Chrome 71, src/lib/profileCache.ts
      + kode vendor), `Array.prototype.flatMap` (Chrome 69). Menulis angka lebih
      rendah dari 73 di sini akan jadi klaim palsu: bundel-nya ter-parse, lalu
      mati dengan ReferenceError.

      Di bawah Chrome 73 aplikasi tetap tidak jalan, tapi tidak lagi berupa layar
      putih bisu: error-nya ditangkap window.onerror di index.html dan versi
      WebView-nya ditampilkan ke layar.

      Catatan: jangan tulis "android73" di sini — lightningcss menolak target
      "android" dan build langsung gagal. Android WebView memakai mesin Chrome,
      jadi "chrome73" sudah mencakupnya.
    */
    target: ['es2017', 'chrome73'],
    cssTarget: ['chrome73'],
  },
})
