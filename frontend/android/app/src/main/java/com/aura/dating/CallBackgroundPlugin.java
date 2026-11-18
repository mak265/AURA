package com.aura.dating;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "CallBackground")
public class CallBackgroundPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        try {
            ContextCompat.startForegroundService(
                getContext(), new Intent(getContext(), CallForegroundService.class)
            );
            call.resolve();
        } catch (IllegalStateException | SecurityException error) {
            call.reject("Android could not keep the call active in the background.", error);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), CallForegroundService.class));
        call.resolve();
    }
}
