// JSON Schema 驗證 + 跨檔參照檢查。任何一項失敗 → build 失敗（治理門檻）。
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
  migration: 'migration.json',
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
  const diseaseIds = new Set(site.master.diseases.map((d) => d.id));
  for (const item of site.all) {
    if (!units.has(item.owner)) push(item.__file, `owner ${item.owner} 不在 units 主檔`);
    for (const ref of item.basedOn ?? []) if (!ids.has(ref) && !site.collections.documents.some((d) => d.family === ref)) push(item.__file, `basedOn ${ref} 不存在（可填內容 id 或文件 family）`);
    for (const ref of item.diseases ?? []) if (!diseaseIds.has(ref)) push(item.__file, `diseases ${ref} 不在傳染病主檔`);
    if (item.type === 'document' && item.supersedes && !ids.has(item.supersedes)) push(item.__file, `supersedes ${item.supersedes} 不存在`);
    if (!site.config.licenses.allowed.includes(item.license) && !item.licenseNote) push(item.__file, `license ${item.license} 非標準授權且未填 licenseNote`);
    if (item.type === 'disease' && !diseaseIds.has(item.id)) push(item.__file, `疾病頁 ${item.id} 不在傳染病主檔`);
    if (item.type === 'labtest' && !diseaseIds.has(item.disease)) push(item.__file, `labtest.disease ${item.disease} 不在傳染病主檔`);
    if (item.type === 'media' && !(item.basedOn?.length)) push(item.__file, `影音素材必須填 basedOn（依據正本），見規劃 7.7`);
    for (const ref of item.contentIds ?? []) if (!ids.has(ref)) push(item.__file, `contentIds ${ref} 不存在`);
  }
  // 3. 佔位／示意網址政策（治理門檻）：內容欄位的連結不得含 placeholder-、example.gov.tw、example.com…
  //    例外：legacyUrls（現行官網對照用，不檢）。
  for (const item of site.all) for (const hit of findPlaceholderUrls(item)) push(item.__file, `${hit.path} 含佔位／示意網址：${hit.value}（尚未遷移的文件請改連 /pending/?ref=<id>&doc=<名稱>）`);

  // 4. 移轉清單（ARCHITECTURE 13.1）：schema、id 唯一、owner、target 存在（pending／dropped 除外）、key 唯一
  const vMig = ajv.getSchema('https://cdc-prototype/schemas/migration.json');
  const migIds = new Set();
  for (const list of site.migrationLists ?? []) {
    const file = list.__file ?? `content/migration/${list.id}.json`;
    if (!vMig(list)) for (const e of vMig.errors) push(file, `${e.instancePath || '/'} ${e.message}`);
    if (migIds.has(list.id) || ids.has(list.id)) push(file, `重複 id：${list.id}`);
    migIds.add(list.id);
    if (!units.has(list.owner)) push(file, `owner ${list.owner} 不在 units 主檔`);
    if (list.scope?.disease && !diseaseIds.has(list.scope.disease)) push(file, `scope.disease ${list.scope.disease} 不在傳染病主檔`);
    for (const ref of list.diseases ?? []) if (!diseaseIds.has(ref)) push(file, `diseases ${ref} 不在傳染病主檔`);
    const keys = new Set();
    (list.items ?? []).forEach((it, i) => {
      const at = `/items/${i}${it?.key ? `（${it.key}）` : ''}`;
      if (keys.has(it.key)) push(file, `${at} key 重複：${it.key}`);
      keys.add(it.key);
      if (it.owner && !units.has(it.owner)) push(file, `${at} owner ${it.owner} 不在 units 主檔`);
      const needTarget = !['pending', 'dropped'].includes(it.status);
      if (it.target && !ids.has(it.target)) push(file, `${at} target ${it.target} 不存在`);
      else if (needTarget && !it.target) push(file, `${at} status ${it.status} 必須填 target（新站內容 id）`);
    });
    // 新站內部欄位仍檢查佔位網址；oldUrl／legacyRoot（舊站網址，可含 {id}）豁免
    for (const hit of findPlaceholderUrls(list)) push(file, `${hit.path} 含佔位／示意網址：${hit.value}`);
  }

  for (const it of site.situation.items) if (!diseaseIds.has(it.disease)) push('content/situation/current.json', `disease ${it.disease} 不在主檔`);
  if (!units.has(site.situation.publisher)) push('content/situation/current.json', `publisher ${site.situation.publisher} 不在 units`);

  return errors;
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
