package com.redmagic.mora.mirror;

import android.app.WallpaperManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.hardware.camera2.CameraManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.provider.AlarmClock;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

@CapacitorPlugin(name = "MiraNative")
public class MiraPlugin extends Plugin {
    private boolean torchOn = false;

    @PluginMethod
    public void syncWallpaperState(PluginCall call) {
        String outfit = call.getString("outfit", "cyber");
        String stage = call.getString("stage", "space");
        String commander = call.getString("commanderName", "Commander");

        SharedPreferences prefs = getContext().getSharedPreferences(MiraLiveWallpaperService.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(MiraLiveWallpaperService.KEY_OUTFIT, outfit)
            .putString(MiraLiveWallpaperService.KEY_STAGE, stage)
            .putString(MiraLiveWallpaperService.KEY_COMMANDER, commander)
            .apply();

        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void setLiveWallpaper(PluginCall call) {
        syncWallpaperStateInternal(
            call.getString("outfit", "cyber"),
            call.getString("stage", "space"),
            call.getString("commanderName", "Commander")
        );
        try {
            Intent intent = new Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER);
            intent.putExtra(
                WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT,
                new ComponentName(getContext(), MiraLiveWallpaperService.class)
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("mode", "live");
            call.resolve(ret);
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("mode", "chooser");
                call.resolve(ret);
            } catch (Exception ex) {
                call.reject("Could not open Live Wallpaper picker: " + ex.getMessage());
            }
        }
    }

    @PluginMethod
    public void setStaticWallpaper(PluginCall call) {
        String outfit = call.getString("outfit", "cyber");
        String stage = call.getString("stage", "space");
        String commander = call.getString("commanderName", "Commander");
        syncWallpaperStateInternal(outfit, stage, commander);

        try {
            int w = 1080;
            int h = 2400;
            Bitmap out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(out);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
            canvas.drawColor(Color.rgb(5, 7, 13));

            Bitmap bg = MiraLiveWallpaperService.loadAssetBitmap(getContext(), MiraLiveWallpaperService.stageToAsset(stage));
            if (bg != null) {
                float scale = Math.max((float) w / bg.getWidth(), (float) h / bg.getHeight());
                int dw = Math.round(bg.getWidth() * scale);
                int dh = Math.round(bg.getHeight() * scale);
                canvas.drawBitmap(bg, null, new Rect((w - dw) / 2, (h - dh) / 2, (w + dw) / 2, (h + dh) / 2), paint);
            }

            Bitmap ch = MiraLiveWallpaperService.loadAssetBitmap(getContext(), MiraLiveWallpaperService.outfitToAsset(outfit));
            if (ch != null) {
                float targetH = h * 0.60f;
                float targetW = targetH * ((float) ch.getWidth() / Math.max(1, ch.getHeight()));
                int left = Math.round((w - targetW) / 2f);
                int top = Math.round(h * 0.27f);
                canvas.drawBitmap(ch, null, new Rect(left, top, left + Math.round(targetW), top + Math.round(targetH)), paint);
            }

            WallpaperManager wm = WallpaperManager.getInstance(getContext());
            wm.setBitmap(out);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("mode", "static");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to set wallpaper: " + e.getMessage());
        }
    }

    private void syncWallpaperStateInternal(String outfit, String stage, String commander) {
        SharedPreferences prefs = getContext().getSharedPreferences(MiraLiveWallpaperService.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(MiraLiveWallpaperService.KEY_OUTFIT, outfit)
            .putString(MiraLiveWallpaperService.KEY_STAGE, stage)
            .putString(MiraLiveWallpaperService.KEY_COMMANDER, commander)
            .apply();
    }

    @PluginMethod
    public void openApp(PluginCall call) {
        String target = call.getString("target", "").toLowerCase(Locale.ROOT).trim();
        Map<String, String> appMap = new HashMap<>();
        appMap.put("chrome", "com.android.chrome");
        appMap.put("browser", "com.android.chrome");
        appMap.put("whatsapp", "com.whatsapp");
        appMap.put("youtube", "com.google.android.youtube");
        appMap.put("instagram", "com.instagram.android");
        appMap.put("telegram", "org.telegram.messenger");
        appMap.put("spotify", "com.spotify.music");
        appMap.put("maps", "com.google.android.apps.maps");
        appMap.put("gmail", "com.google.android.gm");
        appMap.put("camera", "com.android.camera");
        appMap.put("photos", "com.google.android.apps.photos");
        appMap.put("gallery", "com.android.gallery3d");
        appMap.put("settings", "android.settings.SETTINGS");
        appMap.put("play store", "com.android.vending");
        appMap.put("calculator", "com.google.android.calculator");
        appMap.put("calendar", "com.google.android.calendar");
        appMap.put("clock", "com.google.android.deskclock");
        appMap.put("contacts", "com.android.contacts");
        appMap.put("phone", "com.android.dialer");
        appMap.put("messages", "com.google.android.apps.messaging");
        appMap.put("pubg", "com.tencent.ig");
        appMap.put("bgmi", "com.pubg.imobile");
        appMap.put("free fire", "com.dts.freefireth");
        appMap.put("mlbb", "com.mobile.legends");
        appMap.put("genshin", "com.miHoYo.GenshinImpact");

        if ("settings".equals(target)) {
            Intent i = new Intent(android.provider.Settings.ACTION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("launched", "settings");
            call.resolve(ret);
            return;
        }

        String pkg = null;
        for (Map.Entry<String, String> entry : appMap.entrySet()) {
            if (target.contains(entry.getKey())) {
                pkg = entry.getValue();
                break;
            }
        }

        PackageManager pm = getContext().getPackageManager();
        if (pkg != null) {
            Intent launch = pm.getLaunchIntentForPackage(pkg);
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(launch);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("launched", pkg);
                call.resolve(ret);
                return;
            }
        }

        try {
            Intent market = new Intent(Intent.ACTION_VIEW, Uri.parse("market://search?q=" + Uri.encode(target)));
            market.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(market);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("launched", "play_store_search");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not open app: " + target);
        }
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "https://www.google.com");
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not open URL: " + e.getMessage());
        }
    }

    @PluginMethod
    public void toggleFlashlight(PluginCall call) {
        Boolean desired = call.getBoolean("on");
        try {
            CameraManager cm = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
            String cameraId = cm.getCameraIdList()[0];
            torchOn = desired != null ? desired : !torchOn;
            cm.setTorchMode(cameraId, torchOn);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("on", torchOn);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Flashlight unavailable: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getDeviceBattery(PluginCall call) {
        BatteryManager bm = (BatteryManager) getContext().getSystemService(Context.BATTERY_SERVICE);
        int level = bm != null ? bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) : 85;
        boolean charging = bm != null && bm.isCharging();
        JSObject ret = new JSObject();
        ret.put("level", level);
        ret.put("charging", charging);
        call.resolve(ret);
    }

    @PluginMethod
    public void setSystemAlarm(PluginCall call) {
        int hour = call.getInt("hour", 7);
        int minute = call.getInt("minute", 30);
        String message = call.getString("message", "MIRA Wake-Up Call");
        try {
            Intent i = new Intent(AlarmClock.ACTION_SET_ALARM);
            i.putExtra(AlarmClock.EXTRA_HOUR, hour);
            i.putExtra(AlarmClock.EXTRA_MINUTES, minute);
            i.putExtra(AlarmClock.EXTRA_MESSAGE, message);
            i.putExtra(AlarmClock.EXTRA_SKIP_UI, false);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not set system alarm: " + e.getMessage());
        }
    }
}
