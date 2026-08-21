import { ScanIcon } from '../components/Icons'

/**
 * Shown only while the stored session is being restored. Without it, a signed-in
 * user sees the landing screen flash for a frame before being let in.
 */
export function SplashScreen() {
  return (
    <div className="splash">
      <div className="splash__mark">
        <ScanIcon size={30} />
      </div>
      <p className="splash__label">ScannApp</p>
    </div>
  )
}
