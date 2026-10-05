// JSON Schema 驗證 + 跨檔參照檢查。任何一項失敗 → build 失敗（治理門檻）。
// 檔案資產（assets[]、/files/ 引用、content/assets/ 實體檔）的檢查在 scripts/lib/assets.mjs 的 validateAssets()，
// build.mjs 在本檢查後呼叫並把錯誤併入同一份失敗清單（ARCHITECTURE 16.1）。
import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ROOT } from './load.mjs';

const SCHEMAS = path.join(ROOT, 'schemas');

function loadSchemas() {
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);
  for (const f of fs.readdirSync(SCHEMAS).filter((x) => x.endsWith('.json'))) {
    const schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS, f), 'utf8'));
    ajv.addSchema(schema, schema.$id);
  }
  return ajv;
}

const typeToSchema = {
  disease: 'disease.json', faq: 'faq.json', news: 'news.json', letter: 'news.json', clarification: 'clarification.json',
  document: 'document.json', vaccine: 'vaccine.json', dataset: 'dataset.json', banner: 'banner.json', page: 'page.json',
  media: 'media.json', topic: 'topic.json', service: 'service.json', publication: 'publication.json', labtest: 'labtest.json', research: 'research.json',
  migration: 'migration.json', job: 'job.json', tender: 'tender.json',
};

