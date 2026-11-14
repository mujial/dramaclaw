package com.mira.companion;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.provider.AlarmClock;
import android.provider.Settings;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.text.InputType;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * MIRA — Android shell.
 *
 * A dependency-free host: one full-screen WebView for the companion UI, plus a
 * JavaScript bridge that supplies the two things an Android WebView does not
 * give a web page on its own:
 *
 *   1. speech recognition  (android.speech.SpeechRecognizer, in-app, continuous)
 *   2. text-to-speech      (android.speech.tts.TextToSpeech, Hindi + English)
 *
 * The page calls `window.MiraNative` and the shell calls back into
 *   window.__miraSpeechPartial / __miraSpeechResult / __miraSpeechError /
 *   __miraSpeechEnd
 *
 * MIRA's whole brain — memory, agent, providers, voice, HTTP API — also runs
 * inside this APK: Chaquopy executes CPython in-process and
 * `mira.android_boot.start()` brings the standard-library server up on
 * 127.0.0.1. The WebView then simply loads http://127.0.0.1:<port>/, so there
 * is no CORS, no LAN, no second device.
 *
 * If embedded Python ever fails to start (unsupported ABI, corrupt install),
 * the shell falls back to the bundled static UI and the user can point it at a
 * server on the LAN from Settings → "MIRA server". It never just shows a blank
 * screen.
 */
public class MainActivity extends Activity {

    private static final String TAG = "MIRA";
    private static final String PREFS = "mira";
    private static final String KEY_SERVER = "server";
    private static final String DEFAULT_SERVER = "http://127.0.0.1:8090";
    private static final int REQ_MIC = 4301;

    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady = false;

    private SpeechRecognizer recognizer;
    private boolean listening = false;
    private boolean pendingListen = false;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;
    private String serverBase;
    private volatile int embeddedPort = 0;

