/* 管理页：状态的开始 / 结束 / 编辑 + 记录管理（搜索、翻页）+ 本地保存 + GitHub 同步（含自动同步）。 */
(function () {
  'use strict';
  const M = window.Monitoring;
  const UI = window.MonitoringUI;
  const $ = (s) => document.querySelector(s);

  let data = null;
  let editingId = null; // 非空 = 正在编辑某条记录
  let autoTimer = 0;
  const MAX_ACTIVITY = 60;
  const listState = { q: '', page: 1, size: 8 };

  /* ================= 表单 ================= */
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

  /* 按钮文案跟着「开始 / 补记 / 保存修改」切换 */
  function renderSubmitLabel() {
    $('#submit-btn').textContent = editingId ? '保存修改' : $('#ongoing').checked ? '开始' : '补记';
    $('#composer-tab').textContent = editingId ? '编辑记录' : '开始新状态';
  }

  function resetForm() {
    editingId = null;
    $('#activity').value = '';
    $('#note').value = '';
    $('#kind').value = data && data.records[0] ? data.records[0].kind : 'work';
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
    $('#editing-hint').textContent = `编辑中：${M.fmtDateTime(rec.start)} 的这条记录`;
    $('#cancel-edit').classList.remove('hide');
    renderCounter();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('#activity').focus();
  }

  /* ================= 状态机：开始 / 结束 ================= */
  function runningRecord() {
    const cur = M.currentState(data);
    return cur.state === 'running' ? cur.record : null;
  }

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
    const running = runningRecord();
    let next = data;
    let message;
    if (running && !rec.end && M.ts(rec.start) > M.ts(running.start)) {
      next = M.stopRecord(next, running.id, rec.start); // 开始新状态 = 自动结束上一条
      message = `已结束「${running.activity}」并开始「${rec.activity}」`;
    } else {
      message = rec.end ? `已补记「${rec.activity}」${M.fmtDuration(M.duration(rec))}` : `已开始「${rec.activity}」`;
    }
    commit(M.upsertRecord(next, rec), message);
    resetForm();
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
    commit(M.upsertRecord(data, rec), '记录已更新');
    resetForm();
  }

  function stopState(id) {
    const rec = data.records.find((r) => r.id === id) || runningRecord();
    if (!rec) return;
    const span = M.fmtDuration(M.duration(rec));
    commit(M.stopRecord(data, id || rec.id), `已结束「${rec.activity}」，本次 ${span}`);
  }

  /* ================= 渲染 ================= */
  function commit(next, message) {
    data = M.saveLocal(next);
    listState.page = 1;
    paint();
    UI.toast(message);
    scheduleAutoPush(message);
  }

  function renderNow() {
    const now = Date.now();
    const { state, record } = M.currentState(data, now);
    const box = $('#now-body');
    const running = state === 'running' && record;

    if (running) {
      const kind = M.kindOf(record.kind);
      box.innerHTML = `<div class="stack">
        <div class="row row--between">
          ${UI.presenceHtml(kind.tone, kind.label, true)}
          <span class="caption1">起始 ${UI.esc(M.fmtDateTime(record.start))}</span>
        </div>
        <p class="hero__activity">${UI.esc(record.activity || '(未填写活动内容)')}</p>
        <div class="row">
          <span class="hero__timer" data-now-timer>${UI.esc(M.fmtDuration(M.duration(record, now)))}</span>
          <span class="caption1">已持续</span>
        </div>
        ${record.note ? `<div class="note-box">${UI.esc(record.note)}</div>` : ''}
        <div class="actions-row">
          <button class="btn btn--primary" type="button" data-act="stop" data-id="${record.id}">${UI.icon('stop', 20)}结束当前状态</button>
          <button class="btn btn--secondary" type="button" data-act="edit" data-id="${record.id}">${UI.icon('edit', 20)}修改这条</button>
        </div>
      </div>`;
      const hint = $('#running-hint');
      hint.hidden = false;
      hint.innerHTML = `<span>正在进行：${UI.esc(record.activity)}（已持续 ${UI.esc(M.fmtDuration(M.duration(record, now)))}）—— 在这里填新内容点「开始」，会自动结束上一条。</span>`;
      return;
    }

    hintOff();
    const last = record;
    box.innerHTML = `<div class="stack">
      <div class="row row--between">
        ${UI.presenceHtml(state === 'planned' ? 'away' : 'offline', state === 'planned' ? '计划中' : '当前空闲', true)}
        ${last ? `<span class="caption1">最近 ${UI.esc(M.fmtRelative(last.end || last.start, now))}</span>` : ''}
      </div>
      ${
        last
          ? `<p class="body1 muted">最近一条：<span class="body1Strong">${UI.esc(last.activity)}</span> · ${UI.esc(M.fmtDuration(M.duration(last, now)))}（${UI.esc(M.fmtDateTime(last.start))} → ${last.end ? UI.esc(M.fmtDateTime(last.end)) : '进行中'}）</p>`
          : '<p class="body1 muted">还没有任何记录，写下要开始做的事，点「开始」。</p>'
      }
      <div class="actions-row">
        <button class="btn btn--primary" type="button" data-act="focus-composer">${UI.icon('edit', 20)}开始新状态</button>
      </div>
    </div>`;
  }

  function hintOff() {
    const hint = $('#running-hint');
    hint.hidden = true;
    hint.textContent = '';
  }

  function renderRecords() {
    const now = Date.now();
    $('#count-hint').textContent = data.records.length
      ? `共 ${data.records.length} 条 · 进行中的记录可随时「结束」`
      : '';
    const matched = UI.filterRecords(data.records, listState.q);
    const pg = UI.paginate(matched, listState.page, listState.size);
    listState.page = pg.page;
    $('#records-hint').textContent = listState.q ? `匹配 ${pg.total} 条` : '按起始时间倒序';
    $('#records-empty').innerHTML = pg.total
      ? ''
      : `<div class="empty">${UI.icon('clock', 32)}<p class="subtitle2">${listState.q ? '没有匹配的记录' : '还没有任何记录'}</p><p class="body1 muted">${
          listState.q ? '换个关键词试试。' : '在上面写下这一刻在做什么，然后点「开始」。'
        }</p></div>`;

    $('#records-pager').innerHTML = UI.pagerHtml(pg.page, pg.pages, pg.total, pg.size);
    $('#records').innerHTML = pg.items
      .map((r) => {
        const running = !r.end || M.ts(r.end) > now;
        const p = UI.presenceOf(r, now);
        return `<tr>
        <td data-label="活动内容">
          <div class="body1Strong">${UI.esc(r.activity || '(未填写活动内容)')}</div>
          ${r.note ? `<div class="caption1 cell-note">${UI.esc(r.note.slice(0, 80))}${r.note.length > 80 ? '…' : ''}</div>` : ''}
        </td>
        <td data-label="状态">${UI.presenceHtml(p.tone, p.text)}</td>
        <td data-label="起止" class="num caption1">${UI.esc(M.fmtDateTime(r.start))}<br>→ ${r.end ? UI.esc(M.fmtDateTime(r.end)) : '进行中'}</td>
        <td data-label="时长" class="num">${UI.esc(M.fmtDuration(M.duration(r, now)))}</td>
        <td data-label="操作"><div class="row-actions">
          ${running ? `<button class="btn btn--subtle" data-act="stop" data-id="${r.id}" type="button">${UI.icon('stop', 16)}结束</button>` : ''}
          <button class="btn btn--subtle" data-act="edit" data-id="${r.id}" type="button">${UI.icon('edit', 16)}编辑</button>
          <button class="btn btn--danger" data-act="delete" data-id="${r.id}" type="button">${UI.icon('delete', 16)}删除</button>
        </div></td>
      </tr>`;
      })
      .join('');
  }

  function renderIdentity() {
    UI.applyIdentity(data, Date.now());
    $('#owner-name').value = data.owner.name || '';
    $('#owner-bio').value = data.owner.bio || '';
  }

  function renderSyncState() {
    const cfg = M.syncConfig();
    const local = M.loadLocal();
    $('#sync-state').innerHTML =
      UI.presenceHtml(cfg ? 'available' : 'offline', cfg ? 'GitHub 已配置' : '仅本地') +
      (cfg
        ? `<span class="caption1 mono">${UI.esc(cfg.owner)}/${UI.esc(cfg.repo)}@${UI.esc(cfg.branch)}</span>`
        : '<span class="caption1">数据存在本机浏览器；配置 GitHub 后可自动发布给其他人看。</span>') +
      (local ? `<span class="caption1">· 最后保存 ${UI.esc(M.fmtRelative(local.updatedAt))}</span>` : '');
    const autoOn = !!(cfg && cfg.auto);
    $('#auto-sync').checked = autoOn;
    $('#auto-sync').disabled = !cfg;
    $('#sync-flag').textContent = autoOn ? '自动同步已开启' : '自动同步关闭';
  }

  function paint() {
    renderNow();
    renderRecords();
    renderIdentity();
    renderSyncState();
  }

  /* ================= 自动同步 ================= */
  function scheduleAutoPush(message) {
    const cfg = M.syncConfig();
    if (!cfg || !cfg.auto) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => pushRemote(`chore(status): ${message}`, true), 1200);
  }

  /* ================= GitHub 操作 ================= */
  async function withBusy(btn, label, fn) {
    const span = btn.querySelector('span') || btn;
    const old = span.textContent;
    btn.disabled = true;
    span.textContent = label;
    try {
      await fn();
    } catch (e) {
      UI.toast(e.message || String(e), 'error', 6000);
    } finally {
      btn.disabled = false;
      span.textContent = old;
    }
  }

  async function pushRemote(message, silent) {
    const cfg = M.syncConfig();
    if (!cfg) {
      if (!silent) {
        UI.toast('请先在「同步设置」里填写仓库与 Token', 'error');
        openSyncDialog();
      }
      return false;
    }
    const btn = $('#push-btn');
    const span = btn.querySelector('span');
    const old = span.textContent;
    if (!silent) {
      btn.disabled = true;
      span.textContent = '发布中…';
    }
    try {
      const merged = await M.push(data, message || `chore(status): 更新状态记录 (${new Date().toISOString().slice(0, 16)})`);
      data = M.saveLocal(merged);
      paint();
      UI.toast(silent ? '已自动同步到 GitHub' : '已提交到 GitHub，Pages 约 1 分钟后更新', 'ok', silent ? 2200 : 5000);
      return true;
    } catch (e) {
      UI.toast(`同步失败：${e.message || e}`, 'error', 6000);
      return false;
    } finally {
      if (!silent) {
        btn.disabled = false;
        span.textContent = old;
      }
    }
  }

  async function pullRemote() {
    if (!M.syncConfig()) {
      UI.toast('请先配置 GitHub 同步', 'error');
      openSyncDialog();
      return;
    }
    await withBusy($('#pull-btn'), '拉取中…', async () => {
      const { data: remote } = await M.pull();
      if (!remote) {
        UI.toast('远程还没有 data/status.json', 'error');
        return;
      }
      data = M.saveLocal(M.merge(data, remote));
      paint();
      UI.toast('已合并远程数据');
    });
  }

  /* ================= 对话框 ================= */
  function openSyncDialog() {
    const cfg = M.syncConfig() || {};
    $('#cfg-owner').value = cfg.owner || '';
    $('#cfg-repo').value = cfg.repo || '';
    $('#cfg-branch').value = cfg.branch || 'main';
    $('#cfg-path').value = cfg.path || M.DATA_FILE;
    $('#cfg-token').value = cfg.token || '';
    $('#cfg-auto').checked = !!cfg.auto;
    $('#sync-dialog').classList.remove('hide');
  }

  const closeSyncDialog = () => $('#sync-dialog').classList.add('hide');

  function togglePanel(name, force) {
    const panel = $(`#panel-${name}`);
    const btn = document.querySelector(`[data-toggle="${name}"]`);
    const open = force === undefined ? panel.hidden : force;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }

  /* ================= 事件 ================= */
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
    $('#reset-btn').addEventListener('click', resetForm);
    $('#cancel-edit').addEventListener('click', resetForm);
    $('#activity').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') (editingId ? saveEdit : startState)();
    });

    // 当前状态控制台 + 记录表，共用一套动作
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const rec = data.records.find((r) => r.id === btn.dataset.id);
      if (act === 'stop') stopState(btn.dataset.id);
      else if (act === 'edit' && rec) startEdit(rec);
      else if (act === 'focus-composer') {
        $('#activity').focus();
        $('#activity').scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else if (act === 'delete' && rec) {
        if (confirm(`删除「${rec.activity}」这条记录？`)) commit(M.removeRecord(data, rec.id), '记录已删除');
      }
    });

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

    ['#owner-name', '#owner-bio'].forEach((s) =>
      $(s).addEventListener('change', () => {
        data = M.saveLocal({
          ...data,
          owner: { name: $('#owner-name').value.trim(), bio: $('#owner-bio').value.trim() }
        });
        paint();
        UI.toast('身份信息已保存');
        scheduleAutoPush('chore(status): 更新身份信息');
      })
    );

    $('#save-local').addEventListener('click', () => {
      data = M.saveLocal(data);
      renderSyncState();
      UI.toast('已保存到本机浏览器（data/status.json 内容）');
    });

    $('#push-btn').addEventListener('click', () => pushRemote());
    $('#pull-btn').addEventListener('click', pullRemote);
    $('#sync-btn').addEventListener('click', openSyncDialog);
    $('#sync-cancel').addEventListener('click', closeSyncDialog);

    $('#sync-save').addEventListener('click', () => {
      const cfg = {
        owner: $('#cfg-owner').value.trim(),
        repo: $('#cfg-repo').value.trim(),
        branch: $('#cfg-branch').value.trim() || 'main',
        path: $('#cfg-path').value.trim() || M.DATA_FILE,
        token: $('#cfg-token').value.trim(),
        auto: $('#cfg-auto').checked
      };
      if (!cfg.token) {
        UI.toast('缺少 Token，无法发布', 'error');
        return;
      }
      M.saveSyncConfig(cfg);
      closeSyncDialog();
      renderSyncState();
      UI.toast(cfg.auto ? '同步设置已保存，自动同步已开启' : '同步设置已保存');
    });
    $('#sync-clear').addEventListener('click', () => {
      M.saveSyncConfig(null);
      closeSyncDialog();
      renderSyncState();
      UI.toast('已清除同步配置');
    });

    $('#auto-sync').addEventListener('change', (e) => {
      const cfg = M.syncConfig();
      if (!cfg) return;
      M.saveSyncConfig({ ...cfg, auto: e.target.checked });
      renderSyncState();
      UI.toast(e.target.checked ? '自动同步已开启：开始 / 结束 / 修改后自动提交' : '自动同步已关闭');
      if (e.target.checked) pushRemote('chore(status): 开启自动同步', true);
    });

    $('#export-btn').addEventListener('click', () => {
      M.exportFile(data);
      UI.toast('已导出 JSON，可覆盖 data/status.json 后提交');
    });
    $('#import-btn').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const parsed = M.normalize(JSON.parse(await file.text()));
        commit(M.merge(data, parsed), '导入完成（按 id 合并）');
      } catch (err) {
        UI.toast('导入失败：文件不是合法 JSON', 'error');
      }
      e.target.value = '';
    });
    $('#clear-btn').addEventListener('click', () => {
      if (!confirm('清空全部状态记录？此操作不可撤销（可先导出 JSON 备份）。')) return;
      commit({ ...data, records: [] }, '已清空记录');
      resetForm();
    });
  }

  /* 每秒只刷新计时文本 */
  function tick() {
    const running = runningRecord();
    const node = document.querySelector('[data-now-timer]');
    if (running && node) node.textContent = M.fmtDuration(M.duration(running));
  }

  async function boot() {
    UI.initTheme();
    UI.prefetchLinks();
    fillKinds();
    data = await M.load();
    resetForm();
    paint();
    bind();
    UI.mountFooter('#page-footer', data);
    setInterval(tick, 1000);
    setInterval(() => {
      if (!document.hidden) paint();
    }, 60000);
  }

  boot();
})();
