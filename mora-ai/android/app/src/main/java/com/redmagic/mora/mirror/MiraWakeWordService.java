package com.redmagic.mora.mirror;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.core.app.NotificationCompat;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Background Wake-Word Service (adapted from agmanly597/JAVIS-Android WakeWordService).
 * Continuously listens for "Hey MIRA" / "MIRA" / "Ok MIRA" / "Sun MIRA".
 * When triggered, launches MiraOverlayService (Mini MIRA floating popup) WITHOUT opening the main app!
 */
public class MiraWakeWordService extends Service {
    private static final String CHANNEL_ID = "mira_wake_channel";
    private static final int NOTIF_ID = 4101;
    private static final String[] WAKE_WORDS = {
        "hey mira", "ok mira", "okay mira", "hi mira", "hello mira", "sun mira", "mira", "meera"
    };

    private SpeechRecognizer recognizer;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean running = false;
    private long restartDelay = 550L;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
        startForeground(NOTIF_ID, buildNotification());
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            stopSelf();
            return;
        }
        running = true;
        scheduleCycle(400L);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    private void scheduleCycle(long delay) {
        if (!running) return;
        handler.removeCallbacksAndMessages(null);
        handler.postDelayed(() -> {
            if (!running) return;
            destroyRecognizer();
            try {
                recognizer = SpeechRecognizer.createSpeechRecognizer(this);
                recognizer.setRecognitionListener(listener);
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
                i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 900L);
                i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1300L);
                recognizer.startListening(i);
            } catch (Exception e) {
                scheduleCycle(1500L);
            }
        }, delay);
    }

    private String extractWakeCommand(String text) {
        if (text == null) return null;
        String lower = text.toLowerCase(Locale.ROOT).trim();
        for (String w : WAKE_WORDS) {
            int idx = lower.indexOf(w);
            if (idx >= 0) {
                String rest = text.substring(idx + w.length()).replaceAll("^[,\\s:]+", "").trim();
                return rest;
            }
        }
        return null;
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override public void onReadyForSpeech(Bundle params) {}
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onEvent(int eventType, Bundle params) {}

        @Override
        public void onPartialResults(Bundle partialResults) {
            ArrayList<String> list = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (list == null || list.isEmpty()) return;
            String text = list.get(0);
            String cmd = extractWakeCommand(text);
            if (cmd != null && cmd.isEmpty()) {
                // Bare "Hey MIRA" heard -> summon Mini MIRA immediately!
                triggerMiniMira("");
            }
        }

        @Override
        public void onResults(Bundle results) {
            ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            String text = (list != null && !list.isEmpty()) ? list.get(0) : "";
            String cmd = extractWakeCommand(text);
            if (cmd != null) {
                triggerMiniMira(cmd);
            } else {
                scheduleCycle(350L);
            }
        }

        @Override
        public void onError(int error) {
            long d = (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) ? 1800L
                : (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT) ? 2500L
                : 450L;
            scheduleCycle(d);
        }
    };

    private void triggerMiniMira(String inlineCommand) {
        destroyRecognizer();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) {
            Intent overlay = new Intent(this, MiraOverlayService.class);
            overlay.setAction(MiraOverlayService.ACTION_WAKE);
            if (inlineCommand != null && !inlineCommand.isEmpty()) {
                overlay.putExtra(MiraOverlayService.EXTRA_COMMAND, inlineCommand);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(overlay);
            } else {
                startService(overlay);
            }
        }
        // Pause wake-word briefly so Mini MIRA overlay owns the microphone cleanly
        scheduleCycle(inlineCommand != null && !inlineCommand.isEmpty() ? 4500L : 7000L);
    }

    private void destroyRecognizer() {
        if (recognizer != null) {
            try {
                recognizer.destroy();
            } catch (Exception ignored) {}
            recognizer = null;
        }
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "MIRA Wake Word", NotificationManager.IMPORTANCE_MIN);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, openIntent, PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("MIRA AI Wake-Word Active")
            .setContentText("Say \"Hey MIRA\" anytime to summon Mini MIRA")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setSilent(true)
            .setOngoing(true)
            .build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        destroyRecognizer();
        super.onDestroy();
    }
}
