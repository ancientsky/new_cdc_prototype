// 第七十三輪：CSV 匯出的公式注入防護（OWASP「CSV Injection」）。
//   文字儲存格以 = + - @ 或 tab、CR 開頭 ⇒ 前置單引號，Excel／LibreOffice 開檔時才不會把它當公式執行（例：=HYPERLINK(...) 外連、=cmd|...）。
//   數字不動（負數 -4 仍是數字）；兩處匯出：後台共用的 toCSV（admin/common.js）、前台接種時程的 scheduleCsv（vaxschedule.js）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scheduleCsv } from '../src/client/vaxschedule.js';

const EVIL = ['=HYPERLINK("http://evil.invalid","點我")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1'];

test('後台 toCSV：危險開頭的文字加單引號；一般文字、數字、負數不動', async () => {
  // common.js 一載入就檢查工作階段（要瀏覽器），所以只取出 csvSafe 與 toCSV 兩段原始碼來測
  const src = fs.readFileSync(new URL('../src/client/admin/common.js', import.meta.url), 'utf8');
  const safe = src.match(/export const csvSafe = [^\n]+\n/)?.[0];
  const to = src.match(/export function toCSV\(rows\) \{[\s\S]*?\n\}\n/)?.[0];
  assert.ok(safe && to, '找得到 csvSafe 與 toCSV');
  const { toCSV, csvSafe } = await import(`data:text/javascript,${encodeURIComponent(safe + to)}`);
  for (const v of EVIL) assert.equal(csvSafe(v), `'${v}`, JSON.stringify(v));
  assert.equal(csvSafe(-4), -4);
  assert.equal(csvSafe('登革熱'), '登革熱');
  const csv = toCSV([['a', ...EVIL, -4, 3, '中文']]);
  const line = csv.replace(/^﻿/, '').split('\r\n')[0];
  assert.ok(line.startsWith(`a,"'=HYPERLINK(""http://evil.invalid"",""點我"")",'+1+1,'-2+3,'@SUM(A1),'\t=1,"'\r=1",-4,3,中文`), line);
});

test('前台 scheduleCsv：備註、劑次等文字欄位的危險開頭加單引號；數字欄不動', () => {
  const csv = scheduleCsv(
    [{ id: 'sched.x', vaccine: 'v', label: '=1+1', note: '@cmd', group: '-x', ageMinMonths: 0, ageMaxMonths: 12, stage: 'infant', funded: 'self' }],
    () => '+V',
  );
  const row = csv.replace(/^﻿/, '').split('\r\n')[1];
  assert.match(row, /^sched\.x,v,'\+V,'=1\+1,/);
  assert.match(row, /,'@cmd,/);
  assert.match(row, /,'-x,/);
  assert.match(row, /,0,12,/);
});
