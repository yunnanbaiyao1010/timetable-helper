package com.sunwei.timetable;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** 4×3 今日小组件：头部 1 行 + 3 条内容 + 底部 1 行 */
public class TodayWidgetProvider extends AppWidgetProvider {

    private static final int[] ROWS = {R.id.row1, R.id.row2, R.id.row3};
    private static final int[] BARS = {R.id.bar1, R.id.bar2, R.id.bar3};
    private static final int[] TIMES = {R.id.time1, R.id.time2, R.id.time3};
    private static final int[] TITLES = {R.id.title1, R.id.title2, R.id.title3};
    private static final int[] SUBS = {R.id.sub1, R.id.sub2, R.id.sub3};

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    @Override
    public void onDeleted(Context ctx, int[] ids) {
        WidgetTicker.cancel(ctx);
    }

    public static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, TodayWidgetProvider.class));
        if (ids == null || ids.length == 0) return;
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    private static RemoteViews build(Context ctx) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_today);

        String todayKey = new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(new Date());
        JSONObject day = WidgetStore.today(ctx, todayKey);

        if (day == null) {
            rv.setTextViewText(R.id.wDate, new SimpleDateFormat("M月d日", Locale.CHINA).format(new Date()));
            rv.setTextViewText(R.id.wWeek, "");
            showPlaceholder(rv);
        } else {
            rv.setTextViewText(R.id.wDate, day.optString("dateText", ""));
            rv.setTextViewText(R.id.wWeek, day.optString("weekText", ""));

            JSONArray items = day.optJSONArray("items");
            int n = items == null ? 0 : items.length();
            for (int i = 0; i < ROWS.length; i++) {
                JSONObject it = i < n && items != null ? items.optJSONObject(i) : null;
                if (it == null) {
                    rv.setViewVisibility(ROWS[i], View.GONE);
                    continue;
                }
                rv.setViewVisibility(ROWS[i], View.VISIBLE);
                rv.setTextViewText(TIMES[i], it.optString("time", ""));
                rv.setTextViewText(TITLES[i], it.optString("title", ""));
                rv.setTextViewText(SUBS[i], it.optString("sub", ""));
                rv.setInt(BARS[i], "setBackgroundResource",
                        "event".equals(it.optString("type"))
                                ? R.drawable.widget_bar_event
                                : R.drawable.widget_bar_course);
            }
            rv.setTextViewText(R.id.wFooter, day.optString("footer", ""));
        }

        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(R.id.widgetRoot, pi);

        return rv;
    }

    private static void showPlaceholder(RemoteViews rv) {
        rv.setViewVisibility(R.id.row1, View.VISIBLE);
        rv.setTextViewText(R.id.time1, "");
        rv.setTextViewText(R.id.title1, "打开课表助手同步");
        rv.setTextViewText(R.id.sub1, "桌面数据不是今天的");
        rv.setInt(R.id.bar1, "setBackgroundResource", R.drawable.widget_bar_event);

        rv.setViewVisibility(R.id.row2, View.GONE);
        rv.setViewVisibility(R.id.row3, View.GONE);
        rv.setTextViewText(R.id.wFooter, "同步后这里显示今天的课与日程");
    }
}
