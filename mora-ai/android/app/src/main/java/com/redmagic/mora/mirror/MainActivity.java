package com.redmagic.mora.mirror;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MiraPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
