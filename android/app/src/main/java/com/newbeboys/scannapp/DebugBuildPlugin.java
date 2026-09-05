package com.newbeboys.scannapp;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Exposes BuildConfig.DEBUG to JS — the one reliable way to tell a debug
 * Gradle build type from a release one.
 *
 * import.meta.env.DEV cannot do this here: both ci.yml's assembleDebug and
 * build-aab.yml's assembleRelease/bundleRelease run `npm run build`
 * (production Vite) first and bundle that SAME dist/ output into the APK via
 * `npx cap sync android` — the JS payload itself carries no Vite-level
 * distinction between a debug and a release install (TASKS.md, Fase 8.5b).
 * BuildConfig.DEBUG, by contrast, is generated per Gradle build type and
 * cannot be spoofed from JS: it is literally false in the build CI ships to
 * Play Store.
 *
 * Used only to gate the Crashlytics test-crash row in Pengaturan — nothing
 * else in the app reads this.
 */
@CapacitorPlugin(name = "DebugBuild")
public class DebugBuildPlugin extends Plugin {

    @PluginMethod
    public void isDebug(PluginCall call) {
        JSObject result = new JSObject();
        result.put("debug", BuildConfig.DEBUG);
        call.resolve(result);
    }
}