export function validateSite(site) {
  const ajv = loadSchemas();
  const errors = [];
  const push = (file, msg) => errors.push(`${file}: ${msg}`);

  // 1. schema
  for (const item of site.all) {
    const schemaFile = typeToSchema[item.type];
    if (!schemaFile) { push(item.__file, `未知 type ${item.type}`); continue; }
    const validate = ajv.getSchema(`https://cdc-prototype/schemas/${schemaFile}`);
    if (!validate(item)) for (const e of validate.errors) push(item.__file, `${e.instancePath || '/'} ${e.message}`);
  }
  const vSit = ajv.getSchema('https://cdc-prototype/schemas/situation.json');
  if (!vSit(site.situation)) for (const e of vSit.errors) push('content/situation/current.json', `${e.instancePath} ${e.message}`);
  for (const h of site.situation.history ?? []) if (!vSit(h)) for (const e of vSit.errors) push(h.__file, `${e.instancePath} ${e.message}`);
  const vMaster = (def, list, file) => {
    const v = ajv.compile({ type: 'array', items: { $ref: `https://cdc-prototype/schemas/master.json#/$defs/${def}` } });
    if (!v(list)) for (const e of v.errors) push(file, `${e.instancePath} ${e.message}`);
  };
  vMaster('unit', site.master.units, 'content/master/units.json');
  vMaster('diseaseMaster', site.master.diseases, 'content/master/diseases.json');
  vMaster('glossaryTerm', site.master.glossary, 'content/master/glossary.json');
  vMaster('country', site.master.countries, 'content/master/countries.json');
  for (const [def, obj, file] of [
    ['aiStatus', site.governance.aiStatus, 'content/governance/ai-status.json'],
    ['whitelistPolicy', site.governance.whitelist, 'content/governance/whitelist.json'],
    ['evalSet', site.governance.evalSet, 'content/governance/eval-set.json'],
  ]) {
    const v = ajv.compile({ $ref: `https://cdc-prototype/schemas/governance.json#/$defs/${def}` });
    if (!v(obj)) for (const e of v.errors) push(file, `${e.instancePath} ${e.message}`);
  }

  // 2. 跨檔參照
  const ids = new Set(site.all.map((i) => i.id));
  const dup = site.all.map((i) => i.id).filter((id, i, a) => a.indexOf(id) !== i);
  for (const d of new Set(dup)) errors.push(`重複 id：${d}`);
  const units = new Set(site.master.units.map((u) => u.id));
  const unitById = new Map((site.master.units ?? []).map((u) => [u.id, u]));
  const diseaseIds = new Set(site.master.diseases.map((d) => d.id));
  for (const item of site.all) {
    if (!units.has(item.owner)) push(item.__file, `owner ${item.owner} 不在 units 主檔`);
    else if (unitById.get(item.owner)?.publishes === false) push(item.__file, `owner ${item.owner}（${unitById.get(item.owner).name}）不上架內容，請改為實際承辦單位`);
    for (const ref of item.basedOn ?? []) if (!ids.has(ref) && !site.collections.documents.some((d) => d.family === ref)) push(item.__file, `basedOn ${ref} 不存在（可填內容 id 或文件 family）`);
    for (const ref of item.diseases ?? []) if (!diseaseIds.has(ref)) push(item.__file, `diseases ${ref} 不在傳染病主檔`);
    if (item.type === 'document' && item.supersedes && !ids.has(item.supersedes)) push(item.__file, `supersedes ${item.supersedes} 不存在`);
    if (!site.config.licenses.allowed.includes(item.license) && !item.licenseNote) push(item.__file, `license ${item.license} 非標準授權且未填 licenseNote`);
    if (item.type === 'disease' && !diseaseIds.has(item.id)) push(item.__file, `疾病頁 ${item.id} 不在傳染病主檔`);
    if (item.type === 'labtest' && !diseaseIds.has(item.disease)) push(item.__file, `labtest.disease ${item.disease} 不在傳染病主檔`);
    if (item.type === 'media' && !(item.basedOn?.length)) push(item.__file, `影音素材必須填 basedOn（依據正本），見規劃 7.7`);
    for (const ref of item.contentIds ?? []) if (!ids.has(ref)) push(item.__file, `contentIds ${ref} 不存在`);
  }
  // 2a. 第七輪（ARCHITECTURE 15.1）：職缺與採購公告
  //     id／slug 一致、slug 唯一、用人／需求單位存在、日期先後、legacyIds 不得與現存 id 重複；
  //     個資閘門（甄選結果只公布報名編號與遮罩姓名）：違反即建置失敗。
  const slugSeen = new Map();
  for (const item of site.all) {
    if (item.type !== 'job' && item.type !== 'tender') continue;
    const prefix = item.type === 'job' ? 'job' : 'tender';
    const expectSlug = String(item.id).replace(new RegExp(`^${prefix}\\.\\d{4}-\\d{2}-\\d{2}-`), '');
    if (item.slug && item.slug !== expectSlug) push(item.__file, `slug ${item.slug} 必須等於 id 去掉「${prefix}.{yyyy-mm-dd}-」的部分（${expectSlug}）`);
    const sk = `${item.type}:${item.slug ?? expectSlug}`;
    if (slugSeen.has(sk)) push(item.__file, `slug ${item.slug ?? expectSlug} 與 ${slugSeen.get(sk)} 重複（前台路徑會衝突）`);
    else slugSeen.set(sk, item.id);
    const unitField = item.type === 'job' ? 'hiringUnit' : 'requestingUnit';
    if (item[unitField] && !units.has(item[unitField])) push(item.__file, `${unitField} ${item[unitField]} 不在 units 主檔`);
    for (const old of item.legacyIds ?? []) {
      if (ids.has(old)) push(item.__file, `legacyIds ${old} 仍是現存內容 id（搬家後舊檔要刪除，否則轉址與原頁衝突）`);
      if (!/^news\./.test(old)) push(item.__file, `legacyIds ${old}：目前只支援第七輪前的 news.* 舊 id`);
    }
    if (item.type === 'job') {
      if (item.applyStart && item.deadlineAt && item.applyStart > item.deadlineAt) push(item.__file, `applyStart ${item.applyStart} 晚於 deadlineAt ${item.deadlineAt}`);
      for (const e of item.examPlan ?? []) if (e.date && item.deadlineAt && e.date < item.deadlineAt) push(item.__file, `examPlan「${e.stage}」日期 ${e.date} 早於報名截止 ${item.deadlineAt}`);
      if (item.result && item.manualStatus === 'cancelled') push(item.__file, 'manualStatus cancelled 的職缺不得有 result');
      for (const msg of jobPiiErrors(item)) push(item.__file, msg);
    } else {
      if (item.announcedAt && item.deadlineAt && item.announcedAt > item.deadlineAt) push(item.__file, `announcedAt ${item.announcedAt} 晚於 deadlineAt ${item.deadlineAt}`);
      if (item.openingAt && item.deadlineAt && item.openingAt < item.deadlineAt) push(item.__file, `openingAt ${item.openingAt} 早於投標截止 ${item.deadlineAt}`);
      if (item.award && item.manualStatus) push(item.__file, `已決標（award）的標案不得再標 manualStatus ${item.manualStatus}`);
      if (item.award?.date && item.openingAt && item.award.date < item.openingAt) push(item.__file, `award.date ${item.award.date} 早於開標日 ${item.openingAt}`);
    }
  }

  // 2b. 來源語言（ARCHITECTURE 14.2）：languages[sourceLang] 為 source、只有來源語言可標 source；
  //     sourceLang≠zh-TW ⇒ i18n['zh-TW'] 必須存在（含 title、summary）且 languages['zh-TW'] 為 reviewed／machine（中文官網不能沒有中文）。
  for (const item of site.all) for (const msg of sourceLangErrors(item)) push(item.__file, msg);

  // 3. 佔位／示意網址政策（治理門檻）：內容欄位的連結不得含 placeholder-、example.gov.tw、example.com…
  //    例外：legacyUrls（現行官網對照用，不檢）。
  for (const item of site.all) for (const hit of findPlaceholderUrls(item)) push(item.__file, `${hit.path} 含佔位／示意網址：${hit.value}（檔案請放 content/assets/<id>/ 並在 assets 宣告後以 /files/<id>/<檔名> 引用；尚未取得的文件改連 /pending/?ref=<id>&doc=<名稱>）`);

  // 4a. 移轉清單模板（ARCHITECTURE 14.1）：schema、id 唯一、owner、key 唯一
  const vTpl = ajv.getSchema('https://cdc-prototype/schemas/migration-template.json');
  const tplById = new Map();
  for (const tpl of site.migrationTemplates ?? []) {
    const file = tpl.__file ?? `content/migration/_${tpl.id}.json`;
    if (!vTpl(tpl)) for (const e of vTpl.errors) push(file, `${e.instancePath || '/'} ${e.message}`);
    if (tplById.has(tpl.id)) push(file, `重複模板 id：${tpl.id}`);
    tplById.set(tpl.id, tpl);
    if (tpl.owner && !units.has(tpl.owner)) push(file, `owner ${tpl.owner} 不在 units 主檔`);
    const tkeys = new Set();
    (tpl.items ?? []).forEach((it, i) => { if (tkeys.has(it.key)) push(file, `/items/${i} key 重複：${it.key}`); tkeys.add(it.key); });
    for (const hit of findPlaceholderUrls(tpl)) push(file, `${hit.path} 含佔位／示意網址：${hit.value}`);
  }

  // 4. 移轉清單（ARCHITECTURE 13.1）：schema、id 唯一、owner、target 存在或 newPath（pending／dropped 除外）、key 唯一
  //    第六輪（14.1）：同一疾病只能有一份人工清單；extends 指向的模板要存在；omit 的 key 要在模板內。
  const vMig = ajv.getSchema('https://cdc-prototype/schemas/migration.json');
  const migIds = new Set();
  const migByDisease = new Map();
  for (const list of site.migrationLists ?? []) {
    const file = list.__file ?? `content/migration/${list.id}.json`;
    if (!vMig(list)) for (const e of vMig.errors) push(file, `${e.instancePath || '/'} ${e.message}`);
    if (migIds.has(list.id) || ids.has(list.id)) push(file, `重複 id：${list.id}`);
    migIds.add(list.id);
    if (!units.has(list.owner)) push(file, `owner ${list.owner} 不在 units 主檔`);
    if (list.scope?.disease && !diseaseIds.has(list.scope.disease)) push(file, `scope.disease ${list.scope.disease} 不在傳染病主檔`);
    if (list.scope?.disease) {
      if (migByDisease.has(list.scope.disease)) push(file, `scope.disease ${list.scope.disease} 已有人工清單 ${migByDisease.get(list.scope.disease)}（同一疾病只能一份，例外請寫在同一份）`);
      else migByDisease.set(list.scope.disease, list.id);
      const tplId = list.extends ?? 'migration-template.disease';
      if (tplId !== 'none' && list.extends && !tplById.has(tplId)) push(file, `extends ${tplId} 模板不存在`);
      const tpl = tplById.get(tplId);
      for (const k of list.omit ?? []) if (tpl && !tpl.items?.some((x) => x.key === k)) push(file, `omit ${k} 不在模板 ${tplId} 的 key 內`);
    } else if (list.extends && list.extends !== 'none') push(file, `extends 只適用於疾病範圍（scope.kind=disease）的清單`);
    for (const ref of list.diseases ?? []) if (!diseaseIds.has(ref)) push(file, `diseases ${ref} 不在傳染病主檔`);
    const keys = new Set();
    (list.items ?? []).forEach((it, i) => {
      const at = `/items/${i}${it?.key ? `（${it.key}）` : ''}`;
      if (keys.has(it.key)) push(file, `${at} key 重複：${it.key}`);
      keys.add(it.key);
      if (it.owner && !units.has(it.owner)) push(file, `${at} owner ${it.owner} 不在 units 主檔`);
      const needTarget = !['pending', 'dropped'].includes(it.status);
      if (it.target && !ids.has(it.target)) push(file, `${at} target ${it.target} 不存在`);
      else if (needTarget && !it.target && !it.newPath) push(file, `${at} status ${it.status} 必須填 target（新站內容 id）或 newPath（系統產生頁／功能頁路徑）`);
      if (it.target && it.newPath) push(file, `${at} target 與 newPath 只能擇一`);
    });
    // 新站內部欄位仍檢查佔位網址；oldUrl／legacyRoot（舊站網址，可含 {id}）豁免
    for (const hit of findPlaceholderUrls(list)) push(file, `${hit.path} 含佔位／示意網址：${hit.value}`);
  }

  for (const it of site.situation.items) if (!diseaseIds.has(it.disease)) push('content/situation/current.json', `disease ${it.disease} 不在主檔`);
  if (!units.has(site.situation.publisher)) push('content/situation/current.json', `publisher ${site.situation.publisher} 不在 units`);

  return errors;
}

