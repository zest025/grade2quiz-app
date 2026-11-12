#!/usr/bin/env bash
# 发布后检查：轮询线上页面，确认线上版本号与本地 APP_VERSION 一致。
# 用法：./scripts/check-live.sh [URL]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="${1:-https://zest025.github.io/grade2quiz-app/}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/grade2-check.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 需要 Node.js 来读取版本号。" >&2
  exit 1
fi

VERSION="$(node - "$ROOT/index.html" <<'NODE'
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const match = src.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!match) {
  console.error('index.html 中未找到 APP_VERSION');
  process.exit(1);
}
process.stdout.write(match[1]);
NODE
)"

echo "检查线上版本：$VERSION（$URL）"
CODE="000"
for i in $(seq 1 60); do
  CODE="$(curl -s -o "$TMP/live.html" -w '%{http_code}' --max-time 10 "${URL}?v=$(date +%s)-$i" || true)"
  if [[ "$CODE" == "200" ]] && grep -q "$VERSION" "$TMP/live.html"; then
    echo "✅ 线上已更新到 $VERSION（第 $i 次检查）"
    exit 0
  fi
  sleep 5
done

echo "❌ 5 分钟内未在线上检测到 $VERSION（最后一次 HTTP 状态：$CODE）" >&2
exit 1
