package com.aura.dating;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.content.pm.ApplicationInfo;
import android.webkit.WebSettings;
import androidx.activity.OnBackPressedCallback;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallBackgroundPlugin.class);
        super.onCreate(savedInstanceState);
        if (getBridge() == null) return;
        // LAN HTTP is allowed only in debug builds; the network config limits its host.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            getBridge().getWebView().getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        } else {
            getLifecycle().addObserver(new PlayAppUpdates(this));
        }
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge().getWebView().canGoBack()) {
                    getBridge().getWebView().goBack();
                } else if (CallForegroundService.running) {
                    moveTaskToBack(true);
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });
    }
}