// ───────────────────────── 第七輪：甄選結果個資閘門（ARCHITECTURE 15.1） ─────────────────────────

/** 遮罩字（任一即可）：○ U+25CB、◯ U+25EF、〇 U+3007、＊ U+FF0A、* */
export const MASK_CHARS_RE = /[○◯〇＊*]/;
/** 完整姓名樣式：3 個以上連續中文字（王小明、歐陽小明）；遮罩後的「王○明」「歐陽○明」不會命中 */
export const FULL_NAME_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{3,}/u;
/** 身分證字號／居留證號樣式（含新式居留證 8、9 開頭）：出現在任何結果欄位都擋下 */
export const NATIONAL_ID_RE = /[A-Z][1289]\d{8}/i;
/** 報名編號完整比對（契約：^[A-Z][12]\d{8}$ 一律擋下；這裡更嚴，任何位置出現都擋） */
export const CANDIDATE_NO_ID_RE = /^[A-Z][12]\d{8}$/i;

/** 單一遮罩姓名的問題（空陣列＝通過） */
export function maskedNameProblems(name) {
  const v = String(name ?? '').trim();
  const out = [];
  if (!v) { out.push('姓名欄空白'); return out; }
  if (!MASK_CHARS_RE.test(v)) out.push(`「${v}」沒有遮罩字（○、◯、〇、＊ 擇一，例：王○明）`);
  const m = v.match(FULL_NAME_RE);
  if (m) out.push(`「${v}」含 ${m[0].length} 個連續中文字，疑似完整姓名（只留姓與最後一字，中間以 ○ 遮罩）`);
  if (NATIONAL_ID_RE.test(v)) out.push(`「${v}」含身分證字號樣式`);
  return out;
}
/** 單一報名編號的問題 */
export function candidateNoProblems(no) {
  const v = String(no ?? '').trim();
  const out = [];
  if (!v) { out.push('報名編號空白'); return out; }
  if (CANDIDATE_NO_ID_RE.test(v) || NATIONAL_ID_RE.test(v)) out.push(`報名編號「${v.slice(0, 2)}********」疑似身分證字號（請改用報名編號，例：1150924-012）`);
  return out;
}

