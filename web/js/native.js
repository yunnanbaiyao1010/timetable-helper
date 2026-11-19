/* =========================================================
   原生壳（Capacitor）适配：系统本地通知
   —— 只在 App 内生效，网页版会自动跳过
   ========================================================= */
(function () {
  const C = window.Capacitor;
  if (!C || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform()) return;
  const LN = C.Plugins && C.Plugins.LocalNotifications;
  if (!LN) return;

  const SIG_KEY = 'kb_native_sig';
  const IDS_KEY = 'kb_native_ids';
  const CH_CLASS = 'kb-class';
  const CH_DAILY = 'kb-daily';
  const DAILY_DAYS = 14;

  /* 课表 / 日程 / 设置一变，签名就变，提醒需要重排 */
  function sig() {
    const ev = (S.events || [])
      .filter((e) => e && (e.date || e.start))
      .map((e) => `${e.date || ''}|${e.start || ''}`)
      .sort();
    return JSON.stringify({
      start: S.semesterStart,
      lead: S.notifyLead,
      periods: periods(),
      courses: COURSES.length,
      events: ev,
      /* 汇总只排未来 14 天，跨天要重排，否则窗口不会往前滚 */
      dailyFrom: ymd(new Date()),
      ver: 3,
    });
  }

  /* 把整学期剩下的每一节课、每一条日程、每天的汇总都排成一条本地通知 */
  function buildNotifications() {
    const now = Date.now();
    const lead = (S.notifyLead || 15) * 60000;
    const cutoff = now + 60 * 1000;
    const out = [];
    let id = 1000;

    /* 1）课程 */
    for (let w = 1; w <= TOTAL_WEEKS; w++) {
      COURSES.forEach((c) => {
        c.sessions.forEach((s) => {
          if (!s.weeks.includes(w)) return;
          s.days.forEach((d) => {
            const day = addDays(parseYMD(S.semesterStart), (w - 1) * 7 + (d - 1));
            const st = atTime(day, pStart(s.periods[0]));
            const en = atTime(day, pEnd(s.periods[s.periods.length - 1]));
            const at = st.getTime() - lead;
            if (at < cutoff) return;
            out.push({
              id: id++,
              title: `${fmtClock(st)} ${c.name}`,
              body: `${fmtClock(st)}-${fmtClock(en)} · ${s.room} · ${c.teacher}`,
              schedule: { at: new Date(at), allowWhileIdle: true },
              channelId: CH_CLASS,
              extra: { courseId: c.id, room: s.room },
            });
          });
        });
      });
    }

    /* 2）日程：有开始时间按提前量，只有日期则当天 08:00 */
    (S.events || []).forEach((e) => {
      if (!e || !e.date) return;
      if (!e.start) {
        const at = atTime(parseYMD(e.date), '08:00').getTime();
        if (at < cutoff) return;
        out.push({
          id: id++,
          title: `今天有事：${e.title}`,
          body: e.place ? `${e.place}${e.note ? ' · ' + e.note : ''}` : (e.note || '打开课表助手看看安排'),
          schedule: { at: new Date(at), allowWhileIdle: true },
          channelId: CH_CLASS,
          extra: { eventId: e.id },
        });
        return;
      }
      const st = atTime(parseYMD(e.date), e.start);
      const en = e.end ? atTime(parseYMD(e.date), e.end) : null;
      const at = st.getTime() - lead;
      if (at < cutoff) return;
      out.push({
        id: id++,
        title: `${fmtClock(st)} ${e.title}`,
        body: `${fmtClock(st)}${en ? '-' + fmtClock(en) : ''}${e.place ? ' · ' + e.place : ' · 日程提醒'}`,
        schedule: { at: new Date(at), allowWhileIdle: true },
        channelId: CH_CLASS,
        extra: { eventId: e.id },
      });
    });

    /* 3）每天 07:30 的「今日汇总」：按天生成一次性通知，空天跳过 */
    for (let i = 0; i < DAILY_DAYS; i++) {
      const day = addDays(new Date(now), i);
      const at = atTime(day, '07:30');
      if (at.getTime() < cutoff) continue;
      const cls = sessionsOn(day);
      const evs = (S.events || []).filter((e) => e.date === ymd(day));
      if (!cls.length && !evs.length) continue;

      const periods = cls.reduce((a, it) => a + it.session.periods.length, 0);
      const names = cls.map((it) => it.course.name);
      const head = [periods ? `${periods} 节课` : '', evs.length ? `${evs.length} 件事` : '']
        .filter(Boolean).join(' · ');
      const bits = [];
      if (names.length) {
        bits.push(names.slice(0, 2).join('、') + (names.length > 2 ? ` 等 ${names.length} 门` : ''));
      }
      if (evs.length) bits.push(evs[0].title + (evs.length > 1 ? ' 等' : ''));

      out.push({
        id: id++,
        title: `今天：${head}`,
        body: bits.join(' · ') || '打开看看今天的安排',
        schedule: { at, allowWhileIdle: true },
        channelId: CH_DAILY,
        extra: { daily: ymd(day) },
      });
    }

    return out;
  }

  async function ensurePermission() {
    let p = await LN.checkPermissions();
    if (p.display !== 'granted') p = await LN.requestPermissions();
    return p.display === 'granted';
  }

  /* 渠道重要性创建后不可改，以后要调只能换新的 channel id */
  async function ensureChannels() {
    try {
      await LN.createChannel({
        id: CH_CLASS,
        name: '课程与日程提醒',
        description: '课前、日程开始前提醒时间地点',
        importance: 4,
        visibility: 1,
        vibration: true,
      });
    } catch (e) {}
    try {
      await LN.createChannel({
        id: CH_DAILY,
        name: '每日汇总',
        description: '每天早上 7:30 一句今日安排',
        importance: 2,
        visibility: 0,
        vibration: false,
      });
    } catch (e) {}
  }

  async function ensure(force) {
    const granted = await ensurePermission();
    if (!granted) return { granted: false, count: 0, cached: false };

    await ensureChannels();

    if (!force && localStorage.getItem(SIG_KEY) === sig()) {
      try {
        const pend = await LN.getPending();
        return { granted: true, count: pend.notifications.length, cached: true };
      } catch (e) {}
    }

    const oldIds = JSON.parse(localStorage.getItem(IDS_KEY) || '[]');
    if (oldIds.length) {
      try { await LN.cancel({ notifications: oldIds.map((id) => ({ id })) }); } catch (e) {}
    }

    const list = buildNotifications();
    for (let i = 0; i < list.length; i += 40) {
      await LN.schedule({ notifications: list.slice(i, i + 40) });
    }
    localStorage.setItem(SIG_KEY, sig());
    /* 所有排进去的 id 都要登记，否则重排时取消不干净 */
    localStorage.setItem(IDS_KEY, JSON.stringify(list.map((n) => n.id)));
    return { granted: true, count: list.length, cached: false };
  }

  async function clear() {
    const ids = JSON.parse(localStorage.getItem(IDS_KEY) || '[]');
    if (ids.length) {
      try { await LN.cancel({ notifications: ids.map((id) => ({ id })) }); } catch (e) {}
    }
    localStorage.removeItem(SIG_KEY);
    localStorage.removeItem(IDS_KEY);
    return { granted: true, count: 0, cached: false };
  }

  /* 诊断用：10 秒后发一条，验证权限 / 渠道 / 锁屏提醒整条链路 */
  async function test() {
    const granted = await ensurePermission();
    if (!granted) return { granted: false };
    await ensureChannels();
    try {
      await LN.schedule({
        notifications: [{
          id: 990001,
          title: '测试通知',
          body: '10 秒后收到，说明通知链路是通的',
          schedule: { at: new Date(Date.now() + 10000), allowWhileIdle: true },
          channelId: CH_CLASS,
        }],
      });
      return { granted: true };
    } catch (e) {
      return { granted: true, error: String(e && e.message || e) };
    }
  }

  window.KB_NATIVE = {
    supported: true,
    ensure,
    clear,
    test,
    async status() {
      try {
        const p = await LN.checkPermissions();
        const pend = p.display === 'granted' ? await LN.getPending() : { notifications: [] };
        return { granted: p.display === 'granted', count: pend.notifications.length };
      } catch (e) {
        return { granted: false, count: 0 };
      }
    },
  };

  /* 首次进入静默排期（会弹一次系统授权） */
  setTimeout(() => {
    ensure(false).catch(() => {});
  }, 1200);
})();
