#!/usr/bin/env node
// 從官方來源抓資料到 data/snapshots/（骨架版；Agent B 補完 CKAN 全目錄、國家等級、nidss 匯出解析）
// 抓不到（本沙箱無法連外、或官網暫時無回應）就保留既有快照並以 exit 0 結束，不讓建置失敗。
import fs from 'node:fs';
import path from 'node:path';
import { SNAPSHOTS } from './lib/load.mjs';

const SOURCES = [
  { file: 'travel-epidemic.json', url: 'https://www.cdc.gov.tw/TravelEpidemic/ExportJSON', label: '國際重要疫情（近 30 天）' },
  { file: 'country-epid-level.json', url: 'https://www.cdc.gov.tw/CountryEpidLevel/ExportJSON', label: '旅遊疫情建議等級' },
  { file: 'ckan-packages.json', url: 'https://data.cdc.gov.tw/api/3/action/package_search?rows=200', label: 'CKAN 資料集目錄', pick: (j) => j.result?.results ?? [] },
];

fs.mkdirSync(SNAPSHOTS, { recursive: true });
for (const s of SOURCES) {
  const target = path.join(SNAPSHOTS, s.file);
  try {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(s.url, { signal: ctrl.signal, headers: { 'User-Agent': 'cdc-ai-ready-prototype/0.1 (+github pages build)' } });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const data = s.pick ? s.pick(json) : json;
    fs.writeFileSync(target, JSON.stringify({ meta: { mode: 'live', fetchedAt: new Date().toISOString(), sourceUrl: s.url, label: s.label, count: Array.isArray(data) ? data.length : null }, data }, null, 2));
    console.log(`[fetch] ✓ ${s.label} ${Array.isArray(data) ? data.length : ''} 筆 → ${s.file}`);
  } catch (e) {
    const exists = fs.existsSync(target);
    console.log(`[fetch] ✗ ${s.label}（${e.message}）→ ${exists ? '沿用既有快照' : '建立空快照'}`);
    if (!exists) fs.writeFileSync(target, JSON.stringify({ meta: { mode: 'snapshot', fetchedAt: null, sourceUrl: s.url, label: s.label, note: '尚無快照；請在可連外環境執行 npm run fetch' }, data: [] }, null, 2));
  }
}
