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
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MiraOverlayService extends Service {
    public static final String CHANNEL_ID = "mira_overlay_channel";
    public static final String ACTION_WAKE = "com.redmagic.mora.mirror.WAKE_OVERLAY";
    public static final String ACTION_ORB = "com.redmagic.mora.mirror.SHOW_ORB";
    public static final String ACTION_CLOSE = "com.redmagic.mora.mirror.CLOSE_OVERLAY";
    public static final String ACTION_HIDE_CARD = "com.redmagic.mora.mirror.HIDE_CARD";
    public static final String EXTRA_INLINE_COMMAND = "inline_command";
    private static final int NOTIF_ID = 4103;
    public static volatile boolean orbEnabled = false;

    private WindowManager wm;
    private View rootView;
    private View orbView;
    private WindowManager.LayoutParams cardParams;
    private WindowManager.LayoutParams orbParams;

    private TextView statusTxt;
    private TextView replyTxt;
    private EditText inputBox;
    private SpeechRecognizer recognizer;
    private MiraVoiceEngine voiceEngine;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean cardShowing = false;
    private boolean isListening = false;

    @Override
    public void onCreate() {
        super.onCreate();
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        voiceEngine = new MiraVoiceEngine(this);
        createNotificationChannel();
        startForegroundSafe();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundSafe();
        String action = intent != null ? intent.getAction() : ACTION_WAKE;

        if (ACTION_CLOSE.equals(action)) {
            orbEnabled = false;
            closeEverythingAndStop();
            return START_NOT_STICKY;
        }
        if (ACTION_HIDE_CARD.equals(action)) {
            minimizeOrClose();
            return orbEnabled ? START_STICKY : START_NOT_STICKY;
        }
        if (ACTION_ORB.equals(action)) {
            orbEnabled = true;
            removeCardView();
            showFloatingOrb();
            return START_STICKY;
        }

        // ACTION_WAKE: show Mini MIRA over current app without opening MainActivity!
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            Intent perm = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
                .setData(android.net.Uri.parse("package:" + getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(perm);
            stopSelf();
            return START_NOT_STICKY;
        }

        removeOrbView();
        showCardOverlay();

        String inlineCmd = intent != null ? intent.getStringExtra(EXTRA_INLINE_COMMAND) : null;
        if (inlineCmd != null && !inlineCmd.trim().isEmpty()) {
            processUserPrompt(inlineCmd.trim(), false);
        } else {
            beginVoiceCapture();
        }
        return START_STICKY;
    }

    private void startForegroundSafe() {
        Notification notif = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIF_ID, notif);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "MIRA Floating Assistant", NotificationManager.IMPORTANCE_LOW);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        Intent wake = new Intent(this, MiraOverlayService.class).setAction(ACTION_WAKE);
        PendingIntent wakePi = PendingIntent.getService(this, 21, wake, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent close = new Intent(this, MiraOverlayService.class).setAction(ACTION_CLOSE);
        PendingIntent closePi = PendingIntent.getService(this, 22, close, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        return b.setContentTitle("MIRA Mini Assistant Active")
            .setContentText("Tap to open Mini MIRA over any app")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(wakePi)
            .addAction(new Notification.Action.Builder(null, "Close MIRA", closePi).build())
            .setOngoing(true)
            .build();
    }

    private void showFloatingOrb() {
        if (orbView != null || wm == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) return;

        int dp = (int) getResources().getDisplayMetrics().density;
        LinearLayout orb = new LinearLayout(this);
        orb.setOrientation(LinearLayout.VERTICAL);
        orb.setGravity(Gravity.CENTER);
        orb.setPadding(10 * dp, 10 * dp, 10 * dp, 10 * dp);

        GradientDrawable bg = new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[]{Color.parseColor("#06B6D4"), Color.parseColor("#7C3AED")}
        );
        bg.setShape(GradientDrawable.OVAL);
        bg.setStroke(2 * dp, Color.parseColor("#CCFBF1"));
        orb.setBackground(bg);

        TextView label = new TextView(this);
        label.setText("MIRA");
        label.setTextColor(Color.WHITE);
        label.setTextSize(11);
        label.setTypeface(Typeface.DEFAULT_BOLD);
        label.setGravity(Gravity.CENTER);
        orb.addView(label);

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;

        orbParams = new WindowManager.LayoutParams(
            56 * dp,
            56 * dp,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        orbParams.gravity = Gravity.TOP | Gravity.END;
        orbParams.x = 12 * dp;
        orbParams.y = 220 * dp;

        orb.setOnTouchListener(new View.OnTouchListener() {
            private int startX, startY;
            private float touchX, touchY;
            private boolean moved;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        startX = orbParams.x;
                        startY = orbParams.y;
                        touchX = event.getRawX();
                        touchY = event.getRawY();
                        moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx = touchX - event.getRawX();
                        float dy = event.getRawY() - touchY;
                        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;
                        orbParams.x = startX + (int) dx;
                        orbParams.y = startY + (int) dy;
                        if (orbView != null) wm.updateViewLayout(orbView, orbParams);
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (!moved) {
                            Intent wake = new Intent(MiraOverlayService.this, MiraOverlayService.class).setAction(ACTION_WAKE);
                            startService(wake);
                        }
                        return true;
                }
                return false;
            }
        });

        orbView = orb;
        wm.addView(orbView, orbParams);
    }

    private void showCardOverlay() {
        if (cardShowing && rootView != null) return;
        if (wm == null) return;

        int dp = (int) getResources().getDisplayMetrics().density;
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(14 * dp, 12 * dp, 14 * dp, 12 * dp);

        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#EB0B1220"));
        bg.setCornerRadius(22 * dp);
        bg.setStroke(2 * dp, Color.parseColor("#38BDF8"));
        card.setBackground(bg);

        // Header row: Title + Minimize to Orb + Close X
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        statusTxt = new TextView(this);
        statusTxt.setText("✨ Mini MIRA · Ready");
        statusTxt.setTextColor(Color.parseColor("#38BDF8"));
        statusTxt.setTextSize(14);
        statusTxt.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        header.addView(statusTxt, titleLp);

        Button orbBtn = new Button(this);
        orbBtn.setText("Orb");
        orbBtn.setTextSize(11);
        orbBtn.setTextColor(Color.parseColor("#BAE6FD"));
        orbBtn.setBackgroundColor(Color.parseColor("#1E293B"));
        orbBtn.setPadding(10 * dp, 2 * dp, 10 * dp, 2 * dp);
        orbBtn.setOnClickListener(v -> {
            orbEnabled = true;
            minimizeOrClose();
        });
        header.addView(orbBtn);

        Button closeBtn = new Button(this);
        closeBtn.setText("✕ Close");
        closeBtn.setTextSize(11);
        closeBtn.setTextColor(Color.parseColor("#FCA5A5"));
        closeBtn.setBackgroundColor(Color.TRANSPARENT);
        closeBtn.setOnClickListener(v -> {
            orbEnabled = false;
            closeEverythingAndStop();
        });
        header.addView(closeBtn);
        card.addView(header);

        // Reply text
        replyTxt = new TextView(this);
        replyTxt.setText("बोलिए दोस्त — Reels scroll, call, ya koi bhi kaam bol sakte ho!");
        replyTxt.setTextColor(Color.parseColor("#F1F5F9"));
        replyTxt.setTextSize(13);
        replyTxt.setPadding(0, 8 * dp, 0, 8 * dp);
        card.addView(replyTxt);

        // Quick hands-free action chips
        LinearLayout chips = new LinearLayout(this);
        chips.setOrientation(LinearLayout.HORIZONTAL);
        String[][] quickActions = {
            {"Next Reel", "next reel"},
            {"Auto Scroll", "auto scroll"},
            {"Stop", "stop scroll"},
            {"Back", "go back"}
        };
        for (String[] qa : quickActions) {
            Button b = new Button(this);
            b.setText(qa[0]);
            b.setTextSize(10);
            b.setAllCaps(false);
            b.setTextColor(Color.WHITE);
            GradientDrawable cb = new GradientDrawable();
            cb.setColor(Color.parseColor("#1E293B"));
            cb.setCornerRadius(14 * dp);
            cb.setStroke(dp, Color.parseColor("#475569"));
            b.setBackground(cb);
            LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(0, 34 * dp, 1f);
            blp.setMargins(3 * dp, 0, 3 * dp, 6 * dp);
            b.setLayoutParams(blp);
            final String cmd = qa[1];
            b.setOnClickListener(v -> processUserPrompt(cmd, true));
            chips.addView(b);
        }
        card.addView(chips);

        // Input + Mic row
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        inputBox = new EditText(this);
        inputBox.setHint("Hindi / English command...");
        inputBox.setHintTextColor(Color.parseColor("#64748B"));
        inputBox.setTextColor(Color.WHITE);
        inputBox.setTextSize(13);
        inputBox.setSingleLine(true);
        inputBox.setImeOptions(EditorInfo.IME_ACTION_SEND);
        inputBox.setBackgroundColor(Color.parseColor("#1E293B"));
        inputBox.setPadding(10 * dp, 8 * dp, 10 * dp, 8 * dp);
        inputBox.setOnEditorActionListener((v, actionId, event) -> {
            String q = inputBox.getText().toString().trim();
            if (!q.isEmpty()) {
                inputBox.setText("");
                processUserPrompt(q, true);
            }
            return true;
        });
        row.addView(inputBox, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        Button micBtn = new Button(this);
        micBtn.setText("🎤");
        micBtn.setTextSize(16);
        micBtn.setBackgroundColor(Color.parseColor("#0284C7"));
        micBtn.setTextColor(Color.WHITE);
        LinearLayout.LayoutParams mlp = new LinearLayout.LayoutParams(48 * dp, 42 * dp);
        mlp.setMargins(8 * dp, 0, 0, 0);
        micBtn.setOnClickListener(v -> beginVoiceCapture());
        row.addView(micBtn, mlp);

        card.addView(row);

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;

        cardParams = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        );
        cardParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        cardParams.x = 0;
        cardParams.y = 48 * dp;

        rootView = card;
        wm.addView(rootView, cardParams);
        cardShowing = true;
    }

    private void beginVoiceCapture() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            if (statusTxt != null) statusTxt.setText("⚠️ Mic permission needed");
            return;
        }
        // Pause wake-word recognizer so audio focus doesn't collide
        if (MiraWakeWordService.isRunning) {
            startService(new Intent(this, MiraWakeWordService.class).setAction(MiraWakeWordService.ACTION_PAUSE_FOR_OVERLAY));
        }

        mainHandler.postDelayed(() -> {
            if (!cardShowing) return;
            destroyRecognizer();
            if (voiceEngine != null) voiceEngine.stop();
            isListening = true;
            if (statusTxt != null) statusTxt.setText("🎙️ सुन रही हूँ... बोलिए (Hindi / English)");

            try {
                recognizer = SpeechRecognizer.createSpeechRecognizer(this);
                recognizer.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(Bundle params) {}
                    @Override public void onBeginningOfSpeech() {}
                    @Override public void onRmsChanged(float rmsdB) {}
                    @Override public void onBufferReceived(byte[] buffer) {}
                    @Override public void onEndOfSpeech() {
                        isListening = false;
                        if (statusTxt != null) statusTxt.setText("⚡ सोच रही हूँ...");
                    }

                    @Override
                    public void onError(int error) {
                        isListening = false;
                        if (statusTxt != null) statusTxt.setText("🎤 Tap Mic to speak again");
                        resumeWakeWordIfRunning();
                    }

                    @Override
                    public void onResults(Bundle results) {
                        isListening = false;
                        ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (list != null && !list.isEmpty()) {
                            String heard = list.get(0).trim();
                            if (replyTxt != null) replyTxt.setText("🗣️ \"" + heard + "\"");
                            processUserPrompt(heard, false);
                        } else {
                            resumeWakeWordIfRunning();
                        }
                    }

                    @Override public void onPartialResults(Bundle partialResults) {
                        ArrayList<String> list = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (list != null && !list.isEmpty() && replyTxt != null) {
                            replyTxt.setText("🗣️ " + list.get(0));
                        }
                    }
                    @Override public void onEvent(int eventType, Bundle params) {}
                });

                Intent rec = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                rec.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                rec.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "hi-IN");
                rec.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                recognizer.startListening(rec);
            } catch (Exception e) {
                isListening = false;
                if (statusTxt != null) statusTxt.setText("🎤 Speech recognizer unavailable");
                resumeWakeWordIfRunning();
            }
        }, 200);
    }

    private void processUserPrompt(String prompt, boolean fromTap) {
        String lower = prompt.toLowerCase(Locale.ROOT).trim();

        // Explicit close command by voice
        if (lower.matches(".*\\b(close mira|band karo|mira band|exit mira|bye mira|band ho jao|hat jao|chali jao)\\b.*")) {
            if (voiceEngine != null) {
                voiceEngine.speak("ठीक है, मैं बंद हो रही हूँ। ज़रूरत हो तो फिर बुलाना!", () -> {
                    mainHandler.post(() -> {
                        orbEnabled = false;
                        closeEverythingAndStop();
                    });
                });
            } else {
                orbEnabled = false;
                closeEverythingAndStop();
            }
            return;
        }

        if (statusTxt != null) statusTxt.setText("⚡ कर रही हूँ: " + prompt);

        // 1. Instant local phone/screen control
        MiraDeviceController.CommandResult local = MiraDeviceController.executeCommand(this, prompt);
        if (local.handled) {
            if (replyTxt != null) replyTxt.setText("✨ " + local.reply);
            if (statusTxt != null) statusTxt.setText("✅ " + local.actionTag);
            speakAndMaybeAutoMinimize(local.reply, local.actionTag);
            return;
        }

        // 2. Universal AI Agent for ANY random unlisted command (100% Free Pollinations + optional Gemini)
        if (statusTxt != null) statusTxt.setText("🧠 MIRA AI समझ रही है...");
        executor.execute(() -> {
            MiraDeviceController.CommandResult aiRes = MiraDeviceController.runUniversalAiAgent(MiraOverlayService.this, prompt);
            mainHandler.post(() -> {
                if (replyTxt != null) replyTxt.setText("✨ " + aiRes.reply);
                if (statusTxt != null) statusTxt.setText("✅ " + aiRes.actionTag);
                speakAndMaybeAutoMinimize(aiRes.reply, aiRes.actionTag);
            });
        });
    }

    private void speakAndMaybeAutoMinimize(String text, String actionTag) {
        Runnable afterSpeech = () -> {
            resumeWakeWordIfRunning();
            // If user performed a scroll/navigation/app-open over another app, fold cleanly to Orb (or hide) so it doesn't block Reels!
            if (actionTag != null && (actionTag.contains("SCROLL") || actionTag.contains("OPEN_APP") || actionTag.contains("LIKE") || actionTag.contains("NAV_"))) {
                mainHandler.postDelayed(() -> {
                    if (cardShowing) minimizeOrClose();
                }, 700);
            }
        };

        if (voiceEngine != null) {
            voiceEngine.speak(text, afterSpeech);
        } else {
            afterSpeech.run();
        }
    }

    private void resumeWakeWordIfRunning() {
        if (MiraWakeWordService.isRunning) {
            startService(new Intent(this, MiraWakeWordService.class).setAction(MiraWakeWordService.ACTION_RESUME_WAKE));
        }
    }

    private void minimizeOrClose() {
        destroyRecognizer();
        removeCardView();
        if (orbEnabled) {
            showFloatingOrb();
            resumeWakeWordIfRunning();
        } else {
            resumeWakeWordIfRunning();
            stopSelf();
        }
    }

    private void closeEverythingAndStop() {
        destroyRecognizer();
        if (voiceEngine != null) voiceEngine.stop();
        removeCardView();
        removeOrbView();
        resumeWakeWordIfRunning();
        stopForeground(true);
        stopSelf();
    }

    private void removeCardView() {
        if (rootView != null && wm != null) {
            try { wm.removeView(rootView); } catch (Exception ignored) {}
            rootView = null;
            cardShowing = false;
        }
    }

    private void removeOrbView() {
        if (orbView != null && wm != null) {
            try { wm.removeView(orbView); } catch (Exception ignored) {}
            orbView = null;
        }
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

    @Override
    public void onDestroy() {
        destroyRecognizer();
        if (voiceEngine != null) voiceEngine.shutdown();
        removeCardView();
        removeOrbView();
        executor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
