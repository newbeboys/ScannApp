import { Capacitor } from '@capacitor/core'
import { FirebaseCrashlytics } from '@capacitor-firebase/crashlytics'

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
