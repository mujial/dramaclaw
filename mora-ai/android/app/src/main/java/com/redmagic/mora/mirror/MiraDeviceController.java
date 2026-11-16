package com.redmagic.mora.mirror;

import android.Manifest;
import android.app.WallpaperManager;
import android.bluetooth.BluetoothAdapter;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.provider.AlarmClock;
import android.provider.ContactsContract;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.KeyEvent;

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MiraDeviceController {
    public static class CommandResult {
        public final boolean handled;
        public final String reply;
        public final String actionTag;

        public CommandResult(boolean handled, String reply, String actionTag) {
            this.handled = handled;
            this.reply = reply;
            this.actionTag = actionTag;
        }
    }

    private static boolean torchState = false;

    public static CommandResult executeCommand(Context ctx, String rawInput) {
        if (rawInput == null || rawInput.trim().isEmpty()) {
            return new CommandResult(false, "", "");
        }
        String text = rawInput.trim();
        String lower = text.toLowerCase(Locale.ROOT);

        // 0. Auto-scroll & Reels / Shorts commands (Hindi + Hinglish + English)
        if (lower.matches(".*\\b(stop scroll|stop scrolling|auto scroll off|auto scroll band|scroll band|ruk jao|bas karo|roko)\\b.*")) {
            if (MiraAccessibilityService.instance != null) {
                MiraAccessibilityService.instance.stopAutoScroll();
                return new CommandResult(true, "ठीक है, ऑटो स्क्रॉल रोक दिया है।", "AUTO_SCROLL_STOP");
            }
        }
        if (lower.matches(".*\\b(auto scroll|reels chalate raho|scroll karte raho|auto reels|khud scroll)\\b.*")) {
            if (MiraAccessibilityService.instance != null) {
                MiraAccessibilityService.instance.startAutoScroll(6000);
                return new CommandResult(true, "ऑटो रील्स स्क्रॉल चालू कर दिया है! रोकने के लिए बोलें 'रोको'।", "AUTO_SCROLL_START");
            }
            return new CommandResult(true, "रील्स स्क्रॉल करने के लिए कृपया सेटिंग्स में MIRA Accessibility चालू करें।", "NEED_A11Y");
        }
        if (lower.matches(".*\\b(reels scroll|reel scroll|scroll reel|scroll reels|next reel|agla reel|next short|agla video|scroll down|niche scroll|neeche scroll|niche karo|neeche karo|scroll karo|swipe up)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.scroll(true)) {
                return new CommandResult(true, "अगला रील स्क्रॉल कर दिया है!", "SCROLL_NEXT");
            }
            return new CommandResult(true, "स्क्रीन स्क्रॉल करने के लिए कृपया MIRA Accessibility सर्विस ऑन करें।", "NEED_A11Y");
        }
        if (lower.matches(".*\\b(scroll up|upar scroll|upar karo|pichla reel|previous reel|prev short|swipe down)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.scroll(false)) {
                return new CommandResult(true, "ऊपर स्क्रॉल कर दिया है!", "SCROLL_PREV");
            }
            return new CommandResult(true, "स्क्रीन स्क्रॉल करने के लिए कृपया MIRA Accessibility सर्विस ऑन करें।", "NEED_A11Y");
        }
        if (lower.matches(".*\\b(swipe left|left swipe|baye swipe)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.swipeHorizontal(false)) {
                return new CommandResult(true, "लेफ्ट स्वाइप कर दिया।", "SWIPE_LEFT");
            }
        }
        if (lower.matches(".*\\b(swipe right|right swipe|daye swipe)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.swipeHorizontal(true)) {
                return new CommandResult(true, "राइट स्वाइप कर दिया।", "SWIPE_RIGHT");
            }
        }
        if (lower.matches(".*\\b(like karo|like this|reel like|video like|hit like)\\b.*")) {
            if (MiraAccessibilityService.instance != null) {
                boolean ok = MiraAccessibilityService.instance.clickByText("Like")
                    || MiraAccessibilityService.instance.clickByText("like");
                if (!ok) ok = MiraAccessibilityService.instance.tapCoordinates(91f, 62f); // Instagram Reel heart fallback
                return new CommandResult(true, ok ? "वीडियो लाइक कर दिया है!" : "लाइक बटन नहीं मिला।", "LIKE");
            }
        }

        // 1. Accessibility / Screen Navigation & UI Automation
        if (lower.matches(".*\\b(go back|back jao|back karo|piche jao|peeche jao|press back)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.performBack()) {
                return new CommandResult(true, "पीछे जा रही हूँ।", "NAV_BACK");
            }
            return new CommandResult(true, "बैक जाने के लिए MIRA Accessibility ऑन करें।", "NEED_A11Y");
        }
        if (lower.matches(".*\\b(go home|home screen|home pe jao|home jao|press home)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.performHome()) {
                return new CommandResult(true, "होम स्क्रीन पर आ गए।", "NAV_HOME");
            }
            Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(home);
            return new CommandResult(true, "होम स्क्रीन खोल रही हूँ।", "NAV_HOME");
        }
        if (lower.matches(".*\\b(recent apps|recents|app switcher)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.performRecents()) {
                return new CommandResult(true, "रीसेंट ऐप्स दिखा रही हूँ।", "NAV_RECENTS");
            }
        }
        if (lower.matches(".*\\b(open notifications|notification panel|notifications dikhao)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.performNotifications()) {
                return new CommandResult(true, "नोटिफिकेशन पैनल खोल दिया।", "NAV_NOTIFS");
            }
        }
        if (lower.matches(".*\\b(quick settings|control center|status bar)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.performQuickSettings()) {
                return new CommandResult(true, "क्विक सेटिंग्स खोल दिया।", "NAV_QS");
            }
        }
        if (lower.matches(".*\\b(take screenshot|screenshot lo|capture screen|screenshot)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.takeScreenshot()) {
                return new CommandResult(true, "स्क्रीनशॉट ले लिया है!", "SCREENSHOT");
            }
            return new CommandResult(true, "स्क्रीनशॉट लेने के लिए MIRA Accessibility सर्विस ऑन करें।", "NEED_A11Y");
        }
        if (lower.matches(".*\\b(lock screen|lock phone|phone lock karo|screen band karo|screen lock)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.lockScreen()) {
                return new CommandResult(true, "फोन लॉक कर रही हूँ।", "LOCK_SCREEN");
            }
            return new CommandResult(true, "फोन लॉक करने के लिए MIRA Accessibility सर्विस ऑन करें।", "NEED_A11Y");
        }
        if (lower.matches(".*\\b(read screen|screen padho|what is on screen|screen par kya hai)\\b.*")) {
            if (MiraAccessibilityService.instance != null) {
                String txt = MiraAccessibilityService.instance.readVisibleScreenText();
                return new CommandResult(true, txt.isEmpty() ? "स्क्रीन पर कोई टेक्स्ट नहीं मिला।" : txt, "READ_SCREEN");
            }
        }
        Matcher clickM = Pattern.compile("(?:click|tap|press|dabao)\\s+(?:on\\s+)?(.+)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (clickM.matches() && MiraAccessibilityService.instance != null) {
            String target = clickM.group(1).trim();
            boolean ok = MiraAccessibilityService.instance.clickByText(target);
            return new CommandResult(true, ok ? target + " पर टैप कर दिया।" : "स्क्रीन पर " + target + " नहीं मिला।", "CLICK:" + target);
        }
        Matcher typeM = Pattern.compile("(?:type|write|likho)\\s+(.+)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (typeM.matches() && MiraAccessibilityService.instance != null) {
            String val = typeM.group(1).trim();
            boolean ok = MiraAccessibilityService.instance.typeIntoFocusedField(val);
            return new CommandResult(true, ok ? "टाइप कर दिया: " + val : "पहले किसी टेक्स्ट बॉक्स पर टैप करें।", "TYPE");
        }

        // 2. Flashlight / Torch
        if (lower.contains("flashlight") || lower.contains("torch") || lower.contains("light jalao") || lower.contains("light band")) {
            boolean turnOn = !(lower.contains("off") || lower.contains("band") || lower.contains("close") || lower.contains("disable"));
            try {
                CameraManager cm = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
                if (cm != null && cm.getCameraIdList().length > 0) {
                    torchState = turnOn;
                    cm.setTorchMode(cm.getCameraIdList()[0], torchState);
                    return new CommandResult(true, torchState ? "फ्लैशलाइट चालू कर दी है!" : "फ्लैशलाइट बंद कर दी है!", torchState ? "FLASHLIGHT_ON" : "FLASHLIGHT_OFF");
                }
            } catch (Exception e) {
                return new CommandResult(true, "फ्लैशलाइट चालू नहीं हो सकी।", "FLASHLIGHT_ERR");
            }
        }

        // 3. Volume Controls
        if (lower.contains("volume") || lower.contains("awaaz") || lower.contains("awaz") || lower.contains("mute") || lower.contains("unmute")) {
            AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                if (lower.contains("mute") && !lower.contains("unmute")) {
                    am.setStreamVolume(AudioManager.STREAM_MUSIC, 0, AudioManager.FLAG_SHOW_UI);
                    return new CommandResult(true, "आवाज़ म्यूट कर दी है।", "VOL_MUTE");
                }
                if (lower.contains("max") || lower.contains("full") || lower.contains("jyada")) {
                    int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                    am.setStreamVolume(AudioManager.STREAM_MUSIC, max, AudioManager.FLAG_SHOW_UI);
                    return new CommandResult(true, "वॉल्यूम फुल कर दिया है।", "VOL_MAX");
                }
                if (lower.contains("up") || lower.contains("badhao") || lower.contains("increase") || lower.contains("high") || lower.contains("tez")) {
                    am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI);
                    am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI);
                    return new CommandResult(true, "आवाज़ बढ़ा दी है।", "VOL_UP");
                }
                if (lower.contains("down") || lower.contains("kam") || lower.contains("decrease") || lower.contains("low") || lower.contains("dheere")) {
                    am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI);
                    am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI);
                    return new CommandResult(true, "आवाज़ कम कर दी है।", "VOL_DOWN");
                }
            }
        }

        // 4. Media Playback Controls
        if (lower.matches(".*\\b(pause music|pause song|stop music|gaana roko|pause video|video roko)\\b.*")) {
            dispatchMediaKey(ctx, KeyEvent.KEYCODE_MEDIA_PAUSE);
            return new CommandResult(true, "मीडिया पॉज़ कर दिया।", "MEDIA_PAUSE");
        }
        if (lower.matches(".*\\b(resume music|play music|continue music|gaana chalao)\\b.*")) {
            dispatchMediaKey(ctx, KeyEvent.KEYCODE_MEDIA_PLAY);
            return new CommandResult(true, "प्लेबैक शुरू कर रही हूँ।", "MEDIA_PLAY");
        }
        if (lower.matches(".*\\b(next song|next track|agla gaana|skip song)\\b.*")) {
            dispatchMediaKey(ctx, KeyEvent.KEYCODE_MEDIA_NEXT);
            return new CommandResult(true, "अगला गाना चला दिया।", "MEDIA_NEXT");
        }
        if (lower.matches(".*\\b(previous song|prev track|pichla gaana)\\b.*")) {
            dispatchMediaKey(ctx, KeyEvent.KEYCODE_MEDIA_PREVIOUS);
            return new CommandResult(true, "पिछला गाना चला दिया।", "MEDIA_PREV");
        }

        // 5. Brightness Controls
        if (lower.contains("brightness") || lower.contains("roshni")) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Settings.System.canWrite(ctx)) {
                    int val = lower.contains("full") || lower.contains("max") ? 255
                        : lower.contains("low") || lower.contains("min") || lower.contains("kam") ? 35
                        : lower.contains("up") || lower.contains("badhao") ? 200 : 128;
                    Settings.System.putInt(ctx.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
                    Settings.System.putInt(ctx.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, val);
                    return new CommandResult(true, "स्क्रीन ब्राइटनेस सेट कर दी है!", "BRIGHTNESS");
                }
            } catch (Exception ignored) {}
            Intent disp = new Intent(Settings.ACTION_DISPLAY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(disp);
            return new CommandResult(true, "डिस्प्ले ब्राइटनेस सेटिंग्स खोल रही हूँ।", "BRIGHTNESS_SETTINGS");
        }

        // 6. Connectivity / System Settings
        if (lower.contains("wifi") || lower.contains("wi-fi")) {
            Intent i = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? new Intent(Settings.Panel.ACTION_WIFI)
                : new Intent(Settings.ACTION_WIFI_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return new CommandResult(true, "वाई-फाई पैनल खोल रही हूँ।", "WIFI");
        }
        if (lower.contains("bluetooth")) {
            try {
                BluetoothAdapter ba = BluetoothAdapter.getDefaultAdapter();
                if (ba != null && (Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
                    ContextCompat.checkSelfPermission(ctx, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED)) {
                    if (lower.contains("off") || lower.contains("band")) {
                        ba.disable();
                        return new CommandResult(true, "ब्लूटूथ बंद कर दिया।", "BT_OFF");
                    } else if (lower.contains("on") || lower.contains("chalu")) {
                        ba.enable();
                        return new CommandResult(true, "ब्लूटूथ चालू कर दिया।", "BT_ON");
                    }
                }
            } catch (Exception ignored) {}
            Intent i = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return new CommandResult(true, "ब्लूटूथ सेटिंग्स खोल रही हूँ।", "BT_SETTINGS");
        }
        if (lower.contains("mobile data") || lower.contains("internet settings") || lower.contains("data on") || lower.contains("data off")) {
            Intent i = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? new Intent(Settings.Panel.ACTION_INTERNET_CONNECTIVITY)
                : new Intent(Settings.ACTION_DATA_ROAMING_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return new CommandResult(true, "इंटरनेट और मोबाइल डेटा पैनल खोल रही हूँ।", "DATA_PANEL");
        }
        if (lower.contains("airplane") || lower.contains("flight mode")) {
            ctx.startActivity(new Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return new CommandResult(true, "एयरप्लेन मोड सेटिंग्स खोल रही हूँ।", "AIRPLANE");
        }
        if (lower.contains("hotspot")) {
            ctx.startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return new CommandResult(true, "हॉटस्पॉट सेटिंग्स खोल रही हूँ।", "HOTSPOT");
        }
        if (lower.contains("location") || lower.contains("gps")) {
            ctx.startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return new CommandResult(true, "लोकेशन सेटिंग्स खोल रही हूँ।", "LOCATION");
        }

        // 7. Phone Call & Contacts
        Matcher callPattern = Pattern.compile("(?:call|dial|phone\\s+lagao|call\\s+karo)\\s+(.+)", Pattern.CASE_INSENSITIVE).matcher(text);
        Matcher hindiCall = Pattern.compile("(.+?)\\s+ko\\s+(?:call|phone)\\s+(?:karo|lagao|laga)", Pattern.CASE_INSENSITIVE).matcher(text);
        String callTarget = callPattern.matches() ? callPattern.group(1).trim()
            : hindiCall.matches() ? hindiCall.group(1).trim() : null;
        if (callTarget != null && !callTarget.isEmpty()) {
            return handlePhoneCall(ctx, callTarget);
        }

        // 8. WhatsApp / SMS Messaging
        Matcher waMsg = Pattern.compile("(?:send\\s+whatsapp|whatsapp)\\s+(?:to\\s+)?([^:]+?)(?:\\s+(?:saying|message|msg|ki)\\s+(.+))?", Pattern.CASE_INSENSITIVE).matcher(text);
        if (waMsg.matches()) {
            String target = waMsg.group(1).trim();
            String msgBody = waMsg.group(2) != null ? waMsg.group(2).trim() : "";
            String number = resolvePhoneNumber(ctx, target);
            if (number != null) {
                String clean = number.replaceAll("[^0-9+]", "");
                String url = "https://wa.me/" + clean.replace("+", "") + (msgBody.isEmpty() ? "" : "?text=" + urlEncode(msgBody));
                openUrlDirect(ctx, url);
                return new CommandResult(true, target + " के लिए व्हाट्सएप चैट खोल रही हूँ।", "WHATSAPP_MSG");
            }
            openAppByName(ctx, "whatsapp");
            return new CommandResult(true, "व्हाट्सएप खोल रही हूँ।", "WHATSAPP");
        }
        Matcher smsMsg = Pattern.compile("(?:send\\s+sms|send\\s+message|sms)\\s+(?:to\\s+)?([^:]+?)(?:\\s+(?:saying|message|that)\\s+(.+))?", Pattern.CASE_INSENSITIVE).matcher(text);
        if (smsMsg.matches()) {
            String target = smsMsg.group(1).trim();
            String body = smsMsg.group(2) != null ? smsMsg.group(2).trim() : "";
            String number = resolvePhoneNumber(ctx, target);
            Intent sms = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + (number != null ? number : "")));
            if (!body.isEmpty()) sms.putExtra("sms_body", body);
            sms.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(sms);
            return new CommandResult(true, target + " के लिए मैसेज ऐप खोल रही हूँ।", "SMS");
        }

        // 9. Camera / Photo / Video
        if (lower.matches(".*\\b(take photo|take a photo|click photo|selfie|photo khicho|photo lo)\\b.*")) {
            ctx.startActivity(new Intent(MediaStore.ACTION_IMAGE_CAPTURE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return new CommandResult(true, "फोटो के लिए कैमरा खोल रही हूँ!", "CAMERA_PHOTO");
        }
        if (lower.matches(".*\\b(record video|video banao|shoot video)\\b.*")) {
            ctx.startActivity(new Intent(MediaStore.ACTION_VIDEO_CAPTURE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return new CommandResult(true, "वीडियो रिकॉर्डिंग के लिए कैमरा खोल रही हूँ!", "CAMERA_VIDEO");
        }

        // 10. Alarm & Timer
        if (lower.contains("alarm")) {
            Matcher tm = Pattern.compile("(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?", Pattern.CASE_INSENSITIVE).matcher(lower);
            if (tm.find()) {
                int h = Integer.parseInt(tm.group(1));
                int m = tm.group(2) != null ? Integer.parseInt(tm.group(2)) : 0;
                String mer = tm.group(3);
                if ("pm".equalsIgnoreCase(mer) && h < 12) h += 12;
                if ("am".equalsIgnoreCase(mer) && h == 12) h = 0;
                if (h <= 23 && m <= 59) {
                    Intent i = new Intent(AlarmClock.ACTION_SET_ALARM)
                        .putExtra(AlarmClock.EXTRA_HOUR, h)
                        .putExtra(AlarmClock.EXTRA_MINUTES, m)
                        .putExtra(AlarmClock.EXTRA_MESSAGE, "MIRA Wake-Up Call")
                        .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(i);
                    return new CommandResult(true, String.format(Locale.US, "%02d:%02d का अलार्म सेट कर दिया!", h, m), "SET_ALARM");
                }
            }
        }
        Matcher timerM = Pattern.compile("(?:set\\s+)?timer(?:\\s+for)?\\s+(\\d+)\\s*(s|sec|seconds?|m|min|minutes?)", Pattern.CASE_INSENSITIVE).matcher(lower);
        if (timerM.find()) {
            int n = Integer.parseInt(timerM.group(1));
            int secs = timerM.group(2).toLowerCase(Locale.ROOT).startsWith("m") ? n * 60 : n;
            Intent i = new Intent(AlarmClock.ACTION_SET_TIMER)
                .putExtra(AlarmClock.EXTRA_LENGTH, secs)
                .putExtra(AlarmClock.EXTRA_MESSAGE, "MIRA Timer")
                .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return new CommandResult(true, secs + " सेकंड का टाइमर लगा दिया है!", "SET_TIMER");
        }

        // 11. Wallpaper
        if (lower.contains("wallpaper") && (lower.contains("live") || lower.contains("animated"))) {
            Intent i = new Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER);
            i.putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, new ComponentName(ctx, MiraLiveWallpaperService.class));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return new CommandResult(true, "मीरा लाइव वॉलपेपर पिकर खोल रही हूँ!", "LIVE_WALLPAPER");
        }

        // 12. YouTube / Spotify / Google Search / Weather
        Matcher ytM = Pattern.compile("(?:play|search|chalao)\\s+(.+?)\\s+(?:on\\s+youtube|youtube\\s+pe)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (ytM.matches()) {
            String q = ytM.group(1).trim();
            openUrlDirect(ctx, "https://www.youtube.com/results?search_query=" + urlEncode(q));
            return new CommandResult(true, "यूट्यूब पर " + q + " चला रही हूँ।", "YT_SEARCH");
        }
        Matcher spotM = Pattern.compile("(?:play)\\s+(.+?)\\s+(?:on\\s+spotify)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (spotM.matches()) {
            String q = spotM.group(1).trim();
            openUrlDirect(ctx, "https://open.spotify.com/search/" + urlEncode(q));
            return new CommandResult(true, "स्पॉटिफाई पर " + q + " खोल रही हूँ।", "SPOTIFY");
        }
        Matcher gSearch = Pattern.compile("(?:search|google)\\s+(?:for\\s+)?(.+)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (gSearch.matches()) {
            String q = gSearch.group(1).trim();
            openUrlDirect(ctx, "https://www.google.com/search?q=" + urlEncode(q));
            return new CommandResult(true, "गूगल पर " + q + " सर्च कर रही हूँ।", "WEB_SEARCH");
        }
        if (lower.contains("weather") || lower.contains("mausam")) {
            openUrlDirect(ctx, "https://www.google.com/search?q=weather+today");
            return new CommandResult(true, "आज का मौसम दिखा रही हूँ।", "WEATHER");
        }

        // 13. Open ANY Installed App (English + Hinglish "kholo" / "open")
        Matcher openEn = Pattern.compile("(?:please\\s+)?(?:open|launch|start)\\s+(.+)", Pattern.CASE_INSENSITIVE).matcher(text);
        Matcher openHi = Pattern.compile("(.+?)\\s+(?:kholo|khol\\s+do|open\\s+karo|chalao)", Pattern.CASE_INSENSITIVE).matcher(text);
        String appQuery = openEn.matches() ? openEn.group(1).trim()
            : openHi.matches() ? openHi.group(1).trim() : null;
        if (appQuery != null && !appQuery.isEmpty()) {
            String launched = openAppByName(ctx, appQuery);
            if (launched != null) {
                return new CommandResult(true, appQuery + " खोल रही हूँ।", "OPEN_APP:" + launched);
            }
        }

        // 14. Time / Date / Battery
        if (lower.matches(".*\\b(what time|current time|time kya|kitne baje|samay)\\b.*")) {
            String t = new SimpleDateFormat("hh:mm a", Locale.getDefault()).format(new Date());
            return new CommandResult(true, "अभी " + t + " बजे हैं।", "TIME");
        }
        if (lower.matches(".*\\b(today's date|what date|aaj ki tarikh|tarikh|what day)\\b.*")) {
            String d = new SimpleDateFormat("EEEE, dd MMMM yyyy", Locale.getDefault()).format(new Date());
            return new CommandResult(true, "आज " + d + " है।", "DATE");
        }
        if (lower.matches(".*\\b(battery|kitna charge|charge kitna)\\b.*")) {
            BatteryManager bm = (BatteryManager) ctx.getSystemService(Context.BATTERY_SERVICE);
            int pct = bm != null ? bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) : 85;
            boolean chg = bm != null && bm.isCharging();
            return new CommandResult(true, "बैटरी " + pct + " प्रतिशत है" + (chg ? " और चार्ज हो रही है।" : "।"), "BATTERY");
        }

        return new CommandResult(false, "", "");
    }

    /**
     * Executes ANY structured action produced by the Universal AI Agent!
     */
    public static void executeSingleAction(Context ctx, String type, String arg) {
        if (type == null) return;
        String t = type.trim().toUpperCase(Locale.ROOT);
        String a = arg != null ? arg.trim() : "";

        switch (t) {
            case "OPEN_APP":
                openAppByName(ctx, a);
                break;
            case "OPEN_URL":
                if (!a.isEmpty()) openUrlDirect(ctx, a.startsWith("http") ? a : "https://" + a);
                break;
            case "SEARCH_YOUTUBE":
                openUrlDirect(ctx, "https://www.youtube.com/results?search_query=" + urlEncode(a));
                break;
            case "SEARCH_GOOGLE":
                openUrlDirect(ctx, "https://www.google.com/search?q=" + urlEncode(a));
                break;
            case "CALL":
                handlePhoneCall(ctx, a);
                break;
            case "WHATSAPP": {
                String[] parts = a.split("\\|", 2);
                String person = parts[0].trim();
                String body = parts.length > 1 ? parts[1].trim() : "";
                String num = resolvePhoneNumber(ctx, person);
                if (num != null) {
                    openUrlDirect(ctx, "https://wa.me/" + num.replaceAll("[^0-9]", "") + (body.isEmpty() ? "" : "?text=" + urlEncode(body)));
                } else {
                    openAppByName(ctx, "whatsapp");
                }
                break;
            }
            case "SCROLL_DOWN":
                if (MiraAccessibilityService.instance != null) MiraAccessibilityService.instance.scroll(true);
                break;
            case "SCROLL_UP":
                if (MiraAccessibilityService.instance != null) MiraAccessibilityService.instance.scroll(false);
                break;
            case "SWIPE_LEFT":
                if (MiraAccessibilityService.instance != null) MiraAccessibilityService.instance.swipeHorizontal(false);
                break;
            case "SWIPE_RIGHT":
                if (MiraAccessibilityService.instance != null) MiraAccessibilityService.instance.swipeHorizontal(true);
                break;
            case "AUTO_SCROLL_START":
                if (MiraAccessibilityService.instance != null) MiraAccessibilityService.instance.startAutoScroll(6000);
                break;
            case "AUTO_SCROLL_STOP":
                if (MiraAccessibilityService.instance != null) MiraAccessibilityService.instance.stopAutoScroll();
                break;
            case "CLICK_TEXT":
                if (MiraAccessibilityService.instance != null) MiraAccessibilityService.instance.clickByText(a);
                break;
            case "TYPE_TEXT":
                if (MiraAccessibilityService.instance != null) MiraAccessibilityService.instance.typeIntoFocusedField(a);
                break;
            case "PRESS_BACK":
                if (MiraAccessibilityService.instance != null) MiraAccessibilityService.instance.performBack();
                break;
            case "PRESS_HOME":
                if (MiraAccessibilityService.instance != null) MiraAccessibilityService.instance.performHome();
                break;
            case "PRESS_RECENTS":
                if (MiraAccessibilityService.instance != null) MiraAccessibilityService.instance.performRecents();
                break;
            case "NOTIFICATIONS":
                if (MiraAccessibilityService.instance != null) MiraAccessibilityService.instance.performNotifications();
                break;
            case "QUICK_SETTINGS":
                if (MiraAccessibilityService.instance != null) MiraAccessibilityService.instance.performQuickSettings();
                break;
            case "SCREENSHOT":
                if (MiraAccessibilityService.instance != null) MiraAccessibilityService.instance.takeScreenshot();
                break;
            case "LOCK_SCREEN":
                if (MiraAccessibilityService.instance != null) MiraAccessibilityService.instance.lockScreen();
                break;
            case "FLASHLIGHT_ON":
                executeCommand(ctx, "flashlight on");
                break;
            case "FLASHLIGHT_OFF":
                executeCommand(ctx, "flashlight off");
                break;
            case "VOLUME_UP":
                executeCommand(ctx, "volume up");
                break;
            case "VOLUME_DOWN":
                executeCommand(ctx, "volume down");
                break;
            case "VOLUME_MUTE":
                executeCommand(ctx, "mute");
                break;
            case "MEDIA_PLAY":
                dispatchMediaKey(ctx, KeyEvent.KEYCODE_MEDIA_PLAY);
                break;
            case "MEDIA_PAUSE":
                dispatchMediaKey(ctx, KeyEvent.KEYCODE_MEDIA_PAUSE);
                break;
            case "MEDIA_NEXT":
                dispatchMediaKey(ctx, KeyEvent.KEYCODE_MEDIA_NEXT);
                break;
            case "MEDIA_PREV":
                dispatchMediaKey(ctx, KeyEvent.KEYCODE_MEDIA_PREVIOUS);
                break;
            case "BRIGHTNESS_HIGH":
                executeCommand(ctx, "brightness full");
                break;
            case "BRIGHTNESS_LOW":
                executeCommand(ctx, "brightness low");
                break;
            case "WIFI_PANEL":
                executeCommand(ctx, "wifi");
                break;
            case "BLUETOOTH_PANEL":
                executeCommand(ctx, "bluetooth");
                break;
            case "CAMERA_PHOTO":
                executeCommand(ctx, "take photo");
                break;
            default:
                executeCommand(ctx, a.isEmpty() ? t : a);
                break;
        }
    }

    /**
     * Universal AI Agent: understands ANY random unlisted command (Hindi/Hinglish/English),
     * reads current screen UI elements, builds a multi-step JSON action plan, executes it,
     * and returns a sweet Hindi reply! 100% FREE (Pollinations AI) + optional Gemini!
     */
    public static CommandResult runUniversalAiAgent(Context ctx, String userPrompt) {
        SharedPreferences prefs = ctx.getSharedPreferences(MiraLiveWallpaperService.PREFS_NAME, Context.MODE_PRIVATE);
        String geminiKey = prefs.getString("gemini_api_key", "");
        String geminiModel = prefs.getString("gemini_model", "gemini-2.5-flash");
        String commander = prefs.getString(MiraLiveWallpaperService.KEY_COMMANDER, "Dost");

        String screenCtx = (MiraAccessibilityService.instance != null)
            ? MiraAccessibilityService.instance.dumpScreenSummary()
            : "Screen access unavailable";

        String sysPrompt = "You are MIRA, " + commander + "'s friendly female Indian AI phone assistant.\n"
            + "Current phone screen state: " + screenCtx + "\n"
            + "Understand ANY user request (Hindi, Hinglish, or English) and respond in natural conversational Hindi (Devanagari script, 1-2 short warm sentences).\n"
            + "ALWAYS return ONLY valid JSON in this exact format:\n"
            + "{\"reply\":\"<Hindi response>\",\"actions\":[{\"type\":\"<ACTION_TYPE>\",\"arg\":\"<argument>\"}]}\n"
            + "Available ACTION_TYPE values: OPEN_APP, OPEN_URL, SEARCH_YOUTUBE, SEARCH_GOOGLE, CALL, WHATSAPP (arg 'name|msg'), "
            + "SCROLL_DOWN, SCROLL_UP, SWIPE_LEFT, SWIPE_RIGHT, AUTO_SCROLL_START, AUTO_SCROLL_STOP, CLICK_TEXT, TYPE_TEXT, "
            + "PRESS_BACK, PRESS_HOME, PRESS_RECENTS, NOTIFICATIONS, QUICK_SETTINGS, SCREENSHOT, LOCK_SCREEN, "
            + "FLASHLIGHT_ON, FLASHLIGHT_OFF, VOLUME_UP, VOLUME_DOWN, VOLUME_MUTE, MEDIA_PLAY, MEDIA_PAUSE, MEDIA_NEXT, MEDIA_PREV, "
            + "BRIGHTNESS_HIGH, BRIGHTNESS_LOW, WIFI_PANEL, BLUETOOTH_PANEL, CAMERA_PHOTO.\n"
            + "If the user is only chatting/asking a question, set \"actions\": []. If they want ANY phone action (even multi-step like 'Instagram kholo aur reels scroll karo'), include all steps in \"actions\"!";

        String rawJson = null;

        // 1. Try user's Gemini key if configured
        if (geminiKey != null && geminiKey.trim().length() > 10) {
            rawJson = callGeminiJson(geminiKey.trim(), geminiModel, sysPrompt, userPrompt);
        }

        // 2. Try 100% Free Pollinations OpenAI POST endpoint
        if (rawJson == null || rawJson.isEmpty()) {
            rawJson = callPollinationsPost(sysPrompt, userPrompt);
        }

        // 3. Try 100% Free Pollinations GET fallback
        if (rawJson == null || rawJson.isEmpty()) {
            rawJson = callPollinationsGet(sysPrompt, userPrompt);
        }

        if (rawJson != null && !rawJson.isEmpty()) {
            try {
                int s = rawJson.indexOf('{');
                int e = rawJson.lastIndexOf('}');
                if (s >= 0 && e > s) {
                    JSONObject obj = new JSONObject(rawJson.substring(s, e + 1));
                    String reply = obj.optString("reply", "हो गया!");
                    JSONArray acts = obj.optJSONArray("actions");
                    StringBuilder tag = new StringBuilder();
                    if (acts != null) {
                        for (int i = 0; i < acts.length(); i++) {
                            JSONObject a = acts.getJSONObject(i);
                            String type = a.optString("type", "");
                            String arg = a.optString("arg", "");
                            if (!type.isEmpty()) {
                                executeSingleAction(ctx, type, arg);
                                if (tag.length() > 0) tag.append("+");
                                tag.append(type);
                                if (i < acts.length() - 1) Thread.sleep(450);
                            }
                        }
                    }
                    return new CommandResult(true, reply, tag.length() > 0 ? tag.toString() : "MIRA_AI");
                } else {
                    return new CommandResult(true, rawJson.replace("*", "").trim(), "MIRA_AI");
                }
            } catch (Exception ignored) {
                return new CommandResult(true, rawJson.replace("*", "").trim(), "MIRA_AI");
            }
        }

        return new CommandResult(true, "माफ़ कीजिये, अभी इंटरनेट धीमा है। पर आप कॉल, ऐप खोलना, स्क्रॉल, वॉल्यूम, टॉर्च और स्क्रीनशॉट जैसे कमांड ऑफलाइन भी बोल सकते हैं!", "OFFLINE");
    }

    private static String callGeminiJson(String apiKey, String model, String sys, String user) {
        try {
            URL url = new URL("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(7000);
            conn.setReadTimeout(12000);
            conn.setDoOutput(true);
            JSONObject body = new JSONObject();
            body.put("systemInstruction", new JSONObject().put("parts", new JSONArray().put(new JSONObject().put("text", sys))));
            body.put("contents", new JSONArray().put(new JSONObject().put("role", "user").put("parts", new JSONArray().put(new JSONObject().put("text", user)))));
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes("UTF-8"));
            }
            if (conn.getResponseCode() == 200) {
                BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                JSONObject res = new JSONObject(sb.toString());
                return res.getJSONArray("candidates").getJSONObject(0).getJSONObject("content").getJSONArray("parts").getJSONObject(0).getString("text");
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static String callPollinationsPost(String sys, String user) {
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL("https://text.pollinations.ai/openai").openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(12000);
            conn.setDoOutput(true);
            JSONObject body = new JSONObject();
            body.put("model", "openai");
            JSONArray msgs = new JSONArray();
            msgs.put(new JSONObject().put("role", "system").put("content", sys));
            msgs.put(new JSONObject().put("role", "user").put("content", user));
            body.put("messages", msgs);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes("UTF-8"));
            }
            if (conn.getResponseCode() == 200) {
                BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                JSONObject res = new JSONObject(sb.toString());
                return res.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content");
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static String callPollinationsGet(String sys, String user) {
        try {
            String apiUrl = "https://text.pollinations.ai/" + urlEncode(user) + "?model=openai&system=" + urlEncode(sys);
            HttpURLConnection conn = (HttpURLConnection) new URL(apiUrl).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(12000);
            if (conn.getResponseCode() == 200) {
                BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line).append(' ');
                return sb.toString().trim();
            }
        } catch (Exception ignored) {}
        return null;
    }

    public static String openAppByName(Context ctx, String rawName) {
        String target = rawName.toLowerCase(Locale.ROOT).trim();
        if ("settings".equals(target) || "setting".equals(target)) {
            ctx.startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return "settings";
        }
        Map<String, String> aliases = new HashMap<>();
        aliases.put("youtube", "com.google.android.youtube");
        aliases.put("whatsapp", "com.whatsapp");
        aliases.put("instagram", "com.instagram.android");
        aliases.put("insta", "com.instagram.android");
        aliases.put("reels", "com.instagram.android");
        aliases.put("telegram", "org.telegram.messenger");
        aliases.put("spotify", "com.spotify.music");
        aliases.put("chrome", "com.android.chrome");
        aliases.put("maps", "com.google.android.apps.maps");
        aliases.put("gmail", "com.google.android.gm");
        aliases.put("play store", "com.android.vending");
        aliases.put("calculator", "com.google.android.calculator");
        aliases.put("calendar", "com.google.android.calendar");
        aliases.put("clock", "com.google.android.deskclock");
        aliases.put("camera", "com.android.camera");
        aliases.put("pubg", "com.tencent.ig");
        aliases.put("bgmi", "com.pubg.imobile");
        aliases.put("free fire", "com.dts.freefireth");
        aliases.put("mlbb", "com.mobile.legends");
        aliases.put("genshin", "com.miHoYo.GenshinImpact");
        aliases.put("paytm", "net.one97.paytm");
        aliases.put("phonepe", "com.phonepe.app");
        aliases.put("gpay", "com.google.android.apps.nbu.paisa.user");
        aliases.put("google pay", "com.google.android.apps.nbu.paisa.user");
        aliases.put("facebook", "com.facebook.katana");

        PackageManager pm = ctx.getPackageManager();
        for (Map.Entry<String, String> e : aliases.entrySet()) {
            if (target.contains(e.getKey())) {
                Intent launch = pm.getLaunchIntentForPackage(e.getValue());
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(launch);
                    return e.getValue();
                }
            }
        }

        List<ApplicationInfo> apps = pm.getInstalledApplications(PackageManager.GET_META_DATA);
        for (ApplicationInfo app : apps) {
            CharSequence label = pm.getApplicationLabel(app);
            if (label != null && label.toString().toLowerCase(Locale.ROOT).contains(target)) {
                Intent launch = pm.getLaunchIntentForPackage(app.packageName);
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(launch);
                    return app.packageName;
                }
            }
        }
        return null;
    }

    private static CommandResult handlePhoneCall(Context ctx, String target) {
        String digits = target.replaceAll("[^0-9+]", "");
        String number = digits.length() >= 7 ? digits : resolvePhoneNumber(ctx, target);
        if (number == null || number.isEmpty()) {
            ctx.startActivity(new Intent(Intent.ACTION_DIAL).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return new CommandResult(true, target + " का नंबर कॉन्टैक्ट्स में नहीं मिला, डायलर खोल रही हूँ।", "DIAL");
        }
        boolean hasCallPerm = ContextCompat.checkSelfPermission(ctx, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED;
        Intent callIntent = new Intent(hasCallPerm ? Intent.ACTION_CALL : Intent.ACTION_DIAL, Uri.parse("tel:" + number));
        callIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(callIntent);
        return new CommandResult(true, target + " को कॉल कर रही हूँ।", "CALL:" + target);
    }

    public static String resolvePhoneNumber(Context ctx, String query) {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            return null;
        }
        ContentResolver cr = ctx.getContentResolver();
        try (Cursor c = cr.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            new String[]{ContactsContract.CommonDataKinds.Phone.NUMBER},
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " LIKE ?",
            new String[]{"%" + query + "%"},
            null
        )) {
            if (c != null && c.moveToFirst()) {
                return c.getString(0);
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static void dispatchMediaKey(Context ctx, int keyCode) {
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, keyCode));
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, keyCode));
    }

    public static void openUrlDirect(Context ctx, String url) {
        ctx.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    private static String urlEncode(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }
}
