package com.sunwei.timetable;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 网页端把小组件镜像推过来：落盘 → 立刻重画 → 重排下一次定点刷新 */
@CapacitorPlugin(name = "WidgetData")
public class WidgetDataPlugin extends Plugin {

    @PluginMethod
    public void push(PluginCall call) {
        String payload = call.getString("payload", "{}");
        WidgetStore.save(getContext(), payload);
        TodayWidgetProvider.refreshAll(getContext());
        WidgetTicker.schedule(getContext());
        call.resolve(new JSObject());
    }
}
