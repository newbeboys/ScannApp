import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Tanpa error boundary, React 19 meng-unmount SELURUH pohon begitu ada error
 * saat render — hasilnya `#root` kosong, alias layar putih tanpa penjelasan.
 * Di aplikasi Android ini konsekuensinya berat: mesin dev tidak punya Android
 * SDK, jadi tidak ada adb/logcat untuk melihat apa yang sebenarnya terjadi.
 * Satu-satunya kanal diagnostik yang tersisa adalah layar HP itu sendiri.
 */
interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Diisi skrip diagnostik ES5 di index.html. */
declare global {
  interface Window {
    __scannBooted?: () => void
    __scannBootFail?: (title: string, detail: string) => void
  }
}

export class BootErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidMount(): void {
    // Pohon berhasil mount — matikan watchdog di index.html supaya ia tidak
    // menimpa aplikasi yang sudah berjalan normal.
    window.__scannBooted?.()
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[boot] render gagal', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="boot-error">
        <p className="boot-error__eyebrow">ScannApp</p>
        <h1 className="boot-error__title">Aplikasi berhenti saat menampilkan layar</h1>
        <p className="boot-error__lede">
          Ini layar diagnostik, bukan tampilan aplikasi. Screenshot teks di bawah dan kirim
          ke Claude Code.
        </p>
        <pre className="boot-error__detail">
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ''}
          {`\n\nUA: ${navigator.userAgent}`}
        </pre>
        <button
          type="button"
          className="boot-error__retry"
          onClick={() => window.location.reload()}
        >
          Coba lagi
        </button>
      </div>
    )
  }
}
