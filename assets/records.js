/* 记录页：全部记录 + 搜索 + 翻页 + 结束 / 编辑 / 删除。 */
(function () {
  'use strict';
  const M = window.Monitoring;
  const UI = window.MonitoringUI;
  const App = window.MonitoringApp;
  const $ = (s) => document.querySelector(s);

  const listState = { q: '', page: 1, size: 10 };

  function renderRecords() {
    const now = Date.now();
    $('#count-hint').textContent = App.data.records.length ? `共 ${App.data.records.length} 条` : '';
    const matched = UI.filterRecords(App.data.records, listState.q);
    const pg = UI.paginate(matched, listState.page, listState.size);
    listState.page = pg.page;
    $('#records-hint').textContent = listState.q ? `匹配 ${pg.total} 条` : '按起始时间倒序';

    $('#records-empty').innerHTML = pg.total
      ? ''
      : `<div class="empty">${UI.icon('clock', 32)}<p class="subtitle2">${
          listState.q ? '没有匹配的记录' : '还没有任何记录'
        }</p><p class="body1 muted">${
          listState.q ? '换个关键词试试。' : '去「编辑状态」写下这一刻在做什么。'
        }</p></div>`;

    $('#records-pager').innerHTML = UI.pagerHtml(pg.page, pg.pages, pg.total, pg.size);
    $('#records').innerHTML = pg.items
      .map((r) => {
        const p = UI.presenceOf(r, now);
        return `<tr>
        <td data-label="活动内容">
          <div class="body1Strong">${UI.esc(r.activity || '(未填写活动内容)')}</div>
          ${r.note ? `<div class="caption1 cell-note">${UI.esc(r.note.slice(0, 80))}${r.note.length > 80 ? '…' : ''}</div>` : ''}
        </td>
        <td data-label="状态">${UI.presenceHtml(p.tone, p.text)}</td>
        <td data-label="起止" class="num caption1">${UI.esc(M.fmtDateTime(r.start))}<br>→ ${
          r.end ? UI.esc(M.fmtDateTime(r.end)) : '进行中'
        }</td>
        <td data-label="时长" class="num">${UI.esc(M.fmtDuration(M.duration(r, now)))}</td>
        <td data-label="操作"><div class="row-actions">
          <a class="btn btn--subtle" href="edit.html?id=${encodeURIComponent(r.id)}">${UI.icon('edit', 16)}编辑</a>
          <button class="btn btn--danger" data-act="delete" data-id="${r.id}" type="button">${UI.icon('delete', 16)}删除</button>
        </div></td>
      </tr>`;
      })
      .join('');
  }

  function paint() {
    renderRecords();
  }

  function wire() {
    let searchTimer = 0;
    $('#records-q').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      const value = e.target.value;
      searchTimer = setTimeout(() => {
        listState.q = value;
        listState.page = 1;
        renderRecords();
      }, 150);
    });

    $('#records-pager').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-page]');
      if (!btn || btn.disabled) return;
      listState.page = Number(btn.dataset.page);
      renderRecords();
      $('#records').scrollIntoView({ block: 'nearest' });
    });

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.act === 'delete') {
        const rec = App.data.records.find((r) => r.id === id);
        if (rec && confirm(`删除「${rec.activity}」这条记录？`)) {
          App.commit(M.removeRecord(App.data, id), '记录已删除');
          paint();
        }
      }
    });
  }

  async function boot() {
    await App.mount();
    wire();
    paint();
    UI.mountFooter('#page-footer', App.data);
    setInterval(() => {
      if (!document.hidden) paint();
    }, 60000);
  }

  boot();
})();
