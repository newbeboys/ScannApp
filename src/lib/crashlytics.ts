import { Capacitor, registerPlugin } from '@capacitor/core'
import { FirebaseCrashlytics } from '@capacitor-firebase/crashlytics'

/**
 * Wire shape of the custom native plugin (DebugBuildPlugin.java) that
 * exposes BuildConfig.DEBUG to JS. See that file for why this cannot be
 * done with import.meta.env.DEV instead.
 */
interface DebugBuildNative {
  isDebug(): Promise<{ debug: boolean }>
}

const DebugBuildNative = registerPlugin<DebugBuildNative>('DebugBuild')

/**
 * Crashlytics calls are never worth surfacing to the user or breaking a flow
 * over — same reasoning as ads/adsService.ts's `ignore()`. Logged, then
 * swallowed.
 */
function ignore(context: string): (error: unknown) => void {
  return (error: unknown) => {
    console.warn(`[crashlytics] ${context}`, error)
  }
}

/**
 * Starts Crashlytics collection.
 *
 * Native crash catching is already active from process start regardless of
 * this call — it comes from Firebase's own ContentProvider merge, which
 * fires as soon as google-services.json is present in the build, before any
 * JS runs. This call only makes automatic data collection *explicit* rather
 * than relying on the SDK's own default (on), so a future Firebase SDK
 * change to that default cannot silently turn reporting off underneath us.
 *
 * No-ops on web: Crashlytics has no Web SDK (plugin FAQ), so there is
 * nothing to enable there.
 */
export async function initCrashlytics(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await FirebaseCrashlytics.setEnabled({ enabled: true }).catch(ignore('setEnabled'))
}

/**
 * Whether this is a debug Gradle build type (`assembleDebug`) — never the
 * release one CI ships to Play Store (`assembleRelease`/`bundleRelease`).
 * Used only to decide whether Pengaturan shows the crash-test row; nothing
 * else in the app reads this.
 *
 * Resolves `false` on web and on any native failure, so a broken or missing
 * plugin fails toward *hiding* the button rather than showing it in a build
 * that cannot actually tell debug from release.
 */
export async function isDebugBuild(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false

  try {
    const { debug } = await DebugBuildNative.isDebug()
    return debug === true
  } catch (error) {
    ignore('isDebug')(error)
    return false
  }
}

/**
 * Forces a real native crash, to verify the Crashlytics pipeline end to end
 * (TASKS.md, Fase 8.5b testing section) — the report should appear in the
 * Firebase Console a few minutes after the app is relaunched.
 *
 * Deliberately does not re-check `isDebugBuild()` itself: that gate belongs
 * to whoever decides to show a button that calls this, not to this function
 * pretending to have a second opinion. Guarded on `isNativePlatform()` only
 * so calling it from a browser (there is no button to call it from, but
 * nothing stops a future caller) does not throw "not implemented" noise.
 */
export async function triggerTestCrash(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await FirebaseCrashlytics.crash({ message: 'Uji Crashlytics manual dari layar Pengaturan' })
}
