/* 设置页：GitHub 同步配置 / 自动同步 / 身份信息 / 数据导入导出。 */
(function () {
  'use strict';
  const M = window.Monitoring;
  const UI = window.MonitoringUI;
  const App = window.MonitoringApp;
  const $ = (s) => document.querySelector(s);

  function fillForm() {
    const cfg = M.syncConfig() || {};
    $('#cfg-owner').value = cfg.owner || '';
    $('#cfg-repo').value = cfg.repo || '';
    $('#cfg-branch').value = cfg.branch || 'main';
    $('#cfg-path').value = cfg.path || M.DATA_FILE;
    $('#cfg-token').value = cfg.token || '';
    $('#cfg-auto').checked = !!cfg.auto;
    $('#owner-name').value = App.data.owner.name || '';
    $('#owner-bio').value = App.data.owner.bio || '';
  }

  function renderAgent(st) {
    const cfg = M.agentConfig();
    $('#agent-flag').textContent = cfg ? '已启用 · ' + App.transportName() + (cfg.auto === false ? '（自动推送关）' : '') : '未启用';
    $('#agent-auto').checked = !cfg || cfg.auto !== false;
    if (!st || !st.present) {
      $('#agent-state').innerHTML =
        UI.presenceHtml('offline', '没探测到代理') +
        '<span class="caption1">先在本机启动 <span class="mono">node tools/agent.mjs</span>，再点「保存并测试连接」</span>';
      return;
    }
    if (!st.authorized) {
      $('#agent-state').innerHTML = UI.presenceHtml('away', '代理在线 · 需要密钥') +
        '<span class="caption1">把代理启动日志里的密钥填到下面</span>';
      return;
    }
    const lp = (st.state && st.state.lastPush) || null;
    const remotes = (st.state && st.state.remotes) || [];
    $('#agent-state').innerHTML =
      UI.presenceHtml('available', '代理在线') +
      `<span class="caption1 mono">${UI.esc(remotes.map((r) => r.name).join(' + ') || '无 remote')}</span>` +
      (lp
        ? `<span class="caption1">· 最后推送 ${UI.esc(M.fmtRelative(lp.at))}${lp.ok ? ' 成功' : ' 失败'}</span>`
        : '<span class="caption1">· 还没有推送记录</span>') +
      (st.state && st.state.head ? `<span class="caption1 mono">· ${UI.esc(st.state.head)}</span>` : '');
  }

  async function probeAgent(fillDefault = false) {
    const cfg = M.agentConfig() || {};
    if (fillDefault && !$('#agent-url').value) $('#agent-url').value = cfg.url || location.origin;
    if (!cfg.key && !$('#agent-key').value && fillDefault) $('#agent-key').value = '';
    const url = $('#agent-url').value.trim() || cfg.url || location.origin;
    const key = $('#agent-key').value.trim() || cfg.key || '';
    const st = await M.agentProbe(url, key);
    renderAgent(st);
    return { st, url, key };
  }

  function renderState() {
    $('#sync-state').innerHTML = App.syncStateHtml();
    $('#data-hint').textContent = `${App.data.records.length} 条记录 · 更新于 ${M.fmtDateTime(App.data.updatedAt)}`;
  }

  function saveConfig() {
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
      return null;
    }
    M.saveSyncConfig(cfg);
    renderState();
    UI.toast(cfg.auto ? '设置已保存，自动同步已开启' : '设置已保存');
    return cfg;
  }

  async function withBusy(btn, label, fn) {
    const span = btn.querySelector('span') || btn;
    const old = span.textContent;
    btn.disabled = true;
    span.textContent = label;
    try {
      await fn();
    } finally {
      btn.disabled = false;
      span.textContent = old;
    }
  }

  function wire() {
    // ---- 本机代理 ----
    $('#agent-save').addEventListener('click', async () => {
      const { st, url, key } = await probeAgent();
      if (!st.present) return UI.toast('这个地址上没有代理响应', 'error');
      if (!st.authorized) return UI.toast('密钥不对，看代理启动日志里的那一串', 'error');
      M.saveAgentConfig({ url, key, auto: $('#agent-auto').checked });
      renderState();
      UI.toast('本机代理已启用，之后的开始/结束/修改都由机器推送');
    });

    $('#agent-push').addEventListener('click', () =>
      withBusy($('#agent-push'), '推送中…', async () => {
        await App.push();
        setTimeout(probeAgent, 1500);
      })
    );

    $('#agent-pull').addEventListener('click', () =>
      withBusy($('#agent-pull'), '拉取中…', async () => {
        try {
          const r = await M.agentPull();
          if (r && r.data) {
            App.data = M.saveLocal(M.normalize(r.data));
            fillForm();
            renderState();
            UI.toast('已从远程拉取并合并');
          }
        } catch (e) {
          UI.toast('拉取失败：' + (e.message || e), 'error', 6000);
        }
      })
    );

    $('#agent-auto').addEventListener('change', (e) => {
      const cfg = M.agentConfig();
      if (!cfg) return;
      M.saveAgentConfig({ ...cfg, auto: e.target.checked });
      UI.toast(e.target.checked ? '自动推送已开启' : '自动推送已关闭（仍可手动「立即推送」）');
    });

    $('#agent-off').addEventListener('click', () => {
      M.saveAgentConfig(null);
      renderAgent(null);
      renderState();
      UI.toast('已停用本机代理');
    });

    $('#cfg-save').addEventListener('click', saveConfig);

    $('#cfg-push').addEventListener('click', () => {
      if (!saveConfig()) return;
      withBusy($('#cfg-push'), '发布中…', async () => {
        await App.push();
        fillForm();
        renderState();
      });
    });

    $('#cfg-pull').addEventListener('click', () =>
      withBusy($('#cfg-pull'), '拉取中…', async () => {
        const merged = await App.pull();
        if (merged) {
          fillForm();
          renderState();
        }
      })
    );

    $('#cfg-auto').addEventListener('change', (e) => {
      const cfg = M.syncConfig();
      if (!cfg) {
        UI.toast('先填好 Token 再保存设置', 'error');
        e.target.checked = false;
        return;
      }
      M.saveSyncConfig({ ...cfg, auto: e.target.checked });
      renderState();
      UI.toast(e.target.checked ? '自动同步已开启：开始 / 结束 / 修改后自动提交' : '自动同步已关闭');
      if (e.target.checked) App.push('chore(status): 开启自动同步', true);
    });

    $('#cfg-clear').addEventListener('click', () => {
      if (!confirm('清除本机的 GitHub 配置（Token）？')) return;
      M.saveSyncConfig(null);
      fillForm();
      renderState();
      UI.toast('已清除同步配置');
    });

    $('#owner-save').addEventListener('click', () => {
      App.data = { ...App.data, owner: { name: $('#owner-name').value.trim(), bio: $('#owner-bio').value.trim() } };
      App.commit(App.data, '身份信息已保存');
      renderState();
    });

    $('#export-btn').addEventListener('click', () => {
      M.exportFile(App.data);
      UI.toast('已导出 JSON，可覆盖 data/status.json 后提交');
    });

    $('#import-btn').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const parsed = M.normalize(JSON.parse(await file.text()));
        App.commit(M.merge(App.data, parsed), '导入完成（按 id 合并）');
        fillForm();
        renderState();
      } catch (err) {
        UI.toast('导入失败：文件不是合法 JSON', 'error');
      }
      e.target.value = '';
    });

    $('#save-local').addEventListener('click', () => {
      App.data = M.saveLocal(App.data);
      renderState();
      UI.toast('已保存到本机浏览器（data/status.json 的内容）');
    });

    $('#clear-btn').addEventListener('click', () => {
      if (!confirm('清空全部状态记录？此操作不可撤销（可先导出 JSON 备份）。')) return;
      App.commit({ ...App.data, records: [] }, '已清空记录');
      renderState();
    });
  }

  async function boot() {
    await App.mount();
    fillForm();
    renderState();
    wire();
    probeAgent(true);
    UI.mountFooter('#page-footer', App.data);
  }

  boot();
})();
