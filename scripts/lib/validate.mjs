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
  }
  for (const it of site.situation.items) if (!diseaseIds.has(it.disease)) push('content/situation/current.json', `disease ${it.disease} 不在主檔`);
  if (!units.has(site.situation.publisher)) push('content/situation/current.json', `publisher ${site.situation.publisher} 不在 units`);

  return errors;
}
