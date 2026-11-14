package com.mira.companion;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.speech.SpeechRecognizer;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.Locale;

/**
 * MIRA — always-listening shell.
 *
 * A foreground service that owns two things:
 *   1. a tiny floating WebView that shows her 3D body over whatever app you are
 *      in (no full app launch), and
 *   2. the wake word. "Hey Mira" / "Mira utho" brings the small model up and
 *      starts listening; the next sentence is the command.
 *
 * Both permissions are the user's to give: "Display over other apps" for the
 * overlay and the microphone for the wake word. Nothing is claimed if they are
 * missing — the service says so and stops.
 */
public class MiraOverlayService extends Service {

    public static final String ACTION_START = "com.mira.companion.WAKE_START";
    public static final String ACTION_STOP = "com.mira.companion.WAKE_STOP";

    private static final String TAG = "MiraOverlay";
    private static final String CHANNEL = "mira_wake";
    private static final int NOTE_ID = 4407;

    private static volatile boolean running = false;

    private WindowManager wm;
    private WebView web;
    private FrameLayout box;
    private WindowManager.LayoutParams params;

    private SpeechRecognizer recognizer;
    private boolean awake = false;        // overlay is up and waiting for a command
    private boolean wantListening = false;
    private long lastWakeAt = 0;
    private volatile long quietUntil = 0;   // ignore the mic while she talks
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private final Handler ui = new Handler(Looper.getMainLooper());

    public static boolean isRunning() { return running; }

    /* ---------------------------------------------------------------- */
    /* lifecycle                                                        */
    /* ---------------------------------------------------------------- */

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        startForegroundNote();
        initTts();
        buildOverlay();
        startWakeLoop();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        stopRecognizer();
        try {
            if (web != null) {
                if (box != null && box.getParent() != null) wm.removeView(box);
                web.destroy();
                web = null;
            }
        } catch (Exception ignored) { }
        try {
            if (tts != null) { tts.stop(); tts.shutdown(); }
        } catch (Exception ignored) { }
        stopForeground(true);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    /* ---------------------------------------------------------------- */
    /* notification (required for a foreground service)                 */
    /* ---------------------------------------------------------------- */

