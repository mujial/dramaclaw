package com.redmagic.mora.mirror;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.Shader;
import android.os.BatteryManager;
import android.os.Handler;
import android.os.Looper;
import android.service.wallpaper.WallpaperService;
import android.view.MotionEvent;
import android.view.SurfaceHolder;

import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MiraLiveWallpaperService extends WallpaperService {
    public static final String PREFS_NAME = "mira_wallpaper_prefs";
    public static final String KEY_OUTFIT = "outfit";
    public static final String KEY_STAGE = "stage";
    public static final String KEY_COMMANDER = "commander";

    @Override
    public Engine onCreateEngine() {
        return new MiraEngine();
    }

    public static Bitmap loadAssetBitmap(Context ctx, String assetPath) {
        AssetManager am = ctx.getAssets();
        try (InputStream is = am.open(assetPath)) {
            return BitmapFactory.decodeStream(is);
        } catch (Exception e) {
            return null;
        }
    }

    public static String outfitToAsset(String outfit) {
        if ("academy".equals(outfit)) return "public/assets/mora-academy-cutout.png";
        if ("esports".equals(outfit)) return "public/assets/mora-esports-cutout.png";
        if ("chibi".equals(outfit)) return "public/assets/mora-chibi-cutout.png";
        return "public/assets/mora-cyber-cutout.png";
    }

    public static String stageToAsset(String stage) {
        if ("lab".equals(stage)) return "public/assets/bg-cyber-lab.png";
        if ("arena".equals(stage)) return "public/assets/bg-neon-arena.png";
        return "public/assets/bg-space-bridge.png";
    }

    private class MiraEngine extends Engine {
        private final Handler handler = new Handler(Looper.getMainLooper());
        private final Runnable drawRunner = this::drawFrame;
        private boolean visible = false;
        private int width = 1080;
        private int height = 1920;
        private long startMs = System.currentTimeMillis();
        private float tapX = -1f;
        private float tapY = -1f;
        private long tapTimeMs = 0L;

        private Bitmap bgBitmap;
        private Bitmap charBitmap;
        private String loadedOutfit = "";
        private String loadedStage = "";

        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        private final Paint hudPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint particlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);

        @Override
        public void onVisibilityChanged(boolean visible) {
            this.visible = visible;
            if (visible) {
                reloadBitmapsIfNeeded();
                handler.post(drawRunner);
            } else {
                handler.removeCallbacks(drawRunner);
            }
        }

        @Override
        public void onSurfaceChanged(SurfaceHolder holder, int format, int width, int height) {
            super.onSurfaceChanged(holder, format, width, height);
            this.width = Math.max(1, width);
            this.height = Math.max(1, height);
            reloadBitmapsIfNeeded();
        }

        @Override
        public void onTouchEvent(MotionEvent event) {
            if (event.getAction() == MotionEvent.ACTION_DOWN) {
                tapX = event.getX();
                tapY = event.getY();
                tapTimeMs = System.currentTimeMillis();
            }
            super.onTouchEvent(event);
        }

        @Override
        public void onDestroy() {
            super.onDestroy();
            handler.removeCallbacks(drawRunner);
        }

        private void reloadBitmapsIfNeeded() {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String outfit = prefs.getString(KEY_OUTFIT, "cyber");
            String stage = prefs.getString(KEY_STAGE, "space");
            if (!outfit.equals(loadedOutfit) || charBitmap == null) {
                loadedOutfit = outfit;
                charBitmap = loadAssetBitmap(MiraLiveWallpaperService.this, outfitToAsset(outfit));
            }
            if (!stage.equals(loadedStage) || bgBitmap == null) {
                loadedStage = stage;
                bgBitmap = loadAssetBitmap(MiraLiveWallpaperService.this, stageToAsset(stage));
            }
        }

        private void drawFrame() {
            if (!visible) return;
            SurfaceHolder holder = getSurfaceHolder();
            Canvas canvas = null;
            try {
                canvas = holder.lockCanvas();
                if (canvas != null) {
                    render(canvas);
                }
            } finally {
                if (canvas != null) {
                    holder.unlockCanvasAndPost(canvas);
                }
            }
            handler.removeCallbacks(drawRunner);
            if (visible) {
                handler.postDelayed(drawRunner, 33);
            }
        }

        private void render(Canvas canvas) {
            reloadBitmapsIfNeeded();
            long now = System.currentTimeMillis();
            float t = (now - startMs) / 1000f;

            // 1. Background stage cover-crop
            canvas.drawColor(Color.rgb(5, 7, 13));
            if (bgBitmap != null) {
                float scale = Math.max((float) width / bgBitmap.getWidth(), (float) height / bgBitmap.getHeight());
                int dw = Math.round(bgBitmap.getWidth() * scale);
                int dh = Math.round(bgBitmap.getHeight() * scale);
                int left = (width - dw) / 2;
                int top = (height - dh) / 2;
                canvas.drawBitmap(bgBitmap, null, new Rect(left, top, left + dw, top + dh), paint);
            }

            // Dark atmospheric gradient overlay
            paint.setShader(new LinearGradient(
                0, 0, 0, height,
                Color.argb(120, 5, 7, 13),
                Color.argb(190, 5, 7, 13),
                Shader.TileMode.CLAMP
            ));
            canvas.drawRect(0, 0, width, height, paint);
            paint.setShader(null);

            // 2. Floating cyber particles
            for (int i = 0; i < 14; i++) {
                float px = width * (0.1f + (i * 0.065f) % 0.8f);
                float py = height * (0.85f - ((t * 0.08f + i * 0.13f) % 0.72f));
                particlePaint.setColor(i % 2 == 0 ? Color.argb(165, 255, 42, 75) : Color.argb(165, 0, 240, 255));
                canvas.drawCircle(px, py, 4f + (i % 3) * 2f, particlePaint);
            }

            // 3. Animated MIRA character
            if (charBitmap != null) {
                float floatY = (float) Math.sin(t * 2.1) * (height * 0.01f);
                float targetH = height * 0.62f;
                float targetW = targetH * ((float) charBitmap.getWidth() / Math.max(1, charBitmap.getHeight()));
                int left = Math.round((width - targetW) / 2f);
                int top = Math.round(height * 0.24f + floatY);
                canvas.drawBitmap(charBitmap, null, new Rect(left, top, left + Math.round(targetW), top + Math.round(targetH)), paint);
            }

            // 4. Minimalist MIRA HUD header
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String cmd = prefs.getString(KEY_COMMANDER, "Commander");
            BatteryManager bm = (BatteryManager) getSystemService(BATTERY_SERVICE);
            int pct = bm != null ? bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) : 85;
            String clockStr = new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date());

            hudPaint.setColor(Color.argb(230, 255, 255, 255));
            hudPaint.setTextSize(width * 0.042f);
            hudPaint.setTextAlign(Paint.Align.CENTER);
            canvas.drawText("MIRA AI · " + clockStr + " · " + pct + "%", width / 2f, height * 0.12f, hudPaint);

            hudPaint.setColor(Color.argb(200, 0, 240, 255));
            hudPaint.setTextSize(width * 0.028f);
            canvas.drawText("NEURAL LINK ACTIVE · " + cmd.toUpperCase(Locale.ROOT), width / 2f, height * 0.155f, hudPaint);

            // 5. Touch ripple on home screen tap
            long elapsedTap = now - tapTimeMs;
            if (tapX >= 0 && elapsedTap < 700) {
                float prog = elapsedTap / 700f;
                Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
                ring.setStyle(Paint.Style.STROKE);
                ring.setStrokeWidth(6f);
                ring.setColor(Color.argb(Math.round((1f - prog) * 230), 255, 42, 75));
                canvas.drawCircle(tapX, tapY, 30f + prog * 180f, ring);
            }
        }
    }
}
