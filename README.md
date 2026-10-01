name: Monitoring

纯静态（HTML/CSS/JS，零依赖、零构建）的「个人状态看板」：记录当前在做什么、起止时间与备注，按时间线留档。展示页部署到 GitHub Pages 给他人观看，编辑页只在本地使用。

## 两个页面（职责彻底分开）

| 页面 | 谁用 | 内容 | 是否部署 |
|---|---|---|---|
| `index.html` | 所有人 | **只读**：当前状态 + 计时、今日/本周统计、记录时间线（**搜索 + 翻页**）。无导航栏、无编辑入口 | ✅ 部署到 Pages |
| `edit.html` | 只有你（本地） | **开始 / 结束状态机**（当前状态卡 + 开始框）、记录管理（**搜索 + 翻页**）、发布与同步（含自动同步） | ❌ 不部署 |

手机上两个页面都**没有旁栏**：展示页本来就没有；编辑页在 ≤900px 时把导航收进顶栏，≤768px 时记录表格自动变成卡片列表（单列、右对齐数值、按钮 40px 高）。

## 状态机：开始与结束（不是发帖）

管理页顶部就是「当前状态」控制台：

- **进行中** → 实时计时 + `结束当前状态`（primary）/ `修改这条`；
- **空闲** → 显示最近一条 + `开始新状态`，点击直接聚焦开始框；
- 在开始框写内容 → 点 `开始`：**自动给上一条补上终止时间**，再开始新的（日志会写清楚）；
- 点 `补记`（取消勾选「至今」并填终止时间）→ 补录一段已完成的记录；
- 每一条都能在记录管理里 `结束 / 编辑 / 删除`。

## 自动同步

「发布与同步」里勾选 **自动同步** 后，每次 **开始 / 结束 / 编辑 / 删除 / 导入 / 身份信息变更** 都会自动：

1. 用浏览器里的最新数据重新生成 `data/status.json` 的内容（内存 + `localStorage`）；
2. 调 GitHub Contents API 先拉取远程、按 id 合并（`updatedAt` 新的优先），再提交；
3. GitHub Pages 收到 push 后重新构建（白名单）并发布，其他人刷新即见。

防抖 1.2 秒，同一个提交里的多次操作只会发一次；失败会 toast 报错并保留本地数据。展转不同设备时先点「从 GitHub 拉取」合并。

**展示页怎么进编辑页？** 展示页在启动时 HEAD 探测一次 `edit.html`：

- 本地服务（`python3 -m http.server` 等）→ 200 → 顶栏出现「编辑状态」按钮；
- GitHub Pages → 白名单里没有 `edit.html` → 404 → **不渲染任何编辑入口**（线上 HTML 里也没有）。

也可以通过 `http://<你的地址>/index.html?admin=1` 强制显示该按钮。

界面遵循 Fluent 2（Microsoft 设计语言）：只用官方 token（`assets/tokens.min.css`），浅深色、键盘可达。

## 数据

- `data/status.json` —— 唯一数据源，提交进仓库，展示页直接读取。
- 记录字段：`activity`（活动内容）、`start`（起始时间）、`end`（终止时间，空 = 进行中）、`note`（备注）、`kind`（活动类型）。
- 编辑页改动先写入浏览器 `localStorage`（立即生效、离线可用），再点「发布到 GitHub」提交到仓库：

```json
{ "version": 1, "owner": { "name": "…", "bio": "…" }, "updatedAt": "…",
  "records": [ { "id": "r_…", "kind": "work", "activity": "写周报",
                 "start": "2026-01-01T01:00:00.000Z", "end": "2026-01-01T03:00:00.000Z",
                 "note": "备注", "createdAt": "…", "updatedAt": "…" } ] }
```

## 本地预览

```bash
python3 -m http.server 8080
# 展示页（线上同款）http://localhost:8080/index.html
# 编辑页（仅本地）   http://localhost:8080/edit.html
```

## 发布到 GitHub（一键）

```bash
./deploy.sh [仓库名] [public|private]   # 需要已登录的 gh CLI
```

`.github/workflows/pages.yml` 用**白名单**构建 `_site/`，只会发布：

```
index.html
assets/{app.css,tokens.min.css,store.js,ui.js,view.js}
data/status.json
.nojekyll
```

`edit.html` / `assets/edit.js` / 测试 / 脚本一律不进 `_site`，线上站点上不存在编辑功能。之后每次提交 `data/status.json`（或点编辑页的「发布到 GitHub」）都会触发重新部署，地址 `https://<you>.github.io/Monitoring/`。

## 在浏览器里直接发布（无需命令行）

1. 本地打开 `edit.html` → 「同步设置」
2. 填 `owner` / `repo` / `branch` / `path(data/status.json)` 与细粒度 Token（权限只需 **Contents: Read and write**）
3. 点「发布到 GitHub」：先拉取远程按 id 合并（`updatedAt` 新的优先），再提交，不会覆盖别人的改动

Token 只存在本机 `localStorage`，不写入仓库；公共电脑上用完请点「清除配置」。

## 其他

- 搜索：空格分词、全部命中；匹配活动内容、备注、类型与起止时间。翻页默认每页 10 条（展示页）/ 8 条（管理表）。
- 「导出 JSON」可直接覆盖 `data/status.json` 后提交；「导入 JSON」按 id 合并。
- 展示页每 5 分钟静默刷新数据；无第三方依赖、无 CDN、无构建步骤。
- 页面切换用跨文档视图过渡（Chrome/Edge 126+），数据在 `<head>` 提前预取，导航栏不参与过渡。

## 测试

```bash
node tests/store.test.mjs   # 数据层断言（当前状态推导 / 统计 / 合并 / 格式化）
```
