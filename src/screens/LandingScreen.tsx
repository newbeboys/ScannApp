import { CropIcon, ExportIcon, ScanIcon } from '../components/Icons'

interface LandingScreenProps {
  onSignUp: () => void
  onSignIn: () => void
}

/**
 * The hero borrows the one moment that belongs to this product and no other:
 * edge detection locking onto a page. Four brackets snap in, a single sweep
 * passes over the sheet, then the copy rises. Everything else stays quiet.
 */
export function LandingScreen({ onSignUp, onSignIn }: LandingScreenProps) {
  return (
    <div className="landing">
      <div className="landing__stage" aria-hidden="true">
        <div className="landing__sheet">
          <span className="landing__line landing__line--title" />
          <span className="landing__line" />
          <span className="landing__line" />
          <span className="landing__line landing__line--short" />
          <span className="landing__line" />
          <span className="landing__line landing__line--short" />
          <span className="landing__sweep" />
        </div>
        <span className="landing__bracket landing__bracket--nw" />
        <span className="landing__bracket landing__bracket--ne" />
        <span className="landing__bracket landing__bracket--sw" />
        <span className="landing__bracket landing__bracket--se" />
      </div>

      <div className="landing__copy">
        <p className="landing__eyebrow">ScannApp</p>
        <h1 className="landing__title">
          Berkas apa pun,
          <br />
          jadi PDF rapi.
        </h1>
        <p className="landing__lede">
          Arahkan kamera, tepinya terdeteksi sendiri. Dokumen tersimpan di HP kamu, bukan di server
          orang lain.
        </p>
      </div>

      <ul className="landing__points">
        <li>
          <span className="landing__point-icon">
            <ScanIcon size={19} />
          </span>
          Pindai banyak halaman sekaligus
        </li>
        <li>
          <span className="landing__point-icon">
            <CropIcon size={19} />
          </span>
          Rapikan sudut &amp; putar halaman
        </li>
        <li>
          <span className="landing__point-icon">
            <ExportIcon size={19} />
          </span>
          Simpan sebagai PDF atau JPG
        </li>
      </ul>

      <div className="landing__actions">
        <button type="button" className="button button--primary" onClick={onSignUp}>
          Buat akun
        </button>
        <button type="button" className="landing__link" onClick={onSignIn}>
          Sudah punya akun? Masuk
        </button>
      </div>
    </div>
  )
}
