package com.redmagic.mora.mirror;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Bilingual Hindi + English Female Voice Engine for MIRA.
 * - When a Gemini API Key is saved: uses Google Gemini 2.5 Flash TTS Female Voice (Aoede / Kore / Leda / Zephyr)
 *   which speaks fluent, studio-quality Hindi and English!
 * - Always has an instant 100% FREE Offline hi-IN Female Android TextToSpeech fallback.
 */
public class MiraVoiceEngine {
    private final Context ctx;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private final ExecutorService pool = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private AudioTrack currentTrack;

    public interface VoiceCallback {
        void onStart();
        void onDone();
    }

    public MiraVoiceEngine(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        initTts();
    }

    private void initTts() {
        tts = new TextToSpeech(ctx, status -> {
            if (status == TextToSpeech.SUCCESS) {
                ttsReady = true;
                selectBestHindiFemaleVoice();
            }
        });
    }

    private void selectBestHindiFemaleVoice() {
        if (!ttsReady || tts == null) return;
        Locale hiIn = new Locale("hi", "IN");
        tts.setLanguage(hiIn);
        tts.setPitch(1.08f);
        tts.setSpeechRate(1.02f);

        try {
            Set<Voice> voices = tts.getVoices();
            if (voices != null) {
                Voice best = null;
                for (Voice v : voices) {
                    String name = v.getName().toLowerCase(Locale.ROOT);
                    Locale loc = v.getLocale();
                    if (loc != null && "hi".equalsIgnoreCase(loc.getLanguage())) {
                        // Google TTS female Hindi voices: hi-in-x-hia, hi-in-x-hie, hi-in-x-hic, female
                        if (name.contains("hia") || name.contains("hie") || name.contains("female") || name.contains("swara")) {
                            best = v;
                            if (!v.isNetworkConnectionRequired()) break; // prefer instant offline female voice
                        } else if (best == null) {
                            best = v;
                        }
                    }
                }
                if (best != null) {
                    tts.setVoice(best);
                }
            }
        } catch (Exception ignored) {}
    }

    public void speak(String rawText, Runnable onDone) {
        speak(rawText, new VoiceCallback() {
            @Override public void onStart() {}
            @Override public void onDone() {
                if (onDone != null) onDone.run();
            }
        });
    }

    public void speak(String rawText, VoiceCallback cb) {
        if (rawText == null || rawText.trim().isEmpty()) return;
        String clean = rawText
            .replaceAll("\\[\\[ACTION:[^\\]]*\\]\\]", "")
            .replaceAll("[*~`#]", "")
            .replaceAll("\\s+", " ")
            .trim();
        if (clean.isEmpty()) return;

        SharedPreferences prefs = ctx.getSharedPreferences(MiraLiveWallpaperService.PREFS_NAME, Context.MODE_PRIVATE);
        String geminiKey = prefs.getString("gemini_api_key", "");
        String voiceName = prefs.getString("gemini_voice", "Aoede"); // Aoede / Kore / Leda / Zephyr = Female

        if (geminiKey != null && geminiKey.trim().length() > 10) {
            pool.execute(() -> {
                boolean ok = tryGeminiFemaleTts(clean, geminiKey.trim(), voiceName, cb);
                if (!ok) {
                    mainHandler.post(() -> speakNativeHindiFemale(clean, cb));
                }
            });
        } else {
            speakNativeHindiFemale(clean, cb);
        }
    }

    private void speakNativeHindiFemale(String text, VoiceCallback cb) {
        if (!ttsReady || tts == null) {
            if (cb != null) cb.onDone();
            return;
        }
        selectBestHindiFemaleVoice();
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String utteranceId) {
                if (cb != null) mainHandler.post(cb::onStart);
            }
            @Override public void onDone(String utteranceId) {
                if (cb != null) mainHandler.post(cb::onDone);
            }
            @Override public void onError(String utteranceId) {
                if (cb != null) mainHandler.post(cb::onDone);
            }
        });
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "mira_" + System.currentTimeMillis());
    }

    private boolean tryGeminiFemaleTts(String text, String apiKey, String voiceName, VoiceCallback cb) {
        try {
            URL url = new URL("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=" + apiKey);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(12000);
            conn.setDoOutput(true);

            JSONObject body = new JSONObject();
            JSONArray contents = new JSONArray();
            JSONObject userMsg = new JSONObject();
            userMsg.put("role", "user");
            JSONArray parts = new JSONArray();
            parts.put(new JSONObject().put("text", "Speak warmly and naturally as MIRA in Hindi/English: " + text));
            userMsg.put("parts", parts);
            contents.put(userMsg);
            body.put("contents", contents);

            JSONObject prebuilt = new JSONObject().put("voiceName", voiceName != null && !voiceName.isEmpty() ? voiceName : "Aoede");
            JSONObject voiceCfg = new JSONObject().put("prebuiltVoiceConfig", prebuilt);
            JSONObject speechCfg = new JSONObject().put("voiceConfig", voiceCfg);
            JSONObject genCfg = new JSONObject()
                .put("responseModalities", new JSONArray().put("AUDIO"))
                .put("speechConfig", speechCfg);
            body.put("generationConfig", genCfg);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes("UTF-8"));
            }

            if (conn.getResponseCode() != 200) return false;
            BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);

            JSONObject res = new JSONObject(sb.toString());
            JSONObject inlineData = res.getJSONArray("candidates").getJSONObject(0)
                .getJSONObject("content").getJSONArray("parts").getJSONObject(0)
                .getJSONObject("inlineData");
            String b64 = inlineData.getString("data");
            byte[] pcm = Base64.decode(b64, Base64.DEFAULT);
            if (pcm == null || pcm.length == 0) return false;

            playPcm24k(pcm, cb);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void playPcm24k(byte[] pcm, VoiceCallback cb) {
        stopAudioTrack();
        int sampleRate = 24000;
        int minBuf = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
        int bufSize = Math.max(minBuf, pcm.length);

        AudioTrack track = new AudioTrack.Builder()
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build())
            .setAudioFormat(new AudioFormat.Builder()
                .setSampleRate(sampleRate)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build())
            .setBufferSizeInBytes(bufSize)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build();

        currentTrack = track;
        track.write(pcm, 0, pcm.length);
        if (cb != null) mainHandler.post(cb::onStart);
        track.play();

        long durationMs = Math.max(400L, (pcm.length * 1000L) / (sampleRate * 2L));
        mainHandler.postDelayed(() -> {
            if (currentTrack == track) {
                stopAudioTrack();
                if (cb != null) cb.onDone();
            }
        }, durationMs + 150L);
    }

    private void stopAudioTrack() {
        if (currentTrack != null) {
            try {
                currentTrack.stop();
                currentTrack.release();
            } catch (Exception ignored) {}
            currentTrack = null;
        }
    }

    public void stop() {
        stopAudioTrack();
        if (tts != null) {
            try {
                tts.stop();
            } catch (Exception ignored) {}
        }
    }

    public void shutdown() {
        stop();
        if (tts != null) {
            try {
                tts.shutdown();
            } catch (Exception ignored) {}
        }
        pool.shutdownNow();
    }
}
