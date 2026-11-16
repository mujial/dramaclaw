package com.redmagic.mora.mirror;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.Locale;

public class MiraWakeWordService extends Service {
    public static final String CHANNEL_ID = "mira_wake_channel";
    public static final String ACTION_PAUSE_FOR_OVERLAY = "com.redmagic.mora.mirror.PAUSE_WAKE";
    public static final String ACTION_RESUME_WAKE = "com.redmagic.mora.mirror.RESUME_WAKE";
    private static final int NOTIF_ID = 4102;
    public static volatile boolean isRunning = false;

    private SpeechRecognizer recognizer;
    private Handler handler;
    private boolean pausedForOverlay = false;
    private boolean destroyed = false;

    private final Runnable restartRunnable = new Runnable() {
        @Override
        public void run() {
            if (!destroyed && !pausedForOverlay) {
                startListeningLoop();
            }
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        createNotificationChannel();
        startForegroundSafe();
        isRunning = true;
        startListeningLoop();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if ("STOP".equals(action)) {
                destroyed = true;
                stopSelf();
                return START_NOT_STICKY;
            }
            if (ACTION_PAUSE_FOR_OVERLAY.equals(action)) {
                pausedForOverlay = true;
                handler.removeCallbacks(restartRunnable);
                destroyRecognizer();
                return START_STICKY;
            }
            if (ACTION_RESUME_WAKE.equals(action)) {
                pausedForOverlay = false;
                scheduleRestart(400);
                return START_STICKY;
            }
        }
        startForegroundSafe();
        if (!pausedForOverlay && recognizer == null) {
            startListeningLoop();
        }
        return START_STICKY;
    }

    private void startForegroundSafe() {
        Notification notif = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIF_ID, notif);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "MIRA Hands-Free Wake Word", NotificationManager.IMPORTANCE_LOW);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        Intent wakeIntent = new Intent(this, MiraOverlayService.class).setAction(MiraOverlayService.ACTION_WAKE);
        PendingIntent wakePi = PendingIntent.getService(this, 10, wakeIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Intent stopIntent = new Intent(this, MiraWakeWordService.class).setAction("STOP");
        PendingIntent stopPi = PendingIntent.getService(this, 11, stopIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        return b.setContentTitle("MIRA Hands-Free Wake Ready")
            .setContentText("Say \"Hey MIRA\" over Reels/Apps • Tap to Wake")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(wakePi)
            .addAction(new Notification.Action.Builder(null, "Wake MIRA", wakePi).build())
            .addAction(new Notification.Action.Builder(null, "Turn Off", stopPi).build())
            .setOngoing(true)
            .build();
    }

    private void destroyRecognizer() {
        try {
            if (recognizer != null) {
                recognizer.cancel();
                recognizer.destroy();
                recognizer = null;
            }
        } catch (Exception ignored) {}
    }

    private void startListeningLoop() {
        if (destroyed || pausedForOverlay) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return;

        destroyRecognizer();
        try {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {}
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}

                @Override
                public void onError(int error) {
                    if (!destroyed && !pausedForOverlay) {
                        scheduleRestart(error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? 1200 : 450);
                    }
                }

                @Override
                public void onResults(Bundle results) {
                    handleSpeechResults(results);
                }

                @Override
                public void onPartialResults(Bundle partialResults) {
                    handleSpeechResults(partialResults);
                }

                @Override public void onEvent(int eventType, Bundle params) {}
            });

            Intent recIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            recIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            recIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN");
            recIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            recIntent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            recIntent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 1500L);
            recognizer.startListening(recIntent);
        } catch (Exception e) {
            scheduleRestart(1200);
        }
    }

    private void handleSpeechResults(Bundle bundle) {
        if (bundle == null || pausedForOverlay || destroyed) return;
        ArrayList<String> matches = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches != null) {
            for (String m : matches) {
                String lower = m.toLowerCase(Locale.ROOT).trim();
                String[] triggers = {
                    "hey mira", "hi mira", "hello mira", "ok mira", "okay mira",
                    "hey meera", "hi meera", "hello meera", "hey myra", "mira", "meera",
                    "हे मीरा", "हाय मीरा", "मीरा", "ओके मीरा"
                };
                for (String trig : triggers) {
                    int idx = lower.indexOf(trig);
                    if (idx >= 0) {
                        String inlineCmd = m.substring(idx + trig.length()).replaceAll("^[,\\s:]+", "").trim();
                        wakeMiraOverlay(inlineCmd);
                        return;
                    }
                }
            }
        }
        scheduleRestart(350);
    }

    private void wakeMiraOverlay(String inlineCommand) {
        pausedForOverlay = true;
        handler.removeCallbacks(restartRunnable);
        destroyRecognizer();

        Intent wake = new Intent(this, MiraOverlayService.class);
        wake.setAction(MiraOverlayService.ACTION_WAKE);
        if (inlineCommand != null && inlineCommand.length() >= 3) {
            wake.putExtra(MiraOverlayService.EXTRA_INLINE_COMMAND, inlineCommand);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(wake);
        } else {
            startService(wake);
        }
    }

    private void scheduleRestart(long delayMs) {
        handler.removeCallbacks(restartRunnable);
        if (!destroyed && !pausedForOverlay) {
            handler.postDelayed(restartRunnable, delayMs);
        }
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        isRunning = false;
        if (handler != null) handler.removeCallbacksAndMessages(null);
        destroyRecognizer();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
