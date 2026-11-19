/* =========================================================
   课表助手 · 主逻辑
   ========================================================= */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const KEY = 'kb_schedule_v1';
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const isoDay = (d) => (d.getDay() === 0 ? 7 : d.getDay());
const parseYMD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const WEEK_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/* ---------------------------------------------------------
   数据契约：S.events[] —— 一条「某天某时刻的一件事」
   {
     id: 'e1699999999999',
     title: '交实验报告',
     date: 'YYYY-MM-DD' | null,   // null = 连日期都不知道，进「今日待定」
     start: 'HH:mm' | null,       // null = 只知道日期
     end: 'HH:mm' | null,
     place, note, bring: [],
     source: 'ai' | 'manual',
     confidence: 0~1,
     raw: '原文片段',
     rawHash: '判重用',
     created: 1699999999999
   }
   --------------------------------------------------------- */

const DEFAULT_STATE = {
  semesterStart: '2026-08-31',
  notifyLead: 15,
  focusMinutes: 25,
  tasks: [],
  focusLog: [],
  events: [],
  ai: { baseUrl: '', model: '', apiKey: '' },
  notified: {},
  periods: null,
};

let S = loadState();
let view = 'viewToday';
let weekOffset = 0;
let timer = null;

function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    const st = raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : { ...DEFAULT_STATE };
    if (!Array.isArray(st.tasks)) st.tasks = [];
    if (!Array.isArray(st.events)) st.events = [];
    st.events = st.events.filter((e) => e && typeof e === 'object' && e.id);
    st.ai = { ...DEFAULT_STATE.ai, ...(st.ai && typeof st.ai === 'object' ? st.ai : {}) };
    return st;
  } catch (e) {
    return { ...DEFAULT_STATE, ai: { ...DEFAULT_STATE.ai } };
  }
}
function save() {
  /* 只保留最近 30 天的事件；date 未知的按 created 判断，避免待定区无限增长 */
  const cutoff = Date.now() - 30 * 86400000;
  S.events = (S.events || []).filter((e) => {
    const okDate = /^\d{4}-\d{2}-\d{2}$/.test(e.date || '');
    const t = okDate ? parseYMD(e.date).getTime() : (e.created || 0);
    return t >= cutoff;
  });
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  /* 阶段 2 填充：向原生推小组件镜像 */
  if (window.KB_WIDGET && typeof window.KB_WIDGET.push === 'function') window.KB_WIDGET.push(S);
}

/* 数据变更后重排系统通知（网页版没有 KB_NATIVE，自动跳过） */
function rescheduleNative() {
  if (window.KB_NATIVE && typeof window.KB_NATIVE.ensure === 'function') {
    window.KB_NATIVE.ensure(true).catch(() => {});
  }
}

/* ---------------- 时间与课表核心 ---------------- */

function periods() { return (S.periods && S.periods.length === 10) ? S.periods : PERIODS; }

function atTime(date, str) {
  const [h, m] = str.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}
function pStart(n) { return periods()[n - 1].start; }
function pEnd(n) { return periods()[n - 1].end; }

function weekOf(date) {
  const start = parseYMD(S.semesterStart);
  const diff = Math.floor((startOfDay(date) - startOfDay(start)) / 86400000);
  return Math.floor(diff / 7) + 1;
}
function mondayOfWeek(w) {
  return addDays(parseYMD(S.semesterStart), (w - 1) * 7);
}
function dateInWeek(w, day) {
  return addDays(mondayOfWeek(w), day - 1);
}

/* 某一天上哪些课（已按节次排序） */
function sessionsOn(date) {
  const w = weekOf(date);
  const day = isoDay(date);
  const out = [];
  COURSES.forEach((c) => {
    c.sessions.forEach((s) => {
      if (s.days.includes(day) && s.weeks.includes(w)) out.push({ course: c, session: s });
    });
  });
  return out.sort((a, b) => a.session.periods[0] - b.session.periods[0]);
}

/* 某一周的全部课，返回 {course, session, day} */
function sessionsInWeek(w) {
  const out = [];
  COURSES.forEach((c) => {
    c.sessions.forEach((s) => {
      if (s.weeks.includes(w)) s.days.forEach((d) => out.push({ course: c, session: s, day: d }));
    });
  });
  return out;
}
function weekLoad(w) {
  return sessionsInWeek(w).reduce((sum, it) => sum + it.session.periods.length, 0);
}

function sessionStartAt(date, session) { return atTime(date, pStart(session.periods[0])); }
function sessionEndAt(date, session) { return atTime(date, pEnd(session.periods[session.periods.length - 1])); }

