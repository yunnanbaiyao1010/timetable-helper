/* =========================================================
   AI 识图：截图 → 视觉模型 → 候选日程
   —— 请求走 CapacitorHttp（绕开 WebView 的 CORS），只在 App 内可用
   ========================================================= */
(function () {
  const C = window.Capacitor;
  const Plugins = (C && C.Plugins) || {};
  const Camera = Plugins.Camera;

  const DEFAULT_BASE = 'https://open.bigmodel.cn/api/paas/v4';
  const DEFAULT_MODEL = 'glm-4v-flash';
  const MAX_EDGE = 1280;
  const TIMEOUT = 30000;

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  function cfg() {
    const ai = S.ai || {};
    return {
      baseUrl: (ai.baseUrl || DEFAULT_BASE).replace(/\/+$/, ''),
      model: ai.model || DEFAULT_MODEL,
      apiKey: ai.apiKey || '',
    };
  }

  /* ---------- 取图 ---------- */
  async function toDataUrl(blob) {
    let bitmap;
    if (window.createImageBitmap) {
      bitmap = await createImageBitmap(blob);
    } else {
      bitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(blob);
      });
    }
    const w = bitmap.width || bitmap.naturalWidth;
    const h = bitmap.height || bitmap.naturalHeight;
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  async function pick(source) {
    const photo = await Camera.getPhoto({
      resultType: 'uri',
      source,
      quality: 85,
      width: MAX_EDGE,
      height: MAX_EDGE,
    });
    const blob = await (await fetch(photo.webPath)).blob();
    return toDataUrl(blob);
  }

  /* ---------- prompt ---------- */
  const SCHEMA = `只输出一个 JSON 对象，不要任何解释或代码块，格式：
{"events":[{"title":"简短标题，不超过14字","date":"YYYY-MM-DD 或 null","start":"HH:mm 或 null","end":"HH:mm 或 null","place":"地点，未知填空字符串","note":"补充信息，未知填空字符串","raw":"截图里对应的原文句子","confidence":0到1的小数}],"warnings":["不确定的地方，最多3条"]}
规则：
1. 日期时间只能来自截图里的明确信息；聊天时间条（如「昨天 20:28」「11月18日 下午3:12」）优先于当前时间。
2. 推不出的字段填 null，禁止猜测。只有日期没有具体时间的，start 填 null；连日期都没有的，date 填 null。
3. 「周三 3-4 节」这类说法按下面给出的节次时间换算成具体时刻。
4. 群聊里的闲聊、表情、已经过期的事不要输出。
5. 同一件事只输出一条；标题用「交实验报告」「高数组会」这种短语。`;

  function contextText() {
    const now = new Date();
    const table = periods().map((p, i) => `${i + 1}节 ${p.start}-${p.end}`).join('，');
    return [
      `今天是 ${ymd(now)}（${WEEK_NAMES[isoDay(now)]}），第 ${weekOf(now)} 周，开学第一周周一为 ${S.semesterStart}。`,
      `节次时间：${table}。`,
      '请从这张截图里找出所有「需要在某天做某件事」的安排（调课、考试、提交、会议、活动、报名等），按 schema 输出。',
    ].join('\n');
  }

  /* ---------- 请求 ---------- */
  function stripFence(s) {
    return String(s || '')
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
  }

  function normalize(e) {
    if (!e || typeof e !== 'object') return null;
    const title = String(e.title || '').trim().slice(0, 20);
    if (!title) return null;
    const date = DATE_RE.test(e.date || '') ? e.date : null;
    const start = TIME_RE.test(e.start || '') ? e.start : null;
    let end = TIME_RE.test(e.end || '') ? e.end : null;
    if (start && end && end < start) end = null;
    return {
      title,
      date,
      start,
      end,
      place: String(e.place || '').trim().slice(0, 30),
      note: String(e.note || '').trim().slice(0, 60),
      raw: String(e.raw || '').trim().slice(0, 200),
      confidence: Math.max(0, Math.min(1, Number(e.confidence) || 0)),
    };
  }

  function parseResult(text) {
    let obj;
    try {
      obj = JSON.parse(stripFence(text));
    } catch (e) {
      throw new Error('模型返回的不是合法 JSON');
    }
    const events = (Array.isArray(obj.events) ? obj.events : []).map(normalize).filter(Boolean);
    if (!events.length) throw new Error('没识别出日程，换张更清楚的图试试');
    return {
      events,
      warnings: (Array.isArray(obj.warnings) ? obj.warnings : []).map(String).slice(0, 3),
    };
  }

  async function request(body, opts) {
    const c = cfg();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(`${c.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${c.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 160); } catch (e) {}
        const hint = res.status === 401 ? 'API Key 不对'
          : res.status === 404 ? '接口地址或模型名不对'
          : res.status === 429 ? '请求太频繁或额度用完'
          : '请求被拒绝';
        const err = new Error(detail ? `${hint}（HTTP ${res.status}：${detail}）` : `${hint}（HTTP ${res.status}）`);
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      const choice = data.choices && data.choices[0];
      if (!choice || !choice.message) throw new Error('模型没有返回内容');
      if (choice.finish_reason === 'length' && !(opts && opts.lenient)) {
        throw new Error('输出被截断，换一张信息少一点的图');
      }
      return choice.message.content || '';
    } finally {
      clearTimeout(timer);
    }
  }

  async function analyze(dataUrl) {
    const c = cfg();
    if (!c.apiKey) throw new Error('还没填 API Key');
    if (!/^https:\/\//i.test(c.baseUrl)) throw new Error('接口地址必须以 https:// 开头');

    const bare = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buildBody = (imgUrl, jsonMode) => ({
      model: c.model,
      messages: [
        { role: 'system', content: `你是把聊天截图整理成日程的助手。${SCHEMA}` },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imgUrl } },
            { type: 'text', text: contextText() },
          ],
        },
      ],
      temperature: 0.1,
      /* 部分视觉模型输出上限是 1024，写大会直接 400 */
      max_tokens: 1000,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    });

    /* 各家视觉接口的差异都试一遍：JSON 模式 → 纯文本约束 → base64 去掉 data 前缀 */
    const variants = [
      { img: dataUrl, json: true },
      { img: dataUrl, json: false },
      { img: bare, json: false },
    ];
    let lastErr = null;
    for (let i = 0; i < variants.length; i++) {
      try {
        const text = await request(buildBody(variants[i].img, variants[i].json));
        return parseResult(text);
      } catch (e) {
        lastErr = e;
        /* 鉴权/地址/额度类错误没救，直接抛 */
        if (e.status && e.status !== 400 && e.status !== 422) break;
        if (!e.status && /接口地址|API Key|网络|请求太频繁/.test(e.message)) break;
      }
    }
    throw lastErr || new Error('识别失败');
  }

  /* ---------- 连接测试：发一张 1×1 的图，验证地址 / 模型 / key / 视觉能力 ---------- */
  const TINY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  async function test() {
    const c = cfg();
    if (!c.apiKey) return { ok: false, msg: '还没填 API Key' };
    if (!/^https:\/\//i.test(c.baseUrl)) return { ok: false, msg: '接口地址必须以 https:// 开头' };
    try {
      /* 视觉模型常有前置 token，8 个会被判成“截断”，这里放宽且不把它当错误 */
      const text = await request({
        model: c.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: TINY } },
            { type: 'text', text: '回复两个字：可用' },
          ],
        }],
        max_tokens: 64,
        temperature: 0,
      }, { lenient: true });
      return { ok: true, msg: String(text).trim().slice(0, 20) || '可用' };
    } catch (e) {
      return { ok: false, msg: (e && e.message) || '连接失败' };
    }
  }

  /* ---------- 入口 ---------- */
  function chooser() {
    if (!Camera) {
      toast('识图只能在 App 里用（网页版取不到相机）');
      return;
    }
    openSheet(`
      <div class="sheet-h"><div><h3>识图加日程</h3><div class="sub">截图会压缩后上传给模型识别</div></div></div>
      <button class="btn btn-primary" data-act="scanPick" data-src="CAMERA">拍一张</button>
      <button class="btn" style="margin-top:9px" data-act="scanPick" data-src="PHOTOS">从相册选</button>
      <div style="font-size:11.5px;color:var(--ink3);margin-top:12px;line-height:1.7">
        图片会上传到第三方模型服务；识别结果先给你确认，勾选后才写入日程。
      </div>`);
  }

  async function run(source) {
    openSheet(`
      <div class="sheet-h"><div><h3>识别中…</h3><div class="sub">压缩图片 → 请求模型，最多 30 秒</div></div></div>
      <div class="scan-loading"><span class="scan-spin"></span></div>
      <button class="btn" style="margin-top:9px" data-act="scanClose">取消</button>`);

    let dataUrl;
    try {
      dataUrl = await pick(source);
    } catch (e) {
      closeSheet();
      return; /* 用户取消拍照，不打扰 */
    }
    try {
      const res = await analyze(dataUrl);
      window.KB_SCAN_SHEET.open(res, dataUrl);
    } catch (e) {
      /* 错误原文可能有 160 字，放在卡片里比 toast 好读 */
      const msg = (e && e.message) || '识别失败';
      openSheet(`
        <div class="sheet-h"><div><h3>识别失败</h3><div class="sub">${esc(msg)}</div></div></div>
        <button class="btn" data-act="scanClose">知道了</button>`);
    }
  }

  window.KB_SCAN = { chooser, run, test, analyze };
})();
