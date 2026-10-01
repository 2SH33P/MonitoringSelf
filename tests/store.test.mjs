import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../assets/store.js', import.meta.url), 'utf8');
const mem = {};
const ctx = {
  window: {},
  localStorage: {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; }
  },
  console,
  fetch: async () => { throw new Error('offline'); },
  Date, Math, JSON, Object, Array, String, Number, isNaN, RegExp, Map, Promise,
  btoa, atob, TextEncoder, TextDecoder, Uint8Array
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const M = ctx.window.Monitoring;

const iso = (minsFromNow) => new Date(Date.now() + minsFromNow * 60000).toISOString();

// 进行中
let d = M.normalize({ records: [
  { id: 'a', activity: '写代码', kind: 'work', start: iso(-120), note: 'v1' },
  { id: 'b', activity: '午饭', kind: 'rest', start: iso(-300), end: iso(-180) }
] });
let cur = M.currentState(d);
assert.equal(cur.state, 'running');
assert.equal(cur.record.id, 'a');
assert.ok(M.duration(cur.record) >= 119 * 60000);

// 全部结束 → 空闲
d = M.upsertRecord(d, { id: 'a', activity: '写代码', kind: 'work', start: iso(-120), end: iso(-10), note: '' });
assert.equal(M.currentState(d).state, 'idle');

// 未来记录 → 计划中
d = M.normalize({ records: [{ id: 'c', activity: '会议', kind: 'work', start: iso(60) }] });
assert.equal(M.currentState(d).state, 'planned');
// 覆盖当前时刻的区间也算进行中
d = M.normalize({ records: [{ id: 'c', activity: '会议', kind: 'work', start: iso(-10), end: iso(30) }] });
assert.equal(M.currentState(d).state, 'running');

// 统计：今日时长只算与今天重叠的部分
const today = new Date(); today.setHours(1, 0, 0, 0);
const d2 = M.normalize({ records: [
  { id: 'x', activity: 'A', start: today.toISOString(), end: new Date(+today + 3600000).toISOString() },
  { id: 'y', activity: 'B', start: new Date(+today - 86400000).toISOString(), end: new Date(+today - 82800000).toISOString() }
] });
const s = M.stats(d2, +today + 2 * 3600000);
assert.equal(s.total, 2);
assert.equal(s.todayCount, 1);
assert.equal(s.todayMs, 3600000);

// 结束记录 / 删除记录
const stopped = M.stopRecord(d2, 'x', iso(-1));
assert.ok(stopped.records.find((r) => r.id === 'x').end);
assert.equal(M.removeRecord(d2, 'x').records.length, 1);
assert.equal(d2.records.length, 2, '纯函数不应修改入参');

// merge：同 id 取 updatedAt 较新者
const older = M.normalize({ records: [{ id: 'm', activity: '旧', start: iso(-60), updatedAt: iso(-60) }] });
const newer = M.normalize({ records: [{ id: 'm', activity: '新', start: iso(-60), updatedAt: iso(0) }] });
assert.equal(M.merge(older, newer).records[0].activity, '新');
assert.equal(M.merge(older, newer).records.length, 1);

// normalize 兜底
const junk = M.normalize({ records: [null, { id: 'z', kind: '不存在', activity: 'x'.repeat(500) }] });
assert.equal(junk.records.length, 1);
assert.equal(junk.records[0].kind, 'work');
assert.equal(junk.records[0].activity.length, 120);

// 格式化
assert.equal(M.fmtDuration(90 * 60000), '1 小时 30 分钟');
assert.equal(M.fmtDuration(45 * 1000), '45 秒');
assert.equal(M.fmtDuration(0), '0 分钟');

// 本地持久化
M.saveLocal(d2);
assert.equal(M.loadLocal().records.length, 2);
assert.ok(M.loadLocal().updatedAt);

// base64 UTF-8 往返
const raw = JSON.stringify({ 中文: '状态 ✅', n: 1 });
assert.equal(atob(M.b64(raw)), Buffer.from(raw, 'utf8').toString('binary'));

console.log('store.js: 全部断言通过');
