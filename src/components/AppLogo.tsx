const logoUrl = new URL('../assets/logo.svg', import.meta.url).href

interface AppLogoProps {
  size?: number
  className?: string
}

/**
 * The ScannApp brand mark — same src/assets/logo.svg used for the Android
 * launcher icon and the PDF watermark (lib/watermark.ts). Kept at its
 * original teal+black colours rather than recoloured to the accent token,
 * same call Boss Ali made for those two spots (2 September 2026).
 */
export function AppLogo({ size = 24, className }: AppLogoProps) {
  return <img src={logoUrl} alt="ScannApp" width={size} height={size} className={className} />
}
