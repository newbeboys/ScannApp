import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import './auth.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider'
import { BootErrorBoundary } from './components/BootErrorBoundary'
import { initCrashlytics } from './lib/crashlytics'
import { ThemeProvider } from './theme/ThemeProvider'

// Fire-and-forget, sebelum React sempat mount: penangkapan crash native sudah
// aktif sejak process start terlepas dari ini (lewat ContentProvider Firebase
// sendiri), tapi ini titik paling awal di entry point JS untuk menjadikan
// pengumpulan data eksplisit. No-op di web/browser dev — lihat
// lib/crashlytics.ts.
void initCrashlytics()

// Boundary dipasang paling luar — di dalam ThemeProvider/AuthProvider ia tidak
// akan menangkap error yang dilempar provider itu sendiri saat render pertama.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BootErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BootErrorBoundary>
  </StrictMode>,
)
