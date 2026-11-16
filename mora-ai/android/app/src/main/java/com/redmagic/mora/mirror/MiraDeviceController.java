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

        // 1. Accessibility / Screen Navigation & UI Automation
        if (lower.matches(".*\\b(go back|back jao|piche jao|press back)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.performBack()) {
                return new CommandResult(true, "Going back.", "NAV_BACK");
            }
            return new CommandResult(true, "Please enable MIRA Accessibility Service in Settings for Back navigation.", "NEED_A11Y");
        }
        if (lower.matches(".*\\b(go home|home screen|home pe jao|press home)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.performHome()) {
                return new CommandResult(true, "Returning to Home screen.", "NAV_HOME");
            }
            Intent home = new Intent(Intent.ACTION_MAIN);
            home.addCategory(Intent.CATEGORY_HOME);
            home.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(home);
            return new CommandResult(true, "Going to Home screen.", "NAV_HOME");
        }
        if (lower.matches(".*\\b(recent apps|recents|app switcher)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.performRecents()) {
                return new CommandResult(true, "Opening recent apps.", "NAV_RECENTS");
            }
        }
        if (lower.matches(".*\\b(open notifications|notification panel|notifications dikhao)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.performNotifications()) {
                return new CommandResult(true, "Pulling down notifications.", "NAV_NOTIFS");
            }
        }
        if (lower.matches(".*\\b(quick settings|control center|status bar)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.performQuickSettings()) {
                return new CommandResult(true, "Opening Quick Settings.", "NAV_QS");
            }
        }
        if (lower.matches(".*\\b(take screenshot|screenshot lo|capture screen|screenshot)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.takeScreenshot()) {
                return new CommandResult(true, "Screenshot captured!", "SCREENSHOT");
            }
            return new CommandResult(true, "Please enable MIRA Accessibility Service in Settings to take screenshots by voice.", "NEED_A11Y");
        }
        if (lower.matches(".*\\b(lock screen|lock phone|phone lock karo|screen band karo)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.lockScreen()) {
                return new CommandResult(true, "Locking your phone.", "LOCK_SCREEN");
            }
            return new CommandResult(true, "Please enable MIRA Accessibility Service to lock the screen by voice.", "NEED_A11Y");
        }
        if (lower.matches(".*\\b(scroll down|niche scroll|neeche karo|next reel|next short)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.scroll(true)) {
                return new CommandResult(true, "Scrolling down.", "SCROLL_DOWN");
            }
        }
        if (lower.matches(".*\\b(scroll up|upar scroll|upar karo|previous reel)\\b.*")) {
            if (MiraAccessibilityService.instance != null && MiraAccessibilityService.instance.scroll(false)) {
                return new CommandResult(true, "Scrolling up.", "SCROLL_UP");
            }
        }
        if (lower.matches(".*\\b(read screen|screen padho|what is on screen)\\b.*")) {
            if (MiraAccessibilityService.instance != null) {
                String txt = MiraAccessibilityService.instance.readVisibleScreenText();
                return new CommandResult(true, txt.isEmpty() ? "I couldn't find readable text on screen." : txt, "READ_SCREEN");
            }
        }
        Matcher clickM = Pattern.compile("(?:click|tap|press)\\s+(?:on\\s+)?(.+)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (clickM.matches() && MiraAccessibilityService.instance != null) {
            String target = clickM.group(1).trim();
            boolean ok = MiraAccessibilityService.instance.clickByText(target);
            return new CommandResult(true, ok ? "Tapped " + target : "Could not find " + target + " on screen.", "CLICK:" + target);
        }
        Matcher typeM = Pattern.compile("(?:type|write|likho)\\s+(.+)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (typeM.matches() && MiraAccessibilityService.instance != null) {
            String val = typeM.group(1).trim();
            boolean ok = MiraAccessibilityService.instance.typeIntoFocusedField(val);
            return new CommandResult(true, ok ? "Typed: " + val : "Tap a text box first so I can type into it.", "TYPE");
        }

        // 2. Flashlight / Torch
        if (lower.contains("flashlight") || lower.contains("torch")) {
            boolean turnOn = !(lower.contains("off") || lower.contains("band") || lower.contains("close") || lower.contains("disable"));
            try {
                CameraManager cm = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
                if (cm != null && cm.getCameraIdList().length > 0) {
                    torchState = turnOn;
                    cm.setTorchMode(cm.getCameraIdList()[0], torchState);
                    return new CommandResult(true, torchState ? "Flashlight turned on!" : "Flashlight turned off!", torchState ? "FLASHLIGHT_ON" : "FLASHLIGHT_OFF");
                }
            } catch (Exception e) {
                return new CommandResult(true, "Flashlight error: " + e.getMessage(), "FLASHLIGHT_ERR");
            }
        }

        // 3. Volume Controls
        if (lower.contains("volume") || lower.contains("awaaz") || lower.contains("mute") || lower.contains("unmute")) {
            AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                if (lower.contains("mute") && !lower.contains("unmute")) {
                    am.setStreamVolume(AudioManager.STREAM_MUSIC, 0, AudioManager.FLAG_SHOW_UI);
                    return new CommandResult(true, "Media volume muted.", "VOL_MUTE");
                }
                if (lower.contains("max") || lower.contains("full")) {
                    int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                    am.setStreamVolume(AudioManager.STREAM_MUSIC, max, AudioManager.FLAG_SHOW_UI);
                    return new CommandResult(true, "Volume set to maximum.", "VOL_MAX");
                }
                if (lower.contains("up") || lower.contains("badhao") || lower.contains("increase") || lower.contains("high")) {
                    am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI);
                    am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI);
                    return new CommandResult(true, "Volume increased.", "VOL_UP");
                }
                if (lower.contains("down") || lower.contains("kam") || lower.contains("decrease") || lower.contains("low")) {
                    am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI);
                    am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI);
                    return new CommandResult(true, "Volume lowered.", "VOL_DOWN");
                }
            }
        }

        // 4. Media Playback Controls
        if (lower.matches(".*\\b(pause music|pause song|stop music|gaana roko|pause video)\\b.*")) {
            dispatchMediaKey(ctx, KeyEvent.KEYCODE_MEDIA_PAUSE);
            return new CommandResult(true, "Paused media.", "MEDIA_PAUSE");
        }
        if (lower.matches(".*\\b(resume music|play music|continue music|gaana chalao)\\b.*")) {
            dispatchMediaKey(ctx, KeyEvent.KEYCODE_MEDIA_PLAY);
            return new CommandResult(true, "Resuming playback.", "MEDIA_PLAY");
        }
        if (lower.matches(".*\\b(next song|next track|agla gaana|skip song)\\b.*")) {
            dispatchMediaKey(ctx, KeyEvent.KEYCODE_MEDIA_NEXT);
            return new CommandResult(true, "Skipped to next track.", "MEDIA_NEXT");
        }
        if (lower.matches(".*\\b(previous song|prev track|pichla gaana)\\b.*")) {
            dispatchMediaKey(ctx, KeyEvent.KEYCODE_MEDIA_PREVIOUS);
            return new CommandResult(true, "Playing previous track.", "MEDIA_PREV");
        }

        // 5. Brightness Controls
        if (lower.contains("brightness")) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Settings.System.canWrite(ctx)) {
                    int val = lower.contains("full") || lower.contains("max") ? 255
                        : lower.contains("low") || lower.contains("min") || lower.contains("kam") ? 35
                        : lower.contains("up") || lower.contains("badhao") ? 200 : 120;
                    Settings.System.putInt(ctx.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
                    Settings.System.putInt(ctx.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, val);
                    return new CommandResult(true, "Screen brightness adjusted!", "BRIGHTNESS");
                }
            } catch (Exception ignored) {}
            Intent disp = new Intent(Settings.ACTION_DISPLAY_SETTINGS);
            disp.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(disp);
            return new CommandResult(true, "Opening Display Brightness settings.", "BRIGHTNESS_SETTINGS");
        }

        // 6. Connectivity / System Settings (Wi-Fi, Bluetooth, Data, Airplane, Hotspot, Location, DND)
        if (lower.contains("wifi") || lower.contains("wi-fi")) {
            Intent i = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? new Intent(Settings.Panel.ACTION_WIFI)
                : new Intent(Settings.ACTION_WIFI_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return new CommandResult(true, "Opening Wi-Fi controls.", "WIFI");
        }
        if (lower.contains("bluetooth")) {
            try {
                BluetoothAdapter ba = BluetoothAdapter.getDefaultAdapter();
                if (ba != null && (Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
                    ContextCompat.checkSelfPermission(ctx, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED)) {
                    if (lower.contains("off") || lower.contains("band")) {
                        ba.disable();
                        return new CommandResult(true, "Bluetooth turned off.", "BT_OFF");
                    } else if (lower.contains("on") || lower.contains("chalu")) {
                        ba.enable();
                        return new CommandResult(true, "Bluetooth turned on.", "BT_ON");
                    }
                }
            } catch (Exception ignored) {}
            Intent i = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return new CommandResult(true, "Opening Bluetooth settings.", "BT_SETTINGS");
        }
        if (lower.contains("mobile data") || lower.contains("internet settings") || lower.contains("data on") || lower.contains("data off")) {
            Intent i = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? new Intent(Settings.Panel.ACTION_INTERNET_CONNECTIVITY)
                : new Intent(Settings.ACTION_DATA_ROAMING_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return new CommandResult(true, "Opening Internet & Mobile Data panel.", "DATA_PANEL");
        }
        if (lower.contains("airplane") || lower.contains("flight mode")) {
            Intent i = new Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return new CommandResult(true, "Opening Airplane Mode settings.", "AIRPLANE");
        }
        if (lower.contains("hotspot")) {
            Intent i = new Intent(Settings.ACTION_WIRELESS_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return new CommandResult(true, "Opening Hotspot & Wireless settings.", "HOTSPOT");
        }
        if (lower.contains("location") || lower.contains("gps")) {
            Intent i = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return new CommandResult(true, "Opening Location GPS settings.", "LOCATION");
        }

        // 7. Phone Call & Contacts ("call mom", "rahul ko call karo", "dial 98...")
        Matcher callPattern = Pattern.compile("(?:call|dial|phone\\s+lagao|call\\s+karo)\\s+(.+)", Pattern.CASE_INSENSITIVE).matcher(text);
        Matcher hindiCall = Pattern.compile("(.+?)\\s+ko\\s+call\\s+(?:karo|lagao|laga)", Pattern.CASE_INSENSITIVE).matcher(text);
        String callTarget = null;
        if (callPattern.matches()) callTarget = callPattern.group(1).trim();
        else if (hindiCall.matches()) callTarget = hindiCall.group(1).trim();
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
                return new CommandResult(true, "Opening WhatsApp chat with " + target + ".", "WHATSAPP_MSG");
            }
            openAppByName(ctx, "whatsapp");
            return new CommandResult(true, "Opening WhatsApp.", "WHATSAPP");
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
            return new CommandResult(true, "Opening Messages for " + target + ".", "SMS");
        }

        // 9. Camera / Photo / Video
        if (lower.matches(".*\\b(take photo|take a photo|click photo|selfie|photo khicho)\\b.*")) {
            Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            cam.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(cam);
            return new CommandResult(true, "Opening Camera for a photo!", "CAMERA_PHOTO");
        }
        if (lower.matches(".*\\b(record video|video banao|shoot video)\\b.*")) {
            Intent vid = new Intent(MediaStore.ACTION_VIDEO_CAPTURE);
            vid.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(vid);
            return new CommandResult(true, "Opening Camera for video recording!", "CAMERA_VIDEO");
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
                    return new CommandResult(true, String.format(Locale.US, "Alarm set for %02d:%02d!", h, m), "SET_ALARM");
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
            return new CommandResult(true, "Timer set for " + secs + " seconds!", "SET_TIMER");
        }

        // 11. Wallpaper
        if (lower.contains("wallpaper")) {
            if (lower.contains("live") || lower.contains("animated")) {
                Intent i = new Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER);
                i.putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, new ComponentName(ctx, MiraLiveWallpaperService.class));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
                return new CommandResult(true, "Opening MIRA Live Wallpaper picker!", "LIVE_WALLPAPER");
            }
        }

        // 12. YouTube / Spotify / Google Search / Weather
        Matcher ytM = Pattern.compile("(?:play|search)\\s+(.+?)\\s+(?:on\\s+youtube|youtube\\s+pe)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (ytM.matches()) {
            String q = ytM.group(1).trim();
            openUrlDirect(ctx, "https://www.youtube.com/results?search_query=" + urlEncode(q));
            return new CommandResult(true, "Searching YouTube for " + q + ".", "YT_SEARCH");
        }
        Matcher spotM = Pattern.compile("(?:play)\\s+(.+?)\\s+(?:on\\s+spotify)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (spotM.matches()) {
            String q = spotM.group(1).trim();
            openUrlDirect(ctx, "https://open.spotify.com/search/" + urlEncode(q));
            return new CommandResult(true, "Opening Spotify for " + q + ".", "SPOTIFY");
        }
        Matcher gSearch = Pattern.compile("(?:search|google)\\s+(?:for\\s+)?(.+)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (gSearch.matches()) {
            String q = gSearch.group(1).trim();
            openUrlDirect(ctx, "https://www.google.com/search?q=" + urlEncode(q));
            return new CommandResult(true, "Searching Google for " + q + ".", "WEB_SEARCH");
        }
        if (lower.contains("weather") || lower.contains("mausam")) {
            openUrlDirect(ctx, "https://www.google.com/search?q=weather+today");
            return new CommandResult(true, "Opening live weather forecast.", "WEATHER");
        }

        // 13. Open ANY Installed App (English + Hinglish "kholo" / "open")
        Matcher openEn = Pattern.compile("(?:please\\s+)?(?:open|launch|start)\\s+(.+)", Pattern.CASE_INSENSITIVE).matcher(text);
        Matcher openHi = Pattern.compile("(.+?)\\s+(?:kholo|open\\s+karo|chalao)", Pattern.CASE_INSENSITIVE).matcher(text);
        String appQuery = openEn.matches() ? openEn.group(1).trim()
            : openHi.matches() ? openHi.group(1).trim() : null;
        if (appQuery != null && !appQuery.isEmpty()) {
            String launched = openAppByName(ctx, appQuery);
            if (launched != null) {
                return new CommandResult(true, "Opening " + appQuery + ".", "OPEN_APP:" + launched);
            }
        }

        // 14. Time / Date / Battery
        if (lower.matches(".*\\b(what time|current time|time kya|kitne baje)\\b.*")) {
            String t = new SimpleDateFormat("hh:mm a", Locale.getDefault()).format(new Date());
            return new CommandResult(true, "It is " + t + ".", "TIME");
        }
        if (lower.matches(".*\\b(today's date|what date|aaj ki tarikh|what day)\\b.*")) {
            String d = new SimpleDateFormat("EEEE, dd MMMM yyyy", Locale.getDefault()).format(new Date());
            return new CommandResult(true, "Today is " + d + ".", "DATE");
        }
        if (lower.matches(".*\\b(battery|kitna charge)\\b.*")) {
            BatteryManager bm = (BatteryManager) ctx.getSystemService(Context.BATTERY_SERVICE);
            int pct = bm != null ? bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) : 85;
            boolean chg = bm != null && bm.isCharging();
            return new CommandResult(true, "Your battery is at " + pct + "% " + (chg ? "and charging." : "on battery."), "BATTERY");
        }

        return new CommandResult(false, "", "");
    }

    public static String openAppByName(Context ctx, String rawName) {
        String target = rawName.toLowerCase(Locale.ROOT).trim();
        if ("settings".equals(target) || "setting".equals(target)) {
            Intent i = new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return "settings";
        }
        Map<String, String> aliases = new HashMap<>();
        aliases.put("youtube", "com.google.android.youtube");
        aliases.put("whatsapp", "com.whatsapp");
        aliases.put("instagram", "com.instagram.android");
        aliases.put("insta", "com.instagram.android");
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

        // Dynamic scan of ALL installed apps on the device (from open-jarvis pattern)
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
            Intent dial = new Intent(Intent.ACTION_DIAL).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(dial);
            return new CommandResult(true, "Couldn't find " + target + " in contacts, opening Dialer.", "DIAL");
        }
        boolean hasCallPerm = ContextCompat.checkSelfPermission(ctx, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED;
        Intent callIntent = new Intent(hasCallPerm ? Intent.ACTION_CALL : Intent.ACTION_DIAL, Uri.parse("tel:" + number));
        callIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(callIntent);
        return new CommandResult(true, (hasCallPerm ? "Calling " : "Dialing ") + target + ".", "CALL:" + target);
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
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }

    private static String urlEncode(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    /**
     * Free AI Brain for background Mini MIRA Overlay (optional Gemini key OR 100% free Pollinations AI!)
     */
    public static String askFreeAiBlocking(Context ctx, String prompt) {
        SharedPreferences prefs = ctx.getSharedPreferences(MiraLiveWallpaperService.PREFS_NAME, Context.MODE_PRIVATE);
        String geminiKey = prefs.getString("gemini_api_key", "");
        String geminiModel = prefs.getString("gemini_model", "gemini-2.5-flash");
        String commander = prefs.getString(MiraLiveWallpaperService.KEY_COMMANDER, "Commander");

        // 1. Optional user Gemini API key
        if (geminiKey != null && geminiKey.trim().length() > 10) {
            try {
                URL url = new URL("https://generativelanguage.googleapis.com/v1beta/models/" + geminiModel + ":generateContent?key=" + geminiKey.trim());
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(10000);
                conn.setDoOutput(true);
                JSONObject body = new JSONObject();
                JSONArray contents = new JSONArray();
                JSONObject userObj = new JSONObject();
                userObj.put("role", "user");
                JSONArray parts = new JSONArray();
                parts.put(new JSONObject().put("text", "You are MIRA, " + commander + "'s friendly personal AI assistant. Answer concisely in 1-2 plain sentences (English or Hinglish matching user): " + prompt));
                userObj.put("parts", parts);
                contents.put(userObj);
                body.put("contents", contents);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.toString().getBytes("UTF-8"));
                }
                if (conn.getResponseCode() == 200) {
                    BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                    JSONObject res = new JSONObject(sb.toString());
                    String reply = res.getJSONArray("candidates").getJSONObject(0)
                        .getJSONObject("content").getJSONArray("parts").getJSONObject(0).getString("text");
                    return reply.replace("*", "").trim();
                }
            } catch (Exception ignored) {}
        }

        // 2. 100% Free Keyless Pollinations AI endpoint
        try {
            String sys = "You are MIRA, " + commander + "'s personal AI assistant. Reply briefly in 1-2 plain sentences without markdown.";
            String apiUrl = "https://text.pollinations.ai/" + urlEncode(prompt) + "?system=" + urlEncode(sys);
            HttpURLConnection conn = (HttpURLConnection) new URL(apiUrl).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(10000);
            if (conn.getResponseCode() == 200) {
                BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line).append(' ');
                String reply = sb.toString().replace("*", "").trim();
                if (!reply.isEmpty()) return reply;
            }
        } catch (Exception ignored) {}

        return "I heard you, " + commander + "! Check your internet connection or try a phone command like Open YouTube, Call Mom, or Flashlight on.";
    }
}
