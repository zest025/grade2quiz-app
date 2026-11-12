# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A Chinese grade-2 daily quiz/points app for one student, built as a **single static file**. Everything — markup, Tailwind (via CDN), and application JS — lives in `index.html`. There is no `package.json`, bundler, build step, linter, or test suite.

Deployed with GitHub Pages from `main` (repo `zest025/grade2quiz-app`): pushing to `main` publishes to <https://zest025.github.io/grade2quiz-app/>. All commit messages are written in Chinese.

## Running and verifying

```bash
# Simplest: open the file directly
open index.html

# Or serve locally (recommended, closer to production)
python3 -m http.server 8000   # then visit http://localhost:8000

# Pre-push smoke test (headless Chrome, all network calls stubbed)
./scripts/smoke-test.sh

# Post-push check (polls the live site for the current APP_VERSION)
./scripts/check-live.sh
```

There is no build or lint step. The smoke test requires Node.js and Google Chrome (override the browser with `CHROME_BIN`). To reset the app to defaults, clear `localStorage["grade2_app_state"]`, or use the parent panel's "重置今日答题状态" action.

## Architecture

**Single state object.** `appState` (`index.html:313`) is the source of truth: `score`, `streak`, `lastCheckInDate`, `parentPin`, `mistakes`, `rewards`, `redemptionHistory`, `completedDates`, `syncId`. It persists to `localStorage["grade2_app_state"]`; on load it is shallow-merged over the defaults. `renderState()` calls `saveLocalStorage()` at the end, so **mutations must be followed by `renderState()`** (or an explicit `saveLocalStorage()`) to persist.

**Imperative rendering.** No framework. `renderQuiz()` rebuilds the question area and `renderState()` rebuilds score, mistakes, shop, history, and the parent reward list, all via `innerHTML` template strings. Inline `onclick="fn(...)"` attributes require every handler to stay a **global top-level function** — don't convert the script to a module or scope functions.

**Daily content rotation.** `getTodayQuiz()` and `getTodayBonusQuestion()` index into `questionBank` / `bonusQuestionBank` by the local day-of-year modulo the bank length. `questionBank` is an array of 5-question daily sets; `bonusQuestionBank` is one cross-subject question per day. Each question's `ans` is a **0-based option index** into the source options. `shuffleQuestion()` then deterministically shuffles the options (seeded by day-of-year and question id), re-letters the `A.`/`B.` prefixes embedded in the option text, remaps `ans`, and marks the copy `_shuffled: true`; stored mistakes keep that flag and are not reshuffled. Source banks can keep a natural option order, but `ans` must still point at the correct option. `currentQuizData` / `currentBonusData` are captured at load; a date rollover with the page open requires a reload.

**Quiz submission (`submitQuiz()`).** Two branches:

- *Normal daily mode*: +1 per correct base question (max 5) plus +5 for the bonus. The bonus question is **optional** — skipping it never blocks submission and only forfeits its 5 points. Wrong base questions are appended to `mistakes` (bonus questions are never added). One submission per calendar day is enforced by `completedDates` (a `toLocaleDateString()` string), the streak increments once per day, and the day's scores are stored in `appState.dailyResults` (pruned to 60 days). After submission, `renderQuiz()` disables the inputs and shows the completed state via `setSubmitButton()`.
- *Mistake-retest mode* (`isMistakeMode`, entered from 错题重测): renders `appState.mistakes`; each correctly answered mistake is removed from the notebook. No points are awarded.

**Wrong-answer notebook / printing.** `printMistakesPaper()` fills the hidden `#print-mistakes-area` then calls `window.print()`. The `@media print` block hides everything else (`.no-print`, plus explicit ids). New UI sections either need `.no-print` or must be added to that print rule.

**Parent panel.** Gate is a client-side `prompt()` compared against `appState.parentPin` (default `8888`). It manages the PIN, wish rewards (add/edit/delete inline), manual score adjustment, `syncId`, cloud upload/download, and resetting today's status. This is UX gating only — the PIN and the `DEFAULT_MASTER_KEY` are visible in the page source.

**Cloud sync (jsonbin.io).** `DEFAULT_MASTER_KEY` is hardcoded in `index.html`. The key is **intentionally committed** — this is a private family app with no sensitive data, so do not replace it with a placeholder or move it to a secret; edit the file incrementally and leave the key line untouched. Bin ids are cached per student in `appState.cloudBins[syncId]`: `uploadToCloud()` reuses the cached id with `PUT /v3/b/:id`, and only `POST`s a new bin named `quiz_${syncId}` (default `kid_2026`) when no id is cached or the old bin returns 404. `findCloudBinId()` lists uncategorized bins, filters by `snippetMeta.name`, and picks the newest by `createdAt` (the listing is paginated at 10, newest first). `downloadFromCloud()` confirms before overwriting, resolves the bin by name first, and stores the resolved id. `setSyncStatus()` / `renderSyncStatus()` update the `#sync-status` label. `exportBackup()` / `importBackup()` handle local JSON files. When debugging cross-device sync, inspect the jsonbin collection for duplicate `quiz_*` bins created by older builds.

**Dates and time.** All daily logic uses browser-local time (`toDateString()` / `toLocaleDateString()`), so midnight/timezone changes can make the app consider a new day. Content and UI text are Chinese; keep that language and tone when adding questions or labels.

## Git workflow

Work on `main` directly (the repo has only that branch). Keep commit messages short and in Chinese, matching the existing history (e.g. `优化移动端响应式布局与触控体验`). Push to deploy via GitHub Pages — there is no separate release step.

## Changelog

`CHANGELOG.md` is the human-facing record of what each deployment changed. For every user-visible change, add or extend a dated entry at the top (newest first, Chinese) before committing. Group items under 新增 / 优化 / 修复 / 维护 and use the deploy date. Git commit messages remain the detailed history; the changelog is the readable summary.

## Versioning and deploy

`APP_VERSION` and `APP_RELEASED_AT` are defined near the top of the `index.html` script and rendered in the footer and parent panel. `APP_VERSION` is also the marker `scripts/check-live.sh` uses, so **bump it whenever a deploy changes the page** — patch for fixes, minor for user-visible features, major for breaking data/layout changes — and update `APP_RELEASED_AT` to the deploy date. Tooling-only commits (scripts, docs) do not need a version bump.

Deploy checklist:

1. Update `APP_VERSION` / `APP_RELEASED_AT` and add the matching `CHANGELOG.md` entry.
2. Run `./scripts/smoke-test.sh` (must report `0 failed`).
3. Commit and `git push origin main`.
4. Run `./scripts/check-live.sh` and wait for `✅ 线上已更新到 …`.
5. Optionally tag the verified release: `git tag v1.0.0 && git push origin v1.0.0`.

Rollback: `git revert <bad-commit>` then push; Pages rebuilds the previous state in about a minute. The previous build stays live if a new Pages build fails.