    /* ------------------------------------------------------------------ */
    /* lifecycle                                                          */
    /* ------------------------------------------------------------------ */

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        serverBase = prefs.getString(KEY_SERVER, DEFAULT_SERVER);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);   // file:// -> http://<lan>
        s.setTextZoom(100);

        web.setBackgroundColor(0xFF07030F);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // Anything that is not our own page belongs to the browser/apps,
                // otherwise tapping a link would navigate the companion away.
                if (url != null && (url.startsWith("http://127.0.0.1")
                        || url.startsWith("file:///android_asset"))) {
                    return false;
                }
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "MiraNative");

        setContentView(web);

        initTts();
        bootPython();
    }

    /**
     * Bring up CPython + MIRA's server in the background, then point the WebView
     * at it. Falls back to the static shell if anything at all goes wrong.
     */
    private void bootPython() {
        final String dataDir = new java.io.File(getFilesDir(), "mira").getAbsolutePath();

        new Thread(() -> {
            long t0 = System.currentTimeMillis();
            int port = 0;
            String failure = "";
            try {
                if (!Python.isStarted()) {
                    Python.start(new AndroidPlatform(getApplicationContext()));
                }
                PyObject boot = Python.getInstance().getModule("mira.android_boot");
                port = boot.callAttr("start", dataDir, "").toInt();
                if (port == 0) {
                    failure = boot.callAttr("last_error").toString();
                }
            } catch (Throwable t) {
                failure = t.getClass().getSimpleName() + ": " + t.getMessage();
                Log.e(TAG, "python boot failed", t);
            }

            final int okPort = port;
            final String why = failure;
            final long ms = System.currentTimeMillis() - t0;

            ui.post(() -> {
                if (okPort > 0) {
                    embeddedPort = okPort;
                    Log.i(TAG, "embedded brain on port " + okPort + " in " + ms + "ms");
                    web.loadUrl("http://127.0.0.1:" + okPort + "/");
                } else {
                    Log.e(TAG, "embedded brain unavailable: " + why);
                    Toast.makeText(this,
                            "Embedded brain start nahi hua — settings se server address daalo",
                            Toast.LENGTH_LONG).show();
                    loadUi();
                }
            });
        }, "mira-python-boot").start();
    }

    private void loadUi() {
        String url = "file:///android_asset/www/index.html?api=" + serverBase;
        Log.i(TAG, "loading " + url);
        web.loadUrl(url);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
        stopRecognizer();
        if (ttsReady) tts.stop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        stopRecognizer();
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        if (web != null) web.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /* ------------------------------------------------------------------ */
    /* text to speech                                                     */
    /* ------------------------------------------------------------------ */

    private void initTts() {
        tts = new TextToSpeech(this, status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (!ttsReady) {
                Log.w(TAG, "TTS unavailable");
                return;
            }
            // Hindi first — the persona is Hinglish — then Indian English, then US.
            int r = tts.setLanguage(new Locale("hi", "IN"));
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                r = tts.setLanguage(new Locale("en", "IN"));
            }
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                tts.setLanguage(Locale.US);
            }
            tts.setPitch(1.06f);
            tts.setSpeechRate(1.0f);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { callJs("__miraSpeechEnd()"); }
                @Override public void onError(String id) { callJs("__miraSpeechEnd()"); }
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /* speech recognition                                                 */
    /* ------------------------------------------------------------------ */

    private void startListening() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            pendingListen = true;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
            return;
        }

        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            callJs("__miraSpeechError('Is phone par speech recogniser nahi hai')");
            return;
        }

        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new Listener());
        }

        listening = true;
        recognizer.cancel();
        recognizer.startListening(recognitionIntent());
    }

    private android.content.Intent recognitionIntent() {
        android.content.Intent i = new android.content.Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "hi-IN");
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "hi-IN");
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        return i;
    }

    private void stopRecognizer() {
        listening = false;
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (Exception ignored) { }
        }
    }

    private class Listener implements RecognitionListener {
        @Override public void onReadyForSpeech(Bundle p) { }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float rms) { }
        @Override public void onBufferReceived(byte[] b) { }
        @Override public void onEndOfSpeech() { }

        @Override
        public void onPartialResults(Bundle partial) {
            String t = best(partial);
            if (t != null && !t.isEmpty()) callJs("__miraSpeechPartial(" + jsStr(t) + ")");
        }

        @Override
        public void onResults(Bundle results) {
            listening = false;
            String t = best(results);
            if (t != null && !t.isEmpty()) {
                callJs("__miraSpeechResult(" + jsStr(t) + ")");
            } else {
                callJs("__miraSpeechError('Kuch sunai nahi diya')");
            }
        }

        @Override
        public void onError(int error) {
            String msg = errorText(error);
            boolean soft = error == SpeechRecognizer.ERROR_NO_MATCH
                    || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                    || error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY;
            if (listening && soft) {
                // keep the conversation going — restart quietly
                ui.postDelayed(() -> {
                    if (listening && recognizer != null) {
                        try { recognizer.startListening(recognitionIntent()); } catch (Exception ignored) { }
                    }
                }, 400);
                return;
            }
            listening = false;
            callJs("__miraSpeechError(" + jsStr(msg) + ")");
        }

        @Override public void onEvent(int type, Bundle params) { }
    }

    private static String best(Bundle b) {
        if (b == null) return null;
        ArrayList<String> list = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (list == null || list.isEmpty()) return null;
        return list.get(0);
    }

    private static String errorText(int code) {
        switch (code) {
            case SpeechRecognizer.ERROR_AUDIO: return "Audio error";
            case SpeechRecognizer.ERROR_CLIENT: return "Recogniser client error";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "Mic permission denied";
            case SpeechRecognizer.ERROR_NETWORK: return "Network error — recognise offline?";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "Network timeout";
            case SpeechRecognizer.ERROR_NO_MATCH: return "Samajh nahi aaya, phir bolo";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "Recogniser busy";
            case SpeechRecognizer.ERROR_SERVER: return "Recogniser server error";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "Kuch sunai nahi diya";
            default: return "Speech error " + code;
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == REQ_MIC) {
            boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            boolean wanted = pendingListen;
            pendingListen = false;
            if (granted && wanted) startListening();
            else if (!granted) callJs("__miraSpeechError('Microphone permission denied')");
        }
    }

    /* ------------------------------------------------------------------ */
    /* JS -> native                                                       */
    /* ------------------------------------------------------------------ */

    private void callJs(final String script) {
        ui.post(() -> {
            if (web != null) web.evaluateJavascript("(function(){" + script + "})()", null);
        });
    }

    private static String jsStr(String s) {
        if (s == null) return "''";
        StringBuilder b = new StringBuilder("'");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '\'': b.append("\\'"); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': break;
                default: b.append(c);
            }
        }
        return b.append("'").toString();
    }

    public class Bridge {

        @JavascriptInterface
        public String platform() { return "android"; }

        @JavascriptInterface
        public String ping() {
            return "android/" + Build.VERSION.SDK_INT
                 + "/port=" + embeddedPort
                 + "/tts=" + (ttsReady ? "ready" : "off")
                 + "/app=" + getPackageName();
        }

        @JavascriptInterface
        public int sdkInt() { return Build.VERSION.SDK_INT; }

        @JavascriptInterface
        public String server() { return serverBase; }

        @JavascriptInterface
        public int embeddedPort() { return embeddedPort; }

        @JavascriptInterface
        public void setServer(String url) {
            if (url == null) return;
            String clean = url.trim().replaceAll("/+$", "");
            if (clean.isEmpty()) return;
            if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
                clean = "http://" + clean;
            }
            serverBase = clean;
            prefs.edit().putString(KEY_SERVER, serverBase).apply();
            ui.post(MainActivity.this::loadUi);
        }

        @JavascriptInterface
        public void promptServer() {
            ui.post(() -> {
                final EditText input = new EditText(MainActivity.this);
                input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
                input.setText(serverBase);
                input.setSelection(input.getText().length());

                new AlertDialog.Builder(MainActivity.this)
                        .setTitle("MIRA server address")
                        .setMessage("Termux: http://127.0.0.1:8090\nWiFi computer: http://192.168.x.x:8090")
                        .setView(input)
                        .setPositiveButton("Save", (d, w) -> setServer(input.getText().toString()))
                        .setNegativeButton("Cancel", null)
                        .show();
            });
        }

        @JavascriptInterface
        public void speak(final String text, final double rate, final double pitch) {
            ui.post(() -> {
                if (!ttsReady) {
                    callJs("__miraSpeechEnd()");
                    return;
                }
                tts.stop();
                tts.setSpeechRate((float) Math.max(0.6d, Math.min(1.6d, rate)));
                tts.setPitch((float) Math.max(0.6d, Math.min(1.6d, pitch)));
                Bundle params = new Bundle();
                tts.speak(text == null ? "" : text, TextToSpeech.QUEUE_FLUSH, params, "mira");
            });
        }

        @JavascriptInterface
        public void stopSpeaking() {
            ui.post(() -> {
                if (ttsReady) tts.stop();
            });
        }

        @JavascriptInterface
        public void listen() {
            ui.post(MainActivity.this::startListening);
        }

        @JavascriptInterface
        public void stopListening() {
            ui.post(MainActivity.this::stopRecognizer);
        }


        /* ---------------- device actions ---------------- */

        @JavascriptInterface
        public void openUrl(final String url) {
            ui.post(() -> {
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(normaliseUrl(url)));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) {
                    toast("Koi app is link ko khol nahi paya");
                }
            });
        }

        /** Launch an installed app by (case-insensitive) launcher label. */
        @JavascriptInterface
        public void openApp(final String name) {
            ui.post(() -> {
                String wanted = name == null ? "" : name.trim().toLowerCase(Locale.ROOT);
                if (wanted.isEmpty()) { toast("Kaunsa app?"); return; }

                // Direct package hits first — predictable and fast.
                String pkg = packageFor(wanted);
                if (pkg != null) {
                    try {
                        Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
                        if (i != null) {
                            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(i);
                            return;
                        }
                    } catch (Exception ignored) { }
                }
                launchByLabel(wanted);
            });
        }

        @JavascriptInterface
        public void phone(final String kind, final String value) {
            ui.post(() -> {
                try {
                    String v = value == null ? "" : value.trim();
                    switch (kind == null ? "" : kind) {
                        case "call":
                            startActivity(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + digits(v))));
                            break;
                        case "sms":
                            startActivity(new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + digits(v))));
                            break;
                        case "alarm":
                            startActivity(new Intent(AlarmClock.ACTION_SET_ALARM)
                                    .putExtra(AlarmClock.EXTRA_MESSAGE, "MIRA"));
                            break;
                        case "maps":
                            startActivity(new Intent(Intent.ACTION_VIEW,
                                    Uri.parse("geo:0,0?q=" + Uri.encode(v))));
                            break;
                        case "camera":
                            startActivity(new Intent("android.media.action.STILL_IMAGE_CAMERA"));
                            break;
                        case "settings":
                            startActivity(new Intent(Settings.ACTION_SETTINGS));
                            break;
                        case "share":
                            startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND)
                                    .setType("text/plain").putExtra(Intent.EXTRA_TEXT, v), "Share"));
                            break;
                        case "email":
                            startActivity(new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + v)));
                            break;
                        default:
                            toast("Pata nahi kaise: " + kind);
                    }
                } catch (Exception e) {
                    toast("Ye action phone par nahi chala: " + e.getClass().getSimpleName());
                }
            });
        }

        @JavascriptInterface
        public void toast(final String message) {
            ui.post(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            try {
                android.os.Vibrator v = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (v != null) v.vibrate(ms);
            } catch (Exception ignored) { }
        }
    }

    /* ------------------------------------------------------------------ */
    /* app launching helpers                                              */
    /* ------------------------------------------------------------------ */

    /** Activity-level toast (the Bridge has its own for JS calls). */
    private void toast(final String message) {
        ui.post(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
    }

    private static String normaliseUrl(String url) {
        String u = (url == null ? "" : url.trim());
        if (!u.matches("(?i)^[a-z]+://.*")) u = "https://" + u.replace(" ", "%20");
        return u;
    }

    private static String digits(String s) {
        return s == null ? "" : s.replaceAll("[^0-9+]", "");
    }

    /** A few labels whose package ids are universally known. */
    private static String packageFor(String label) {
        switch (label) {
            case "whatsapp": return "com.whatsapp";
            case "youtube": return "com.google.android.youtube";
            case "instagram": return "com.instagram.android";
            case "facebook": return "com.facebook.katana";
            case "telegram": return "org.telegram.messenger";
            case "chrome": return "com.android.chrome";
            case "gmail": return "com.google.android.gm";
            case "maps": return "com.google.android.apps.maps";
            case "spotify": return "com.spotify.music";
            case "camera": return "com.android.camera";
            case "gallery": return "com.google.android.apps.photos";
            case "settings": return "com.android.settings";
            case "phone": case "dialer": return "com.android.dialer";
            case "play store": case "playstore": return "com.android.vending";
            default: return null;
        }
    }

    /** Pick the launchable app whose label best matches the request. */
    private void launchByLabel(String wanted) {
        try {
            Intent probe = new Intent(Intent.ACTION_MAIN, null);
            probe.addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> all = getPackageManager().queryIntentActivities(probe, 0);

            ResolveInfo exact = null, starts = null, contains = null;
            for (ResolveInfo ri : all) {
                CharSequence cs = ri.loadLabel(getPackageManager());
                String label = cs == null ? "" : cs.toString().toLowerCase(Locale.ROOT);
                String pkg = ri.activityInfo.packageName;
                if (pkg.equals(getPackageName())) continue;

                if (label.equals(wanted)) { exact = ri; break; }
                if (starts == null && label.startsWith(wanted)) starts = ri;
                if (contains == null && label.contains(wanted)) contains = ri;
            }

            ResolveInfo pick = exact != null ? exact : (starts != null ? starts : contains);
            if (pick == null) {
                toast("'" + wanted + "' naam ka app nahi mila — " +
                      "launcher me jo naam hai wahi bolo");
                return;
            }

            ComponentName cn = new ComponentName(pick.activityInfo.packageName,
                                                 pick.activityInfo.name);
            Intent i = new Intent(Intent.ACTION_MAIN);
            i.addCategory(Intent.CATEGORY_LAUNCHER);
            i.setComponent(cn);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            toast("App khol nahi payi: " + e.getClass().getSimpleName());
        }
    }
}