/**
 * 職缺甄選結果的個資閘門 → 錯誤訊息陣列（違反即建置失敗）。
 * 檢查 result.admitted[]、result.waitlist[]、waitlistUpdates[] 的 nameMasked 與 candidateNo；
 * result.note 與 waitlistUpdates[].note 不得含身分證字號樣式；正取人數不得超過名額。
 */
export function jobPiiErrors(job) {
  const errs = [];
  const head = '個資閘門（甄選結果只公布報名編號與遮罩姓名）';
  const rows = [
    ...(job.result?.admitted ?? []).map((r, i) => ({ at: `result.admitted[${i}]`, r })),
    ...(job.result?.waitlist ?? []).map((r, i) => ({ at: `result.waitlist[${i}]`, r })),
    ...(job.waitlistUpdates ?? []).map((r, i) => ({ at: `waitlistUpdates[${i}]`, r })),
  ];
  for (const { at, r } of rows) {
    for (const p of maskedNameProblems(r?.nameMasked)) errs.push(`${head}：${at}.nameMasked ${p}`);
    for (const p of candidateNoProblems(r?.candidateNo)) errs.push(`${head}：${at}.candidateNo ${p}`);
  }
  for (const [at, text] of [['result.note', job.result?.note], ...(job.waitlistUpdates ?? []).map((u, i) => [`waitlistUpdates[${i}].note`, u?.note])]) {
    if (text && NATIONAL_ID_RE.test(String(text))) errs.push(`${head}：${at} 含身分證字號樣式`);
  }
  const admitted = job.result?.admitted?.length ?? 0;
  if (job.positions != null && admitted > job.positions) errs.push(`甄選結果：正取 ${admitted} 名超過名額 ${job.positions} 名`);
  const inResult = [...(job.result?.admitted ?? []), ...(job.result?.waitlist ?? [])].map((r) => r?.candidateNo).filter(Boolean);
  const dupNo = inResult.filter((x, i, a) => a.indexOf(x) !== i);
  if (dupNo.length) errs.push(`甄選結果：報名編號重複 ${[...new Set(dupNo)].join('、')}`);
  return errs;
}

