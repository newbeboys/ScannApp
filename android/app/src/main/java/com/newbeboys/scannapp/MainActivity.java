package com.newbeboys.scannapp;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must run before super.onCreate(): that call is what builds the
        // bridge and immediately replays the launch intent through it (see
        // BridgeActivity.load()), so the plugin has to already be registered.
        registerPlugin(SharedImportPlugin.class);
        registerPlugin(DebugBuildPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
