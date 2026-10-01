/* 本地管理页共享层：数据加载、当前状态卡、提交（含自动同步）、GitHub 推送/拉取。
   edit.html / records.html / settings.html 都引它，避免三份重复逻辑。 */
(function (global) {
  'use strict';
  const M = global.Monitoring;
  const UI = global.MonitoringUI;
  let autoTimer = 0;

  const App = {
    data: null,

    async mount() {
      UI.initTheme();
      UI.prefetchLinks();
      App.data = await M.load();
      UI.applyIdentity(App.data, Date.now());
      setInterval(() => UI.applyIdentity(App.data, Date.now()), 30000);
      return App.data;
    },

    /* 当前状态卡（管理页共用）：进行中 → 结束 / 修改；空闲 → 开始新状态 */
    nowHtml(now = Date.now(), startMode = 'focus') {
      const cur = M.currentState(App.data, now);
      const rec = cur.record;

      if (!rec || cur.state !== 'running') {
        const startBtn =
          startMode === 'link'
            ? `<a class="btn btn--primary" href="edit.html">${UI.icon('edit', 20)}开始新状态</a>`
            : `<button class="btn btn--primary" type="button" data-act="focus-composer">${UI.icon('edit', 20)}开始新状态</button>`;
        return `<div class="stack">
          <div class="row row--between">
            ${UI.presenceHtml(cur.state === 'planned' ? 'away' : 'offline', cur.state === 'planned' ? '计划中' : '当前空闲', true)}
            ${rec ? `<span class="caption1">最近 ${UI.esc(M.fmtRelative(rec.end || rec.start, now))}</span>` : ''}
          </div>
          ${
            rec
              ? `<p class="body1 muted">最近一条：<span class="body1Strong">${UI.esc(rec.activity)}</span> · ${UI.esc(
                  M.fmtDuration(M.duration(rec, now))
                )}（${UI.esc(M.fmtDateTime(rec.start))} → ${rec.end ? UI.esc(M.fmtDateTime(rec.end)) : '进行中'}）</p>`
              : '<p class="body1 muted">还没有任何记录。写下要开始做的事，点「开始」。</p>'
          }
          <div class="actions-row">${startBtn}</div>
        </div>`;
      }

      const kind = M.kindOf(rec.kind);
      return `<div class="stack">
        <div class="row row--between">
          ${UI.presenceHtml(kind.tone, kind.label, true)}
          <span class="caption1">起始 ${UI.esc(M.fmtDateTime(rec.start))}</span>
        </div>
        <p class="hero__activity">${UI.esc(rec.activity || '(未填写活动内容)')}</p>
        <div class="row">
          <span class="hero__timer" data-now-timer>${UI.esc(M.fmtDuration(M.duration(rec, now)))}</span>
          <span class="caption1">已持续</span>
        </div>
        ${rec.note ? `<div class="note-box">${UI.esc(rec.note)}</div>` : ''}
        <div class="actions-row">
          <button class="btn btn--primary" type="button" data-act="stop" data-id="${rec.id}">${UI.icon('stop', 20)}结束当前状态</button>
          <button class="btn btn--secondary" type="button" data-act="edit" data-id="${rec.id}">${UI.icon('edit', 20)}修改这条</button>
        </div>
      </div>`;
    },

    /* 结束某条（默认结束正在进行的）：写本地 + 触发自动同步 */
    stop(id) {
      const cur = M.currentState(App.data);
      const rec = App.data.records.find((r) => r.id === id) || (cur.state === 'running' ? cur.record : null);
      if (!rec) return false;
      const span = M.fmtDuration(M.duration(rec));
      App.commit(M.stopRecord(App.data, rec.id), `已结束「${rec.activity}」，本次 ${span}`);
      return true;
    },

    tick() {
      const cur = M.currentState(App.data);
      const node = document.querySelector('[data-now-timer]');
      if (node && cur.state === 'running' && cur.record) node.textContent = M.fmtDuration(M.duration(cur.record));
    },

    /* 任何状态变更的唯一出口：落 localStorage → 提示 → 触发自动同步 */
    commit(next, message) {
      App.data = M.saveLocal(next);
      UI.toast(message);
      App.autoPush('chore(status): ' + message);
      return App.data;
    },

    autoPush(message) {
      const cfg = M.syncConfig();
      const agent = M.agentConfig();
      if (agent) {
        if (agent.auto === false) return;
      } else if (!cfg || !cfg.auto) {
        return;
      }
      clearTimeout(autoTimer);
      autoTimer = setTimeout(() => App.push(message, true), 1200);
    },

    /* 推送：优先本机代理（机器发请求），否则回落到浏览器直连 GitHub */
    async push(message, silent) {
      const msg = message || `chore(status): 更新状态记录 (${new Date().toISOString().slice(0, 16)})`;
      if (M.agentConfig()) return App.pushViaAgent(msg, silent);
      if (!M.syncConfig()) {
        if (!silent) {
          UI.toast('还没有配置推送方式，正在打开设置页…', 'error');
          setTimeout(() => (location.href = 'settings.html'), 900);
        }
        return null;
      }
      try {
        const merged = await M.push(
          App.data,
          message || `chore(status): 更新状态记录 (${new Date().toISOString().slice(0, 16)})`
        );
        App.data = M.saveLocal(merged);
        UI.toast(silent ? '已自动同步到 GitHub' : '已提交到 GitHub，Pages 约 1 分钟后更新', 'ok', silent ? 2200 : 5000);
        return App.data;
      } catch (e) {
        UI.toast('同步失败：' + (e.message || e), 'error', 6000);
        return null;
      }
    },

    /* 交给本机代理：立即回执，后台提交推送，前端轮询结果，全程不阻塞 */
    async pushViaAgent(message, silent) {
      try {
        await M.agentPush(App.data, message);
        UI.toast(silent ? '已交给本机代理，正在推送…' : '已交给本机代理，正在后台推送…', 'info', 1800);
        App.pollAgent();
        return App.data;
      } catch (e) {
        UI.toast('本机代理推送失败：' + (e.message || e), 'error', 6000);
        return null;
      }
    },

    /* 轮询代理状态，把提交/推送结果补一个提示（不阻塞页面） */
    pollAgent(tries = 8) {
      clearTimeout(App._poll);
      const tick = async (n) => {
        let st;
        try {
          st = await M.agentState();
        } catch (e) {
          return;
        }
        if (st.pending && n > 0) {
          App._poll = setTimeout(() => tick(n - 1), 1200);
          return;
        }
        const lp = st.lastPush;
        if (lp) {
          UI.toast(
            lp.ok ? `已推送到 GitHub · ${lp.message}` : `推送失败：${lp.detail}`,
            lp.ok ? 'ok' : 'error',
            lp.ok ? 3500 : 8000
          );
          App.onState && App.onState(st);
        }
      };
      App._poll = setTimeout(() => tick(tries), 900);
    },

    async pull() {
      if (!M.syncConfig()) {
        UI.toast('还没有配置 GitHub，正在打开设置页…', 'error');
        setTimeout(() => (location.href = 'settings.html'), 900);
        return null;
      }
      try {
        const { data: remote } = await M.pull();
        if (!remote) {
          UI.toast('远程还没有 data/status.json', 'error');
          return null;
        }
        App.data = M.saveLocal(M.merge(App.data, remote));
        UI.toast('已合并远程数据');
        return App.data;
      } catch (e) {
        UI.toast('拉取失败：' + (e.message || e), 'error', 6000);
        return null;
      }
    },

    syncFlag() {
      if (M.agentConfig()) return '经本机代理推送';
      const cfg = M.syncConfig();
      return cfg ? (cfg.auto ? '自动同步已开启' : '自动同步关闭') : '未配置同步';
    },

    transportName() {
      if (M.agentConfig()) return '本机代理';
      if (M.syncConfig()) return '浏览器直连 GitHub';
      return '仅本地';
    },

    syncStateHtml() {
      const cfg = M.syncConfig();
      const local = M.loadLocal();
      return (
        UI.presenceHtml(
          cfg ? 'available' : 'offline',
          cfg ? (cfg.auto ? 'GitHub 已配置 · 自动同步开' : 'GitHub 已配置 · 自动同步关') : '仅本地'
        ) +
        (cfg
          ? `<span class="caption1 mono">${UI.esc(cfg.owner)}/${UI.esc(cfg.repo)}@${UI.esc(cfg.branch)} · ${UI.esc(cfg.path)}</span>`
          : '<span class="caption1">数据只保存在本机浏览器，不会上传</span>') +
        (local ? `<span class="caption1">· 最后保存 ${UI.esc(M.fmtRelative(local.updatedAt))}</span>` : '')
      );
    }
  };

  global.MonitoringApp = App;
})(window);
