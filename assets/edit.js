/* 编辑页：状态的开始 / 结束 / 补记 / 修改（自动同步由 App.commit 统一触发）。 */
(function () {
  'use strict';
  const M = window.Monitoring;
  const UI = window.MonitoringUI;
  const App = window.MonitoringApp;
  const $ = (s) => document.querySelector(s);

  let editingId = null;
  const MAX_ACTIVITY = 60;

  /* ---------------- 表单 ---------------- */
  function fillKinds() {
    $('#kind').innerHTML = M.KINDS.map((k) => `<option value="${k.id}">${UI.esc(k.label)}</option>`).join('');
  }

  function draftRecord() {
    const ongoing = $('#ongoing').checked;
    const startVal = $('#start').value;
    return {
      id: editingId || M.uid(),
      activity: $('#activity').value.trim(),
      kind: $('#kind').value,
      start: startVal ? M.fromLocalInput(startVal) : new Date().toISOString(),
      end: ongoing || !$('#end').value ? '' : M.fromLocalInput($('#end').value),
      note: $('#note').value.trim(),
      updatedAt: new Date().toISOString()
    };
  }

  function renderCounter() {
    const left = MAX_ACTIVITY - $('#activity').value.length;
    const el = $('#counter');
    el.textContent = left >= 0 ? `还可以输入 ${left} 字` : `已超出 ${-left} 字`;
    el.classList.toggle('counter--over', left < 0);
    renderSubmitLabel();
  }

  function renderSubmitLabel() {
    $('#submit-btn').textContent = editingId ? '保存修改' : $('#ongoing').checked ? '开始' : '补记';
    $('#composer-tab').textContent = editingId ? '修改记录' : '开始新状态';
  }

  function resetForm() {
    editingId = null;
    $('#activity').value = '';
    $('#note').value = '';
    $('#kind').value = App.data.records[0] ? App.data.records[0].kind : 'work';
    $('#ongoing').checked = true;
    $('#end').value = '';
    $('#end').disabled = true;
    $('#start').value = M.toLocalInput();
    $('#editing-hint').textContent = '';
    $('#cancel-edit').classList.add('hide');
    renderCounter();
  }

  function startEdit(rec) {
    editingId = rec.id;
    $('#activity').value = rec.activity;
    $('#note').value = rec.note || '';
    $('#kind').value = rec.kind;
    $('#start').value = M.toLocalInput(rec.start);
    $('#ongoing').checked = !rec.end;
    $('#end').disabled = !rec.end;
    $('#end').value = rec.end ? M.toLocalInput(rec.end) : '';
    if (rec.note) togglePanel('note', true);
    $('#editing-hint').textContent = `修改中：${M.fmtDateTime(rec.start)} 的这条`;
    $('#cancel-edit').classList.remove('hide');
    renderCounter();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('#activity').focus();
  }

  /* ---------------- 开始 / 修改 ---------------- */
  function startState() {
    const rec = draftRecord();
    if (!rec.activity) {
      UI.toast('先写一下要开始做什么', 'error');
      $('#activity').focus();
      return;
    }
    if (rec.end && M.ts(rec.end) <= M.ts(rec.start)) {
      UI.toast('终止时间必须晚于起始时间', 'error');
      return;
    }
    const cur = M.currentState(App.data);
    const running = cur.state === 'running' ? cur.record : null;
    let next = App.data;
    let message;
    if (running && !rec.end && M.ts(rec.start) > M.ts(running.start)) {
      next = M.stopRecord(next, running.id, rec.start); // 开始新状态 = 自动结束上一条
      message = `已结束「${running.activity}」并开始「${rec.activity}」`;
    } else {
      message = rec.end ? `已补记「${rec.activity}」，${M.fmtDuration(M.duration(rec))}` : `已开始「${rec.activity}」`;
    }
    App.commit(M.upsertRecord(next, rec), message);
    resetForm();
    renderNow();
    history.replaceState(null, '', location.pathname);
  }

  function saveEdit() {
    const rec = draftRecord();
    if (!rec.activity) {
      UI.toast('活动内容不能为空', 'error');
      return;
    }
    if (rec.end && M.ts(rec.end) <= M.ts(rec.start)) {
      UI.toast('终止时间必须晚于起始时间', 'error');
      return;
    }
    App.commit(M.upsertRecord(App.data, rec), '记录已更新');
    resetForm();
    renderNow();
    history.replaceState(null, '', location.pathname);
  }

  /* ---------------- 渲染 ---------------- */
  function renderNow() {
    const now = Date.now();
    const cur = M.currentState(App.data, now);
    $('#now-body').innerHTML = App.nowHtml(now, 'focus');
    $('#sync-flag').textContent = App.syncFlag();

    const hint = $('#running-hint');
    if (cur.state === 'running' && cur.record) {
      hint.hidden = false;
      hint.innerHTML = `正在进行：${UI.esc(cur.record.activity)}（已持续 ${UI.esc(
        M.fmtDuration(M.duration(cur.record, now))
      )}）—— 在这里填新内容点「开始」，会自动结束上一条。`;
    } else {
      hint.hidden = true;
      hint.textContent = '';
    }
  }

  function togglePanel(name, force) {
    const panel = $(`#panel-${name}`);
    const btn = document.querySelector(`[data-toggle="${name}"]`);
    const open = force === undefined ? panel.hidden : force;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    $('#activity').addEventListener('input', renderCounter);
    ['input', 'change'].forEach((ev) => {
      ['#kind', '#note', '#start', '#end'].forEach((s) => $(s).addEventListener(ev, renderCounter));
    });
    $('#ongoing').addEventListener('change', (e) => {
      $('#end').disabled = e.target.checked;
      if (e.target.checked) $('#end').value = '';
      renderSubmitLabel();
    });
    document.querySelectorAll('[data-toggle]').forEach((btn) =>
      btn.addEventListener('click', () => togglePanel(btn.dataset.toggle))
    );

    $('#submit-btn').addEventListener('click', () => (editingId ? saveEdit() : startState()));
    $('#reset-btn').addEventListener('click', () => {
      resetForm();
      renderNow();
    });
    $('#cancel-edit').addEventListener('click', () => {
      resetForm();
      renderNow();
      history.replaceState(null, '', location.pathname);
    });
    $('#activity').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') (editingId ? saveEdit() : startState)();
    });

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'focus-composer') {
        $('#activity').focus();
        $('#activity').scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else if (act === 'stop') {
        if (App.stop(btn.dataset.id)) renderNow();
      } else if (act === 'edit') {
        const rec = App.data.records.find((r) => r.id === btn.dataset.id);
        if (rec) startEdit(rec);
      }
    });
  }

  async function boot() {
    await App.mount();
    fillKinds();
    resetForm();
    const id = new URLSearchParams(location.search).get('id');
    const rec = id ? App.data.records.find((r) => r.id === id) : null;
    if (rec) startEdit(rec);
    renderNow();
    bind();
    UI.mountFooter('#page-footer', App.data);
    setInterval(App.tick, 1000);
    setInterval(renderNow, 60000);
  }

  boot();
})();
