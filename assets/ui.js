/* Monitoring — 共享视图组件（观看页与编辑页预览复用同一套渲染，保证所见即所得） */
(function (global) {
  'use strict';

  const M = global.Monitoring;

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function badgeHtml(rec, now) {
    if (!rec) return '<span class="badge badge--plain">暂无记录</span>';
    const kind = M.kindOf(rec.kind);
    const running = !rec.end || M.ts(rec.end) > now;
    const tone = running ? kind.tone : 'idle';
    const text = running ? kind.label : `${kind.label} · 已结束`;
    return `<span class="badge badge--${tone}">${esc(text)}</span>`;
  }

  function heroHtml(data, now) {
    const { state, record } = M.currentState(data, now);
    const meta = M.STATE_LABEL[state];
    if (!record) {
      return `<div class="hero">
        <span class="badge badge--${meta.badge}">${meta.text}</span>
        <p class="hero__activity muted">暂时没有任何状态记录</p>
        <p class="caption1">记录开始后，这里会显示当前正在进行的活动。</p>
      </div>`;
    }
    const running = state === 'running';
    const kind = M.kindOf(record.kind);
    return `<div class="hero">
      <div class="row row--between">
        <span class="badge badge--${running ? kind.tone : meta.badge}">${running ? '进行中' : meta.text}</span>
        <span class="caption1">更新于 ${esc(M.fmtRelative(data.updatedAt, now))}</span>
      </div>
      <p class="hero__activity">${esc(record.activity || '(未填写活动内容)')}</p>
      <div class="row">
        <span class="hero__timer" data-hero-timer>${esc(M.fmtDuration(M.duration(record, now)))}</span>
        <span class="caption1">${running ? '已持续' : '总时长'}</span>
      </div>
      <dl class="meta-grid">
        <div><dt>起始时间</dt><dd class="num">${esc(M.fmtDateTime(record.start))}</dd></div>
        <div><dt>终止时间</dt><dd class="num">${record.end ? esc(M.fmtDateTime(record.end)) : '进行中'}</dd></div>
        <div><dt>活动类型</dt><dd>${esc(kind.label)}</dd></div>
      </dl>
      ${record.note ? `<div class="timeline__note">${esc(record.note)}</div>` : ''}
    </div>`;
  }

  function timelineHtml(records, now, emptyHint) {
    const list = [...(records || [])].sort(M.byStartDesc);
    if (!list.length) {
      return `<div class="empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <circle cx="12" cy="12" r="9"></circle><path d="M12 8v4l3 2"></path>
        </svg>
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
      const kind = M.kindOf(r.kind);
      const running = !r.end || M.ts(r.end) > now;
      const tone = running ? kind.tone : 'idle';
      html += `<li class="timeline__item">
        <span class="timeline__dot timeline__dot--${tone}" aria-hidden="true"></span>
        <div class="timeline__head">
          <span class="body1Strong">${esc(r.activity || '(未填写活动内容)')}</span>
          ${badgeHtml(r, now)}
          <span class="caption1 num">${esc(M.fmtTime(r.start))} → ${r.end ? esc(M.fmtTime(r.end)) : '进行中'}</span>
          <span class="caption1 num" data-dur="${i}">· ${esc(M.fmtDuration(M.duration(r, now)))}</span>
        </div>
        ${r.note ? `<div class="timeline__note">${esc(r.note)}</div>` : ''}
      </li>`;
    });
    return html + '</ul>';
  }

  function statsHtml(data, now) {
    const s = M.stats(data, now);
    const items = [
      ['今日时长', M.fmtDuration(s.todayMs)],
      ['今日记录', `${s.todayCount} 条`],
      ['本周时长', M.fmtDuration(s.weekMs)],
      ['累计记录', `${s.total} 条`]
    ];
    return `<div class="stat-grid">${items
      .map(([label, value]) => `<div class="stat"><div class="stat__value">${esc(value)}</div><p class="caption1 stat__label">${esc(label)}</p></div>`)
      .join('')}</div>`;
  }

  function render(root, data, now) {
    if (!root) return;
    const hero = root.querySelector('[data-hero]');
    if (hero) hero.innerHTML = heroHtml(data, now);
  }

  /* ---------------- Toast ---------------- */
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
    node.textContent = message;
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
        btn.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题');
        btn.textContent = dark ? '☀' : '☾';
      };
      btn.addEventListener('click', () => {
        apply(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
        sync();
      });
      sync();
    });
  }

  function mountFooter(selector) {
    const node = document.querySelector(selector);
    if (node) node.textContent = `数据文件 data/status.json · 页面生成于 ${M.fmtDateTime(new Date().toISOString())}`;
  }

  global.MonitoringUI = { esc, badgeHtml, heroHtml, timelineHtml, statsHtml, render, toast, initTheme, mountFooter };
})(window);
