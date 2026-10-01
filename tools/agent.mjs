#!/usr/bin/env node
/* Monitoring 本机推送代理（零依赖，只用 node: 内置模块）
 *
 * 职责：
 *   1) 托管静态站点（替代 python -m http.server，带正确的 content-type 与 no-cache）
 *   2) 让管理页把最新数据 POST 过来，由「这台机器」用本机 git 凭据提交并推送到 GitHub
 *      —— 浏览器里不需要任何 GitHub 令牌
 *
 * API：
 *   GET  /api/state   → 代理状态（含最后推送结果）
 *   POST /api/status  → body {message, data}；写 data/status.json 后异步 commit + push
 *   POST /api/pull    → git pull（把远程改动拉回本地）
 *
 * 鉴权：回环地址（127.0.0.1 / ::1）免密钥；其它来源必须带 X-Admin-Key。
 *       密钥首次启动自动生成，存在 ~/.monitoring-agent.key（不在仓库里）。
 *
 * 用法：node tools/agent.mjs [port]      环境变量：PORT / HOST / AGENT_REMOTES
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'data', 'status.json');
const KEY_FILE = path.join(os.homedir(), '.monitoring-agent.key');
const PORT = Number(process.env.PORT || process.argv[2] || 8098);
const HOST = process.env.HOST || '::';
const REMOTES = (process.env.AGENT_REMOTES || 'self,origin').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_BODY = 4 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

/* ---------------- 密钥 ---------------- */
let KEY = '';
try {
  KEY = fs.readFileSync(KEY_FILE, 'utf8').trim();
} catch {}
if (!KEY) {
  KEY = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(KEY_FILE, KEY + '\n', { mode: 0o600 });
}

/* ---------------- git ---------------- */
function git(args, timeout = 90000) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', ROOT, ...args], { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim().slice(0, 400)));
      resolve(String(stdout).trim());
    });
  });
}

const state = { startedAt: new Date().toISOString(), pushing: false, lastPush: null, remoteUrls: [] };

/* ---------------- 提交 + 推送（后台，队列化） ---------------- */
let queuedMessage = null;
let pushTimer = null;

function queuePush(message) {
  queuedMessage = message || queuedMessage || 'chore(status): 更新状态记录';
  clearTimeout(pushTimer);
  pushTimer = setTimeout(runPush, 700);
}

async function runPush() {
  if (state.pushing) return;
  state.pushing = true;
  const message = queuedMessage || 'chore(status): 更新状态记录';
  queuedMessage = null;
  const t0 = Date.now();
  state.lastPush = { at: new Date().toISOString(), ok: null, message, detail: '提交中…', ms: 0 };
  try {
    await git(['add', 'data/status.json']);
    let changed = true;
    try {
      await git(['diff', '--cached', '--quiet']);
      changed = false;
    } catch {
      changed = true;
    }
    if (changed) await git(['commit', '-m', message]);
    const results = [];
    for (const r of REMOTES) {
      try {
        await git(['push', r, 'main']);
        results.push(`${r}:ok`);
      } catch (e) {
        results.push(`${r}:失败(${e.message.slice(0, 100)})`);
      }
    }
    const ok = changed ? results.every((x) => x.endsWith('ok')) : true;
    state.lastPush = {
      at: new Date().toISOString(),
      ok,
      message,
      detail: changed ? results.join(' | ') : '数据无变化，无需提交',
      ms: Date.now() - t0
    };
  } catch (e) {
    state.lastPush = { at: new Date().toISOString(), ok: false, message, detail: e.message, ms: Date.now() - t0 };
  } finally {
    state.pushing = false;
  }
}

/* ---------------- 工具 ---------------- */
const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
};

const isLoopback = (req) => {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
};

const authorized = (req) => isLoopback(req) || req.headers['x-admin-key'] === KEY;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function headInfo() {
  try {
    return await git(['log', '-1', '--pretty=%h %s (%cr)']);
  } catch {
    return '';
  }
}

/* ---------------- 静态文件 ---------------- */
async function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const st = await fsp.stat(file);
    if (st.isDirectory()) return serveStatic(req, res, p + '/');
    const body = await fsp.readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      // 本地开发：始终拿最新，避免改了前端还被浏览器缓存
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Agent': 'monitoring'
    });
    res.end(body);
  } catch {
    const notFound = Buffer.from('404 Not Found');
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': notFound.length });
    res.end(notFound);
  }
}

/* ---------------- API ---------------- */
async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const auth = authorized(req);
    return json(res, 200, {
      ok: true,
      auth,
      keyRequired: true,
      pending: state.pushing || !!queuedMessage,
      startedAt: state.startedAt,
      lastPush: state.lastPush,
      remotes: auth ? state.remoteUrls : undefined,
      head: auth ? await headInfo() : undefined
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/status') {
    if (!authorized(req)) return json(res, 401, { ok: false, error: '管理员密钥不正确' });
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (e) {
      return json(res, 400, { ok: false, error: '不是合法 JSON：' + e.message });
    }
    const data = payload && payload.data ? payload.data : payload;
    if (!data || typeof data !== 'object' || !Array.isArray(data.records)) {
      return json(res, 400, { ok: false, error: '数据里缺少 records 数组' });
    }
    data.updatedAt = new Date().toISOString();
    await fsp.writeFile(DATA_FILE, JSON.stringify(data, null, 2) + '\n');
    queuePush(payload.message);
    // 立刻回执，提交与推送在后台跑，前端不会等
    return json(res, 202, { ok: true, queued: true, at: data.updatedAt });
  }

  if (req.method === 'POST' && url.pathname === '/api/pull') {
    if (!authorized(req)) return json(res, 401, { ok: false, error: '管理员密钥不正确' });
    try {
      const out = await git(['pull', '--ff-only', REMOTES[0] || 'self', 'main']);
      const data = JSON.parse(await fsp.readFile(DATA_FILE, 'utf8'));
      return json(res, 200, { ok: true, detail: out.slice(-400), data });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  return json(res, 404, { ok: false, error: '未知接口' });
}

/* ---------------- 启动 ---------------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end('method not allowed');
    return await serveStatic(req, res, url.pathname);
  } catch (e) {
    json(res, 500, { ok: false, error: String(e.message || e) });
  }
});

for (const r of REMOTES) {
  try {
    state.remoteUrls.push({ name: r, url: await git(['remote', 'get-url', r]) });
  } catch {
    /* 远端不存在就忽略 */
  }
}

server.listen(PORT, HOST, () => {
  const line = '─'.repeat(64);
  console.log(line);
  console.log('Monitoring 本机推送代理已启动');
  console.log(`  站点      http://[::1]:${PORT}/          （回环免密钥）`);
  console.log(`  推送目标  ${state.remoteUrls.map((r) => r.name + ' → ' + r.url).join('\n            ') || '(未配置 remote)'}`);
  console.log(`  管理密钥  ${KEY}`);
  console.log(`  密钥文件  ${KEY_FILE}   (页面「设置 → 本机推送代理」里填一次即可)`);
  console.log(line);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