    private void startForegroundNote() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (nm != null) {
                    NotificationChannel ch = new NotificationChannel(
                            CHANNEL, "MIRA wake word", NotificationManager.IMPORTANCE_LOW);
                    ch.setDescription("Sun rahi hoon — 'Hey Mira' bolne par aa jaungi");
                    nm.createNotificationChannel(ch);
                }
            }
            Intent open = new Intent(this, MainActivity.class);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT
                    | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
            PendingIntent pi = PendingIntent.getActivity(this, 0, open, flags);

            Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                    ? new Notification.Builder(this, CHANNEL)
                    : new Notification.Builder(this);
            b.setContentTitle("MIRA sun rahi hoon")
             .setContentText("'Hey Mira' ya 'Mira utho' bolo")
             .setSmallIcon(android.R.drawable.ic_btn_speak_now)
             .setOngoing(true)
             .setContentIntent(pi);
            startForeground(NOTE_ID, b.build());
        } catch (Exception e) {
            Log.e(TAG, "notification failed", e);
        }
    }

    /* ---------------------------------------------------------------- */
    /* the floating model                                               */
    /* ---------------------------------------------------------------- */

    private int port() {
        return getSharedPreferences("mira", Context.MODE_PRIVATE).getInt("embedded_port", 8090);
    }

    private void buildOverlay() {
        try {
            int width = (int) (getResources().getDisplayMetrics().density * 170);
            int height = (int) (getResources().getDisplayMetrics().density * 240);

            box = new FrameLayout(this);
            web = new WebView(this);
            web.setBackgroundColor(0x00000000);
            web.getSettings().setJavaScriptEnabled(true);
            web.getSettings().setDomStorageEnabled(true);
            web.getSettings().setMediaPlaybackRequiresUserGesture(false);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                WebView.setWebContentsDebuggingEnabled(false);
            }
            web.setWebViewClient(new WebViewClient() {
                @Override
                public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                    // the brain may still be booting — try again shortly
                    ui.postDelayed(() -> {
                        try { web.loadUrl("http://127.0.0.1:" + port() + "/overlay.html"); }
                        catch (Exception ignored) { }
                    }, 2000);
                }
            });
            web.addJavascriptInterface(new OverlayBridge(), "MiraNative");
            web.loadUrl("http://127.0.0.1:" + port() + "/overlay.html");
            box.addView(web, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

            int type = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                    ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    : WindowManager.LayoutParams.TYPE_PHONE;

            params = new WindowManager.LayoutParams(
                    width, height, type,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    PixelFormat.TRANSLUCENT);
            params.gravity = Gravity.TOP | Gravity.END;
            params.x = (int) (getResources().getDisplayMetrics().density * 8);
            params.y = (int) (getResources().getDisplayMetrics().density * 90);

            // drag it wherever you like
            box.setOnTouchListener(new View.OnTouchListener() {
                float dx, dy;
                int ox, oy;
                @Override
                public boolean onTouch(View v, MotionEvent e) {
                    switch (e.getAction()) {
                        case MotionEvent.ACTION_DOWN:
                            dx = e.getRawX(); dy = e.getRawY();
                            ox = params.x; oy = params.y;
                            return true;
                        case MotionEvent.ACTION_MOVE:
                            params.x = ox - (int) (e.getRawX() - dx);
                            params.y = oy + (int) (e.getRawY() - dy);
                            try { wm.updateViewLayout(box, params); } catch (Exception ignored) { }
                            return true;
                        default:
                            return false;
                    }
                }
            });

            wm.addView(box, params);
            box.setVisibility(View.GONE);
        } catch (Exception e) {
            Log.e(TAG, "overlay could not be created", e);
            toast("Overlay nahi bana — 'Display over other apps' on hai?");
            stopSelf();
        }
    }

    private void showOverlay(boolean show) {
        awake = show;
        try {
            box.setVisibility(show ? View.VISIBLE : View.GONE);
        } catch (Exception ignored) { }
    }

    private void toast(final String msg) {
        ui.post(() -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show());
    }

    private void initTts() {
        try {
            tts = new TextToSpeech(this, status -> {
                if (status == TextToSpeech.SUCCESS && tts != null) {
                    try { tts.setLanguage(new Locale("hi", "IN")); } catch (Exception ignored) { }
                    tts.setSpeechRate(1.02f);
                    ttsReady = true;
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "tts init failed", e);
        }
    }

    /* ---------------------------------------------------------------- */
    /* wake word                                                        */
    /* ---------------------------------------------------------------- */

    private static boolean containsWake(String text) {
        if (text == null) return false;
        String t = " " + text.toLowerCase(Locale.ROOT).replaceAll("[^a-z ]", " ") + " ";
        return t.contains(" mira ") || t.contains("meera") || t.contains("myra")
                || t.contains("utho mira") || t.contains("hey mira") || t.contains("hi mira")
                || t.contains("mira utho");
    }

    private void startWakeLoop() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            toast("Phone par speech recognition nahi hai");
            stopSelf();
            return;
        }
        ui.post(() -> {
            try {
                if (recognizer == null) {
                    recognizer = SpeechRecognizer.createSpeechRecognizer(this);
                    recognizer.setRecognitionListener(new Listener());
                }
                wantListening = true;
                listenNow();
            } catch (Exception e) {
                Log.e(TAG, "recognizer failed", e);
            }
        });
    }

    private void listenNow() {
        if (recognizer == null || !wantListening) return;
        try {
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "hi-IN");
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            recognizer.startListening(i);
        } catch (Exception e) {
            ui.postDelayed(this::listenNow, 1500);
        }
    }

    private void stopRecognizer() {
        wantListening = false;
        try {
            if (recognizer != null) {
                recognizer.cancel();
                recognizer.destroy();
                recognizer = null;
            }
        } catch (Exception ignored) { }
    }

    private class Listener implements RecognitionListener {
        @Override public void onReadyForSpeech(Bundle b) { }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float v) { }
        @Override public void onBufferReceived(byte[] b) { }
        @Override public void onEndOfSpeech() { }

        @Override public void onError(int error) {
            // silence / timeout is normal — just keep the loop alive
            ui.postDelayed(MiraOverlayService.this::listenNow, awake ? 300 : 700);
        }

        @Override public void onPartialResults(Bundle partial) {
            ArrayList<String> got = partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            String text = (got == null || got.isEmpty()) ? "" : got.get(0);
            if (!awake && containsWake(text)) {
                wakeUp();
            }
        }

        @Override public void onResults(Bundle results) {
            ArrayList<String> got = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            String text = (got == null || got.isEmpty()) ? "" : got.get(0);
            String low = text == null ? "" : text.toLowerCase(Locale.ROOT);

            if (awake) {
                String command = low.replace("mira", " ").replace("meera", " ").trim();
                if (command.length() > 1) {
                    sendCommand(command);
                } else {
                    // they only said the name again — stay listening
                    js("window.__miraPrompt && window.__miraPrompt()");
                }
            } else if (containsWake(text)) {
                wakeUp();
            }
            ui.postDelayed(MiraOverlayService.this::listenNow, awake ? 400 : 700);
        }

        @Override public void onEvent(int type, Bundle params) { }
    }

    private void wakeUp() {
        long now = System.currentTimeMillis();
        if (now - lastWakeAt < 1200) return;   // debounce double fires
        lastWakeAt = now;
        showOverlay(true);
        js("window.__miraWake && window.__miraWake()");
    }

    private void sendCommand(String text) {
        String escaped = text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ");
        js("window.__miraCommand && window.__miraCommand('" + escaped + "')");
    }

    private void js(String script) {
        ui.post(() -> {
            if (web != null) web.evaluateJavascript("(function(){" + script + "})()", null);
        });
    }

    /* ---------------------------------------------------------------- */
    /* bridge for the floating page                                     */
    /* ---------------------------------------------------------------- */

    private void act(Intent i) {
        if (i == null) return;
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { startActivity(i); } catch (Exception e) { toast("Ye action nahi chala"); }
    }

    private static String digits(String s) {
        return s == null ? "" : s.replaceAll("[^0-9+]", "");
    }

    public class OverlayBridge {

        @JavascriptInterface
        public String platform() { return "android-overlay"; }

        @JavascriptInterface
        public String ping() {
            return "overlay/port=" + port() + "/awake=" + awake;
        }

        @JavascriptInterface
        public void speak(final String text) {
            ui.post(() -> {
                try {
                    if (ttsReady && tts != null) {
                        quietUntil = System.currentTimeMillis() + 2500;
                        tts.stop();
                        tts.speak(text == null ? "" : text, TextToSpeech.QUEUE_FLUSH, null, "mira-overlay");
                    }
                } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface
        public void hide() {
            ui.post(() -> showOverlay(false));
        }

        @JavascriptInterface
        public void openApp(final String name) {
            ui.post(() -> {
                String wanted = name == null ? "" : name.trim().toLowerCase(Locale.ROOT);
                if (wanted.isEmpty()) return;
                Intent probe = new Intent(Intent.ACTION_MAIN, null);
                probe.addCategory(Intent.CATEGORY_LAUNCHER);
                java.util.List<android.content.pm.ResolveInfo> all =
                        getPackageManager().queryIntentActivities(probe, 0);
                android.content.pm.ResolveInfo best = null;
                for (android.content.pm.ResolveInfo ri : all) {
                    String label = String.valueOf(ri.loadLabel(getPackageManager())).toLowerCase(Locale.ROOT);
                    if (ri.activityInfo.packageName.equals(getPackageName())) continue;
                    if (label.equals(wanted)) { best = ri; break; }
                    if (best == null && label.contains(wanted)) best = ri;
                }
                if (best == null) { toast("'" + wanted + "' app nahi mila"); return; }
                Intent i = new Intent(Intent.ACTION_MAIN);
                i.addCategory(Intent.CATEGORY_LAUNCHER);
                i.setComponent(new android.content.ComponentName(
                        best.activityInfo.packageName, best.activityInfo.name));
                act(i);
            });
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            String u = url == null ? "" : url.trim();
            if (u.isEmpty()) return;
            if (!u.matches("(?i)^[a-z]+://.*")) u = "https://" + u;
            act(new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
        }

        @JavascriptInterface
        public void searchIn(final String app, final String query) {
            String q = query == null ? "" : query.trim();
            if (q.isEmpty()) return;
            String key = app == null ? "" : app.toLowerCase(Locale.ROOT);
            if (key.contains("youtube") || key.contains("yt")) {
                act(new Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(q))));
                return;
            }
            if (key.contains("map")) {
                act(new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(q))));
                return;
            }
            if (key.contains("spotify")) {
                act(new Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://open.spotify.com/search/" + Uri.encode(q))));
                return;
            }
            act(new Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://www.google.com/search?q=" + Uri.encode(q))));
        }

        @JavascriptInterface
        public void phone(final String kind, final String value) {
            String v = value == null ? "" : value.trim();
            String k = kind == null ? "" : kind;
            if (k.equals("call")) act(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + digits(v))));
            else if (k.equals("sms")) act(new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + digits(v))));
            else if (k.equals("maps")) act(new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(v))));
            else if (k.equals("settings")) act(new Intent(android.provider.Settings.ACTION_SETTINGS));
            else if (k.equals("alarm")) {
                act(new Intent(android.provider.AlarmClock.ACTION_SET_ALARM)
                        .putExtra(android.provider.AlarmClock.EXTRA_MESSAGE, "MIRA"));
            } else toast("Pata nahi kaise: " + k);
        }

        @JavascriptInterface
        public void message(final String app, final String to, final String text) {
            String num = digits(to);
            String body = text == null ? "" : text;
            String url = (num.length() >= 8)
                    ? "https://wa.me/" + num.replace("+", "") + "?text=" + Uri.encode(body)
                    : "https://wa.me/?text=" + Uri.encode(body);
            act(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        }

        @JavascriptInterface
        public void torch(final boolean on) {
            ui.post(() -> {
                try {
                    android.hardware.camera2.CameraManager cm =
                            (android.hardware.camera2.CameraManager) getSystemService(Context.CAMERA_SERVICE);
                    if (cm != null) cm.setTorchMode(cm.getCameraIdList()[0], on);
                } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface
        public void volume(final String level) {
            ui.post(() -> {
                try {
                    android.media.AudioManager am =
                            (android.media.AudioManager) getSystemService(Context.AUDIO_SERVICE);
                    if (am == null) return;
                    String v = level == null ? "" : level.trim();
                    if (v.matches("\\d{1,3}")) {
                        int max = am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC);
                        am.setStreamVolume(android.media.AudioManager.STREAM_MUSIC,
                                Math.round(max * Math.min(100, Integer.parseInt(v)) / 100f), 0);
                    } else if (v.equals("mute")) {
                        am.setStreamVolume(android.media.AudioManager.STREAM_MUSIC, 0, 0);
                    } else if (v.equals("down")) {
                        am.adjustStreamVolume(android.media.AudioManager.STREAM_MUSIC,
                                android.media.AudioManager.ADJUST_LOWER, 0);
                    } else {
                        am.adjustStreamVolume(android.media.AudioManager.STREAM_MUSIC,
                                android.media.AudioManager.ADJUST_RAISE, 0);
                    }
                } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface
        public void media(final String cmd) {
            ui.post(() -> {
                try {
                    android.media.AudioManager am =
                            (android.media.AudioManager) getSystemService(Context.AUDIO_SERVICE);
                    if (am == null) return;
                    int key = android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
                    String c = cmd == null ? "" : cmd;
                    if (c.equals("next")) key = android.view.KeyEvent.KEYCODE_MEDIA_NEXT;
                    else if (c.equals("prev")) key = android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS;
                    long now = android.os.SystemClock.uptimeMillis();
                    am.dispatchMediaKeyEvent(new android.view.KeyEvent(now, now,
                            android.view.KeyEvent.ACTION_DOWN, key, 0));
                    am.dispatchMediaKeyEvent(new android.view.KeyEvent(now, now,
                            android.view.KeyEvent.ACTION_UP, key, 0));
                } catch (Exception ignored) { }
            });
        }
    }
}
