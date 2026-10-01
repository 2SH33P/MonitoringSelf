/* 观看页：加载数据 → 渲染总览 / 指标 / 时间线，并让「已持续」秒级走动。 */
(function () {
  'use strict';
  const M = window.Monitoring;
  const UI = window.MonitoringUI;
  const $ = (s) => document.querySelector(s);

  let data = null;

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

    // 记录集合变化才重排时间线；否则只刷新时长文案，避免打断阅读
    const sig = data.records.map((r) => r.id + r.updatedAt).join('|');
    if (sig !== paint.sig) {
      paint.sig = sig;
      $('#timeline').innerHTML = UI.timelineHtml(data.records, now);
      return;
    }
    const list = [...data.records].sort(M.byStartDesc);
    document.querySelectorAll('[data-dur]').forEach((span) => {
      const r = list[+span.dataset.dur];
      if (r) span.textContent = `· ${M.fmtDuration(M.duration(r, now))}`;
    });
  }

  async function boot() {
    UI.initTheme();
    const hasLocal = !!M.loadLocal();
    $('#local-banner').hidden = !hasLocal;
    data = await M.load();
    paint();
    UI.mountFooter('#page-footer', data);

    // 秒级刷新「已持续」；每 60 秒整块重绘一次（跨越整天 / 记录自动收尾）
    setInterval(() => {
      const { state, record } = M.currentState(data);
      const node = document.querySelector('[data-hero-timer]');
      if (node && record && state === 'running') node.textContent = M.fmtDuration(M.duration(record));
    }, 1000);
    setInterval(paint, 60000);

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
