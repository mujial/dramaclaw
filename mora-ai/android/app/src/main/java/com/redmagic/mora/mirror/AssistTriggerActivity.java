package com.redmagic.mora.mirror;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;

/**
 * Transparent Assistant Trigger Activity:
 * When launched via system Assistant / Voice Command gesture,
 * shows the floating Mini MIRA Overlay without opening the main app!
 */
public class AssistTriggerActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) {
            Intent svc = new Intent(this, MiraOverlayService.class);
            svc.setAction(MiraOverlayService.ACTION_WAKE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(svc);
            } else {
                startService(svc);
            }
        } else {
            Intent main = new Intent(this, MainActivity.class);
            main.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(main);
        }
        finish();
    }
}
