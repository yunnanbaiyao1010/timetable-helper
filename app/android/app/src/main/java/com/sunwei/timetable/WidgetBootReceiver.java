package com.sunwei.timetable;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 重启 / 改时间 / 覆盖安装后，AlarmManager 里的定点刷新会丢，这里补回来 */
public class WidgetBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        TodayWidgetProvider.refreshAll(ctx);
        WidgetTicker.schedule(ctx);
    }
}
