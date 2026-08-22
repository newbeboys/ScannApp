import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import './auth.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider'
import { BootErrorBoundary } from './components/BootErrorBoundary'
import { ThemeProvider } from './theme/ThemeProvider'

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
