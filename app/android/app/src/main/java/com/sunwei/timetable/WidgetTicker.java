package com.sunwei.timetable;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/**
 * 小组件的定点刷新：今天还有没开始的项 → 到点刷一次；
 * 没有 → 次日 00:00 刷一次（跨天换数据）。每次触发后自续下一次。
 */
public class WidgetTicker extends BroadcastReceiver {

    static final String ACTION_TICK = "com.sunwei.timetable.WIDGET_TICK";
    private static final int REQ = 7401;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        TodayWidgetProvider.refreshAll(ctx);
        schedule(ctx);
    }

    public static void schedule(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long at = nextTrigger(ctx);
        PendingIntent pi = pending(ctx);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (SecurityException e) {
            /* 极少数机型拿不到精确闹钟，退化成不精确，最多晚几分钟 */
            am.set(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    public static void cancel(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = pending(ctx);
        am.cancel(pi);
        pi.cancel();
    }

    private static PendingIntent pending(Context ctx) {
        Intent i = new Intent(ctx, WidgetTicker.class).setAction(ACTION_TICK);
        return PendingIntent.getBroadcast(ctx, REQ, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** 今天还没开始的最近一项；没有就明天 00:00:05 */
    private static long nextTrigger(Context ctx) {
        long now = System.currentTimeMillis();
        long best = tomorrowMidnight();

        String todayKey = new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(new Date());
        JSONObject day = WidgetStore.today(ctx, todayKey);
        JSONArray items = day == null ? null : day.optJSONArray("items");
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null) continue;
            long t = todayAt(it.optString("time", ""));
            if (t > now + 30000 && t < best) best = t;
        }
        return best > now + 5000 ? best : now + 60000;
    }

    private static long todayAt(String hm) {
        try {
            String[] p = hm.split(":");
            Calendar c = Calendar.getInstance();
            c.set(Calendar.HOUR_OF_DAY, Integer.parseInt(p[0]));
            c.set(Calendar.MINUTE, Integer.parseInt(p[1]));
            c.set(Calendar.SECOND, 0);
            c.set(Calendar.MILLISECOND, 0);
            return c.getTimeInMillis();
        } catch (Exception e) {
            return Long.MAX_VALUE;
        }
    }

    private static long tomorrowMidnight() {
        Calendar c = Calendar.getInstance();
        c.add(Calendar.DAY_OF_YEAR, 1);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 5);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }
}
