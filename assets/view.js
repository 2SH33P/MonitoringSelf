/* 观看页（只读）：加载数据 → 渲染当前状态 / 指标 / 记录列表，支持搜索与翻页。 */
(function () {
  'use strict';
  const M = window.Monitoring;
  const UI = window.MonitoringUI;
  const $ = (s) => document.querySelector(s);

  let data = null;
  const state = { q: '', page: 1, size: UI.PAGE_SIZE };
  let queryTimer = 0;

  function renderList() {
    const list = UI.filterRecords(data.records, state.q);
    const pg = UI.paginate(list, state.page, state.size);
    state.page = pg.page;
    $('#timeline').innerHTML = UI.timelineHtml(
      pg.items,
      Date.now(),
      state.q ? '没有匹配的记录，换个关键词试试。' : undefined
    );
    $('#pager').innerHTML = UI.pagerHtml(pg.page, pg.pages, pg.total, pg.size);
    $('#result-hint').textContent = state.q ? `匹配 ${pg.total} 条` : '按起始时间倒序';
  }

  function paint() {
    const now = Date.now();
    $('#owner-name').textContent = data.owner.name || 'Monitoring';
    $('#owner-bio').textContent = data.owner.bio || '';
    $('#updated-at').textContent = `更新于 ${M.fmtDateTime(data.updatedAt)}`;
    $('#hero-since').textContent = `同步于 ${M.fmtRelative(data.updatedAt, now)}`;
    $('#record-count').textContent = data.records.length ? `${data.records.length} 条` : '';
    UI.applyIdentity(data, now);
    UI.render(document, data, now);
    $('#metrics').innerHTML = UI.metricsHtml(data, now);

    // 只有「筛选 / 页码 / 记录集合」变化才重排列表，否则仅刷新时长文案
    const sig = [state.q, state.page, state.size, data.records.map((r) => r.id + r.updatedAt).join(',')].join('|');
    if (sig === paint.sig) return;
    paint.sig = sig;
    renderList();
  }

  function wire() {
    $('#q').addEventListener('input', (e) => {
      clearTimeout(queryTimer);
      const value = e.target.value;
      queryTimer = setTimeout(() => {
        state.q = value;
        state.page = 1;
        paint();
      }, 150);
    });

    $('#pager').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-page]');
      if (!btn || btn.disabled) return;
      state.page = Number(btn.dataset.page);
      paint();
      $('#timeline').scrollIntoView({ block: 'nearest' });
    });
  }

  function tick() {
    const now = Date.now();
    const { state: st, record } = M.currentState(data);
    const node = document.querySelector('[data-hero-timer]');
    if (node && record && st === 'running') node.textContent = M.fmtDuration(M.duration(record));
    document.querySelectorAll('[data-dur]').forEach((span) => {
      const rec = data.records.find((r) => r.id === span.dataset.dur);
      if (rec && !rec.end) span.textContent = `· ${M.fmtDuration(M.duration(rec, now))}`;
    });
  }

  /* 本地编辑入口：只有当本站真的存在 edit.html 时才出现。
     本地 python/git 服务 → HEAD 200 → 按钮出现；
     GitHub Pages 白名单里没有 edit.html → HEAD 404 → 不出现任何编辑入口。 */
  async function mountAdminEntry() {
    const forced = new URLSearchParams(location.search).has('admin');
    let ok = forced || location.protocol === 'file:';
    if (!ok) {
      try {
        // 只有本站真的存在 edit.html（且是真 HTML）才渲染按钮：
        // GitHub Pages 白名单里没有它 → 404 → 不渲染任何入口
        const res = await fetch('edit.html', { method: 'HEAD', cache: 'no-store' });
        ok = res.ok && (res.headers.get('content-type') || '').includes('text/html');
      } catch (e) {
        ok = false;
      }
    }
    if (!ok) return;
    const link = document.createElement('a');
    link.className = 'btn btn--secondary';
    link.href = 'edit.html';
    link.title = '本地编辑页（不会部署到 GitHub Pages）';
    link.innerHTML =
      '<svg class="icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.4 3.6l3 3-8.9 8.9-3.8.8.8-3.8z"/><path d="M12 5l3 3"/></svg>编辑状态';
    const bar = document.querySelector('.commandbar');
    const toggle = bar && bar.querySelector('[data-theme-toggle]');
    if (bar) bar.insertBefore(link, toggle || null);
    UI.prefetchLinks();
  }

  async function boot() {
    UI.initTheme();
    const hasLocal = !!M.loadLocal();
    $('#local-banner').hidden = !hasLocal;
    data = await M.load();
    wire();
    paint();
    UI.mountFooter('#page-footer', data);
    mountAdminEntry();

    // 秒级只更新时长文案（不重排 DOM）；每 60 秒整块重绘（跨天、记录自动收尾）
    setInterval(tick, 1000);
    setInterval(() => {
      if (!document.hidden) paint();
    }, 60000);

    // 只读访客：每 5 分钟静默拉取最新数据文件
    if (!hasLocal) {
      setInterval(async () => {
        try {
          data = await M.fetchFile();
          paint();
        } catch (e) {
          /* 离线观看时保持现有内容 */
        }
      }, 300000);
    }
  }

  boot();
})();
