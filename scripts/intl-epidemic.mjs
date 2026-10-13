#!/usr/bin/env node
// 國際重要疫情資訊匯入（docs/intl-epidemic.md 第 4 節）：手動或排程把一份 feed 送進匯入器。
//
// 用法：
//   npm run intl:import -- <檔案或 URL> [--dry] [--mode full|delta] [--token <Bearer 權杖>] [--shape v1|legacy|csv]
//                          [--source feed|official-export|manual|push] [--by <誰>] [--today YYYY-MM-DD] [--snapshots <目錄>]
//   檔案可以是交換格式 v1 的 JSON、等價的 CSV，或現行官網 TravelEpidemic/ExportJSON 的匯出檔（自動判斷形狀）。
//   URL 會帶 Authorization: Bearer <token>（--token 或環境變數 INTL_FEED_TOKEN）。
//   --dry：只檢查與比對，印出會怎麼變，不寫任何檔。
//
// 結束碼：0＝完成（含「與上次完全相同」）；1＝讀不到或看不懂這份資料；2＝整批保留不動（held）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeed, planImport, applyImport, describePlan, ROOT, SNAPSHOT_FILE, SOURCES } from './lib/intl-epidemic.mjs';

const log = (...m) => console.log('[intl]', ...m);

export function parseArgs(argv) {
  const out = {
    input: null,
    dry: false,
    mode: undefined,
    token: undefined,
    shape: undefined,
    source: undefined,
    by: undefined,
    today: undefined,
    snapshots: undefined,
  };
  const needValue = new Set(['--mode', '--token', '--shape', '--source', '--by', '--today', '--snapshots']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') out.dry = true;
    else if (needValue.has(a)) out[a.slice(2)] = argv[++i];
    else if (a.startsWith('--') && a.includes('=') && needValue.has(a.split('=')[0])) out[a.split('=')[0].slice(2)] = a.slice(a.indexOf('=') + 1);
    else if (!a.startsWith('--') && out.input == null) out.input = a;
    else throw new Error(`看不懂的參數：${a}`);
  }
  if (out.mode && !['full', 'delta'].includes(out.mode)) throw new Error('--mode 只能是 full 或 delta');
  if (out.shape && !['v1', 'legacy', 'csv'].includes(out.shape)) throw new Error('--shape 只能是 v1、legacy 或 csv');
  if (out.source && !SOURCES.includes(out.source)) throw new Error(`--source 只能是 ${SOURCES.join('、')}`);
  return out;
}

async function readInput(input, token) {
  if (/^https?:\/\//i.test(input)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const headers = { 'User-Agent': 'cdc-ai-ready-prototype/0.2 (intl-epidemic import)', Accept: 'application/json, text/csv;q=0.9, */*;q=0.1' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(input, { signal: ctrl.signal, headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }
  return fs.readFileSync(path.resolve(input), 'utf8');
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    log(e.message);
    return 1;
  }
  if (!args.input) {
    log('用法：npm run intl:import -- <檔案或 URL> [--dry] [--mode full|delta] [--token …]');
    return 1;
  }
  const isUrl = /^https?:\/\//i.test(args.input);
  let feed;
  try {
    const text = await readInput(args.input, args.token ?? process.env.INTL_FEED_TOKEN);
    feed = parseFeed(text, { shape: args.shape });
  } catch (e) {
    // 不印 URL（可能是內網位址）；檔名可以印
    log(`讀不到或看不懂這份資料：${e.message}${isUrl ? '' : `（${args.input}）`}`);
    return 1;
  }
  const snapshotsDir = args.snapshots ? path.resolve(args.snapshots) : path.join(ROOT, 'data', 'snapshots');
  let current = null;
  try {
    current = JSON.parse(fs.readFileSync(path.join(snapshotsDir, SNAPSHOT_FILE), 'utf8'));
  } catch {}
  const source = args.source ?? (feed.shape === 'legacy' ? 'official-export' : isUrl ? 'feed' : 'manual');
  const plan = planImport({ current, feed, mode: args.mode, today: args.today, source, by: args.by ?? process.env.USER ?? null });
  log(`形狀 ${feed.shape}、模式 ${plan.mode}、來源 ${source}${feed.producer ? `、產生者 ${feed.producer}` : ''}`);
  log(describePlan(plan));
  for (const r of plan.report.rejected) log(`  退回 ${r.id ?? `第 ${r.index + 1} 則`}${r.headline ? `「${r.headline}」` : ''}：${r.errors.join('；')}`);
  for (const u of plan.report.unmapped) log(`  對不上${u.kind === 'disease' ? '疾病' : '國家'}主檔：${u.value}（${u.ids.length} 則）`);
  for (const w of plan.changes.withdrawn)
    log(`  撤下 ${w.id}（${{ withdrawn: '資料庫標示撤下', expired: '已過下架時間', missing: 'full 模式未再出現' }[w.reason]}）`);
  for (const w of plan.report.warnings) log(`  提醒 ${w.id ?? ''}：${w.message}`);
  const r = applyImport(plan, { snapshotsDir, dry: args.dry, fetched: isUrl, sourceUrl: source === 'official-export' && isUrl ? args.input : undefined });
  if (args.dry) log('(dry) 未寫入任何檔案');
  else if (r.wrote.length) log(`已寫入：${r.wrote.map((f) => path.relative(process.cwd(), f)).join('、')}`);
  else log('沒有需要寫入的變更');
  return plan.held ? 2 : 0;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      log(`未預期錯誤：${e.message}`);
      process.exitCode = 1;
    },
  );
}
