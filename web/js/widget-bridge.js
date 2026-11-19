/* =========================================================
   桌面小组件镜像：把未来 3 天压成一份 JSON 推给原生
   —— 只在 App 内生效；网页版没有 WidgetData 插件，直接跳过
   ========================================================= */
(function () {
  const C = window.Capacitor;
  const plugin = C && C.Plugins && C.Plugins.WidgetData;
  if (!plugin) return;

  const MAX_ITEMS = 3;
  const MAX_TITLE = 14;
  const MAX_SUB = 12;

  const clip = (s, n) => {
    const t = String(s == null ? '' : s).trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  };

  function dayPayload(day, label, isToday) {
    const now = new Date();
    const classes = sessionsOn(day).map((it) => {
      const start = sessionStartAt(day, it.session);
      return {
        start,
        end: sessionEndAt(day, it.session),
        time: fmtClock(start),
        title: it.course.name,
        sub: it.session.room || '',
        type: 'class',
      };
    });
    const events = (S.events || [])
      .filter((e) => e && e.date === ymd(day) && e.start)
      .map((e) => ({
        start: atTime(day, e.start),
        end: e.end ? atTime(day, e.end) : atTime(day, e.start),
        time: e.start,
        title: e.title,
        sub: e.place || '日程',
        type: 'event',
      }));

    let list = classes.concat(events).sort((a, b) => a.start - b.start);
    if (isToday) list = list.filter((x) => x.end >= now);

    const shown = list.slice(0, MAX_ITEMS);
    const rest = list.length - shown.length;
    return {
      dayKey: ymd(day),
      label,
      dateText: `${day.getMonth() + 1}月${day.getDate()}日 ${WEEK_NAMES[isoDay(day)]}`,
      weekText: `第 ${weekOf(day)} 周`,
      items: shown.map((x) => ({
        time: x.time,
        title: clip(x.title, MAX_TITLE),
        sub: clip(x.sub, MAX_SUB),
        type: x.type,
      })),
      footer: !list.length
        ? '今天没有安排'
        : (rest > 0 ? `还有 ${rest} 项没显示 · 打开查看` : `共 ${list.length} 项`),
    };
  }

  function build(state) {
    const s = state || S;
    const now = new Date();
    const labels = ['今天', '明天', '后天'];
    const days = [0, 1, 2].map((i) => dayPayload(addDays(now, i), labels[i], i === 0));
    return {
      version: 1,
      pushedAt: Date.now(),
      /* 跨天判断用：原生拿这个和系统日期比对 */
      dayKey: days[0].dayKey,
      days,
    };
  }

  let timer = null;
  function push(state) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        plugin.push({ payload: JSON.stringify(build(state)) }).catch(() => {});
      } catch (e) {}
    }, 300);
  }

  window.KB_WIDGET = { push, build };

  /* 首次进入推一次；从后台回来再推一次（可能在别处待了很久） */
  setTimeout(() => push(), 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) push();
  });
})();