function fmtClock(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function fmtSpan(start, end) { return `${fmtClock(start)} - ${fmtClock(end)}`; }
function durText(ms) {
  const total = Math.round(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h} 小时 ${m} 分`;
  if (h) return `${h} 小时`;
  return `${m} 分钟`;
}
function countdownText(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}
function periodSpanText(periodsArr) {
  const a = periodsArr[0];
  const b = periodsArr[periodsArr.length - 1];
  return a === b ? `第 ${a} 节` : `第 ${a}-${b} 节`;
}

/* ---------------- 顶部 ---------------- */

function renderHeader() {
  const now = new Date();
  const w = weekOf(now);
  const shown = clamp(w, 1, TOTAL_WEEKS);
  $('#weekBadge').textContent = w < 1 ? '未开学' : w > TOTAL_WEEKS ? '学期结束' : `第 ${w} 周`;
  const md = `${now.getMonth() + 1}月${now.getDate()}日 ${WEEK_NAMES[isoDay(now)]}`;
  $('#semesterMeta').textContent = `2026-2027 学年 · ${md}`;
  const pct = clamp(Math.round((shown / TOTAL_WEEKS) * 100), 0, 100);
  $('#progressFill').style.width = pct + '%';
  $('#progressLeft').textContent = `学期进度 ${pct}%`;
  $('#progressRight').textContent = w < 1 ? '即将开学' : `还剩 ${Math.max(0, TOTAL_WEEKS - w + 1)} 周`;
}

/* ---------------- 今日 ---------------- */

/* 当天带时间的日程（date 未知的进「今日待定」，不参与排序） */
function eventsOn(date) {
  const key = ymd(date);
  return (S.events || []).filter((e) => e.date === key && e.start);
}
function pendingEvents() {
  return (S.events || []).filter((e) => !e.date);
}

function buildTimeline(date) {
  const classes = sessionsOn(date).map((it) => ({
    ...it,
    type: 'class',
    start: sessionStartAt(date, it.session),
    end: sessionEndAt(date, it.session),
  }));
  const events = eventsOn(date).map((e) => ({
    type: 'event',
    ev: e,
    start: atTime(date, e.start),
    end: e.end ? atTime(date, e.end) : atTime(date, e.start),
  }));

  /* 合并排序：课程与日程同一条时间轴，不裁剪任何条目 */
  const list = classes.concat(events).sort((a, b) => a.start - b.start);

  /* 窗口至少覆盖 07:40~21:30，早到/晚到的事件自动把边界撑开 */
  let winStart = atTime(date, '07:40').getTime();
  let winEnd = atTime(date, '21:30').getTime();
  list.forEach((it) => {
    winStart = Math.min(winStart, it.start.getTime());
    winEnd = Math.max(winEnd, it.end.getTime());
  });

  const items = [];
  let cursor = new Date(winStart);
  list.forEach((it) => {
    if (it.start - cursor >= 50 * 60000) items.push({ type: 'gap', start: new Date(cursor), end: it.start });
    items.push(it);
    /* 条目可能互相重叠，cursor 只能往后走 */
    if (it.end > cursor) cursor = new Date(it.end);
  });
  if (winEnd - cursor >= 50 * 60000) items.push({ type: 'gap', start: new Date(cursor), end: new Date(winEnd) });
  return items;
}

function todayAlerts(list) {
  const out = [];
  const trainingItems = list.filter((it) => it.session.type === '实训');
  if (trainingItems.length) {
    out.push({ kind: 'warn', text: `<b>校内实训周</b>：今天 ${trainingItems.length} 门课转为校内实训，教室不再是四维 / 仁爱楼，留意老师通知的集合点。` });
  }
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i];
    const b = list[i + 1];
    if (a.session.building === b.session.building) continue;
    if (a.session.building === '无楼号' || b.session.building === '无楼号') continue;
    const gapMin = (b.start - a.end) / 60000;
    const walk = (BUILDING_WALK[a.session.building] || {})[b.session.building] || 8;
    if (gapMin <= 30) {
      out.push({
        kind: 'warn',
        text: `<b>要换楼</b>：${fmtClock(a.end)} 在 ${a.session.building}，${fmtClock(b.start)} 要去 ${b.session.building}（${b.session.room}），中间只有 ${Math.round(gapMin)} 分钟，步行约 ${walk} 分钟，别拖堂。`,
      });
    } else if (gapMin <= 480) {
      out.push({
        kind: 'info',
        text: `<b>下一节换楼</b>：${b.course.name} 在 ${b.session.building} ${b.session.room}，从 ${a.session.building} 步行约 ${walk} 分钟，中间有 ${durText(gapMin * 60000)} 可以吃个饭。`,
      });
    }
  }
  return out;
}

function renderToday() {
  const now = new Date();
  const list = buildTimeline(now);
  const classes = list.filter((it) => it.type === 'class');
  const dayEvents = list.filter((it) => it.type === 'event');

  /* 提示（周次校准入口已移到设置页） */
  const banners = todayAlerts(classes);
  $('#alertSlot').innerHTML = banners.map((a) => `<div class="alert ${a.kind}">${a.text}</div>`).join('');

  /* 大卡：当前 / 下一节 */
  const cur = classes.find((it) => now >= it.start && now < it.end);
  const next = classes.find((it) => it.start > now);
  const hero = $('#heroSlot');

  if (cur) {
    const c = cur.course;
    hero.innerHTML = `
      <div class="hero t-${c.theme}">
        <div class="hero-top"><span>正在上课 · ${periodSpanText(cur.session.periods)}</span><span>${fmtClock(cur.start)} 开始</span></div>
        <div class="hero-name">${c.name}</div>
        <div class="hero-meta">
          <span>${cur.session.room}</span><span>${c.teacher}</span><span>${cur.session.type}</span>
        </div>
        <div class="hero-timer"><span class="num" id="heroNum">--:--</span><span class="txt">后下课</span></div>
      </div>`;
    hero.dataset.kind = 'now';
    hero.dataset.endAt = cur.end.getTime();
  } else if (next) {
    const c = next.course;
    const walkHint = buildingHint(now, next);
    hero.innerHTML = `
      <div class="hero t-${c.theme}">
        <div class="hero-top"><span>下一节 · ${periodSpanText(next.session.periods)}</span><span>${fmtClock(next.start)} 上课</span></div>
        <div class="hero-name">${c.name}</div>
        <div class="hero-meta">
          <span>${next.session.room}</span><span>${c.teacher}</span><span>${next.session.building}</span>
        </div>
        <div class="hero-timer"><span class="num" id="heroNum">--:--</span><span class="txt">后开始</span>${walkHint}</div>
      </div>`;
    hero.dataset.kind = 'next';
    hero.dataset.startAt = next.start.getTime();
  } else {
    const tomorrow = tomorrowFirst(now);
    const sub = dayEvents.length
      ? `今天有 ${dayEvents.length} 个日程，见下方时间线`
      : (tomorrow || '接下来几天都没有课，安排点自己的事吧');
    hero.innerHTML = `
      <div class="hero-empty">
        <div class="big">${classes.length ? '今天的课上完了' : '今天没有课'}</div>
        <div class="sub">${sub}</div>
      </div>`;
    hero.dataset.kind = 'none';
  }

  /* 时间轴 */
  const tl = list.map((it) => {
    if (it.type === 'gap') {
      const planned = plannedInGap(now, it.start, it.end);
      const isAllDay = it.start.getHours() <= 7 && it.end.getHours() >= 21;
      return `
        <div class="tl-item">
          <div class="tl-time">${isAllDay ? '全天' : fmtClock(it.start)}</div>
          <div class="tl-line"></div>
          <div class="tl-body">
            <div class="gap">
              <div class="gap-info">
                <div class="n">${isAllDay ? '全天无课' : `空档 ${durText(it.end - it.start)}`}</div>
                <div class="m">${fmtClock(it.start)} - ${fmtClock(it.end)}</div>
                ${planned.length ? `<div class="gap-plan">已排：${planned.map((t) => esc(t.title)).join('、')}</div>` : ''}
              </div>
              <button class="gap-btn" data-act="planGap" data-start="${it.start.getTime()}" data-end="${it.end.getTime()}">排任务</button>
            </div>
          </div>
        </div>`;
    }
    if (it.type === 'event') {
      const e = it.ev;
      const past = now > it.end;
      const isNow = !!(e.end && now >= it.start && now < it.end);
      return `
        <div class="tl-item">
          <div class="tl-time">${fmtClock(it.start)}</div>
          <div class="tl-line t-event"></div>
          <div class="tl-body">
            <div class="slot t-event ${past ? 'is-past' : ''} ${isNow ? 'is-now' : ''}" data-act="event" data-id="${e.id}">
              <div class="n">${esc(e.title)}</div>
              <div class="m">
                <span>${e.end ? fmtSpan(it.start, it.end) : fmtClock(it.start)}</span>
                ${e.place ? `<span>${esc(e.place)}</span>` : ''}
                ${e.source === 'ai' ? '<span class="tag">识图</span>' : ''}
              </div>
            </div>
          </div>
        </div>`;
    }
    const c = it.course;
    const past = now > it.end;
    const isNow = now >= it.start && now < it.end;
    const dueTasks = pendingTasksFor(c.id).length;
    return `
      <div class="tl-item">
        <div class="tl-time">${fmtClock(it.start)}</div>
        <div class="tl-line t-${c.theme}"></div>
        <div class="tl-body">
          <div class="slot t-${c.theme} ${past ? 'is-past' : ''} ${isNow ? 'is-now' : ''}" data-act="course" data-course="${c.id}">
            <div class="n">${c.name}</div>
            <div class="m">
              <span>${fmtSpan(it.start, it.end)}</span>
              <span>${it.session.room}</span>
              <span>${c.teacher}</span>
              <span class="tag">${it.session.type}</span>
              ${dueTasks ? `<span class="tag">待办 ${dueTasks}</span>` : ''}
            </div>
          </div>
        </div>
      </div>`;
  }).join('');

  const pending = pendingEvents();
  const pendingBlock = pending.length ? `
    <div class="sec-title">今日待定 · ${pending.length}</div>
    <div class="card" style="padding:4px 14px">
      ${pending.map((e) => `
        <div class="ev-row" data-act="event" data-id="${e.id}">
          <div class="ev-when">待定</div>
          <div class="ev-main">
            <div class="n">${esc(e.title)}</div>
            <div class="m">${e.place ? esc(e.place) : '点开补上日期和时间'}</div>
          </div>
        </div>`).join('')}
    </div>` : '';

  $('#todayTimeline').innerHTML = `
    <div class="sec-title">今天 · ${WEEK_NAMES[isoDay(now)]} · 共 ${classes.reduce((a, it) => a + it.session.periods.length, 0)} 节${dayEvents.length ? ` · ${dayEvents.length} 个日程` : ''}</div>
    <div class="tl">${tl}</div>
    ${pendingBlock}
    <button class="btn ev-add" data-act="eventNew">+ 加一件事</button>
    ${classes.length ? '' : upcomingCard(now)}`;

  renderFocusCard();
  renderTodayTasks();
  tick();
}

/* 没课的日子给个“接下来几天”的预告 */
function upcomingCard(now) {
  const days = [];
  for (let i = 1; i <= 7 && days.length < 3; i++) {
    const d = addDays(now, i);
    const list = sessionsOn(d);
    if (list.length) days.push({ d, list });
  }
  if (!days.length) return '';
  return `
    <div class="sec-title">接下来几天</div>
    <div class="card" style="padding:6px 16px">
      ${days.map(({ d, list }) => `
        <div style="padding:11px 0;border-bottom:0.5px solid var(--line)">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--ink3);margin-bottom:6px">
            <span>${WEEK_NAMES[isoDay(d)]} · ${d.getMonth() + 1}/${d.getDate()}</span>
            <span>${list.reduce((a, it) => a + it.session.periods.length, 0)} 节</span>
          </div>
          ${list.map((it) => `
            <div class="slot t-${it.course.theme}" style="margin-bottom:5px;padding:8px 11px" data-act="course" data-course="${it.course.id}">
              <div class="n" style="font-size:13.5px">${it.course.name}</div>
              <div class="m"><span>${fmtClock(sessionStartAt(d, it.session))}</span><span>${it.session.room}</span><span>${it.course.teacher}</span></div>
            </div>`).join('')}
        </div>`).join('')}
    </div>`;
}

function buildingHint(now, next) {
  const curList = sessionsOn(now).filter((it) => sessionEndAt(now, it.session) <= now);
  if (!curList.length) return '';
  const last = curList[curList.length - 1];
  if (last.session.building === next.session.building) return '';
  if (last.session.building === '无楼号' || next.session.building === '无楼号') return '';
  const walk = (BUILDING_WALK[last.session.building] || {})[next.session.building] || 8;
  return `<span class="pill warn">换楼 约 ${walk} 分钟</span>`;
}

function tomorrowFirst(now) {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(now, i);
    const list = sessionsOn(d);
    if (list.length) {
      const s = list[0];
      const when = i === 1 ? '明天' : i === 2 ? '后天' : WEEK_NAMES[isoDay(d)];
      return `${when} 第一节 ${fmtClock(sessionStartAt(d, s.session))} ${s.course.name} · ${s.session.room}`;
    }
  }
  return '';
}

function plannedInGap(date, start, end) {
  return S.tasks.filter((t) => !t.done && t.plan && t.plan.date === ymd(date) &&
    t.plan.start >= start.getTime() && t.plan.end <= end.getTime());
}

/* ---------------- 待办 ---------------- */

function pendingTasksFor(courseId) {
  return S.tasks.filter((t) => !t.done && t.courseId === courseId);
}

function taskDueInfo(t) {
  if (!t.due) return { text: '无期限', over: false };
  const today = startOfDay(new Date());
  const due = parseYMD(t.due);
  const diff = Math.round((due - today) / 86400000);
  if (diff < 0) return { text: `逾期 ${-diff} 天`, over: true };
  if (diff === 0) return { text: '今天到期', over: true };
  if (diff === 1) return { text: '明天到期', over: false };
  return { text: `${diff} 天后`, over: false };
}

function renderTaskList() {
  const box = $('#taskList');
  const open = S.tasks.filter((t) => !t.done);
  const done = S.tasks.filter((t) => t.done);
  const today = startOfDay(new Date());
  const groups = [
    { key: 'over', title: '已逾期', items: [] },
    { key: 'today', title: '今天', items: [] },
    { key: 'week', title: '本周内', items: [] },
    { key: 'later', title: '以后', items: [] },
    { key: 'none', title: '没有期限', items: [] },
  ];
  open.forEach((t) => {
    if (!t.due) return groups[4].items.push(t);
    const diff = Math.round((parseYMD(t.due) - today) / 86400000);
    if (diff < 0) groups[0].items.push(t);
    else if (diff === 0) groups[1].items.push(t);
    else if (diff <= 6) groups[2].items.push(t);
    else groups[3].items.push(t);
  });

  const card = (t) => {
    const c = COURSES.find((x) => x.id === t.courseId);
    const due = taskDueInfo(t);
    return `
      <div class="task ${t.done ? 'is-done' : ''}" data-id="${t.id}">
        <button class="check ${t.done ? 'on' : ''}" data-act="toggleTask" data-id="${t.id}" aria-label="完成">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11"></path></svg>
        </button>
        <div class="task-main">
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-meta">
            ${c ? `<span class="chip t-${c.theme}">${c.short || c.name}</span>` : ''}
            <span class="chip ${due.over ? 'over' : 'due'}">${due.text}</span>
            ${t.plan ? `<span class="chip plan">已排 ${new Date(t.plan.start).getMonth() + 1}/${new Date(t.plan.start).getDate()} ${fmtClock(new Date(t.plan.start))}</span>` : ''}
          </div>
        </div>
        <button class="task-del" data-act="delTask" data-id="${t.id}" aria-label="删除">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"></path></svg>
        </button>
      </div>`;
  };

  let html = '';
  groups.forEach((g) => {
    if (!g.items.length) return;
    html += `<div class="task-group-title">${g.title} · ${g.items.length}</div>`;
    html += g.items.map(card).join('');
  });
  if (done.length) {
    html += `<div class="task-group-title">已完成 · ${done.length}</div>` + done.map(card).join('');
  }
  if (!S.tasks.length) html = `<div class="empty">还没有待办。上面加一条，或者点课程卡片里的“添加待办”。</div>`;
  box.innerHTML = html;
}

function renderTodayTasks() {
  const open = S.tasks.filter((t) => !t.done);
  const box = $('#todayTasks');
  if (!open.length) { box.innerHTML = ''; return; }
  const soon = open.slice().sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : 1).slice(0, 3);
  box.innerHTML = `
    <div class="sec-title">待办 · ${open.length} 件未完成</div>
    ${soon.map((t) => {
      const c = COURSES.find((x) => x.id === t.courseId);
      const due = taskDueInfo(t);
      return `<div class="task" data-id="${t.id}">
        <button class="check" data-act="toggleTask" data-id="${t.id}" aria-label="完成">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11"></path></svg>
        </button>
        <div class="task-main">
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-meta">
            ${c ? `<span class="chip t-${c.theme}">${c.short || c.name}</span>` : ''}
            <span class="chip ${due.over ? 'over' : 'due'}">${due.text}</span>
          </div>
        </div>
      </div>`;
    }).join('')}`;
}

/* ---------------- 专注计时 ---------------- */

function focusState() {
  const running = S.focus && S.focus.endsAt && S.focus.endsAt > Date.now();
  const total = (S.focus && S.focus.minutes || S.focusMinutes) * 60000;
  const left = running ? S.focus.endsAt - Date.now() : total;
  return { running, total, left };
}

function renderFocusCard() {
  const st = focusState();
  const totalMin = Math.round(st.total / 60000);
  const course = COURSES.find((c) => c.id === (S.focus && S.focus.courseId));
  const todayMin = focusMinutesOn(new Date());
  const C = 2 * Math.PI * 26;
  const ratio = clamp(st.left / st.total, 0, 1);
  $('#focusSlot').innerHTML = `
    <div class="card focus-card">
      <div class="focus-ring">
        <svg width="62" height="62" viewBox="0 0 62 62">
          <circle cx="31" cy="31" r="26" style="stroke:var(--bg-soft)" stroke-width="5" fill="none"></circle>
          <circle id="focusArc" cx="31" cy="31" r="26" style="stroke:var(--accent)" stroke-width="5" fill="none"
            stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - ratio)).toFixed(1)}"></circle>
        </svg>
        <div class="focus-num" id="focusNum">${Math.ceil(st.left / 60000)}'</div>
      </div>
      <div class="focus-body">
        <div class="t">专注 ${totalMin} 分钟</div>
        <div class="s">${course ? esc(course.name) : '未选课程'} · 今天已专注 ${todayMin} 分钟</div>
        <div class="focus-actions">
          ${st.running
            ? `<button class="small-btn" data-act="focusStop">结束并记录</button>`
            : `<button class="small-btn primary" data-act="focusStart">开始</button>`}
          <button class="small-btn" data-act="focusPick">选课程</button>
        </div>
      </div>
    </div>`;
}

function focusMinutesOn(date) {
  return S.focusLog.filter((f) => f.date === ymd(date)).reduce((a, f) => a + f.minutes, 0);
}

function startFocus(courseId) {
  S.focus = { endsAt: Date.now() + S.focusMinutes * 60000, minutes: S.focusMinutes, courseId: courseId || null };
  save();
  renderFocusCard();
  toast('专注开始，' + S.focusMinutes + ' 分钟后提醒你');
}

function stopFocus() {
  if (!S.focus || !S.focus.endsAt) return;
  const total = S.focus.minutes * 60000;
  const left = Math.max(0, S.focus.endsAt - Date.now());
  const used = Math.max(1, Math.round((total - left) / 60000));
  S.focusLog.push({ id: 'f' + Date.now(), courseId: S.focus.courseId || null, minutes: used, date: ymd(new Date()) });
  S.focus = null;
  save();
  renderFocusCard();
  if (view === 'viewStats') renderStats();
  toast(`已记录专注 ${used} 分钟`);
}

/* ---------------- 周表 ---------------- */

function renderWeek() {
  const now = new Date();
  const w = clamp(weekOf(now) + weekOffset, 1, TOTAL_WEEKS);
  const mon = mondayOfWeek(w);
  const sun = addDays(mon, 6);
  $('#weekTitle').textContent = `第 ${w} 周`;
  $('#weekSummary').innerHTML =
    `${mon.getMonth() + 1}/${mon.getDate()} – ${sun.getMonth() + 1}/${sun.getDate()} · 共 ${weekLoad(w)} 节` +
    (w === weekOf(now) ? ' · 本周' : '') +
    '<span class="swipe-hint">左右滑动看完整一周</span>';
  $('#weekBack').style.visibility = weekOffset === 0 ? 'hidden' : 'visible';

  const tt = $('#timetable');
  const parts = [];
  parts.push('<div class="tt-h" style="grid-column:1;grid-row:1"></div>');
  for (let d = 1; d <= 7; d++) {
    const isToday = weekOffset === 0 && isoDay(now) === d;
    parts.push(`<div class="tt-h ${isToday ? 'is-today' : ''}" style="grid-column:${d + 1};grid-row:1">${WEEK_NAMES[d]}</div>`);
  }
  for (let p = 1; p <= 10; p++) {
    parts.push(`<div class="tt-n" style="grid-column:1;grid-row:${p + 1}">${p}</div>`);
    for (let d = 1; d <= 7; d++) {
      parts.push(`<div class="tt-cell ${d >= 6 ? 'is-weekend' : ''}" style="grid-column:${d + 1};grid-row:${p + 1}"></div>`);
    }
  }

  sessionsInWeek(w).forEach((it) => {
    const c = it.course;
    const p0 = it.session.periods[0];
    const len = it.session.periods.length;
    if (p0 + len - 1 > 10) return;
    parts.push(`
      <div class="tt-block t-${c.theme} ${len >= 3 ? 'tall' : ''}" data-act="course" data-course="${c.id}"
        style="grid-column:${it.day + 1};grid-row:${p0 + 1}/span ${len}">
        <div class="n">${c.short || c.name}</div>
        <div class="m">${it.session.room}</div>
        ${len >= 3 ? `<div class="m">${it.session.type}</div>` : ''}
        <div class="type">${len > 2 ? len + '节' : ''}</div>
      </div>`);
  });

  tt.innerHTML = parts.join('');

  $('#legend').innerHTML = COURSES.map(
    (c) => `<div class="legend-item t-${c.theme}"><span class="legend-dot"></span>${c.name}</div>`
  ).join('');
}

/* ---------------- 统计 ---------------- */

function renderStats() {
  const now = new Date();
  const w = clamp(weekOf(now), 1, TOTAL_WEEKS);
  const totalPeriods = COURSES.reduce(
    (sum, c) => sum + c.sessions.reduce((s2, s) => s2 + s.weeks.length * s.periods.length, 0), 0
  );
  const doneCount = S.tasks.filter((t) => t.done).length;
  const totalFocus = S.focusLog.reduce((a, f) => a + f.minutes, 0);

  const byCourse = COURSES.map((c) => ({
    c,
    periods: c.sessions.reduce((s2, s) => s2 + s.weeks.length * s.periods.length, 0),
  })).sort((a, b) => b.periods - a.periods);
  const maxPeriods = Math.max(1, ...byCourse.map((x) => x.periods));

  const focusByCourse = {};
  S.focusLog.forEach((f) => { focusByCourse[f.courseId || 'none'] = (focusByCourse[f.courseId || 'none'] || 0) + f.minutes; });

  const bars = [];
  let maxLoad = 1;
  for (let i = 1; i <= TOTAL_WEEKS; i++) maxLoad = Math.max(maxLoad, weekLoad(i));
  for (let i = 1; i <= TOTAL_WEEKS; i++) {
    const load = weekLoad(i);
    bars.push(`<div class="bar-wrap">
      <div class="bar ${i === w ? 'cur' : ''}" style="height:${Math.max(3, (load / maxLoad) * 88)}%" title="第${i}周 ${load}节"></div>
      <div class="bar-lbl ${i === w ? 'cur' : ''}">${i}</div>
    </div>`);
  }

  $('#statsBody').innerHTML = `
    <div class="stat-grid">
      <div class="metric"><div class="k">本周课时</div><div class="v">${weekLoad(w)}</div><div class="s">节 · 第 ${w} 周</div></div>
      <div class="metric"><div class="k">全学期课时</div><div class="v">${totalPeriods}</div><div class="s">节 · 8 门课</div></div>
      <div class="metric"><div class="k">累计专注</div><div class="v">${totalFocus}</div><div class="s">分钟 · ${S.focusLog.length} 次</div></div>
      <div class="metric"><div class="k">待办完成</div><div class="v">${doneCount}/${S.tasks.length}</div><div class="s">${S.tasks.length ? Math.round((doneCount / S.tasks.length) * 100) + '%' : '还没有待办'}</div></div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">每周课时分布</div><div class="s" style="font-size:11px;color:var(--ink3)">第 ${w} 周已高亮</div></div>
      <div class="chart">${bars.join('')}</div>
      <div style="font-size:11.5px;color:var(--ink3);margin-top:10px;line-height:1.6">
        前 8 周约 20 节，第 9 周起下午实训加入后升到 24-28 节（第 12 周最重），
        第 13 周后课程陆续结束，腾出大块复习时间。
      </div>
    </div>

    <div class="card">
      <div class="card-title">各课程学期总课时</div>
      ${byCourse.map((x) => `
        <div class="ratio-row t-${x.c.theme}">
          <div class="ratio-name">${x.c.name}</div>
          <div class="ratio-track"><div class="ratio-fill" style="width:${(x.periods / maxPeriods) * 100}%"></div></div>
          <div class="ratio-val">${x.periods}</div>
        </div>`).join('')}
    </div>

    <div class="card">
      <div class="card-title">专注时间分布</div>
      ${Object.keys(focusByCourse).length
        ? Object.entries(focusByCourse).sort((a, b) => b[1] - a[1]).map(([id, min]) => {
            const c = COURSES.find((x) => x.id === id);
            const maxF = Math.max(...Object.values(focusByCourse));
            return `<div class="ratio-row ${c ? 't-' + c.theme : ''}">
              <div class="ratio-name">${c ? c.short || c.name : '未分类'}</div>
              <div class="ratio-track"><div class="ratio-fill" style="width:${(min / maxF) * 100}%"></div></div>
              <div class="ratio-val">${min}m</div>
            </div>`;
          }).join('')
        : '<div class="empty">还没有专注记录，从“今日”里的计时器开始</div>'}
    </div>

    <div class="card">
      <div class="card-title">空档规律</div>
      <div style="font-size:13px;color:var(--ink2);line-height:1.75">
        周三上午、周四上午、周五下午到晚上是每周最稳定的三块整时间，
        周末完全空。这些时段适合放需要连续投入的事（实训项目、大作业、复习），
        不建议拆成碎片。
      </div>
    </div>`;
}

/* ---------------- 设置 / 弹层 ---------------- */

function openSheet(html) {
  $('#sheetBody').innerHTML = html;
  $('#sheet').classList.add('on');
  $('#sheetMask').classList.add('on');
}
function closeSheet() {
  $('#sheet').classList.remove('on');
  $('#sheetMask').classList.remove('on');
}

function courseSheet(id) {
  const c = COURSES.find((x) => x.id === id);
  if (!c) return;
  const w = weekOf(new Date());
  const weeksOn = new Set();
  c.sessions.forEach((s) => s.weeks.forEach((x) => weeksOn.add(x)));
  const rooms = [...new Set(c.sessions.map((s) => s.room))];
  const times = c.sessions
    .map((s) => `${s.days.map((d) => WEEK_NAMES[d]).join('/')} ${periodSpanText(s.periods)}`)
    .filter((v, i, a) => a.indexOf(v) === i);
  const tasks = S.tasks.filter((t) => t.courseId === c.id);

  openSheet(`
    <div class="sheet-h">
      <div>
        <h3>${c.name}</h3>
        <div class="sub">${c.teacher} · ${rooms.join(' / ')}</div>
      </div>
      <span class="chip t-${c.theme}" style="padding:5px 10px">${c.sessions[0].type}</span>
    </div>
    <div class="kv"><div class="k">上课时间</div><div class="v">${times.join('<br>')}</div></div>
    <div class="kv"><div class="k">教室</div><div class="v">${c.sessions.map((s) => `${s.room}（${s.building}）`).filter((v, i, a) => a.indexOf(v) === i).join('<br>')}</div></div>
    <div class="kv"><div class="k">周次</div><div class="v">
      <div class="week-chips t-${c.theme}">
        ${range(1, TOTAL_WEEKS).map((i) => `<div class="wc ${weeksOn.has(i) ? 'on' : ''} ${i === w ? 'cur' : ''}">${i}</div>`).join('')}
      </div>
    </div></div>
    <div class="kv"><div class="k">本课待办</div><div class="v">
      ${tasks.length
        ? tasks.map((t) => `<div style="display:flex;gap:8px;align-items:center;padding:3px 0">
            <span style="flex:1;${t.done ? 'text-decoration:line-through;opacity:.5' : ''}">${esc(t.title)}</span>
            <span class="chip ${taskDueInfo(t).over ? 'over' : 'due'}">${taskDueInfo(t).text}</span>
          </div>`).join('')
        : '<span style="color:var(--ink3);font-size:12.5px">暂无</span>'}
    </div></div>
    <div style="display:flex;gap:9px;margin-top:16px">
      <button class="btn" data-act="addTaskFor" data-course="${c.id}">加待办</button>
      <button class="btn btn-primary" data-act="focusStartFor" data-course="${c.id}">开始专注</button>
    </div>`);
}

/* 日程：新建 / 编辑 / 删除 */
function eventSheet(id) {
  const old = id ? (S.events || []).find((x) => x.id === id) : null;
  const e = old || {
    id: '', title: '', date: ymd(new Date()), start: '', end: '',
    place: '', note: '',
  };
  openSheet(`
    <div class="sheet-h">
      <div>
        <h3>${old ? '编辑日程' : '新建日程'}</h3>
        <div class="sub">只有日期 = 当天提醒；带时间会按时间提醒</div>
      </div>
    </div>
    <div class="setting-row">
      <div class="lbl" style="width:56px">标题</div>
      <input class="input" id="evTitle" value="${esc(e.title)}" placeholder="比如：交实验报告">
    </div>
    <div class="setting-row">
      <div class="lbl" style="width:56px">日期</div>
      <input class="input" type="date" id="evDate" value="${e.date || ''}">
    </div>
    <div class="setting-row">
      <div class="lbl" style="width:56px">时间</div>
      <div style="display:flex;gap:6px;align-items:center">
        <input class="input" type="time" id="evStart" value="${e.start || ''}" style="width:112px">
        <span style="color:var(--ink3)">-</span>
        <input class="input" type="time" id="evEnd" value="${e.end || ''}" style="width:112px">
      </div>
    </div>
    <div class="setting-row">
      <div class="lbl" style="width:56px">地点</div>
      <input class="input" id="evPlace" value="${esc(e.place || '')}" placeholder="可不填">
    </div>
    <div class="setting-row">
      <div class="lbl" style="width:56px">备注</div>
      <input class="input" id="evNote" value="${esc(e.note || '')}" placeholder="可不填">
    </div>
    <div style="display:flex;gap:9px;margin-top:16px">
      <button class="btn btn-primary" data-act="eventSave" data-id="${e.id}">保存</button>
      ${old ? `<button class="btn" data-act="eventDel" data-id="${e.id}" style="color:var(--danger)">删除</button>` : ''}
    </div>`);
}

function settingsSheet() {
  const noticeOK = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const isApp = !!(window.KB_NATIVE && window.KB_NATIVE.supported);
  const noticeRow = isApp
    ? `<div class="setting-row">
        <div><div class="lbl">课程与日程提醒</div><div class="hint" id="nativeHint">检查中…</div></div>
        <div style="display:flex;gap:6px">
          <button class="small-btn" data-act="nativeTest">测试</button>
          <button class="small-btn" data-act="nativeSchedule">重排</button>
          <button class="small-btn" data-act="nativeClear">清除</button>
        </div>
      </div>`
    : `<div class="setting-row">
        <div><div class="lbl">系统通知</div><div class="hint">${noticeOK ? '已开启，页面开着就会提醒' : '未开启，只在页面内提示'}</div></div>
        <button class="small-btn" data-act="askNotice">${noticeOK ? '已开启' : '开启'}</button>
      </div>`;
  openSheet(`
    <div class="sheet-h"><div><h3>设置</h3><div class="sub">数据都存在本机</div></div></div>
    <div class="setting-row">
      <div><div class="lbl">开学第一周的周一</div><div class="hint">决定“第几周”怎么算</div></div>
      <input class="input" type="date" id="setStart" value="${S.semesterStart}">
    </div>
    <div class="setting-row">
      <div><div class="lbl">课前提醒</div><div class="hint">提前多久通知</div></div>
      <select class="input" id="setLead">
        ${[5, 10, 15, 20, 30].map((m) => `<option value="${m}" ${S.notifyLead === m ? 'selected' : ''}>${m} 分钟</option>`).join('')}
      </select>
    </div>
    <div class="setting-row">
      <div><div class="lbl">专注时长</div><div class="hint">一个番茄的长度</div></div>
      <select class="input" id="setFocus">
        ${[15, 20, 25, 30, 45, 50].map((m) => `<option value="${m}" ${S.focusMinutes === m ? 'selected' : ''}>${m} 分钟</option>`).join('')}
      </select>
    </div>
    <div class="setting-row" style="align-items:flex-start">
      <div style="flex:1">
        <div class="lbl">识图模型</div>
        <div class="hint">OpenAI 兼容接口；图片会上传到该服务</div>
        <input class="input" id="aiBase" style="margin-top:7px" value="${esc(S.ai.baseUrl)}" placeholder="https://open.bigmodel.cn/api/paas/v4">
        <input class="input" id="aiModel" style="margin-top:6px" value="${esc(S.ai.model)}" placeholder="glm-4v-flash">
        <input class="input" type="password" id="aiKey" style="margin-top:6px" value="${esc(S.ai.apiKey)}" placeholder="API Key">
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="small-btn" data-act="aiSave">保存</button>
          <button class="small-btn" data-act="aiTest">测试连接</button>
        </div>
      </div>
    </div>
    ${noticeRow}
    ${isApp ? `<div style="font-size:11.5px;color:var(--ink3);margin:2px 4px 4px;line-height:1.75">
      已声明 USE_EXACT_ALARM，系统自动授权，不需要手动开“精确闹钟”。<br>
      小米手机还需：允许自启动 / 省电策略设为“无限制” / 打开锁屏通知，否则重启或清理后台后可能收不到。
    </div>` : ''}
    <div class="setting-row">
      <div><div class="lbl">备份</div><div class="hint">课表、日程、待办导出成 JSON</div></div>
      <div style="display:flex;gap:8px">
        <button class="small-btn" data-act="exportData">导出</button>
        <label class="small-btn file-btn">导入<input type="file" accept="application/json" id="importFile"></label>
      </div>
    </div>
    <div class="setting-row">
      <div><div class="lbl">清空数据</div><div class="hint">课表与日程不动，只清待办和记录</div></div>
      <button class="small-btn" data-act="resetData" style="color:var(--danger)">清空</button>
    </div>
    <div style="font-size:11.5px;color:var(--ink3);margin-top:14px;line-height:1.7">
      节次时间目前按 08:00 / 14:00 / 19:00 三段的常见作息设定。如果和你们学校铃声不一致，
      可以点下面的按钮调整，倒计时会更准。
    </div>
    <button class="btn" style="margin-top:10px" data-act="editPeriods">调整节次时间</button>`);

  if (isApp) {
    window.KB_NATIVE.status().then((st) => {
      const hint = document.getElementById('nativeHint');
      if (!hint) return;
      hint.textContent = st.granted
        ? `已排入 ${st.count} 条（课程 / 日程 / 汇总），关掉 App 也会响`
        : '未授权，点“重排”去开启通知权限';
    });
  }
}

function periodSheet() {
  openSheet(`
    <div class="sheet-h"><div><h3>节次时间</h3><div class="sub">按学校铃声填，用于倒计时</div></div></div>
    ${periods().map((p) => `
      <div class="setting-row">
        <div class="lbl" style="width:56px">第 ${p.n} 节</div>
        <div style="display:flex;gap:6px;align-items:center">
          <input class="input" type="time" data-p="${p.n}" data-k="start" value="${p.start}" style="width:112px">
          <span style="color:var(--ink3)">-</span>
          <input class="input" type="time" data-p="${p.n}" data-k="end" value="${p.end}" style="width:112px">
        </div>
      </div>`).join('')}
    <button class="btn btn-primary" style="margin-top:14px" data-act="savePeriods">保存</button>`);
}

/* ---------------- 交互 ---------------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}

function switchView(v) {
  view = v;
  $$('.view').forEach((s) => s.classList.toggle('is-active', s.id === v));
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === v));
  try { history.replaceState(null, '', '#' + v); } catch (e) {}
  if (v === 'viewWeek') renderWeek();
  if (v === 'viewTasks') { renderTaskList(); renderCourseOptions(); }
  if (v === 'viewStats') renderStats();
  if (v === 'viewToday') renderToday();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderCourseOptions() {
  const sel = $('#taskCourse');
  const cur = sel.value;
  sel.innerHTML = '<option value="">不关联课程</option>' +
    COURSES.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  if (cur) sel.value = cur;
}

function addTask(title, courseId, due) {
  if (!title || !title.trim()) { toast('先写点什么'); return; }
  S.tasks.unshift({ id: 't' + Date.now(), title: title.trim(), courseId: courseId || null, due: due || '', done: false, plan: null, created: Date.now() });
  save();
  renderTaskList();
  renderTodayTasks();
  if (view === 'viewToday') renderToday();
  toast('已加入清单');
}

document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) { switchView(tab.dataset.view); return; }

  const el = e.target.closest('[data-act]');
  if (!el) {
    if (e.target.id === 'sheetMask') closeSheet();
    return;
  }
  const act = el.dataset.act;

  if (act === 'course') { courseSheet(el.dataset.course); return; }

  if (act === 'toggleTask') {
    const t = S.tasks.find((x) => x.id === el.dataset.id);
    if (t) { t.done = !t.done; save(); renderTaskList(); if (view === 'viewToday') renderToday(); }
    return;
  }
  if (act === 'delTask') {
    S.tasks = S.tasks.filter((x) => x.id !== el.dataset.id);
    save(); renderTaskList(); if (view === 'viewToday') renderToday();
    return;
  }

  /* ---- 日程 ---- */
  if (act === 'event') { eventSheet(el.dataset.id); return; }
  if (act === 'eventNew') { eventSheet(); return; }
  if (act === 'eventSave') {
    const title = ($('#evTitle').value || '').trim();
    if (!title) { toast('先写个标题'); return; }
    const date = $('#evDate').value || null;
    const start = $('#evStart').value || null;
    const end = $('#evEnd').value || null;
    if (start && !date) { toast('有时间就得先选日期'); return; }
    if (start && end && end < start) { toast('结束时间早于开始时间'); return; }
    const body = {
      title, date, start, end,
      place: ($('#evPlace').value || '').trim(),
      note: ($('#evNote').value || '').trim(),
    };
    const old = el.dataset.id ? S.events.find((x) => x.id === el.dataset.id) : null;
    if (old) {
      Object.assign(old, body);
    } else {
      S.events.push({
        id: 'e' + Date.now(),
        ...body,
        bring: [],
        source: 'manual',
        confidence: 1,
        raw: '',
        rawHash: '',
        created: Date.now(),
      });
    }
    save(); closeSheet(); renderToday();
    rescheduleNative();
    toast(old ? '已更新日程' : '已加入日程');
    return;
  }
  if (act === 'eventDel') {
    S.events = S.events.filter((x) => x.id !== el.dataset.id);
    save(); closeSheet(); renderToday();
    rescheduleNative();
    toast('已删除日程');
    return;
  }
  if (act === 'addTaskFor') { closeSheet(); switchView('viewTasks'); $('#taskCourse').value = el.dataset.course; $('#taskTitle').focus(); return; }
  if (act === 'focusStart') { startFocus(S.focus ? S.focus.courseId : null); return; }
  if (act === 'focusStartFor') { closeSheet(); startFocus(el.dataset.course); return; }
  if (act === 'focusStop') { stopFocus(); return; }
  if (act === 'focusPick') {
    openSheet(`<div class="sheet-h"><div><h3>这次专注算哪门课</h3><div class="sub">结束后计入该课统计</div></div></div>
      ${COURSES.map((c) => `<div class="setting-row"><div class="lbl">${c.name}</div>
        <button class="small-btn" data-act="focusSet" data-course="${c.id}">选它</button></div>`).join('')}`);
    return;
  }
  if (act === 'focusSet') { closeSheet(); startFocus(el.dataset.course); return; }

  if (act === 'planGap') {
    const start = Number(el.dataset.start);
    const end = Number(el.dataset.end);
    const pending = S.tasks.filter((t) => !t.done);
    openSheet(`<div class="sheet-h"><div><h3>排进这段空档</h3>
      <div class="sub">${fmtClock(new Date(start))} - ${fmtClock(new Date(end))} · ${durText(end - start)}</div></div></div>
      ${pending.length ? pending.map((t) => `<div class="setting-row">
          <div class="lbl">${esc(t.title)}<div class="hint">${t.due ? taskDueInfo(t).text : '没有期限'}</div></div>
          <button class="small-btn" data-act="planSet" data-id="${t.id}" data-start="${start}" data-end="${end}">排这里</button>
        </div>`).join('') : '<div class="empty">清单里没有未完成的事</div>'}`);
    return;
  }
  if (act === 'planSet') {
    const t = S.tasks.find((x) => x.id === el.dataset.id);
    if (t) {
      const start = Number(el.dataset.start);
      const total = Number(el.dataset.end) - start;
      const len = Math.min(total, 50 * 60000);
      t.plan = { date: ymd(new Date()), start, end: start + len };
      save(); closeSheet(); renderToday();
      toast(`已排：${fmtClock(new Date(start))} 开始`);
    }
    return;
  }

  if (act === 'scan') {
    if (window.KB_SCAN) window.KB_SCAN.chooser();
    return;
  }
  if (act === 'scanPick') {
    if (window.KB_SCAN) window.KB_SCAN.run(el.dataset.src || 'CAMERA');
    return;
  }
  if (act === 'aiSave') {
    const base = ($('#aiBase').value || '').trim().replace(/\/+$/, '');
    const model = ($('#aiModel').value || '').trim();
    const key = ($('#aiKey').value || '').trim();
    if (base && !/^https:\/\//i.test(base)) { toast('接口地址必须以 https:// 开头'); return; }
    S.ai = { baseUrl: base, model, apiKey: key };
    save();
    closeSheet();
    toast('已保存识图配置');
    return;
  }
  if (act === 'aiTest') {
    if (!window.KB_SCAN) { toast('识图只在 App 内可用'); return; }
    const base = ($('#aiBase').value || '').trim().replace(/\/+$/, '');
    const model = ($('#aiModel').value || '').trim();
    const key = ($('#aiKey').value || '').trim();
    if (base && !/^https:\/\//i.test(base)) { toast('接口地址必须以 https:// 开头'); return; }
    S.ai = { baseUrl: base, model, apiKey: key };
    save();
    el.textContent = '测试中…';
    window.KB_SCAN.test().then((r) => {
      el.textContent = '测试连接';
      toast(r.ok ? `连接正常：${r.msg || '可用'}` : `失败：${r.msg}`);
    });
    return;
  }
  if (act === 'nativeTest') {
    if (!window.KB_NATIVE) return;
    el.textContent = '发送中…';
    window.KB_NATIVE.test().then((r) => {
      settingsSheet();
      if (!r.granted) toast('没拿到通知权限，去系统设置里允许');
      else if (r.error) toast('发送失败：' + r.error);
      else toast('10 秒后收到测试通知，锁屏等一下');
    });
    return;
  }
  if (act === 'nativeSchedule') {
    if (!window.KB_NATIVE) return;
    el.textContent = '排期中…';
    window.KB_NATIVE.ensure(true).then((r) => {
      if (r.granted) { settingsSheet(); toast(`已排入 ${r.count} 条提醒`); }
      else { settingsSheet(); toast('没拿到通知权限，去系统设置里允许'); }
    });
    return;
  }
  if (act === 'nativeClear') {
    if (!window.KB_NATIVE) return;
    window.KB_NATIVE.clear().then(() => { settingsSheet(); toast('已清除全部提醒'); });
    return;
  }
  if (act === 'askNotice') {
    if (typeof Notification === 'undefined') { toast('这个浏览器不支持系统通知'); return; }
    Notification.requestPermission().then((p) => {
      toast(p === 'granted' ? '通知已开启' : '未授权，只能页面内提示');
      settingsSheet();
    });
    return;
  }
  if (act === 'exportData') {
    const dump = { ...S, ai: { ...S.ai, apiKey: '' } };
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `课表助手备份-${ymd(new Date())}.json`;
    a.click();
    return;
  }
  if (act === 'resetData') {
    S.tasks = []; S.focusLog = []; S.focus = null; S.notified = {};
    save(); closeSheet(); renderToday(); toast('已清空待办与记录（日程保留）');
    return;
  }
  if (act === 'editPeriods') { periodSheet(); return; }
  if (act === 'savePeriods') {
    const next = periods().map((p) => ({ ...p }));
    $$('#sheetBody input[type=time]').forEach((inp) => {
      const n = Number(inp.dataset.p);
      next[n - 1][inp.dataset.k] = inp.value;
    });
    S.periods = next; save(); closeSheet(); renderToday(); toast('已更新节次时间');
    return;
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'setStart') {
    S.semesterStart = e.target.value;
    S.calibrated = true;
    save(); renderHeader(); renderToday(); toast('已更新开学日期');
  }
  if (e.target.id === 'setLead') { S.notifyLead = Number(e.target.value); save(); }
  if (e.target.id === 'setFocus') { S.focusMinutes = Number(e.target.value); save(); renderFocusCard(); }
  if (e.target.id === 'importFile') {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        const incoming = { ...data };
        if (!Array.isArray(incoming.events)) delete incoming.events;
        else incoming.events = incoming.events.filter((e) => e && typeof e === 'object' && e.id);
        const prevAi = { ...S.ai };
        S = { ...DEFAULT_STATE, ...incoming };
        if (!Array.isArray(S.tasks)) S.tasks = [];
        if (!Array.isArray(S.events)) S.events = [];
        /* 备份里的 apiKey 是空的，保住本机已配置的 key */
        S.ai = { ...DEFAULT_STATE.ai, ...(incoming.ai || {}) };
        if (!S.ai.apiKey) S.ai.apiKey = prevAi.apiKey || '';
        save(); closeSheet(); renderHeader(); renderToday();
        rescheduleNative();
        toast('已导入');
      } catch (err) { toast('文件读不出来'); }
    };
    r.readAsText(f);
  }
});

$('#btnSettings').addEventListener('click', settingsSheet);
$('#weekPrev').addEventListener('click', () => { weekOffset = Math.max(weekOffset - 1, 1 - weekOf(new Date())); renderWeek(); });
$('#weekNext').addEventListener('click', () => { weekOffset = Math.min(weekOffset + 1, TOTAL_WEEKS - weekOf(new Date())); renderWeek(); });
$('#weekBack').addEventListener('click', () => { weekOffset = 0; renderWeek(); });
$('#btnAddTask').addEventListener('click', () => {
  addTask($('#taskTitle').value, $('#taskCourse').value, $('#taskDue').value);
  $('#taskTitle').value = '';
});
$('#taskTitle').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btnAddTask').click();
});

/* ---------------- 计时器 ---------------- */

function tick() {
  const hero = $('#heroSlot');
  const num = document.getElementById('heroNum');
  if (num && hero.dataset.kind === 'next') {
    const left = Number(hero.dataset.startAt) - Date.now();
    num.textContent = left > 0 ? countdownText(left) : '00:00';
  }
  if (num && hero.dataset.kind === 'now') {
    const left = Number(hero.dataset.endAt) - Date.now();
    num.textContent = left > 0 ? countdownText(left) : '00:00';
  }
  const fnum = document.getElementById('focusNum');
  if (fnum && S.focus && S.focus.endsAt) {
    const left = S.focus.endsAt - Date.now();
    if (left > 0) {
      fnum.textContent = Math.ceil(left / 60000) + "'";
      const arc = document.getElementById('focusArc');
      if (arc) {
        const C = 2 * Math.PI * 26;
        arc.style.strokeDashoffset = (C * (1 - left / (S.focus.minutes * 60000))).toFixed(1);
      }
    } else {
      const used = S.focus.minutes;
      S.focusLog.push({ id: 'f' + Date.now(), courseId: S.focus.courseId || null, minutes: used, date: ymd(new Date()) });
      S.focus = null; save();
      renderFocusCard();
      toast(`专注完成，记了 ${used} 分钟`);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('专注结束', { body: `${used} 分钟已记录，起来走两步` });
      }
    }
  }
}

/* 每 15 秒：课前提醒 + 界面刷新 */
function watch() {
  const now = new Date();
  const dayKey = ymd(now);
  const list = sessionsOn(now);

  list.forEach((it) => {
    const start = sessionStartAt(now, it.session);
    const diff = start - now;
    const key = `${dayKey}-c-${it.course.id}-${fmtClock(start)}`;
    if (diff > 0 && diff <= S.notifyLead * 60000 && !S.notified[key]) {
      S.notified[key] = true; save();
      const body = `${fmtClock(start)} ${it.session.room} · ${it.session.building}`;
      toast(`还有 ${Math.round(diff / 60000)} 分钟：${it.course.name}`);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(it.course.name, { body });
      }
    }
  });

  /* 日程：只有带时间的才做「还有 N 分钟」提示 */
  (S.events || []).forEach((e) => {
    if (!e || e.date !== dayKey || !e.start) return;
    const start = atTime(now, e.start);
    const diff = start - now;
    const key = `${dayKey}-e-${e.id}-${e.start}`;
    if (diff > 0 && diff <= S.notifyLead * 60000 && !S.notified[key]) {
      S.notified[key] = true; save();
      const body = e.place || '日程提醒';
      toast(`还有 ${Math.round(diff / 60000)} 分钟：${e.title}`);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(e.title, { body });
      }
    }
  });
}

function boot() {
  renderHeader();
  renderToday();
  renderCourseOptions();
  const hash = (location.hash || '').replace('#', '');
  if (['viewWeek', 'viewTasks', 'viewStats'].includes(hash)) switchView(hash);
  setInterval(tick, 1000);
  setInterval(() => {
    const dayChanged = $('body').dataset.day !== ymd(new Date());
    if (dayChanged) { $('body').dataset.day = ymd(new Date()); renderHeader(); renderToday(); }
    watch();
  }, 15000);
  $('body').dataset.day = ymd(new Date());
}

boot();
