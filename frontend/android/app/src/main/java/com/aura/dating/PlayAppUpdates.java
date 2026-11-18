package com.aura.dating;

import android.widget.Toast;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.LifecycleOwner;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.InstallStateUpdatedListener;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.InstallStatus;
import com.google.android.play.core.install.model.UpdateAvailability;

final class PlayAppUpdates implements DefaultLifecycleObserver {
    private static final AppUpdateOptions OPTIONS = AppUpdateOptions.defaultOptions(AppUpdateType.FLEXIBLE);

    private final MainActivity activity;
    private final AppUpdateManager manager;
    private final ActivityResultLauncher<IntentSenderRequest> updateLauncher;
    private final InstallStateUpdatedListener installListener = state -> {
        if (state.installStatus() == InstallStatus.DOWNLOADED) showRestartPrompt();
    };

    private AlertDialog restartPrompt;
    private boolean updateOffered;
    private boolean restartDeferred;
    private boolean installing;

    PlayAppUpdates(MainActivity activity) {
        this.activity = activity;
        manager = AppUpdateManagerFactory.create(activity);
        updateLauncher = activity.registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(), result -> { }
        );
    }

    @Override
    public void onStart(LifecycleOwner owner) {
        manager.registerListener(installListener);
    }

    @Override
    public void onResume(LifecycleOwner owner) {
        manager.getAppUpdateInfo().addOnSuccessListener(info -> {
            if (!canPrompt()) return;
            int status = info.installStatus();
            if (status == InstallStatus.DOWNLOADED) {
                showRestartPrompt();
            } else if (!updateOffered && status != InstallStatus.PENDING && status != InstallStatus.DOWNLOADING
                && status != InstallStatus.INSTALLING && info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                && info.isUpdateTypeAllowed(OPTIONS)) {
                updateOffered = manager.startUpdateFlowForResult(info, updateLauncher, OPTIONS);
            }
        });
    }

    @Override
    public void onStop(LifecycleOwner owner) {
        manager.unregisterListener(installListener);
        if (restartPrompt != null) restartPrompt.dismiss();
    }

    private boolean canPrompt() {
        return activity.getLifecycle().getCurrentState() == Lifecycle.State.RESUMED
            && !activity.isFinishing() && !CallForegroundService.running;
    }

    private void showRestartPrompt() {
        if (!canPrompt() || restartDeferred || installing || restartPrompt != null) return;

        restartPrompt = new AlertDialog.Builder(activity)
            .setTitle(R.string.update_ready_title)
            .setMessage(R.string.update_ready_message)
            .setNegativeButton(R.string.update_later, (dialog, which) -> restartDeferred = true)
            .setPositiveButton(R.string.update_restart, (dialog, which) -> completeUpdate())
            .setOnCancelListener(dialog -> restartDeferred = true)
            .setOnDismissListener(dialog -> restartPrompt = null)
            .show();
    }

    private void completeUpdate() {
        if (!canPrompt()) return;
        installing = true;
        manager.completeUpdate().addOnFailureListener(error -> {
            installing = false;
            if (canPrompt()) {
                Toast.makeText(activity, R.string.update_restart_failed, Toast.LENGTH_LONG).show();
            }
        });
    }
}