/** 來源語言規則（ARCHITECTURE 14.2）→ 錯誤訊息陣列 */
export function sourceLangErrors(item) {
  const errs = [];
  const src = item.sourceLang ?? 'zh-TW';
  const langs = item.languages ?? {};
  if (langs[src]?.status !== 'source') errs.push(`languages.${src}.status 必須為 source（sourceLang＝${src}）`);
  for (const [lang, m] of Object.entries(langs)) if (lang !== src && m?.status === 'source') errs.push(`languages.${lang}.status 為 source，但來源語言是 ${src}（只有 sourceLang 可標 source；其他語言改 reviewed／machine）`);
  if (src !== 'zh-TW') {
    const zh = item.i18n?.['zh-TW'];
    if (!zh || typeof zh !== 'object') errs.push(`sourceLang＝${src} 時必須提供中文譯文 i18n["zh-TW"]（中文官網不能沒有中文）`);
    else for (const f of ['title', 'summary']) if (!zh[f]) errs.push(`i18n["zh-TW"].${f} 必填（sourceLang＝${src}）`);
    if (!['reviewed', 'machine'].includes(langs['zh-TW']?.status)) errs.push(`sourceLang＝${src} 時 languages["zh-TW"].status 必須為 reviewed 或 machine（目前 ${langs['zh-TW']?.status ?? '未填'}）`);
  }
  return errs;
}

/** 佔位／示意網址判定（與 scripts/lib/check-internal-links.mjs 的黑名單同精神；這裡管內容來源） */
export const PLACEHOLDER_URL_RE = /placeholder-|(?:^|[/.@])example\.(?:gov\.tw|com|org|net)\b/i;
/** 這些欄位不檢（現行官網對照、移轉清單的舊站網址〔可含 {id} 佔位〕、建置期附加欄位） */
export const PLACEHOLDER_EXEMPT_KEYS = new Set(['legacyUrls', 'oldUrl', 'legacyRoot', 'gov', '__file', 'sourceHash']);

/** 遞迴找出內容中含佔位網址的字串欄位 → [{ path, value }] */
export function findPlaceholderUrls(item) {
  const hits = [];
  const visit = (v, p) => {
    if (typeof v === 'string') { if (PLACEHOLDER_URL_RE.test(v)) hits.push({ path: p || '/', value: v.length > 160 ? `${v.slice(0, 157)}…` : v }); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => visit(x, `${p}/${i}`)); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!PLACEHOLDER_EXEMPT_KEYS.has(k)) visit(x, `${p}/${k}`);
  };
  visit(item, '');
  return hits;
}
