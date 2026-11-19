/* =========================================================
   识图结果确认卡片：勾选 / 改标题和时间 / 看原文 / 落库
   ========================================================= */
(function () {
  let current = null;

  function hash(s) {
    let h = 5381;
    const t = String(s || '');
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
    return 'h' + (h >>> 0).toString(36);
  }

  function fingerprint(e) {
    return hash(e.raw || `${e.title}|${e.date || ''}|${e.start || ''}|${e.place || ''}`);
  }

  function isDup(e) {
    const fp = fingerprint(e);
    return (S.events || []).some((x) => {
      if (x.rawHash && x.rawHash === fp) return true;
      return x.title === e.title && x.date === e.date && x.start === e.start;
    });
  }

  function row(e, i) {
    const checked = !!(e.date && e.start && e.confidence >= 0.7) && !e.dup;
    return `
      <div class="scan-card" data-i="${i}">
        <div class="scan-head">
          <input type="checkbox" class="scan-ck" ${checked ? 'checked' : ''} ${e.dup ? 'disabled' : ''}>
          <input class="input scan-title" value="${esc(e.title)}" maxlength="20" placeholder="标题">
        </div>
        <div class="scan-meta">
          <input class="input scan-date" type="date" value="${e.date || ''}">
          <input class="input scan-start" type="time" value="${e.start || ''}">
          <span class="scan-dash">-</span>
          <input class="input scan-end" type="time" value="${e.end || ''}">
        </div>
        <div class="scan-sub">
          <input class="input scan-place" value="${esc(e.place)}" placeholder="地点（可空）">
          ${e.dup ? '<span class="scan-tag">已存在</span>'
            : (e.confidence < 0.7 ? '<span class="scan-tag warn">不太确定</span>' : '')}
        </div>
        ${e.raw ? `<details class="scan-raw"><summary>看原文</summary><div>${esc(e.raw)}</div></details>` : ''}
      </div>`;
  }

  function open(res, preview) {
    current = res.events.map((e) => ({ ...e, dup: isDup(e) }));
    const addable = current.filter((e) => !e.dup).length;
    openSheet(`
      <div class="sheet-h">
        <div>
          <h3>识别到 ${current.length} 条</h3>
          <div class="sub">勾选要加入的，时间和标题可以直接改${addable ? '' : '（都和已有日程重复了）'}</div>
        </div>
      </div>
      ${current.map(row).join('')}
      ${res.warnings && res.warnings.length ? `<div class="scan-warn">${res.warnings.map((w) => `<div>· ${esc(w)}</div>`).join('')}</div>` : ''}
      <div style="display:flex;gap:9px;margin-top:14px">
        <button class="btn btn-primary" data-act="scanSave">加入日程</button>
        <button class="btn" data-act="scanClose">取消</button>
      </div>
      ${preview ? `<img class="scan-preview" src="${preview}" alt="识别原图">` : ''}`);
  }

  function save() {
    const cards = Array.prototype.slice.call(document.querySelectorAll('#sheetBody .scan-card'));
    let added = 0;
    let noDate = 0;

    cards.forEach((card) => {
      const ck = card.querySelector('.scan-ck');
      if (!ck || !ck.checked || ck.disabled) return;

      const title = (card.querySelector('.scan-title').value || '').trim();
      const date = card.querySelector('.scan-date').value || null;
      const start = card.querySelector('.scan-start').value || null;
      const end = card.querySelector('.scan-end').value || null;
      if (!title) return;
      if (!date) { noDate++; return; }

      const ev = {
        title: title.slice(0, 20),
        date,
        start,
        end: start && end && end < start ? null : end,
        place: (card.querySelector('.scan-place').value || '').trim().slice(0, 30),
        note: '',
        raw: '',
        confidence: 1,
        source: 'ai',
        bring: [],
        created: Date.now(),
      };
      const origin = current[Number(card.dataset.i)];
      if (origin) {
        ev.note = origin.note || '';
        ev.raw = origin.raw || '';
        ev.confidence = origin.confidence;
      }
      ev.rawHash = fingerprint(ev);
      if (isDup(ev)) return;

      S.events.push({ id: 'e' + Date.now() + '_' + added, ...ev });
      added++;
    });

    closeSheet();
    if (added) {
      save();
      renderToday();
      rescheduleNative();
      if (window.KB_WIDGET && KB_WIDGET.push) KB_WIDGET.push(S);
    }
    if (added && noDate) toast(`加入了 ${added} 条，${noDate} 条缺日期已跳过`);
    else if (added) toast(`已加入 ${added} 条日程`);
    else if (noDate) toast('勾选的日程缺日期，补上再加入');
    else toast('没有勾选可加入的日程');
  }

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'scanClose') { closeSheet(); return; }
    if (act === 'scanSave') { save(); return; }
  });

  window.KB_SCAN_SHEET = { open };
})();
