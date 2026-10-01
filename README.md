name: Monitoring

纯静态（HTML/CSS/JS，零依赖、零构建）的「个人状态看板」：
记录当前在做什么、起止时间与备注，按时间线留档，并部署到 GitHub Pages 供他人观看。

## 两个页面

| 页面 | 用途 |
|---|---|
| `index.html` | 观看页：当前状态大卡片、计时、今日/本周统计、按天分组的时间线。只读，给他人看。 |
| `edit.html` | 编辑页：QQ 空间式发表框（活动内容 + 工具条 + 字数 + 发表按钮）、实时「他人视角」预览、记录管理表格、GitHub 发布。 |

界面遵循 Fluent 2（Microsoft 设计语言）：只使用官方 token（`assets/tokens.min.css`），支持浅色/深色，键盘可达。

## 数据

- `data/status.json` —— 唯一数据源（提交进仓库，观看页直接读取，所以所有人都能看到）。
- 记录字段：`activity`（活动内容）、`start`（起始时间）、`end`（终止时间，空 = 进行中）、`note`（备注）、`kind`（活动类型）。
- 编辑页的改动先写入浏览器 `localStorage`（立即生效、离线可用），再通过「发布到 GitHub」提交到仓库：

```json
{ "version": 1, "owner": { "name": "…", "bio": "…" }, "updatedAt": "…",
  "records": [ { "id": "r_…", "kind": "work", "activity": "写周报",
                 "start": "2026-01-01T01:00:00.000Z", "end": "2026-01-01T03:00:00.000Z",
                 "note": "备注", "createdAt": "…", "updatedAt": "…" } ] }
```

## 本地预览

```bash
python3 -m http.server 8080      # 或 npx serve .
# 观看页 http://localhost:8080/index.html
# 编辑页 http://localhost:8080/edit.html
```

直接双击 `index.html`（`file://`）也能看，但浏览器会拦截读取 `data/status.json`，此时显示空数据；编辑功能不受影响。

## 发布到 GitHub（一键）

```bash
./deploy.sh [仓库名] [public|private]   # 需要已登录的 gh CLI
```

脚本会 init/commit/push；首次运行自动创建仓库并把 Pages 来源切到 GitHub Actions。
手动流程等价于：

```bash
git remote add origin git@github.com:<you>/Monitoring.git
git push -u origin main
# 仓库 Settings → Pages → Source 选 “GitHub Actions”
```

之后每次提交 `data/status.json`（或点击编辑页的「发布到 GitHub」）都会触发 `.github/workflows/pages.yml` 重新部署，地址：`https://<you>.github.io/Monitoring/`。

## 在浏览器里直接发布（无需命令行）

1. 打开 `edit.html` → 「同步设置…」
2. 填入 `owner` / `repo` / `branch` / `path(data/status.json)` 与细粒度 Token（权限只需 **Contents: Read and write**）
3. 点「发布到 GitHub」：脚本会先拉取远程数据按 id 合并（`updatedAt` 新的优先），再提交，避免覆盖别人的改动

Token 仅保存在本机 `localStorage`，不会写入仓库。公共电脑上用完请点「清除配置」。

## 其他

- 「导出 JSON」得到的文件可直接覆盖 `data/status.json` 后提交；「导入 JSON」按 id 合并。
- 观看页每 5 分钟静默刷新一次数据，无需手动刷新。
- 无第三方依赖、无 CDN、无构建步骤；页面总体积 < 40KB。

## 测试

```bash
node tests/store.test.mjs   # 数据层断言（当前状态推导 / 统计 / 合并 / 格式化）
```
