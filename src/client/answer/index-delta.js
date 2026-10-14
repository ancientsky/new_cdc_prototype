// 專業版答案索引的「差異分片」（第四十九輪，Issue #103 的第二個便宜做法）。
//
// 專業版索引 = 民眾版索引的所有片段 ＋ 只給專業人員看的片段（文件庫、通函、檢驗項目、研究計畫、疾病頁的專業人員重點……）。
// 以前專業版另有一份完整的 search-index-pro.<lang>.json，其中約六成與民眾版逐字相同，專業同事與民眾使用同一站卻要各下載一次、HTTP 快取也不共用。
// 現在建置另輸出 search-index-pro-delta.<lang>.json（只放專業版多出來的片段，加上把它們插回原位置所需的資訊），
// 專業版頁面下載「民眾版分片＋差異分片」並在記憶體合回與原本完全相同的陣列（順序也相同——BM25 同分時的名次取決於陣列順序）。
// 對外的 v1/search-index*.json 完整檔照舊輸出（API 相容；差異分片是新增檔，不取代任何既有端點）。
//
// 本檔是純函式、不碰 DOM：建置（scripts/lib/emit-api.mjs 產生、驗證）與瀏覽器（data.js 合併）共用同一份，
// 不會出現「建置端的格式」和「前端解讀的格式」各寫一份而漂移。
import { indexShardNames } from './deps-manifest.js';

/** 差異分片的檔名基底（v1/ 之後、語言碼之前） */
export const PRO_DELTA_BASE = 'search-index-pro-delta';
/** 差異分片的格式版本；前端遇到不認得的版本就退回完整的專業版分片 */
export const PRO_DELTA_VERSION = 1;

/** 某語言的專業版頁要下載的差異分片（中文正本一定要有，與 indexShardNames 同規則） */
export const proDeltaShardNames = (lang) => indexShardNames(PRO_DELTA_BASE, lang);

const fingerprint = (arr) => ({ count: arr.length, first: arr[0]?.id ?? null, last: arr.at(-1)?.id ?? null });

/**
 * 建置端：算出「民眾版分片 → 專業版分片」的差異。
 * @param {Array<{id:string}>} pub 某語言的民眾版分片（陣列順序＝輸出順序）
 * @param {Array<{id:string}>} pro 同語言的專業版分片
 * @returns {{ v:number, base:{count:number,first:string|null,last:string|null}, omit:string[], at:number[], chunks:object[] }}
 *   base：民眾版分片的指紋（前端合併前核對，擋住「民眾版分片來自舊快取、差異分片是新的」這種版本錯位）；
 *   omit：民眾版有、專業版沒有的片段 id（目前恆為空，但規則上允許：專業版的資格比民眾版多了幾道檢查）；
 *   at：chunks[i] 在合併後陣列中的位置（遞增）；chunks：專業版獨有（或內容與民眾版不同）的片段。
 */
export function diffProIndex(pub, pro) {
  const pubById = new Map(pub.map((c) => [c.id, c]));
  const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
  const at = [];
  const chunks = [];
  const keep = new Set();
  pro.forEach((c, i) => {
    const p = pubById.get(c.id);
    if (p && same(p, c)) keep.add(c.id);
    else { at.push(i); chunks.push(c); }
  });
  const omit = pub.filter((c) => !keep.has(c.id)).map((c) => c.id);
  return { v: PRO_DELTA_VERSION, base: fingerprint(pub), omit, at, chunks };
}

/**
 * 前端／驗證：民眾版分片 ＋ 差異分片 → 專業版分片。資料對不上（指紋不符、位置不合理）回傳 null，由呼叫端退回完整的專業版分片。
 * 不修改輸入。
 */
export function applyProDelta(pub, delta) {
  if (!Array.isArray(pub) || !delta || delta.v !== PRO_DELTA_VERSION || !Array.isArray(delta.chunks) || !Array.isArray(delta.at) || delta.at.length !== delta.chunks.length) return null;
  const fp = fingerprint(pub);
  if (!delta.base || delta.base.count !== fp.count || delta.base.first !== fp.first || delta.base.last !== fp.last) return null;
  const omit = new Set(delta.omit ?? []);
  const base = omit.size ? pub.filter((c) => !omit.has(c.id)) : pub;
  const total = base.length + delta.chunks.length;
  const out = new Array(total);
  let prev = -1;
  for (let i = 0; i < delta.at.length; i++) {
    const pos = delta.at[i];
    if (!Number.isInteger(pos) || pos <= prev || pos >= total) return null;
    out[pos] = delta.chunks[i];
    prev = pos;
  }
  let j = 0;
  for (let k = 0; k < total; k++) if (!(k in out)) out[k] = base[j++];
  return j === base.length ? out : null;
}

/**
 * 瀏覽器：讀「民眾版分片＋差異分片」合成某語言頁要用的專業版索引（中文正本在前）。任何一組讀不到或對不上就呼叫 full() 退回完整專業版分片。
 * @param {{ lang:string, shard:(name:string)=>Promise<any>, full:()=>Promise<any[]> }} io shard 讀 v1/<name>.json 的 data（失敗回 null）
 */
export async function loadProIndex({ lang, shard, full }) {
  const langs = lang === 'zh-TW' ? ['zh-TW'] : ['zh-TW', lang];
  const deltaNames = proDeltaShardNames(lang);
  const parts = await Promise.all(langs.map(async (l, i) => {
    const [pub, delta] = await Promise.all([shard(`search-index.${l}`), shard(deltaNames[i])]);
    return applyProDelta(pub, delta);
  }));
  return parts.every(Array.isArray) ? parts.flat() : full();
}
