/* 编辑页：QQ 空间式发表框 + 实时预览 + 本地持久化 + GitHub 发布。 */
(function () {
  'use strict';
  const M = window.Monitoring;
  const UI = window.MonitoringUI;
  const $ = (s) => document.querySelector(s);

  let data = null;
  let editingId = null; // 非空表示正在编辑既有记录

  const MAX_ACTIVITY = 60;

  /* ---------------- 表单 ---------------- */
  function fillKinds() {
    $('#kind').innerHTML = M.KINDS.map((k) => `<option value="${k.id}">${UI.esc(k.label)}</option>`).join('');
  }

  function draftRecord() {
    const startVal = $('#start').value;
    const ongoing = $('#ongoing').checked;
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

  function formHasContent() {
    return !!($('#activity').value.trim() || $('#note').value.trim());
  }

  function renderCounter() {
    const left = MAX_ACTIVITY - $('#activity').value.length;
    const el = $('#counter');
    el.textContent = left >= 0 ? `还可以输入 ${left} 字` : `已超出 ${-left} 字`;
    el.classList.toggle('counter--over', left < 0);
  }

  function resetForm(keepTimes) {
    editingId = null;
    $('#activity').value = '';
    $('#note').value = '';
    $('#kind').value = 'work';
    $('#ongoing').checked = true;
    $('#end').value = '';
    $('#end').disabled = true;
    $('#start').value = M.toLocalInput();
    $('#composer-tab').textContent = '发表状态';
    $('#submit-btn').textContent = '发表';
    $('#editing-hint').textContent = '';
    $('#cancel-edit').classList.add('hide');
    if (keepTimes && keepTimes.start) $('#start').value = keepTimes.start;
    renderCounter();
    renderPreview();
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
    $('#composer-tab').textContent = '编辑状态';
    $('#submit-btn').textContent = '保存修改';
    $('#editing-hint').textContent = `正在编辑：${M.fmtDateTime(rec.start)} 开始的记录`;
    $('#cancel-edit').classList.remove('hide');
    if (rec.note) togglePanel('note', true);
    renderCounter();
    renderPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- 提交 ---------------- */
  function submit() {
    const rec = draftRecord();
    if (!rec.activity) {
      UI.toast('请先填写活动内容', 'error');
      $('#activity').focus();
      return;
    }
    if (rec.activity.length > MAX_ACTIVITY) {
      UI.toast(`活动内容最多 ${MAX_ACTIVITY} 字`, 'error');
      return;
    }
    if (rec.end && M.ts(rec.end) <= M.ts(rec.start)) {
      UI.toast('终止时间必须晚于起始时间', 'error');
      return;
    }
    const isEdit = !!editingId;
    commit(M.upsertRecord(data, rec), isEdit ? '记录已更新（保存在本地）' : '状态已发表（保存在本地）');
    resetForm();
  }

  function commit(next, message) {
    data = M.saveLocal(next);
    renderRecords();
    renderPreview();
    renderSyncState();
    UI.toast(message);
  }

  /* ---------------- 渲染 ---------------- */
  function renderRecords() {
    const now = Date.now();
    const body = $('#records');
    const list = [...data.records].sort(M.byStartDesc);
    $('#count-hint').textContent = list.length ? `共 ${list.length} 条 · 点「结束」可给进行中的记录补上终止时间` : '';
    $('#records-empty').innerHTML = list.length
      ? ''
      : `<div class="empty">${UI.icon('clock', 32)}<p class="subtitle2">还没有任何记录</p><p class="body1 muted">在上面写下这一刻在做什么，然后点「发表」。</p></div>`;
    body.innerHTML = list
      .map((r) => {
        const running = !r.end || M.ts(r.end) > now;
        const p = UI.presenceOf(r, now);
        return `<tr>
        <td>
          <div class="body1Strong">${UI.esc(r.activity || '(未填写活动内容)')}</div>
          ${r.note ? `<div class="caption1" style="margin-top:4px">${UI.esc(r.note.slice(0, 80))}${r.note.length > 80 ? '…' : ''}</div>` : ''}
        </td>
        <td>${UI.presenceHtml(p.tone, p.text)}</td>
        <td class="num caption1">${UI.esc(M.fmtDateTime(r.start))}<br>→ ${r.end ? UI.esc(M.fmtDateTime(r.end)) : '进行中'}</td>
        <td class="num">${UI.esc(M.fmtDuration(M.duration(r, now)))}</td>
        <td><div class="row-actions">
          ${running ? `<button class="btn btn--subtle" data-act="stop" data-id="${r.id}" type="button">${UI.icon('stop', 16)}结束</button>` : ''}
          <button class="btn btn--subtle" data-act="edit" data-id="${r.id}" type="button">${UI.icon('edit', 16)}编辑</button>
          <button class="btn btn--danger" data-act="delete" data-id="${r.id}" type="button">${UI.icon('delete', 16)}删除</button>
        </div></td>
      </tr>`;
      })
      .join('');
  }

  function previewData() {
    if (!formHasContent() && !editingId) return data;
    const rec = draftRecord();
    const others = data.records.filter((r) => r.id !== rec.id);
    return M.normalize({ ...data, records: [rec, ...others] });
  }

  function renderPreview() {
    const now = Date.now();
    const view = previewData();
    UI.applyIdentity(view, now);
    $('#preview-hero').innerHTML = UI.heroHtml(view, now);
    $('#preview-timeline').innerHTML = UI.timelineHtml(view.records.slice(0, 3), now, '发表后，记录会出现在时间线里。');
  }

  function renderSyncState() {
    const cfg = M.syncConfig();
    const local = M.loadLocal();
    $('#sync-state').innerHTML =
      UI.presenceHtml(cfg ? 'available' : 'offline', cfg ? 'GitHub 已配置' : '仅本地') +
      (cfg
        ? `<span class="caption1 mono">${UI.esc(cfg.owner)}/${UI.esc(cfg.repo)}@${UI.esc(cfg.branch)} · ${UI.esc(cfg.path)}</span>`
        : '<span class="caption1">数据存在本机浏览器；配置 GitHub 后可一键发布给其他人看。</span>') +
      (local ? `<span class="caption1">· 最后保存 ${UI.esc(M.fmtRelative(local.updatedAt))}</span>` : '');
  }

  function togglePanel(name, force) {
    const panel = $(`#panel-${name}`);
    const btn = document.querySelector(`[data-toggle="${name}"]`);
    const open = force === undefined ? panel.hidden : force;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }

  /* ---------------- 远端操作 ---------------- */
  async function withBusy(btn, label, fn) {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try {
      await fn();
    } catch (e) {
      UI.toast(e.message || String(e), 'error', 6000);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  async function pushRemote(message) {
    if (!M.syncConfig()) {
      UI.toast('请先在「同步设置」里填写仓库与 Token', 'error');
      openSyncDialog();
      return;
    }
    await withBusy($('#push-btn'), '发布中…', async () => {
      const merged = await M.push(data, message || `chore(status): 更新状态记录 (${new Date().toISOString().slice(0, 16)})`);
      data = M.saveLocal(merged);
      renderRecords();
      renderPreview();
      renderSyncState();
      UI.toast('已提交到 GitHub，Pages 约 1 分钟后更新', 'ok', 5000);
    });
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
      const merged = M.merge(data, remote);
      data = M.saveLocal(merged);
      fillOwnerInputs();
      renderRecords();
      renderPreview();
      renderSyncState();
      UI.toast('已合并远程数据');
    });
  }

  /* ---------------- 对话框 ---------------- */
  function openSyncDialog() {
    const cfg = M.syncConfig() || {};
    $('#cfg-owner').value = cfg.owner || '';
    $('#cfg-repo').value = cfg.repo || '';
    $('#cfg-branch').value = cfg.branch || 'main';
    $('#cfg-path').value = cfg.path || M.DATA_FILE;
    $('#cfg-token').value = cfg.token || '';
    $('#sync-dialog').classList.remove('hide');
  }

  const closeSyncDialog = () => $('#sync-dialog').classList.add('hide');

  function fillOwnerInputs() {
    $('#owner-name').value = data.owner.name || '';
    $('#owner-bio').value = data.owner.bio || '';
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $('#activity').addEventListener('input', () => {
      renderCounter();
      renderPreview();
    });
    ['#kind', '#note', '#start', '#end'].forEach((s) =>
      ['input', 'change'].forEach((ev) => $(s).addEventListener(ev, renderPreview))
    );
    $('#ongoing').addEventListener('change', (e) => {
      $('#end').disabled = e.target.checked;
      if (e.target.checked) $('#end').value = '';
      renderPreview();
    });
    document.querySelectorAll('[data-toggle]').forEach((btn) =>
      btn.addEventListener('click', () => togglePanel(btn.dataset.toggle))
    );

    $('#submit-btn').addEventListener('click', submit);
    $('#reset-btn').addEventListener('click', () => resetForm());
    $('#cancel-edit').addEventListener('click', () => resetForm());
    $('#activity').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit();
    });

    $('#records').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const rec = data.records.find((r) => r.id === btn.dataset.id);
      if (!rec) return;
      if (btn.dataset.act === 'edit') startEdit(rec);
      if (btn.dataset.act === 'stop') commit(M.stopRecord(data, rec.id), '已结束该记录');
      if (btn.dataset.act === 'delete') {
        if (confirm(`删除「${rec.activity}」这条记录？`)) commit(M.removeRecord(data, rec.id), '记录已删除');
      }
    });

    $('#owner-name').addEventListener('change', saveOwner);
    $('#owner-bio').addEventListener('change', saveOwner);
    function saveOwner() {
      data = M.saveLocal({ ...data, owner: { name: $('#owner-name').value.trim(), bio: $('#owner-bio').value.trim() } });
      renderPreview();
      UI.toast('身份信息已保存到本地');
    }

    $('#save-local').addEventListener('click', () => {
      data = M.saveLocal(data);
      renderSyncState();
      UI.toast('已保存到本机浏览器');
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
        token: $('#cfg-token').value.trim()
      };
      if (!cfg.token) {
        UI.toast('缺少 Token，无法发布', 'error');
        return;
      }
      M.saveSyncConfig(cfg);
      closeSyncDialog();
      renderSyncState();
      UI.toast('同步设置已保存');
    });
    $('#sync-clear').addEventListener('click', () => {
      M.saveSyncConfig(null);
      closeSyncDialog();
      renderSyncState();
      UI.toast('已清除同步配置');
    });

    $('#export-btn').addEventListener('click', () => {
      M.exportFile(data);
      UI.toast('已导出 JSON，可放到 data/status.json 后提交');
    });
    $('#import-btn').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const parsed = M.normalize(JSON.parse(await file.text()));
        data = M.saveLocal(M.merge(data, parsed));
        fillOwnerInputs();
        renderRecords();
        renderPreview();
        renderSyncState();
        UI.toast('导入完成（按 id 合并）');
      } catch (err) {
        UI.toast('导入失败：文件不是合法 JSON', 'error');
      }
      e.target.value = '';
    });
    $('#clear-btn').addEventListener('click', () => {
      if (!confirm('清空全部状态记录？此操作不可撤销（可先导出 JSON 备份）。')) return;
      data = M.saveLocal({ ...data, records: [] });
      resetForm();
      renderRecords();
      renderSyncState();
      UI.toast('已清空记录');
    });
  }

  async function boot() {
    UI.initTheme();
    fillKinds();
    data = await M.load();
    fillOwnerInputs();
    resetForm();
    if (data.records.length) $('#kind').value = data.records[0].kind || 'work';
    renderRecords();
    renderSyncState();
    renderPreview();
    bind();
    UI.mountFooter('#page-footer');
    setInterval(renderPreview, 30000); // 让预览里的时长保持新鲜
  }

  boot();
})();
