#!/usr/bin/env bash
# 一键部署到 GitHub Pages：
#   1) 首次运行且没有 remote 时，用 gh 创建仓库并推送；2) 之后每次提交改动并推送，由 Actions 部署。
# 用法： ./deploy.sh [仓库名] [public|private]
set -euo pipefail

cd "$(dirname "$0")"
REPO="${1:-$(basename "$PWD")}"
VISIBILITY="${2:-public}"

if ! command -v git >/dev/null; then echo "缺少 git" >&2; exit 1; fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git init -q -b main
fi

git add -A
if git diff --cached --quiet; then
  echo "没有需要提交的改动"
else
  git commit -q -m "chore(status): ${1:-更新状态与记录} ($(date '+%Y-%m-%d %H:%M'))"
fi

if git remote get-url origin >/dev/null 2>&1; then
  git push -u origin HEAD
  REMOTE_URL="$(git remote get-url origin)"
else
  command -v gh >/dev/null || { echo "没有 remote，且未安装 gh CLI。请先： git remote add origin <repo-url> && git push -u origin main" >&2; exit 1; }
  gh repo create "$REPO" "--$VISIBILITY" --source=. --remote=origin --push
  REMOTE_URL="$(git remote get-url origin)"
  # 首次创建时把 Pages 的发布来源切到 GitHub Actions
  gh api -X POST "repos/{owner}/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 || true
fi

SLUG="$(printf '%s' "$REMOTE_URL" | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
OWNER="${SLUG%%/*}"
NAME="${SLUG##*/}"

echo
echo "已推送。GitHub Actions 正在部署，约 1 分钟后可访问："
echo "  https://${OWNER}.github.io/${NAME}/"
echo "  仓库设置里确认 Pages → Source = GitHub Actions。"
