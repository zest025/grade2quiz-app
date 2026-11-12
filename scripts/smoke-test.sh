#!/usr/bin/env bash
# 推送前冒烟测试：用本机 Chrome 无头模式跑一遍关键交互。
# 测试页面复制到临时目录，网络请求全部拦截，不会写入真实云端数据。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/grade2-smoke.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

CHROME="${CHROME_BIN:-}"
if [[ -z "$CHROME" ]]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "$(command -v google-chrome || true)" \
    "$(command -v chromium || true)" \
    "$(command -v chromium-browser || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      CHROME="$candidate"
      break
    fi
  done
fi

if [[ -z "$CHROME" ]]; then
  echo "❌ 未找到 Chrome。请安装 Google Chrome，或用 CHROME_BIN 指定浏览器路径。" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 需要 Node.js 来组装测试页面。" >&2
  exit 1
fi

node - "$ROOT" "$TMP" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, tmp] = process.argv.slice(2);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const test = fs.readFileSync(path.join(root, 'tests', 'smoke-browser.js'), 'utf8');
if (!html.includes('</body>')) throw new Error('index.html 缺少 </body>');
fs.writeFileSync(
  path.join(tmp, 'smoke.html'),
  html.replace('</body>', `<script>\n${test}\n</script>\n</body>`)
);
NODE

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --user-data-dir="$TMP/profile" --virtual-time-budget=8000 \
  --dump-dom "file://$TMP/smoke.html" > "$TMP/dom.html" 2>"$TMP/chrome.log" || true

node - "$TMP/dom.html" <<'NODE'
const fs = require('fs');
const dom = fs.readFileSync(process.argv[2], 'utf8');
const match = dom.match(/<pre id="test-results">([\s\S]*?)<\/pre>/);
if (!match) {
  console.error('❌ 测试脚本未产生结果，Chrome 可能启动失败。');
  process.exit(1);
}
const text = match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
console.log(text);
const lines = text.split('\n');
const passed = lines.filter(l => l.startsWith('PASS')).length;
const failed = lines.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
NODE
