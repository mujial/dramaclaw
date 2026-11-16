package com.redmagic.mora.mirror;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.OvershootInterpolator;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.app.NotificationCompat;

import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Google-Assistant-style Floating Mini MIRA Overlay!
 * Appears directly on top of ANY screen / Home Screen when "Hey MIRA" is spoken —
 * WITHOUT opening the full MIRA app!
 */
public class MiraOverlayService extends Service {
    public static final String ACTION_WAKE = "com.redmagic.mora.mirror.OVERLAY_WAKE";
    public static final String ACTION_HIDE = "com.redmagic.mora.mirror.OVERLAY_HIDE";
    public static final String EXTRA_COMMAND = "command";

    private static final String CHANNEL_ID = "mira_overlay_channel";
    private static final int NOTIF_ID = 4102;

    private WindowManager wm;
    private View rootView;
    private WindowManager.LayoutParams params;
    private TextView statusBadge;
    private TextView bubbleText;
    private ImageView avatarView;

    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService bgPool = Executors.newSingleThreadExecutor();
    private final Runnable autoHideTask = this::dismissOverlay;

    private int initX, initY;
    private float touchX, touchY;
    private boolean dragging = false;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
        startForeground(NOTIF_ID, buildNotif());
        wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                ttsReady = true;
                tts.setLanguage(Locale.US);
                tts.setPitch(1.18f);
                tts.setSpeechRate(1.03f);
            }
        });
        createOverlayView();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_HIDE.equals(intent.getAction())) {
            dismissOverlay();
            return START_NOT_STICKY;
        }
        showOverlay();
        String inlineCmd = intent != null ? intent.getStringExtra(EXTRA_COMMAND) : null;
        if (inlineCmd != null && !inlineCmd.trim().isEmpty()) {
            processVoiceCommand(inlineCmd.trim());
        } else {
            speak("Yes, I'm listening!");
            handler.postDelayed(this::startVoiceCapture, 450);
        }
        return START_NOT_STICKY;
    }

    private void createOverlayView() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int widthPx = Math.min(Math.round(dm.widthPixels * 0.86f), 860);

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;

        params = new WindowManager.LayoutParams(
            widthPx,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.BOTTOM | Gravity.END;
        params.x = 24;
        params.y = Math.round(dm.heightPixels * 0.10f);

        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.HORIZONTAL);
        container.setGravity(Gravity.BOTTOM | Gravity.END);
        container.setPadding(8, 8, 8, 8);

        // Left: Glassmorphic Cyber Bubble
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(28, 22, 28, 22);
        GradientDrawable cardBg = new GradientDrawable();
        cardBg.setColor(Color.argb(232, 10, 14, 26));
        cardBg.setCornerRadius(38f);
        cardBg.setStroke(3, Color.argb(220, 0, 240, 255));
        card.setBackground(cardBg);

        LinearLayout.LayoutParams cardLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        cardLp.rightMargin = 16;

        // Top row of bubble: Badge + Close X
        LinearLayout topRow = new LinearLayout(this);
        topRow.setOrientation(LinearLayout.HORIZONTAL);
        topRow.setGravity(Gravity.CENTER_VERTICAL);

        statusBadge = new TextView(this);
        statusBadge.setText("MIRA MINI · LISTENING...");
        statusBadge.setTextColor(Color.rgb(0, 240, 255));
        statusBadge.setTextSize(11f);
        statusBadge.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView micBtn = new TextView(this);
        micBtn.setText("MIC");
        micBtn.setTextColor(Color.WHITE);
        micBtn.setTextSize(11f);
        micBtn.setPadding(18, 6, 18, 6);
        GradientDrawable micBg = new GradientDrawable();
        micBg.setColor(Color.rgb(255, 42, 75));
        micBg.setCornerRadius(20f);
        micBtn.setBackground(micBg);
        micBtn.setOnClickListener(v -> startVoiceCapture());

        TextView closeBtn = new TextView(this);
        closeBtn.setText("  ✕");
        closeBtn.setTextColor(Color.rgb(200, 210, 225));
        closeBtn.setTextSize(14f);
        closeBtn.setPadding(12, 4, 4, 4);
        closeBtn.setOnClickListener(v -> dismissOverlay());

        topRow.addView(statusBadge);
        topRow.addView(micBtn);
        topRow.addView(closeBtn);

        bubbleText = new TextView(this);
        bubbleText.setText("Hey! Tell me what to do on your phone or ask anything!");
        bubbleText.setTextColor(Color.WHITE);
        bubbleText.setTextSize(13.5f);
        bubbleText.setPadding(0, 10, 0, 0);

        card.addView(topRow);
        card.addView(bubbleText);

        // Right: Mini MIRA Floating Avatar Cutout (matching screenshot Mini MIRA!)
        avatarView = new ImageView(this);
        Bitmap bmp = MiraLiveWallpaperService.loadAssetBitmap(this, "public/assets/mora-chibi-cutout.png");
        if (bmp == null) {
            bmp = MiraLiveWallpaperService.loadAssetBitmap(this, "public/assets/mora-cyber-cutout.png");
        }
        if (bmp != null) {
            avatarView.setImageBitmap(bmp);
        }
        int avSize = Math.round(dm.density * 92);
        LinearLayout.LayoutParams avLp = new LinearLayout.LayoutParams(avSize, Math.round(avSize * 1.25f));
        avatarView.setScaleType(ImageView.ScaleType.FIT_CENTER);

        container.addView(card, cardLp);
        container.addView(avatarView, avLp);

        container.setOnTouchListener((v, event) -> {
            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    initX = params.x;
                    initY = params.y;
                    touchX = event.getRawX();
                    touchY = event.getRawY();
                    dragging = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = touchX - event.getRawX();
                    float dy = touchY - event.getRawY();
                    if (!dragging && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) dragging = true;
                    if (dragging) {
                        params.x = Math.round(initX + dx);
                        params.y = Math.round(initY + dy);
                        wm.updateViewLayout(rootView, params);
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    if (!dragging) startVoiceCapture();
                    return true;
            }
            return false;
        });

        rootView = container;
        wm.addView(rootView, params);
    }

    private void showOverlay() {
        handler.removeCallbacks(autoHideTask);
        if (rootView != null) {
            rootView.setVisibility(View.VISIBLE);
            rootView.setScaleX(0.85f);
            rootView.setScaleY(0.85f);
            rootView.setAlpha(0f);
            rootView.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(260)
                .setInterpolator(new OvershootInterpolator()).start();
        }
    }

    private void startVoiceCapture() {
        handler.removeCallbacks(autoHideTask);
        destroyRecognizer();
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            bubbleText.setText("Speech recognition unavailable on this device.");
            scheduleAutoHide(4500);
            return;
        }
        statusBadge.setText("MIRA MINI · LISTENING...");
        statusBadge.setTextColor(Color.rgb(0, 240, 255));

        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) {}
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rmsdB) {
                if (avatarView != null) {
                    float s = 1f + Math.min(0.12f, Math.max(0f, rmsdB / 60f));
                    avatarView.setScaleX(s);
                    avatarView.setScaleY(s);
                }
            }
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() {
                if (avatarView != null) {
                    avatarView.setScaleX(1f);
                    avatarView.setScaleY(1f);
                }
            }
            @Override public void onError(int error) {
                statusBadge.setText("MIRA MINI · TAP MIC");
                scheduleAutoHide(5500);
            }
            @Override public void onPartialResults(Bundle partialResults) {
                ArrayList<String> res = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (res != null && !res.isEmpty()) {
                    bubbleText.setText("“" + res.get(0) + "”");
                }
            }
            @Override public void onResults(Bundle results) {
                ArrayList<String> res = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (res != null && !res.isEmpty()) {
                    processVoiceCommand(res.get(0));
                } else {
                    scheduleAutoHide(4500);
                }
            }
            @Override public void onEvent(int eventType, Bundle params) {}
        });

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        recognizer.startListening(intent);
    }

    private void processVoiceCommand(String cmd) {
        handler.removeCallbacks(autoHideTask);
        statusBadge.setText("MIRA MINI · EXECUTING");
        statusBadge.setTextColor(Color.rgb(255, 42, 75));
        bubbleText.setText("You: " + cmd);

        MiraDeviceController.CommandResult local = MiraDeviceController.executeCommand(this, cmd);
        if (local.handled) {
            statusBadge.setText("MIRA · " + local.actionTag);
            bubbleText.setText(local.reply);
            speak(local.reply);
            scheduleAutoHide(5500);
            return;
        }

        statusBadge.setText("MIRA AI · THINKING...");
        bgPool.execute(() -> {
            String reply = MiraDeviceController.askFreeAiBlocking(this, cmd);
            handler.post(() -> {
                statusBadge.setText("MIRA AI · FREE CORE");
                bubbleText.setText(reply);
                speak(reply);
                scheduleAutoHide(8000);
            });
        });
    }

    private void speak(String text) {
        if (ttsReady && tts != null && text != null && !text.isEmpty()) {
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "mira_overlay_utt");
        }
    }

    private void scheduleAutoHide(long delayMs) {
        handler.removeCallbacks(autoHideTask);
        handler.postDelayed(autoHideTask, delayMs);
    }

    private void dismissOverlay() {
        destroyRecognizer();
        if (rootView != null) {
            try {
                wm.removeView(rootView);
            } catch (Exception ignored) {}
            rootView = null;
        }
        stopSelf();
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
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Mini MIRA Overlay", NotificationManager.IMPORTANCE_LOW);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotif() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Mini MIRA Assistant")
            .setContentText("Listening on screen")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setSilent(true)
            .build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        destroyRecognizer();
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        if (rootView != null) {
            try {
                wm.removeView(rootView);
            } catch (Exception ignored) {}
        }
        super.onDestroy();
    }
}
