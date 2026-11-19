package com.sunwei.timetable;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 小组件镜像的读写。网页端把未来 3 天压成一份 JSON 推过来，
 * 这里只负责存和按 dayKey 取「今天」那一份。
 */
public final class WidgetStore {

    private static final String SP = "kb_widget";
    private static final String KEY = "payload";

    private WidgetStore() {}

    public static void save(Context ctx, String json) {
        ctx.getSharedPreferences(SP, Context.MODE_PRIVATE).edit().putString(KEY, json).apply();
    }

    public static JSONObject load(Context ctx) {
        try {
            String s = ctx.getSharedPreferences(SP, Context.MODE_PRIVATE).getString(KEY, null);
            return s == null ? null : new JSONObject(s);
        } catch (Exception e) {
            return null;
        }
    }

    /** dayKey 与今天一致的那一天；null 表示没有今天的数据（跨天未同步 / 从未打开过 App） */
    public static JSONObject today(Context ctx, String todayKey) {
        JSONObject data = load(ctx);
        if (data == null) return null;
        JSONArray days = data.optJSONArray("days");
        if (days == null) return null;
        for (int i = 0; i < days.length(); i++) {
            JSONObject d = days.optJSONObject(i);
            if (d != null && todayKey.equals(d.optString("dayKey"))) return d;
        }
        return null;
    }
}
