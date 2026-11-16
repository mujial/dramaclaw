package com.redmagic.mora.mirror;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.os.Build;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.List;

public class MiraAccessibilityService extends AccessibilityService {
    public static volatile MiraAccessibilityService instance = null;

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
        // Track foreground window automatically via getRootInActiveWindow()
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (instance == this) instance = null;
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

    public boolean scroll(boolean down) {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        float x = dm.widthPixels / 2f;
        float startY = down ? dm.heightPixels * 0.72f : dm.heightPixels * 0.28f;
        float endY = down ? dm.heightPixels * 0.25f : dm.heightPixels * 0.75f;
        Path path = new Path();
        path.moveTo(x, startY);
        path.lineTo(x, endY);
        GestureDescription.StrokeDescription stroke = new GestureDescription.StrokeDescription(path, 0, 280);
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
