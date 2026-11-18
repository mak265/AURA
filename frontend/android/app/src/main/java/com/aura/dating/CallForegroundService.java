package com.aura.dating;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

public class CallForegroundService extends Service {
    private static final String CHANNEL = "aura_active_call";
    static volatile boolean running;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager.class).createNotificationChannel(
                new NotificationChannel(CHANNEL, "Active calls", NotificationManager.IMPORTANCE_LOW)
            );
        }
        Intent openApp = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent reopen = PendingIntent.getActivity(this, 0, openApp, PendingIntent.FLAG_IMMUTABLE);
        try {
            ServiceCompat.startForeground(this, 2741, new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_menu_call)
                .setContentTitle("AURA voice call")
                .setContentText("Tap to return to AURA")
                .setContentIntent(reopen)
                .setOngoing(true)
                .build(), Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0);
            running = true;
        } catch (IllegalStateException | SecurityException error) {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
