package com.mira.companion;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ResolveInfo;
import android.media.AudioManager;
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
import android.view.KeyEvent;
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
    private static final String KEY_PORT = "embedded_port";
    private static final String KEY_MODEL_URL = "model_url";

    /** The 3D body the user uploaded. Downloaded once, then served locally. */
    private static final String DEFAULT_MODEL_URL =
            "https://drive.google.com/uc?export=download&confirm=t&id=12VsOBQbvodOduj2X6nzCKWWWaIwnPc2A";
    private static final int REQ_MIC = 4301;
    private static final int REQ_CONTACTS = 4302;

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
    private boolean pendingAssist = false;   // opened from the assistant gesture

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
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                listenIfAsked();
            }

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

        pendingAssist = isAssist(getIntent());

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
                    prefs.edit().putInt(KEY_PORT, okPort).apply();
                    ensureModel();
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


    /* ------------------------------------------------------------------ */
    /* 3D body + floating overlay                                          */
    /* ------------------------------------------------------------------ */

    private java.io.File modelFile() {
        return new java.io.File(new java.io.File(getFilesDir(), "mira"), "model.glb");
    }

    /** Download the glTF body once. Runs off the UI thread; silent on failure. */
    private void ensureModel() {
        String url = prefs.getString(KEY_MODEL_URL, DEFAULT_MODEL_URL);
        java.io.File f = modelFile();
        if (f.exists() && f.length() > 1024) return;
        downloadModel(url);
    }

    void downloadModel(final String url) {
        if (url == null || url.trim().isEmpty()) return;
        new Thread(() -> {
            String clean = url.trim();
            java.io.File target = modelFile();
            java.io.File dir = target.getParentFile();
            if (dir != null && !dir.exists()) dir.mkdirs();
            java.io.File tmp = new java.io.File(dir, "model.part");
            java.net.HttpURLConnection c = null;
            java.io.InputStream in = null;
            java.io.FileOutputStream out = null;
            try {
                java.net.URL u = new java.net.URL(clean);
                c = (java.net.HttpURLConnection) u.openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(20000);
                c.setReadTimeout(60000);
                c.setRequestProperty("User-Agent", "MIRA/2.5 (Android)");
                int code = c.getResponseCode();
                if (code >= 400) throw new java.io.IOException("HTTP " + code);
                in = c.getInputStream();
                out = new java.io.FileOutputStream(tmp);
                byte[] buf = new byte[64 * 1024];
                int n, total = 0;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    total += n;
                }
                out.flush();
                out.close();
                out = null;
                in.close();
                in = null;
                if (total < 1024) throw new java.io.IOException("too small: " + total);
                if (target.exists() && !target.delete()) throw new java.io.IOException("cannot replace");
                if (!tmp.renameTo(target)) throw new java.io.IOException("rename failed");
                Log.i(TAG, "3D model saved: " + total + " bytes");
                callJs("window.__miraModelReady && window.__miraModelReady()");
            } catch (Exception e) {
                Log.e(TAG, "model download failed", e);
                final String msg = e.getClass().getSimpleName() + ": " + e.getMessage();
                callJs("window.__miraModelError && window.__miraModelError('" + msg.replace("'", " ") + "')");
            } finally {
                try { if (out != null) out.close(); } catch (Exception ignored) { }
                try { if (in != null) in.close(); } catch (Exception ignored) { }
                if (c != null) c.disconnect();
                if (tmp.exists() && !target.exists()) tmp.delete();
            }
        }, "mira-model").start();
    }

    /** "Hey Mira" in the background: floating model + hands-free commands. */
    static boolean canOverlay(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return Settings.canDrawOverlays(ctx);
    }

    private static boolean isAssist(Intent i) {
        if (i == null || i.getAction() == null) return false;
        String a = i.getAction();
        return Intent.ACTION_ASSIST.equals(a)
                || "android.intent.action.VOICE_COMMAND".equals(a)
                || "android.intent.action.SEARCH_LONG_PRESS".equals(a);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (isAssist(intent)) {
            pendingAssist = true;
            if (web != null && embeddedPort != 0) {
                ui.postDelayed(this::listenIfAsked, 400);
            }
        }
    }

    /** Assistant gesture / assistant button: MIRA opens already listening. */
    private void listenIfAsked() {
        if (!pendingAssist) return;
        pendingAssist = false;
        ui.postDelayed(() -> {
            try {
                callJs("window.focusMic && window.focusMic()");
                startListening();
            } catch (Exception ignored) { }
        }, 600);
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
                 + "/app=" + getPackageName()
                 + "/contacts=" + (hasContacts() ? "yes" : "no");
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
                        case "call": {
                            final String spoken = v;
                            new Thread(() -> {
                                String num = digits(spoken);
                                if (num.length() < 6 && !spoken.isEmpty()) {
                                    String hit = firstContactNumber(spoken);
                                    if (!hit.isEmpty()) num = hit;
                                }
                                final String tel = num;
                                ui.post(() -> {
                                    try {
                                        startActivity(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + tel)));
                                    } catch (Exception ignored) { }
                                });
                            }).start();
                            break;
                        }
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


        /* ---------------- phone abilities ---------------- */

        /** Flashlight. Works without the camera permission on Android 6+. */
        @JavascriptInterface
        public void torch(final boolean on) {
            ui.post(() -> {
                try {
                    android.hardware.camera2.CameraManager cm =
                            (android.hardware.camera2.CameraManager) getSystemService(Context.CAMERA_SERVICE);
                    if (cm == null) { toast("Torch nahi mila"); return; }
                    String[] ids = cm.getCameraIdList();
                    if (ids.length == 0) { toast("Torch nahi mila"); return; }
                    cm.setTorchMode(ids[0], on);
                } catch (Exception e) {
                    toast("Torch nahi chala: " + e.getClass().getSimpleName());
                }
            });
        }

        /** play / pause / next / prev / stop as real media-key events. */
        @JavascriptInterface
        public void media(final String cmd) {
            ui.post(() -> {
                try {
                    AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                    if (am == null) return;
                    String c = cmd == null ? "" : cmd.trim().toLowerCase(Locale.ROOT);
                    if (c.equals("volup")) {
                        am.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                                AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI);
                        return;
                    }
                    if (c.equals("voldown")) {
                        am.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                                AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI);
                        return;
                    }
                    int key;
                    switch (c) {
                        case "play": key = KeyEvent.KEYCODE_MEDIA_PLAY; break;
                        case "pause": key = KeyEvent.KEYCODE_MEDIA_PAUSE; break;
                        case "next": key = KeyEvent.KEYCODE_MEDIA_NEXT; break;
                        case "prev": key = KeyEvent.KEYCODE_MEDIA_PREVIOUS; break;
                        case "stop": key = KeyEvent.KEYCODE_MEDIA_STOP; break;
                        default: key = KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE; break;
                    }
                    long now = android.os.SystemClock.uptimeMillis();
                    am.dispatchMediaKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_DOWN, key, 0));
                    am.dispatchMediaKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_UP, key, 0));
                } catch (Exception e) {
                    toast("Media control nahi chala");
                }
            });
        }

        /** "up" / "down" / "mute" / "0".."100" */
        @JavascriptInterface
        public void volume(final String level) {
            ui.post(() -> {
                try {
                    AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                    if (am == null) return;
                    String v = level == null ? "up" : level.trim().toLowerCase(Locale.ROOT);
                    int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                    if (v.matches("\\d{1,3}")) {
                        int pct = Math.max(0, Math.min(100, Integer.parseInt(v)));
                        am.setStreamVolume(AudioManager.STREAM_MUSIC,
                                Math.round(max * pct / 100f), AudioManager.FLAG_SHOW_UI);
                    } else if (v.equals("mute") || v.equals("0")) {
                        am.setStreamVolume(AudioManager.STREAM_MUSIC, 0, AudioManager.FLAG_SHOW_UI);
                    } else if (v.equals("down")) {
                        am.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                                AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI);
                    } else {
                        am.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                                AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI);
                    }
                } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface
        public void copy(final String text) {
            ui.post(() -> {
                try {
                    android.content.ClipboardManager cb =
                            (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cb != null) cb.setPrimaryClip(
                            android.content.ClipData.newPlainText("MIRA", text == null ? "" : text));
                    toast("Copy ho gaya");
                } catch (Exception e) {
                    toast("Copy nahi hua");
                }
            });
        }

        @JavascriptInterface
        public String readClipboard() {
            try {
                android.content.ClipboardManager cb =
                        (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cb == null || cb.getPrimaryClip() == null || cb.getPrimaryClip().getItemCount() == 0) {
                    return "";
                }
                CharSequence t = cb.getPrimaryClip().getItemAt(0).coerceToText(MainActivity.this);
                return t == null ? "" : t.toString();
            } catch (Exception e) {
                return "";
            }
        }

        /** WhatsApp / SMS. A number with a country code goes straight to that chat. */
        @JavascriptInterface
        public void message(final String app, final String to, final String body) {
            ui.post(() -> {
                try {
                    String who = to == null ? "" : to.trim();
                    String text = body == null ? "" : body;
                    String num = digits(who);
                    boolean whatsapp = app == null || app.toLowerCase(Locale.ROOT).contains("whatsapp")
                            || app.toLowerCase(Locale.ROOT).contains("wa");
                    boolean hasCountryCode = who.trim().startsWith("+") || num.length() >= 11;

                    if (whatsapp) {
                        String url = (num.length() > 0 && hasCountryCode)
                                ? "https://wa.me/" + num.replace("+", "") + "?text=" + Uri.encode(text)
                                : "https://wa.me/?text=" + Uri.encode(text);
                        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                        if (!(num.length() > 0 && hasCountryCode)) {
                            toast("Contact chuno — message taiyar hai");
                        }
                    } else {
                        Intent i = new Intent(Intent.ACTION_SENDTO,
                                Uri.parse("smsto:" + num + "?body=" + Uri.encode(text)));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    }
                } catch (Exception e) {
                    toast("Message nahi khul paya");
                }
            });
        }


        /**
         * Search *inside* an app. The old path opened the app and then fired a
         * plain web link, which the browser swallowed — YouTube opened, the
         * search did not. Deep links with an explicit package fix that.
         */
        @JavascriptInterface
        public void searchIn(final String app, final String query) {
            ui.post(() -> {
                String q = query == null ? "" : query.trim();
                if (q.isEmpty()) return;
                String key = app == null ? "" : app.trim().toLowerCase(Locale.ROOT);
                String pkg = packageFor(key);
                Intent i = null;
                try {
                    if (key.contains("youtube") || key.equals("yt")) {
                        // straight into YouTube's own search results
                        try {
                            Intent yt = new Intent(Intent.ACTION_VIEW,
                                    Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(q)));
                            yt.setPackage(pkg == null ? "com.google.android.youtube" : pkg);
                            yt.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(yt);
                            return;
                        } catch (Exception e1) {
                            Intent yt2 = new Intent(Intent.ACTION_VIEW,
                                    Uri.parse("vnd.youtube://results?search_query=" + Uri.encode(q)));
                            yt2.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(yt2);
                            return;
                        }
                    } else if (key.contains("play") || key.equals("ps")) {
                        i = new Intent(Intent.ACTION_VIEW,
                                Uri.parse("market://search?q=" + Uri.encode(q)));
                        i.setPackage("com.android.vending");
                    } else if (key.contains("map")) {
                        i = new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(q)));
                    } else if (key.contains("spotify")) {
                        i = new Intent(Intent.ACTION_VIEW,
                                Uri.parse("https://open.spotify.com/search/" + Uri.encode(q)));
                        i.setPackage("com.spotify.music");
                    } else if (key.contains("instagram")) {
                        i = new Intent(Intent.ACTION_VIEW,
                                Uri.parse("https://www.instagram.com/explore/tags/"
                                        + Uri.encode(q.replace(" ", "")) + "/"));
                        if (pkg != null) i.setPackage(pkg);
                    } else if (key.contains("amazon")) {
                        i = new Intent(Intent.ACTION_VIEW,
                                Uri.parse("https://www.amazon.in/s?k=" + Uri.encode(q)));
                    } else if (key.contains("flipkart")) {
                        i = new Intent(Intent.ACTION_VIEW,
                                Uri.parse("https://www.flipkart.com/search?q=" + Uri.encode(q)));
                    }
                    if (i != null) {
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                        return;
                    }
                } catch (Exception ignored) {
                    // that app does not take this link — fall through
                }
                openApp(key);
                ui.postDelayed(() -> openUrl("https://www.google.com/search?q=" + Uri.encode(q)), 1200);
            });
        }

        /** Contact matches for a spoken name, as a JSON array string. */
        @JavascriptInterface
        public String resolveContact(final String name) {
            return contactJson(name);
        }

        /**
         * "brother ko hi bhejo" — a name is turned into a number from the
         * address book, then the right chat is opened.
         */
        @JavascriptInterface
        public void sendMessageTo(final String app, final String to, final String text) {
            final String who = to == null ? "" : to.trim();
            final String body = text == null ? "" : text;
            final String appName = app == null ? "whatsapp" : app;

            ui.post(() -> {
                String num = digits(who);
                boolean looksNumber = num.length() >= 8;
                if (looksNumber) { message(appName, who, body); return; }
                if (who.isEmpty()) { toast("Kisko bhejna hai?"); return; }

                if (!hasContacts()) {
                    requestPermissions(new String[]{Manifest.permission.READ_CONTACTS}, REQ_CONTACTS);
                    toast("Contacts permission do — phir naam se bhej paungi");
                    return;
                }

                new Thread(() -> {
                    final String json = contactJson(who);
                    int n = 0;
                    org.json.JSONArray arr = new org.json.JSONArray();
                    try { arr = new org.json.JSONArray(json); n = arr.length(); }
                    catch (Exception ignored) { }

                    if (n == 0) {
                        ui.post(() -> {
                            toast("'" + who + "' contacts me nahi mila — chat khol rahi hoon");
                            message(appName, "", body);
                        });
                        return;
                    }
                    if (n == 1) {
                        final String number = arr.optJSONObject(0) == null ? ""
                                : arr.optJSONObject(0).optString("number", "");
                        ui.post(() -> message(appName, number, body));
                        return;
                    }
                    final String[] labels = new String[n];
                    final String[] numbers = new String[n];
                    for (int k = 0; k < n; k++) {
                        org.json.JSONObject o = arr.optJSONObject(k);
                        labels[k] = (o == null ? "" : o.optString("name", "")) + "  ·  "
                                + (o == null ? "" : o.optString("number", ""));
                        numbers[k] = o == null ? "" : o.optString("number", "");
                    }
                    ui.post(() -> new AlertDialog.Builder(MainActivity.this)
                            .setTitle("Kisko bhejun?")
                            .setItems(labels, (d, which) -> message(appName, numbers[which], body))
                            .setNegativeButton("Cancel", null)
                            .show());
                }).start();
            });
        }


        /* ---------------- wake word + 3D body ---------------- */

        @JavascriptInterface
        public String modelUrl() {
            return prefs.getString(KEY_MODEL_URL, DEFAULT_MODEL_URL);
        }

        @JavascriptInterface
        public void setModelUrl(final String url) {
            if (url == null) return;
            prefs.edit().putString(KEY_MODEL_URL, url.trim()).apply();
            if (modelFile().exists()) modelFile().delete();
            downloadModel(url.trim());
        }

        @JavascriptInterface
        public void refreshModel() {
            String url = prefs.getString(KEY_MODEL_URL, DEFAULT_MODEL_URL);
            if (modelFile().exists()) modelFile().delete();
            downloadModel(url);
        }

        @JavascriptInterface
        public String modelStatus() {
            java.io.File f = modelFile();
            return f.exists() ? ("ready/" + f.length()) : "missing";
        }

        /** Turn on background listening. Returns a short status string. */
        @JavascriptInterface
        public String startWake() {
            if (!canOverlay(MainActivity.this)) {
                ui.post(() -> {
                    try {
                        startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:" + getPackageName())));
                        toast("'Display over other apps' on karo, phir wapas aao");
                    } catch (Exception e) {
                        toast("Overlay permission nahi mili");
                    }
                });
                return "need-overlay";
            }
            try {
                Intent i = new Intent(MainActivity.this, MiraOverlayService.class);
                i.setAction(MiraOverlayService.ACTION_START);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(i);
                } else {
                    startService(i);
                }
                return "started";
            } catch (Exception e) {
                return "error: " + e.getMessage();
            }
        }

        @JavascriptInterface
        public void stopWake() {
            try {
                stopService(new Intent(MainActivity.this, MiraOverlayService.class));
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public String wakeStatus() {
            return MiraOverlayService.isRunning() ? "on" : "off";
        }

        @JavascriptInterface
        public void openSettings(final String section) {
            ui.post(() -> {
                String act;
                String s = section == null ? "main" : section.trim().toLowerCase(Locale.ROOT);
                switch (s) {
                    case "wifi": act = Settings.ACTION_WIFI_SETTINGS; break;
                    case "bluetooth": act = Settings.ACTION_BLUETOOTH_SETTINGS; break;
                    case "data": act = Settings.ACTION_DATA_ROAMING_SETTINGS; break;
                    case "display": act = Settings.ACTION_DISPLAY_SETTINGS; break;
                    case "sound": act = Settings.ACTION_SOUND_SETTINGS; break;
                    case "battery": act = "android.settings.BATTERY_SAVER_SETTINGS"; break;
                    case "location": act = Settings.ACTION_LOCATION_SOURCE_SETTINGS; break;
                    case "apps": act = Settings.ACTION_APPLICATION_SETTINGS; break;
                    case "storage": act = Settings.ACTION_INTERNAL_STORAGE_SETTINGS; break;
                    default: act = Settings.ACTION_SETTINGS; break;
                }
                try {
                    Intent i = new Intent(act);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) {
                    try {
                        startActivity(new Intent(Settings.ACTION_SETTINGS)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    } catch (Exception ignored) { }
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
    /* contacts                                                           */
    /* ------------------------------------------------------------------ */

    private boolean hasContacts() {
        return checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED;
    }

    /** Address-book entries whose display name contains what was said, as JSON. */
    private String contactJson(String needle) {
        org.json.JSONArray arr = new org.json.JSONArray();
        String q = needle == null ? "" : needle.trim();
        if (q.isEmpty() || !hasContacts()) return arr.toString();

        android.database.Cursor c = null;
        try {
            String sel = android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " LIKE ?";
            c = getContentResolver().query(
                    android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                    new String[]{
                            android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                            android.provider.ContactsContract.CommonDataKinds.Phone.NUMBER},
                    sel, new String[]{"%" + q + "%"},
                    android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC");

            while (c != null && c.moveToNext() && arr.length() < 8) {
                String name = c.getString(0);
                String num = digits(c.getString(1));
                if (num.isEmpty()) continue;
                org.json.JSONObject o = new org.json.JSONObject();
                o.put("name", name == null ? "" : name);
                o.put("number", num);
                arr.put(o);
            }
        } catch (Exception e) {
            Log.e(TAG, "contact lookup failed", e);
        } finally {
            if (c != null) { try { c.close(); } catch (Exception ignored) { } }
        }
        return arr.toString();
    }

    /** First number that matches a name, or "" — used by "call mom". */
    private String firstContactNumber(String name) {
        try {
            org.json.JSONArray arr = new org.json.JSONArray(contactJson(name));
            if (arr.length() > 0) return arr.getJSONObject(0).optString("number", "");
        } catch (Exception ignored) { }
        return "";
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
        switch (label.trim().toLowerCase(Locale.ROOT)) {
            case "yt": case "yutub": case "you tube": return "com.google.android.youtube";
            case "whatsapp": case "wa": case "wp": case "wtsapp": return "com.whatsapp";
            case "youtube": return "com.google.android.youtube";
            case "instagram": case "insta": case "ig": return "com.instagram.android";
            case "facebook": case "fb": return "com.facebook.katana";
            case "telegram": case "tg": return "org.telegram.messenger";
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
