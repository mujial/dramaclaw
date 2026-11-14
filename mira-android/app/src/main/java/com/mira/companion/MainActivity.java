package com.mira.companion;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
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

import java.util.ArrayList;
import java.util.Locale;

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
 * The Python brain (memory, agent, providers) is NOT in the APK — it runs
 * either in Termux on the phone or on a computer on the same WiFi. This shell
 * loads its UI from assets and talks to that server, whose address is kept in
 * SharedPreferences and can be changed from Settings → "MIRA server".
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
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "MiraNative");

        setContentView(web);

        initTts();
        loadUi();
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
        public int sdkInt() { return Build.VERSION.SDK_INT; }

        @JavascriptInterface
        public String server() { return serverBase; }

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
        public void speak(final String text, final float rate, final float pitch) {
            ui.post(() -> {
                if (!ttsReady) {
                    callJs("__miraSpeechEnd()");
                    return;
                }
                tts.stop();
                tts.setSpeechRate(Math.max(0.6f, Math.min(1.6f, rate)));
                tts.setPitch(Math.max(0.6f, Math.min(1.6f, pitch)));
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
}
