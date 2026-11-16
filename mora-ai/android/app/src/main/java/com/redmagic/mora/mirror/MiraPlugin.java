package com.redmagic.mora.mirror;

import android.Manifest;
import android.app.Activity;
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
import android.os.Build;
import android.provider.AlarmClock;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "MiraNative")
public class MiraPlugin extends Plugin {
    private boolean torchOn = false;

    @PluginMethod
    public void syncWallpaperState(PluginCall call) {
        syncWallpaperStateInternal(
            call.getString("outfit", "cyber"),
            call.getString("stage", "space"),
            call.getString("commanderName", "Commander")
        );
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void syncAiConfig(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(MiraLiveWallpaperService.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString("gemini_api_key", call.getString("geminiApiKey", ""))
            .putString("gemini_model", call.getString("geminiModel", "gemini-2.5-flash"))
            .apply();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void checkPermissionsStatus(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        ret.put("overlay", Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx));
        ret.put("accessibility", MiraAccessibilityService.instance != null);
        ret.put("writeSettings", Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.System.canWrite(ctx));
        ret.put("microphone", ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
        ret.put("contacts", ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED);
        ret.put("callPhone", ContextCompat.checkSelfPermission(ctx, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED);
        ret.put("notifications", Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestRuntimePermissions(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.reject("No activity");
            return;
        }
        List<String> perms = new ArrayList<>();
        perms.add(Manifest.permission.RECORD_AUDIO);
        perms.add(Manifest.permission.CAMERA);
        perms.add(Manifest.permission.READ_CONTACTS);
        perms.add(Manifest.permission.CALL_PHONE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            perms.add(Manifest.permission.BLUETOOTH_CONNECT);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        ActivityCompat.requestPermissions(act, perms.toArray(new String[0]), 9101);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(ctx)) {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestAccessibilityPermission(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestWriteSettingsPermission(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.System.canWrite(ctx)) {
            Intent i = new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void startWakeWordService(PluginCall call) {
        Context ctx = getContext();
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Microphone permission required for Hey MIRA wake-word");
            return;
        }
        Intent svc = new Intent(ctx, MiraWakeWordService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(svc);
        } else {
            ctx.startService(svc);
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopWakeWordService(PluginCall call) {
        Context ctx = getContext();
        ctx.stopService(new Intent(ctx, MiraWakeWordService.class));
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void showMiniMiraOverlay(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(ctx)) {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.reject("Please enable Display Over Other Apps permission first!");
            return;
        }
        Intent svc = new Intent(ctx, MiraOverlayService.class);
        svc.setAction(MiraOverlayService.ACTION_WAKE);
        String cmd = call.getString("command", "");
        if (cmd != null && !cmd.isEmpty()) {
            svc.putExtra(MiraOverlayService.EXTRA_COMMAND, cmd);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(svc);
        } else {
            ctx.startService(svc);
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void hideMiniMiraOverlay(PluginCall call) {
        Context ctx = getContext();
        Intent svc = new Intent(ctx, MiraOverlayService.class);
        svc.setAction(MiraOverlayService.ACTION_HIDE);
        ctx.startService(svc);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void executeDeviceCommand(PluginCall call) {
        String command = call.getString("command", "");
        MiraDeviceController.CommandResult res = MiraDeviceController.executeCommand(getContext(), command);
        JSObject ret = new JSObject();
        ret.put("handled", res.handled);
        ret.put("reply", res.reply);
        ret.put("actionTag", res.actionTag);
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
        String target = call.getString("target", "").trim();
        String launched = MiraDeviceController.openAppByName(getContext(), target);
        if (launched != null) {
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("launched", launched);
            call.resolve(ret);
            return;
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
            MiraDeviceController.openUrlDirect(getContext(), url);
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
