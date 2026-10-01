/* Monitoring — 数据层：本地存储 / data/status.json 读取 / GitHub Contents API 同步。
   浏览器端无后端，所以「持久化」有两条路径：
   1) localStorage（本地编辑与预览，立即生效，不被他人看到）
   2) 配置 GitHub Token 后，每次保存直接向仓库提交 data/status.json，GitHub Pages 自动重新发布 */
(function (global) {
  'use strict';

  const DATA_FILE = 'data/status.json';
  const LS_DATA = 'monitoring:data:v1';
  const LS_CFG = 'monitoring:sync:v1';
  const SMSG = { work: 0, study: 1, rest: 2, away: 3, offline: 4 };

  /* 活动类型 → 语义状态色（配 statusUp/Warn/Down/Idle token） */
  const KINDS = [
    { id: 'work', label: '工作 / 编码', tone: 'up' },
    { id: 'study', label: '学习 / 阅读', tone: 'up' },
    { id: 'rest', label: '休息 / 娱乐', tone: 'idle' },
    { id: 'away', label: '外出 / 通勤', tone: 'warn' },
    { id: 'offline', label: '离线 / 睡觉', tone: 'down' }
  ];

  const kindOf = (id) => KINDS.find((k) => k.id === id) || KINDS[0];
  const ts = (v) => (v ? new Date(v).getTime() : 0);
  const byStartDesc = (a, b) => ts(b.start) - ts(a.start);

  function uid() {
    return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function emptyData() {
    return { version: 1, owner: { name: '监控对象', bio: '' }, updatedAt: new Date().toISOString(), records: [] };
  }

  function normalize(raw) {
    const d = emptyData();
    if (!raw || typeof raw !== 'object') return d;
    d.owner.name = String(raw.owner?.name || d.owner.name).slice(0, 40);
    d.owner.bio = String(raw.owner?.bio || '').slice(0, 200);
    d.updatedAt = raw.updatedAt || d.updatedAt;
    d.records = (Array.isArray(raw.records) ? raw.records : [])
      .filter((r) => r && typeof r === 'object')
      .map((r) => ({
        id: String(r.id || uid()),
        kind: KINDS.some((k) => k.id === r.kind) ? r.kind : 'work',
        activity: String(r.activity || '').slice(0, 120),
        start: r.start || new Date().toISOString(),
        end: r.end || '',
        note: String(r.note || '').slice(0, 1000),
        createdAt: r.createdAt || r.start,
        updatedAt: r.updatedAt || r.createdAt || r.start
      }));
    return d;
  }

  /* ---------------- 当前状态推导 ---------------- */
  function currentState(data, now = Date.now()) {
    const recs = [...(data.records || [])].sort(byStartDesc);
    const running = recs.find((r) => ts(r.start) <= now && (!r.end || ts(r.end) > now));
    if (running) return { state: 'running', record: running, ended: false };
    const lastEnded = recs.find((r) => r.end && ts(r.end) <= now);
    if (lastEnded) return { state: 'idle', record: lastEnded, ended: true };
    const upcoming = recs.filter((r) => ts(r.start) > now).sort((a, b) => ts(a.start) - ts(b.start))[0];
    if (upcoming) return { state: 'planned', record: upcoming, ended: false };
    return { state: 'none', record: null, ended: false };
  }

  const STATE_LABEL = {
    running: { text: '进行中', badge: 'up' },
    planned: { text: '计划中', badge: 'warn' },
    idle: { text: '空闲', badge: 'idle' },
    none: { text: '暂无记录', badge: 'plain' }
  };

  function duration(rec, now = Date.now()) {
    const from = ts(rec.start);
    const to = rec.end ? ts(rec.end) : now;
    return Math.max(0, to - from);
  }

  function stats(data, now = Date.now()) {
    const recs = data.records || [];
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(dayStart);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // 周一为一周起点
    const overlap = (r, from, to) => {
      const s = Math.max(ts(r.start), from);
      const e = Math.min(r.end ? ts(r.end) : now, to);
      return Math.max(0, e - s);
    };
    return {
      todayCount: recs.filter((r) => overlap(r, +dayStart, now) > 0).length,
      todayMs: recs.reduce((n, r) => n + overlap(r, +dayStart, now), 0),
      weekMs: recs.reduce((n, r) => n + overlap(r, +weekStart, now), 0),
      total: recs.length
    };
  }

  /* ---------------- 格式化 ---------------- */
  const pad = (n) => String(n).padStart(2, '0');

  function fmtDateTime(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (isNaN(+d)) return '—';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtTime(v) {
    if (!v) return '—';
    const d = new Date(v);
    return isNaN(+d) ? '—' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtDay(v) {
    const d = new Date(v);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const that = new Date(d);
    that.setHours(0, 0, 0, 0);
    const diff = Math.round((+today - +that) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    if (diff === 2) return '前天';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function fmtDuration(ms) {
    if (!ms || ms < 0) return '0 分钟';
    const m = Math.floor(ms / 60000);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d} 天 ${h % 24} 小时`;
    if (h > 0) return `${h} 小时 ${m % 60} 分钟`;
    if (m > 0) return `${m} 分钟`;
    return `${Math.floor(ms / 1000)} 秒`;
  }

  /* datetime-local 需要的本地时间字符串 */
  function toLocalInput(v) {
    const d = v ? new Date(v) : new Date();
    if (isNaN(+d)) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const fromLocalInput = (s) => (s ? new Date(s).toISOString() : '');

  function fmtRelative(v, now = Date.now()) {
    const t = ts(v);
    if (!t) return '—';
    const diff = now - t;
    const abs = Math.abs(diff);
    const unit = abs < 60000 ? [Math.floor(abs / 1000), '秒'] : abs < 3600000 ? [Math.floor(abs / 60000), '分钟'] : abs < 86400000 ? [Math.floor(abs / 3600000), '小时'] : [Math.floor(abs / 86400000), '天'];
    return diff >= 0 ? `${unit[0]} ${unit[1]}前` : `${unit[0]} ${unit[1]}后`;
  }

  /* ---------------- 存储 ---------------- */
  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_DATA);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch (e) {
      console.warn('本地数据损坏，已忽略', e);
      return null;
    }
  }

  function saveLocal(data) {
    data.updatedAt = new Date().toISOString();
    localStorage.setItem(LS_DATA, JSON.stringify(data));
    return data;
  }

  async function fetchFile(url = DATA_FILE) {
    // 复用 <head> 里提前发起的预取（首屏不额外等一下）
    if (url === DATA_FILE && global.__DATA__ && !fetchFile.usedPreload) {
      fetchFile.usedPreload = true;
      try {
        const raw = await global.__DATA__;
        if (raw) return normalize(raw);
      } catch (e) {
        /* 落到真实请求 */
      }
    }
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return normalize(await res.json());
  }

  async function load() {
    const local = loadLocal();
    if (local) return local;
    try {
      return await fetchFile();
    } catch (e) {
      console.warn('读取 data/status.json 失败，使用空数据', e);
      return emptyData();
    }
  }

  /* ---------------- 记录操作（全部纯函数，返回新对象） ---------------- */
  function upsertRecord(data, rec) {
    const now = new Date().toISOString();
    const next = JSON.parse(JSON.stringify(data));
    const recs = next.records || (next.records = []);
    const i = recs.findIndex((r) => r.id === rec.id);
    const merged = { ...rec, id: rec.id || uid(), createdAt: i >= 0 ? recs[i].createdAt : now, updatedAt: now };
    if (i >= 0) recs[i] = merged;
    else recs.push(merged);
    recs.sort(byStartDesc);
    return next;
  }

  function removeRecord(data, id) {
    const next = JSON.parse(JSON.stringify(data));
    next.records = (next.records || []).filter((r) => r.id !== id);
    return next;
  }

  /* 停止当前记录：补上终止时间 */
  function stopRecord(data, id, end) {
    const next = JSON.parse(JSON.stringify(data));
    const recs = next.records || [];
    const i = recs.findIndex((r) => r.id === id);
    if (i < 0) return next;
    recs[i].end = end || new Date().toISOString();
    recs[i].updatedAt = new Date().toISOString();
    return next;
  }

  /* ---------------- GitHub 同步 ---------------- */
  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }

  function syncConfig() {
    try {
      const cfg = JSON.parse(localStorage.getItem(LS_CFG) || 'null');
      return cfg && cfg.token && cfg.owner && cfg.repo ? cfg : null;
    } catch (e) {
      return null;
    }
  }

  function saveSyncConfig(cfg) {
    if (!cfg || !cfg.token) localStorage.removeItem(LS_CFG);
    else localStorage.setItem(LS_CFG, JSON.stringify(cfg));
  }

  function ghHeaders(cfg) {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  const ghUrl = (cfg) => `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`;

  /* 从仓库拉取最新数据并回显 sha */
  async function pull(cfg = syncConfig()) {
    if (!cfg) throw new Error('未配置 GitHub 同步');
    const res = await fetch(`${ghUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}&t=${Date.now()}`, {
      headers: ghHeaders(cfg),
      cache: 'no-store'
    });
    if (res.status === 404) return { data: null, sha: null };
    if (!res.ok) throw new Error(`拉取失败：HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    const body = await res.json();
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.content.replace(/\s/g, '')), (c) => c.charCodeAt(0))));
    return { data: normalize(json), sha: body.sha };
  }

  /* 按 id 合并两份数据，冲突取 updatedAt 较新的一条 */
  function merge(a, b) {
    const map = new Map();
    [...(a?.records || []), ...(b?.records || [])].forEach((r) => {
      const old = map.get(r.id);
      if (!old || ts(r.updatedAt) >= ts(old.updatedAt)) map.set(r.id, r);
    });
    const base = (a?.records || []).length >= (b?.records || []).length ? a : b;
    const out = normalize({ ...base, records: [...map.values()] });
    out.records.sort(byStartDesc);
    return out;
  }

  /* 提交 data/status.json（先拉取合并，避免覆盖别人的改动） */
  async function push(data, message, cfg = syncConfig()) {
    if (!cfg) throw new Error('未配置 GitHub 同步');
    const remote = await pull(cfg).catch(() => ({ data: null, sha: null }));
    const merged = remote.data ? merge(data, remote.data) : data;
    const body = { message, content: b64(JSON.stringify(merged, null, 2) + '\n'), branch: cfg.branch };
    if (remote.sha) body.sha = remote.sha;
    const res = await fetch(ghUrl(cfg), {
      method: 'PUT',
      headers: { ...ghHeaders(cfg), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`提交失败：HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    return merged;
  }

  function exportFile(data) {
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `monitoring-status-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  global.Monitoring = {
    DATA_FILE, LS_DATA, LS_CFG, KINDS, kindOf, STATE_LABEL, SMSG,
    uid, emptyData, normalize, currentState, duration, stats,
    fmtDateTime, fmtTime, fmtDay, fmtDuration, fmtRelative, toLocalInput, fromLocalInput,
    loadLocal, saveLocal, fetchFile, load, upsertRecord, removeRecord, stopRecord,
    syncConfig, saveSyncConfig, pull, push, merge, exportFile, b64, ts, byStartDesc
  };
})(window);
