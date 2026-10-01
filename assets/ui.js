/* Monitoring — 共享视图组件（观看页与编辑页预览复用同一套渲染，保证所见即所得） */
(function (global) {
  'use strict';

  const M = global.Monitoring;

  const SVG_ATTRS = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

  /* Fluent System Icons 风格的线性图标（sprite 在各页 HTML 内联） */
  const icon = (name, size = 20, cls = 'icon') =>
    `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 20 20" ${SVG_ATTRS} aria-hidden="true"><use href="#i-${name}"></use></svg>`;

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const initials = (name) => {
    const s = String(name || 'M').trim();
    return /[\u3400-\u9fff]/.test(s[0]) ? s.slice(0, 1) : (s.split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || 'M');
  };

  /* 进行中的记录 = 可用；计划中 = 离开；已结束 = 离线 */
  function presenceOf(rec, now) {
    const running = !!rec && (!rec.end || M.ts(rec.end) > now);
    const kind = rec ? M.kindOf(rec.kind) : null;
    if (!rec) return { tone: 'offline', text: '暂无记录' };
    return { tone: running ? 'available' : 'offline', text: running ? kind.label : `${kind.label} · 已结束` };
  }

  const presenceHtml = (tone, text, large) =>
    `<span class="presence presence--${tone}${large ? ' presence--large' : ''}"><span class="presence__dot"></span><span>${esc(text)}</span></span>`;

  function heroHtml(data, now) {
    const { state, record } = M.currentState(data, now);
    if (!record) {
      return `<div class="empty">
        ${icon('pulse', 32)}
        <p class="subtitle2">${esc(M.STATE_LABEL[state].text)}</p>
        <p class="body1 muted">还没有任何状态记录，去「编辑状态」写下这一刻在做什么。</p>
      </div>`;
    }
    const running = state === 'running';
    const { tone, text } = presenceOf(record, now);
    const kind = M.kindOf(record.kind);
    return `<div class="stack">
      ${presenceHtml(tone, text, true)}
      <p class="hero__activity">${esc(record.activity || '(未填写活动内容)')}</p>
      <div class="row">
        <span class="hero__timer" data-hero-timer>${esc(M.fmtDuration(M.duration(record, now)))}</span>
        <span class="caption1">${running ? '已持续，自' : '总时长，起于'} ${esc(M.fmtDateTime(record.start))}</span>
      </div>
      <dl class="meta-grid">
        <div><dt>起始时间</dt><dd class="num">${esc(M.fmtDateTime(record.start))}</dd></div>
        <div><dt>终止时间</dt><dd class="num">${record.end ? esc(M.fmtDateTime(record.end)) : '进行中'}</dd></div>
        <div><dt>活动类型</dt><dd>${esc(kind.label)}</dd></div>
      </dl>
      ${record.note ? `<div class="note-box">${esc(record.note)}</div>` : ''}
    </div>`;
  }

  function timelineHtml(records, now, emptyHint) {
    const list = [...(records || [])].sort(M.byStartDesc);
    if (!list.length) {
      return `<div class="empty">
        ${icon('clock', 32)}
        <p class="subtitle2">还没有记录</p>
        <p class="body1 muted">${esc(emptyHint || '状态一旦记录，就会按时间线出现在这里。')}</p>
      </div>`;
    }
    let html = '<ul class="timeline">';
    let day = '';
    list.forEach((r, i) => {
      const key = M.fmtDay(r.start);
      if (key !== day) {
        day = key;
        html += `<li class="timeline__day caption2">${esc(key)}</li>`;
      }
      const { tone, text } = presenceOf(r, now);
      html += `<li class="timeline__item">
        <span class="timeline__dot timeline__dot--${tone}" aria-hidden="true"></span>
        <div class="timeline__head">
          <span class="body1Strong">${esc(r.activity || '(未填写活动内容)')}</span>
          ${presenceHtml(tone, text)}
          <span class="caption1 num">${esc(M.fmtTime(r.start))} → ${r.end ? esc(M.fmtTime(r.end)) : '进行中'}</span>
          <span class="caption1 num" data-dur="${i}">· ${esc(M.fmtDuration(M.duration(r, now)))}</span>
        </div>
        ${r.note ? `<div class="timeline__note">${esc(r.note)}</div>` : ''}
      </li>`;
    });
    return html + '</ul>';
  }

  function metricsHtml(data, now) {
    const s = M.stats(data, now);
    const items = [
      ['今日时长', M.fmtDuration(s.todayMs)],
      ['今日记录', `${s.todayCount}`],
      ['本周时长', M.fmtDuration(s.weekMs)],
      ['累计记录', `${s.total}`]
    ];
    return items
      .map(([label, value]) => `<div class="metric"><p class="caption2">${esc(label)}</p><p class="metric__value">${esc(value)}</p></div>`)
      .join('');
  }

  /* 侧栏与身份卡：头像首字母 + 名称 + 当前 presence */
  function applyIdentity(data, now) {
    const { record } = M.currentState(data, now);
    const { tone, text } = presenceOf(record, now);
    document.querySelectorAll('[data-avatar]').forEach((el) => (el.textContent = initials(data.owner.name)));
    document.querySelectorAll('[data-me-name]').forEach((el) => (el.textContent = data.owner.name || 'Monitoring'));
    document.querySelectorAll('[data-me-state]').forEach((el) => (el.textContent = text));
    document.querySelectorAll('.presence').forEach((el) => {
      if (!el.querySelector('[data-me-state]')) return;
      el.className = `presence presence--${tone}${el.classList.contains('presence--large') ? ' presence--large' : ''}`;
    });
  }

  function render(root, data, now) {
    const hero = (root || document).querySelector('[data-hero]');
    if (hero) hero.innerHTML = heroHtml(data, now);
  }

  /* ---------------- Toast（Fluent Toaster：图标 + 文案） ---------------- */
  function toast(message, type = 'ok', ms = 3200) {
    let box = document.querySelector('.toasts');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      document.body.appendChild(box);
    }
    const node = document.createElement('div');
    node.className = `toast toast--${type}`;
    node.innerHTML = `${icon(type === 'error' ? 'error' : type === 'info' ? 'info' : 'check')}<span>${esc(message)}</span>`;
    box.appendChild(node);
    setTimeout(() => node.remove(), ms);
  }

  /* ---------------- 主题 ---------------- */
  function initTheme() {
    const saved = localStorage.getItem('monitoring:theme');
    const apply = (t) => {
      document.documentElement.dataset.theme = t;
      localStorage.setItem('monitoring:theme', t);
    };
    if (saved) apply(saved);
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      const sync = () => {
        const dark = document.documentElement.dataset.theme === 'dark';
        btn.innerHTML = icon(dark ? 'sun' : 'moon');
        btn.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题');
      };
      btn.addEventListener('click', () => {
        apply(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
        sync();
      });
      sync();
    });
  }

  function mountFooter(selector, data) {
    const node = document.querySelector(selector);
    if (node) node.textContent = `数据来源 data/status.json · 最后更新 ${M.fmtDateTime(data.updatedAt)}`;
  }

  global.MonitoringUI = {
    esc, icon, initials, presenceOf, presenceHtml,
    heroHtml, timelineHtml, metricsHtml, applyIdentity, render,
    toast, initTheme, mountFooter
  };
})(window);
