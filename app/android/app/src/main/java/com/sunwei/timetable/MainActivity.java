package com.sunwei.timetable;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* 必须写在 super.onCreate() 之前，否则 Bridge 初始化时注册不进去 */
        registerPlugin(WidgetDataPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
