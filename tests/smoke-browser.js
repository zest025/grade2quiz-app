// 浏览器端冒烟测试：由 scripts/smoke-test.sh 注入到 index.html 的临时副本中运行。
// 所有网络请求都被拦截，测试不会写入真实云端数据。
(async function () {
  const out = [];
  const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);
  window.__alerts = [];
  window.alert = m => window.__alerts.push(String(m));
  window.confirm = () => true;
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ metadata: { id: 'stub' } }) });

  await new Promise(r => setTimeout(r, 400));

  // 干净状态
  appState.completedDates = [];
  appState.mistakes = [];
  appState.dailyResults = {};
  appState.score = 0;
  appState.cloudBins = {};
  appState.lastSyncAt = '';
  isMistakeMode = false;
  renderAll();

  // 1. 初始渲染与版本信息
  ok('initial quiz rendered', document.querySelectorAll('#questions-list input[type=radio]').length === 20, String(document.querySelectorAll('#questions-list input[type=radio]').length));
  ok('bonus rendered', document.querySelectorAll('#bonus-question-area input[type=radio]').length === 4);
  ok('bonus labeled optional', document.querySelector('#bonus-question-area').innerText.includes('选做'));
  ok('submit enabled initially', !document.getElementById('submit-btn').disabled);
  ok('sync status exists', !!document.getElementById('sync-status'));
  ok('version shown in footer', document.getElementById('app-version').innerText.includes(APP_VERSION), document.getElementById('app-version').innerText);
  ok('release date shown', document.getElementById('app-version').innerText.includes(APP_RELEASED_AT), document.getElementById('app-version').innerText);
  ok('version shown in parent panel', document.getElementById('app-version-panel').innerText.includes(APP_VERSION));

  // 2. 今日完成态
  const today = new Date().toLocaleDateString();
  appState.completedDates.push(today);
  appState.dailyResults[today] = { base: 3, bonus: 5, total: 8 };
  renderQuiz();
  ok('completed disables submit', document.getElementById('submit-btn').disabled === true);
  ok('completed shows score', document.getElementById('quiz-badge').innerText.includes('8'));
  ok('completed disables inputs', document.querySelectorAll('#questions-list input[type=radio]:disabled').length === 20);
  ok('completed keeps bonus visible', document.querySelectorAll('#bonus-question-area input[type=radio]:disabled').length === 4);

  appState.completedDates = appState.completedDates.filter(d => d !== today);
  delete appState.dailyResults[today];
  renderQuiz();
  ok('reset re-enables submit', !document.getElementById('submit-btn').disabled);

  // 3. 不答任何题（含跳过附加题）也能提交
  const beforeMistakes = appState.mistakes.length;
  submitQuiz();
  await new Promise(r => setTimeout(r, 100));
  ok('submit without any answer allowed', appState.completedDates.includes(today));
  ok('bonus skip message', (window.__alerts.slice(-1)[0] || '').includes('附加题未作答'), window.__alerts.slice(-1)[0]);
  ok('wrong answers collected', appState.mistakes.length === beforeMistakes + 5, `${beforeMistakes} -> ${appState.mistakes.length}`);
  ok('after submit disabled', document.getElementById('submit-btn').disabled === true);
  ok('zero-score result recorded', appState.dailyResults[today] && appState.dailyResults[today].total === 0, JSON.stringify(appState.dailyResults[today]));

  // 4. 错题重测模式
  isMistakeMode = true;
  renderQuiz();
  ok('mistake mode title', document.getElementById('quiz-date-title').innerText.includes('错题专项'));
  ok('mistake radios rendered', document.querySelectorAll('#questions-list input[type=radio]').length === appState.mistakes.length * 4, `${document.querySelectorAll('#questions-list input[type=radio]').length} vs ${appState.mistakes.length * 4}`);
  isMistakeMode = false;
  renderQuiz();

  // 5. 上传复用固定 bin
  const calls = [];
  window.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET' });
    if (url.includes('/c/uncategorized/bins')) {
      return { ok: true, status: 200, json: async () => ([{ snippetMeta: { name: 'quiz_kid_2026' }, record: 'bin123', createdAt: '2026-11-01T00:00:00Z' }]) };
    }
    if (url.includes('/b/bin123')) return { ok: true, status: 200, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ metadata: { id: 'new1' } }) };
  };
  appState.cloudBins = {};
  appState.lastSyncAt = '';
  await uploadToCloud(true);
  ok('upload used PUT to existing bin', calls.some(c => c.method === 'PUT' && c.url.endsWith('/b/bin123')), JSON.stringify(calls));
  ok('cloudBins cached', appState.cloudBins['kid_2026'] === 'bin123');
  ok('lastSyncAt set', !!appState.lastSyncAt);
  ok('sync status updated', document.getElementById('sync-status').innerText.includes('上次同步'), document.getElementById('sync-status').innerText);

  // 6. 没有云端记录时新建 bin
  calls.length = 0;
  appState.cloudBins = {};
  window.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET' });
    if (url.includes('/c/uncategorized/bins')) return { ok: true, status: 200, json: async () => ([]) };
    return { ok: true, status: 200, json: async () => ({ metadata: { id: 'new1' } }) };
  };
  await uploadToCloud(true);
  ok('upload creates bin when none', calls.some(c => c.method === 'POST') && appState.cloudBins['kid_2026'] === 'new1', JSON.stringify(calls));

  // 7. 下载按名字找最新 bin 并合并
  appState.cloudBins = {};
  appState.score = 0;
  window.fetch = async (url) => {
    if (url.includes('/c/uncategorized/bins')) {
      return { ok: true, status: 200, json: async () => ([{ snippetMeta: { name: 'quiz_kid_2026' }, record: 'bin123', createdAt: '2026-11-01T00:00:00Z' }]) };
    }
    return { ok: true, status: 200, json: async () => ({ record: { score: 42, parentPin: '8888' } }) };
  };
  await downloadFromCloud();
  ok('download merges cloud record', appState.score === 42, String(appState.score));
  ok('download caches bin', appState.cloudBins['kid_2026'] === 'bin123');
  ok('download rendered score', document.getElementById('current-score').innerText === '42', document.getElementById('current-score').innerText);

  // 8. 本地备份导出 / 导入
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {};
  let exportOk = true;
  try { exportBackup(); } catch (e) { exportOk = false; }
  HTMLAnchorElement.prototype.click = origClick;
  ok('export runs without error', exportOk);

  const file = new File(
    [JSON.stringify({ score: 77, syncId: 'kid_test', rewards: [], mistakes: [], completedDates: [], redemptionHistory: [] })],
    'backup.json',
    { type: 'application/json' }
  );
  importBackup({ target: { files: [file], value: '' } });
  await new Promise(r => setTimeout(r, 300));
  ok('import applies backup score', appState.score === 77, String(appState.score));
  ok('import renders score', document.getElementById('current-score').innerText === '77', document.getElementById('current-score').innerText);
  ok('import keeps backup syncId', document.getElementById('sync-id').value === 'kid_test', document.getElementById('sync-id').value);

  const pre = document.createElement('pre');
  pre.id = 'test-results';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
})();
