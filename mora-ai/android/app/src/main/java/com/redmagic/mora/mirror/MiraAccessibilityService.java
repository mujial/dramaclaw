package com.redmagic.mora.mirror;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.List;

public class MiraAccessibilityService extends AccessibilityService {
    public static volatile MiraAccessibilityService instance = null;
    private volatile String currentPackage = "";
    private final Handler autoScrollHandler = new Handler(Looper.getMainLooper());
    private volatile boolean autoScrolling = false;
    private int autoScrollIntervalMs = 5500;

    private final Runnable autoScrollRunnable = new Runnable() {
        @Override
        public void run() {
            if (!autoScrolling) return;
            scroll(true);
            autoScrollHandler.postDelayed(this, autoScrollIntervalMs);
        }
    };

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        AccessibilityServiceInfo info = getServiceInfo();
        if (info != null) {
            info.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                | AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
                | AccessibilityEvent.TYPE_VIEW_SCROLLED;
            info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
            info.flags = AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
                | AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
            info.notificationTimeout = 100;
            setServiceInfo(info);
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event != null && event.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            CharSequence pkg = event.getPackageName();
            if (pkg != null && !getPackageName().equals(pkg.toString())) {
                currentPackage = pkg.toString();
            }
        }
    }

    @Override
    public void onInterrupt() {
        stopAutoScroll();
    }

    @Override
    public void onDestroy() {
        stopAutoScroll();
        super.onDestroy();
        if (instance == this) instance = null;
    }

    public String getCurrentPackage() {
        return currentPackage;
    }

    public boolean performBack() {
        return performGlobalAction(GLOBAL_ACTION_BACK);
    }

    public boolean performHome() {
        return performGlobalAction(GLOBAL_ACTION_HOME);
    }

    public boolean performRecents() {
        return performGlobalAction(GLOBAL_ACTION_RECENTS);
    }

    public boolean performNotifications() {
        return performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
    }

    public boolean performQuickSettings() {
        return performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS);
    }

    public boolean takeScreenshot() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return performGlobalAction(GLOBAL_ACTION_TAKE_SCREENSHOT);
        }
        return false;
    }

    public boolean lockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);
        }
        return false;
    }

    public void startAutoScroll(int intervalMs) {
        autoScrollIntervalMs = Math.max(2000, intervalMs);
        autoScrolling = true;
        autoScrollHandler.removeCallbacks(autoScrollRunnable);
        scroll(true);
        autoScrollHandler.postDelayed(autoScrollRunnable, autoScrollIntervalMs);
    }

    public void stopAutoScroll() {
        autoScrolling = false;
        autoScrollHandler.removeCallbacks(autoScrollRunnable);
    }

    public boolean isAutoScrolling() {
        return autoScrolling;
    }

    public boolean scroll(boolean nextDown) {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        float x = dm.widthPixels * 0.5f;
        // For Reels/Shorts/Feed: swipe finger bottom->top to advance down to next item
        float startY = nextDown ? dm.heightPixels * 0.76f : dm.heightPixels * 0.24f;
        float endY = nextDown ? dm.heightPixels * 0.22f : dm.heightPixels * 0.78f;
        Path path = new Path();
        path.moveTo(x, startY);
        path.lineTo(x, endY);
        GestureDescription.StrokeDescription stroke = new GestureDescription.StrokeDescription(path, 0, 260);
        return dispatchGesture(new GestureDescription.Builder().addStroke(stroke).build(), null, null);
    }

    public boolean swipeHorizontal(boolean leftToRight) {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        float y = dm.heightPixels * 0.5f;
        float startX = leftToRight ? dm.widthPixels * 0.15f : dm.widthPixels * 0.85f;
        float endX = leftToRight ? dm.widthPixels * 0.85f : dm.widthPixels * 0.15f;
        Path path = new Path();
        path.moveTo(startX, y);
        path.lineTo(endX, y);
        GestureDescription.StrokeDescription stroke = new GestureDescription.StrokeDescription(path, 0, 260);
        return dispatchGesture(new GestureDescription.Builder().addStroke(stroke).build(), null, null);
    }

    public boolean tapCoordinates(float xPct, float yPct) {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        float x = Math.max(10f, Math.min(dm.widthPixels - 10f, dm.widthPixels * (xPct / 100f)));
        float y = Math.max(10f, Math.min(dm.heightPixels - 10f, dm.heightPixels * (yPct / 100f)));
        Path path = new Path();
        path.moveTo(x, y);
        GestureDescription.StrokeDescription stroke = new GestureDescription.StrokeDescription(path, 0, 60);
        return dispatchGesture(new GestureDescription.Builder().addStroke(stroke).build(), null, null);
    }

    public boolean clickByText(String text) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || text == null || text.trim().isEmpty()) return false;
        List<AccessibilityNodeInfo> nodes = root.findAccessibilityNodeInfosByText(text.trim());
        if (nodes != null) {
            for (AccessibilityNodeInfo node : nodes) {
                AccessibilityNodeInfo target = node;
                while (target != null && !target.isClickable()) {
                    target = target.getParent();
                }
                if (target != null && target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                    return true;
                }
            }
        }
        return false;
    }

    public boolean typeIntoFocusedField(String text) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || text == null) return false;
        AccessibilityNodeInfo editable = findEditable(root);
        if (editable == null) return false;
        editable.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        return editable.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
    }

    private AccessibilityNodeInfo findEditable(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isEditable()) return node;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo found = findEditable(node.getChild(i));
            if (found != null) return found;
        }
        return null;
    }

    public String readVisibleScreenText() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return "";
        StringBuilder sb = new StringBuilder();
        collectText(root, sb);
        String out = sb.toString().trim();
        return out.length() > 420 ? out.substring(0, 420) : out;
    }

    public String dumpScreenSummary() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return "App: " + currentPackage + " (no window access)";
        StringBuilder sb = new StringBuilder("ForegroundApp: ").append(currentPackage).append(" | UI: ");
        collectUiTree(root, sb);
        String out = sb.toString();
        return out.length() > 950 ? out.substring(0, 950) : out;
    }

    private void collectUiTree(AccessibilityNodeInfo node, StringBuilder sb) {
        if (node == null || sb.length() > 950) return;
        CharSequence t = node.getText();
        CharSequence d = node.getContentDescription();
        String label = (t != null && t.length() > 0) ? t.toString() : (d != null ? d.toString() : "");
        label = label.replace("\n", " ").trim();
        if (!label.isEmpty()) {
            if (node.isEditable()) sb.append("[INPUT:").append(label).append("] ");
            else if (node.isClickable()) sb.append("[BTN:").append(label).append("] ");
            else if (label.length() > 2 && label.length() < 60) sb.append(label).append(" · ");
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            collectUiTree(node.getChild(i), sb);
        }
    }

    private void collectText(AccessibilityNodeInfo node, StringBuilder sb) {
        if (node == null || sb.length() > 500) return;
        CharSequence t = node.getText();
        CharSequence d = node.getContentDescription();
        CharSequence v = (t != null && t.length() > 0) ? t : d;
        if (v != null && v.length() > 1) {
            sb.append(v).append(". ");
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            collectText(node.getChild(i), sb);
        }
    }
}
