name: Monitoring

纯静态（HTML/CSS/JS，零依赖、零构建）的「个人状态看板」：记录当前在做什么、起止时间与备注，按时间线留档。展示页部署到 GitHub Pages 给他人观看，编辑页只在本地使用。

## 两个页面（职责彻底分开）

| 页面 | 谁用 | 内容 | 是否部署 |
|---|---|---|---|
| `index.html` | 所有人 | **只读**：当前状态 + 计时、今日/本周统计、记录时间线（**搜索 + 翻页**）。无导航栏、无编辑入口 | ✅ 部署到 Pages |
| `edit.html` | 只有你（本地） | **编辑页**：当前状态控制台（结束 / 修改）+ 开始框（开始 / 补记 / 修改） | ❌ 不部署 |
| `records.html` | 只有你（本地） | **记录页**：全部记录（**搜索 + 翻页** + 每条 结束 / 编辑 / 删除） | ❌ 不部署 |
| `settings.html` | 只有你（本地） | **设置页**：GitHub 同步、自动同步开关、身份信息、导入 / 导出 / 清空 | ❌ 不部署 |

三个本地页共用 `assets/app.js`（数据加载、当前状态卡、提交 + 自动同步、推送/拉取），导航在桌面是左栏、手机收进顶栏。

手机上**没有旁栏**：≤900px 侧栏隐藏、导航收进顶栏；≤768px 记录表格变成卡片列表，字号整体放大一档（正文 16px、标题 20/24px、开始框 20px），所有按钮/输入框 ≥44px 高（触达目标），搜索框占满整行，翻页器居中换行。

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

## 两个远端仓库

| remote | 仓库 | 作用 |
|---|---|---|
| `origin` | `2SH33P/Monitoring` | 项目本体（代码 + 示例/当前数据），Pages：https://2sh33p.github.io/Monitoring/ |
| `self` | `2SH33P/MonitoringSelf` | 我自己的库（同一套代码 + 我的真实记录），Pages：https://2sh33p.github.io/MonitoringSelf/ |

```bash
git push origin main && git push self main
```

两个仓库都用 GitHub Actions 白名单构建，Pages 源为 GitHub Actions（`build_type=workflow`）。

## 本机推送代理（让机器去请求 GitHub）

浏览器不能写文件、也不该持有令牌，所以由本机进程代劳：

```bash
node tools/agent.mjs          # 默认监听 [::]:8098，可用 PORT / HOST / AGENT_REMOTES 覆盖
```

- 既托管静态站点，又提供写入接口：
  - `GET  /api/state`  代理状态（最后推送结果、remote、HEAD）
  - `POST /api/status` `{message, data}` → 写 `data/status.json` → 后台 `git commit` + `git push self/origin`
  - `POST /api/pull`   从远程 `git pull --ff-only`
- 鉴权：回环地址免密钥；其它来源（例如手机走公网 IPv6）必须带 `X-Admin-Key`。密钥首次启动生成，存在 `~/.monitoring-agent.key`（**不在仓库里**），删掉即可轮换。
- 在「设置 → 本机推送代理」里填 地址 + 密钥，点「保存并测试连接」即生效；此后每次开始/结束/修改都由**机器**提交推送，浏览器里不需要任何 GitHub 令牌。
- 前端是 fire-and-forget：先本地生效（内存 + localStorage）、代理立即回 202、后台提交推送，页面轮询结果补个提示，所以推送慢也不会卡操作。
- 「浏览器直连 GitHub」（PAT）保留为兜底，未配置代理时才会用到。

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
