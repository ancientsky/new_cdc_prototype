// 草稿的單筆驗證：scripts/lib/validate.mjs 只有整站 validateSite(site)，沒有單檔入口，所以這裡用 ajv 直接載入 schemas/ 驗單一草稿，
// 再補治理引擎會查的跨檔項目（owner／diseases 在主檔、授權、資產檔存在與雜湊相符）。
import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ROOT } from '../load.mjs';
import { sha256Of } from '../assets.mjs';

const SCHEMAS = path.join(ROOT, 'schemas');
const TYPE_TO_SCHEMA = {
  disease: 'disease.json', faq: 'faq.json', news: 'news.json', letter: 'news.json', clarification: 'clarification.json', document: 'document.json',
  page: 'page.json', media: 'media.json', topic: 'topic.json', service: 'service.json', publication: 'publication.json', labtest: 'labtest.json', research: 'research.json',
};

let ajvCache = null;
function getAjv() {
  if (ajvCache) return ajvCache;
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);
  for (const f of fs.readdirSync(SCHEMAS).filter((x) => x.endsWith('.json'))) {
    const schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS, f), 'utf8'));
    ajv.addSchema(schema, schema.$id);
  }
  ajvCache = ajv;
  return ajv;
}

/**
 * 驗證一筆草稿。
 * @param {object} draft
 * @param {{ units?: Set<string>, diseaseIds?: Set<string>, licenses?: string[], assetsDir?: string }} env assetsDir＝{out}/content/assets
 * @returns {string[]} 錯誤清單（空＝通過）
 */
export function validateDraft(draft, env = {}) {
  const errors = [];
  const file = TYPE_TO_SCHEMA[draft.type];
  if (!file) return [`未知 type ${draft.type}`];
  const validate = getAjv().getSchema(`https://cdc-prototype/schemas/${file}`);
  if (!validate(draft)) for (const e of validate.errors) errors.push(`${e.instancePath || '/'} ${e.message}`);
  if (env.units && !env.units.has(draft.owner)) errors.push(`owner ${draft.owner} 不在 units 主檔`);
  for (const d of draft.diseases ?? []) if (env.diseaseIds && !env.diseaseIds.has(d)) errors.push(`diseases ${d} 不在傳染病主檔`);
  if (env.licenses && !env.licenses.includes(draft.license) && !draft.licenseNote) errors.push(`license ${draft.license} 非標準授權且未填 licenseNote`);
  if (draft.status !== 'review') errors.push(`草稿 status 必須是 review（實際 ${draft.status}）`);
  if (draft.aiWhitelist?.requested !== false) errors.push('草稿 aiWhitelist.requested 必須是 false');
  if (!draft.conversion || typeof draft.conversion.confidence !== 'number') errors.push('缺 conversion.confidence');
  // 資產宣告：檔案存在、sha256 相符、image 有 alt／license
  const names = new Set();
  for (const a of draft.assets ?? []) {
    if (names.has(a.file)) errors.push(`assets 檔名重複：${a.file}`);
    names.add(a.file);
    if (a.kind === 'image' && !String(a.alt ?? '').trim()) errors.push(`圖片 ${a.file} 缺 alt`);
    if (a.kind === 'image' && !a.license) errors.push(`圖片 ${a.file} 缺 license`);
    if ((a.kind === 'attachment' || a.kind === 'data') && !a.label) errors.push(`${a.kind} ${a.file} 缺 label`);
    if (env.assetsDir) {
      const p = path.join(env.assetsDir, draft.id, a.file);
      if (!fs.existsSync(p)) errors.push(`資產檔不存在：${path.relative(env.assetsDir, p)}`);
      else if (a.sha256 && sha256Of(fs.readFileSync(p)) !== a.sha256) errors.push(`資產 sha256 不符：${a.file}`);
    }
  }
  return errors;
}
