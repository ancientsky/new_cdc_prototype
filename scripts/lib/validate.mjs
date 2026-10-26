// @ts-check
// JSON Schema 驗證 + 跨檔參照檢查。任何一項失敗 → build 失敗（治理門檻）。
// 檔案資產（assets[]、/files/ 引用、content/assets/ 實體檔）的檢查在 scripts/lib/assets.mjs 的 validateAssets()，
// build.mjs 在本檢查後呼叫並把錯誤併入同一份失敗清單（ARCHITECTURE 16.1）。
import { articleProblems, categoryProblems } from '../../src/client/bulletin-rules.js';
import fs from 'node:fs';
import path from 'node:path';
import { hasRelativeDate } from './dates.mjs';
// ajv／ajv-formats 的 CJS 預設匯出在 NodeNext 下型別會變成 module 物件，這裡以 JSDoc 指回真正的建構函式／函式
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
/** @type {typeof import('ajv/dist/2020.js').default} */
// @ts-ignore CJS interop
const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
/** @type {typeof import('ajv-formats').default} */
// @ts-ignore CJS interop
const addFormats = addFormatsModule.default ?? addFormatsModule;
import { ROOT } from './load.mjs';
import { jobPiiErrors, jobResultProblems } from '../../src/client/careers-rules.js';
import { themeProblems, overlappingThemes } from './theme.mjs';
import { interactiveProblems } from './interactives.mjs';

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
  media: 'media.json', topic: 'topic.json', service: 'service.json', publication: 'publication.json', labtest: 'labtest.json', research: 'research.json', article: 'article.json',
  migration: 'migration.json', job: 'job.json', tender: 'tender.json', theme: 'theme.json', interactive: 'interactive.json',
};

// ───────────────────────── 第二十五輪：相對日期檢查（Issue #37；規則與理由見 dates.mjs 的 RELATIVE_DATE_RE） ─────────────────────────
export { RELATIVE_DATE_RE, ABSOLUTE_DATE_RE } from './dates.mjs';
/** 相對日期規則只管這三種型別（新聞稿、函釋通函、澄清）；澄清屬第一級，直接擋 */
export const RELATIVE_DATE_TYPES = new Set(['news', 'letter', 'clarification']);
const splitSentences = (s) => String(s ?? '').split(/(?<=[。！？!?；;\n])/).map((x) => x.trim()).filter(Boolean);
const firstParagraph = (md) => String(md ?? '').split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^#{1,6}\s/.test(p)) ?? '';

/** → [{ field, sentence }]：相對日期但同一句沒有絕對日期的句子（標題、摘要、首段） */
export function relativeDateFindings(item) {
  if (!RELATIVE_DATE_TYPES.has(item?.type)) return [];
  const out = [];
  const fields = [['title', item.title], ['summary', item.summary], ['首段', firstParagraph(item.type === 'clarification' ? item.clarificationMarkdown : item.bodyMarkdown)]];
  for (const [field, text] of fields) {
    for (const sentence of splitSentences(text)) {
      if (hasRelativeDate(sentence)) out.push({ field, sentence });
    }
  }
  return out;
}
const relativeDateMsg = (f) => `${f.field}含相對日期卻沒有同句的絕對日期：「${f.sentence.slice(0, 50)}」（請改寫成「2026 年 7 月 21 日（今日）」；見 docs/guide-staff.md 第 26 節）`;

/** 內容警告（不擋建置）：news／letter 的相對日期。clarification 屬第一級，已在 validateSite 當 error */
export function contentWarnings(site) {
  const out = [];
  for (const item of site.all) {
    if (item.type === 'clarification') continue;
    for (const f of relativeDateFindings(item)) out.push(`${item.__file}: ${relativeDateMsg(f)}`);
  }
  return out;
}

/**
 * 第四十八輪（issue #93）：待確認內容（verification.status: pending）卻在建立當天就「審閱」又「核准進 AI 白名單」
 *（aiWhitelist.approvedAt ＝ reviewedAt ＝ publishedAt）：多半是建檔時三個日期一起填，並沒有人真的審過。
 * 只警告不擋建置（現有內容不因此建置失敗）；承辦人確認後把 verification 改成 confirmed，或把 reviewedAt 改成真正審閱的日期。
 * 另列一個函式（不併入 contentWarnings）：contentWarnings 對現有內容必須是空的（round25 測試），這條規則現有內容就會命中。
 */
export const PENDING_REVIEW_MSG = 'reviewedAt 等於建立日，待確認內容不應標示為已審閱';
export function pendingReviewWarnings(site) {
  const out = [];
  for (const item of site.all) {
    const at = item.aiWhitelist?.approvedAt;
    if (item.status === 'published' && item.verification?.status === 'pending' && at && at === item.reviewedAt && at === item.publishedAt) out.push(`${item.__file}: ${PENDING_REVIEW_MSG}（publishedAt／reviewedAt／aiWhitelist.approvedAt 都是 ${at}）`);
  }
  return out;
}

// ───────────────────────── 第六十七輪：內容屬單位不屬個人 ─────────────────────────

/**
 * postPublishReview.reviewedBy 只能寫單位或職稱，不能寫人名（規則 30）。
 * 做法：把字串裡的單位 id、單位名稱、職稱詞拿掉，剩下的只能是空白與標點；剩下中文或英文字母（多半是姓名或帳號）⇒ 錯誤。
 * 例：「公關室承辦人」「unit.pr」「公關室 內容總編輯」可以；「王小明」「公關室王小明」「wang.an」不行。
 */
export const REVIEWER_TITLE_WORDS = ['內容總編輯', '總編輯', '治理幕僚', '平台管理', '副組長', '組長', '副主任', '主任', '副處長', '處長', '科長', '審核人', '複核人', '承辦人', '承辦', '值班人員', '值班', '專員', '技正', '科員'];
/** @param {unknown} value @param {{ id: string, name?: string, stewardTitle?: string }[]} units @returns {string|null} */
export function reviewedByProblem(value, units = []) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return 'postPublishReview.reviewedBy 不可為空字串（不填就刪掉這個欄位）';
  const words = [...units.map((u) => u.id), ...units.map((u) => u.name), ...units.map((u) => u.stewardTitle), ...REVIEWER_TITLE_WORDS].filter((w) => typeof w === 'string' && w).sort((a, b) => b.length - a.length);
  let rest = v;
  for (const w of words) rest = rest.split(w).join(' ');
  if (/[\p{L}\p{N}]/u.test(rest)) return `postPublishReview.reviewedBy「${v}」看起來不是單位或職稱：只能寫單位（例：unit.pr、公關室）加職稱（例：承辦人、科長、內容總編輯），不寫人名或帳號；誰複核記在機關 GitLab 的提交訊息與閘道稽核紀錄（governance-model 規則 30）`;
  return null;
}

/** 單位已裁撤（retiredAt 已到）⇒ 該單位不能再當 owner（規則 31） */
export function retiredUnitOf(unitId, unitById, today) {
  const u = unitById.get(unitId);
  return u?.retiredAt && (!today || u.retiredAt <= today) ? u : null;
}
export const retiredOwnerMsg = (field, u) => `${field} ${u.id}（${u.name}）已於 ${u.retiredAt} 裁撤${u.successor ? `，業務由 ${u.successor} 承接` : ''}：請執行 npm run reassign-owner -- --from ${u.id} --to ${u.successor ?? '<新單位>'}（改組不能只做一半，見 governance-model 規則 31）`;

export function validateSite(site) {
  const ajv = loadSchemas();
  const errors = [];
  const push = (file, msg) => errors.push(`${file}: ${msg}`);
  for (const item of site.all) if (item.type === 'clarification') for (const f of relativeDateFindings(item)) push(item.__file, relativeDateMsg(f));

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
  vMaster('bulletinCategory', site.master.bulletinCategories ?? [], 'content/master/bulletin-categories.json');
  for (const m of categoryProblems(site.master.bulletinCategories ?? [])) push('content/master/bulletin-categories.json', `[疫情報導分類] ${m}`);
  vMaster('scheduleItem', site.master.immunizationSchedule ?? [], 'content/master/immunization-schedule.json');
  for (const [def, obj, file] of [
    ['aiStatus', site.governance.aiStatus, 'content/governance/ai-status.json'],
    ['whitelistPolicy', site.governance.whitelist, 'content/governance/whitelist.json'],
    ['evalSet', site.governance.evalSet, 'content/governance/eval-set.json'],
    ['consistency', site.governance.consistency ?? { version: 1, decisions: [] }, 'content/governance/consistency.json'],
  ]) {
    const v = ajv.compile({ $ref: `https://cdc-prototype/schemas/governance.json#/$defs/${def}` });
    if (!v(obj)) for (const e of v.errors) push(file, `${e.instancePath} ${e.message}`);
  }

  // 2. 跨檔參照
  const ids = new Set(site.all.map((i) => i.id));
  // 第三十三輪：說法一致性判定要指到存在的內容；confirmed 必須指定 prefer 且是兩者之一
  for (const [i, d] of (site.governance.consistency?.decisions ?? []).entries()) {
    const f = 'content/governance/consistency.json';
    for (const k of ['a', 'b']) if (!ids.has(d[k])) push(f, `/decisions/${i}/${k} 指到不存在的內容：${d[k]}`);
    if (d.decision === 'confirmed' && ![d.a, d.b].includes(d.prefer)) push(f, `/decisions/${i} decision 為 confirmed 時 prefer 必須是 a 或 b`);
  }
  const dup = site.all.map((i) => i.id).filter((id, i, a) => a.indexOf(id) !== i);
  for (const d of new Set(dup)) errors.push(`重複 id：${d}`);
  const units = new Set(site.master.units.map((u) => u.id));
  const unitById = new Map((site.master.units ?? []).map((u) => [u.id, u]));
  const diseaseIds = new Set(site.master.diseases.map((d) => d.id));
  // 第六十七輪：單位裁撤（retiredAt）要寫承接單位（successor），承接單位要存在、不能也已裁撤；主檔裡指到裁撤單位的 owner 也要改
  for (const u of site.master.units ?? []) {
    if (u.successor && !u.retiredAt) push('content/master/units.json', `${u.id}：有 successor 就要有 retiredAt（裁撤日）`);
    if (!u.retiredAt) continue;
    if (!u.successor) push('content/master/units.json', `${u.id}：retiredAt 已填，請一併填 successor（業務由哪個單位承接）`);
    else if (!units.has(u.successor) || u.successor === u.id) push('content/master/units.json', `${u.id}：successor ${u.successor} 不在 units 主檔`);
    else if (unitById.get(u.successor)?.retiredAt) push('content/master/units.json', `${u.id}：successor ${u.successor} 也已裁撤，請直接指向現存單位`);
  }
  for (const d of site.master.diseases ?? []) { const ru = d.owner && retiredUnitOf(d.owner, unitById, site.today); if (ru) push('content/master/diseases.json', `${d.id}：${retiredOwnerMsg('owner', ru)}`); }
  // 疫苗接種時程表：疫苗 id 必須在疫苗主檔；年齡上限不得小於下限（ARCHITECTURE 18.1）
  const vaccineIds = new Set((site.master.vaccines ?? []).map((v) => v.id));
  for (const s of site.master.immunizationSchedule ?? []) {
    if (!vaccineIds.has(s.vaccine)) push('content/master/immunization-schedule.json', `${s.id}：vaccine ${s.vaccine} 不在疫苗主檔`);
    if (s.ageMaxMonths != null && s.ageMaxMonths < s.ageMinMonths) push('content/master/immunization-schedule.json', `${s.id}：ageMaxMonths 小於 ageMinMonths`);
    // 第四十輪：可接種上限（不含當月）必須在建議區間之後；比下限還早等於「永遠不能打」，一定是填錯
    if (s.hardLimitMonths != null && s.hardLimitMonths <= s.ageMinMonths) push('content/master/immunization-schedule.json', `${s.id}：hardLimitMonths 必須大於 ageMinMonths`);
    if (s.hardLimitMonths != null && s.ageMaxMonths != null && s.hardLimitMonths < s.ageMaxMonths) push('content/master/immunization-schedule.json', `${s.id}：hardLimitMonths 不得小於 ageMaxMonths（建議區間不能超過可接種上限）`);
  }
  for (const item of site.all) {
    if (!units.has(item.owner)) push(item.__file, `owner ${item.owner} 不在 units 主檔`);
    else if (unitById.get(item.owner)?.publishes === false) push(item.__file, `owner ${item.owner}（${unitById.get(item.owner).name}）不上架內容，請改為實際承辦單位`);
    else if (retiredUnitOf(item.owner, unitById, site.today)) push(item.__file, retiredOwnerMsg('owner', retiredUnitOf(item.owner, unitById, site.today)));
    { const why = reviewedByProblem(item.postPublishReview?.reviewedBy, site.master.units); if (why) push(item.__file, why); }
    for (const ref of item.basedOn ?? []) if (!ids.has(ref) && !site.collections.documents.some((d) => d.family === ref)) push(item.__file, `basedOn ${ref} 不存在（可填內容 id 或文件 family）`);
    for (const ref of item.diseases ?? []) if (!diseaseIds.has(ref)) push(item.__file, `diseases ${ref} 不在傳染病主檔`);
    if (item.type === 'document' && item.supersedes && !ids.has(item.supersedes)) push(item.__file, `supersedes ${item.supersedes} 不存在`);
    if (!site.config.licenses.allowed.includes(item.license) && !item.licenseNote) push(item.__file, `license ${item.license} 非標準授權且未填 licenseNote`);
    if (item.type === 'disease' && !diseaseIds.has(item.id)) push(item.__file, `疾病頁 ${item.id} 不在傳染病主檔`);
    if (item.type === 'labtest' && !diseaseIds.has(item.disease)) push(item.__file, `labtest.disease ${item.disease} 不在傳染病主檔`);
    if (item.type === 'media' && !(item.basedOn?.length)) push(item.__file, `影音素材必須填 basedOn（依據正本），見規劃 7.7`);
    // 第二十九輪（ARCHITECTURE 34）：疫情報導文章——所屬卷期要存在且是 bulletin、同期篇次不重複、頁碼不重疊。規則與後台同一份（bulletin-rules.js）。
    if (item.type === 'article') {
      const siblings = (site.collections.articles ?? []).filter((x) => x !== item && x.issueId === item.issueId && x.status !== 'draft');
      const others = (site.collections.articles ?? []).filter((x) => x !== item);
      for (const pr of articleProblems(item, { issue: site.byId.get(item.issueId) ?? null, siblings, others, categories: site.master.bulletinCategories })) if (pr.level === 'error') push(item.__file, `[疫情報導] ${pr.msg}`);
    }
    for (const ref of item.contentIds ?? []) if (!ids.has(ref)) push(item.__file, `contentIds ${ref} 不存在`);
  }
  // 2a. 第七輪（ARCHITECTURE 15.1）：職缺與採購公告
  //     id／slug 一致、slug 唯一、用人／需求單位存在、日期先後、legacyIds 不得與現存 id 重複；
  //     個資閘門（甄選結果只公布報名編號；第三十輪起不公布任何姓名、必須有下架日）：違反即建置失敗。
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
      // 第三十輪（#55）：下架日必填與上下限、externalUrl 與名單擇一（today 用來判斷「已下架、名單已移除」）
      for (const msg of jobResultProblems(item, site.today)) push(item.__file, msg);
    } else {
      if (item.announcedAt && item.deadlineAt && item.announcedAt > item.deadlineAt) push(item.__file, `announcedAt ${item.announcedAt} 晚於 deadlineAt ${item.deadlineAt}`);
      if (item.openingAt && item.deadlineAt && item.openingAt < item.deadlineAt) push(item.__file, `openingAt ${item.openingAt} 早於投標截止 ${item.deadlineAt}`);
      if (item.award && item.manualStatus) push(item.__file, `已決標（award）的標案不得再標 manualStatus ${item.manualStatus}`);
      if (item.award?.date && item.openingAt && item.award.date < item.openingAt) push(item.__file, `award.date ${item.award.date} 早於開標日 ${item.openingAt}`);
    }
  }

  // 2a'. 第六十輪（Issue #127）：節慶主題——只准覆寫白名單內的裝飾 token、背景色對文字對比 ≥ 4.5:1、裝飾 SVG ≤ 50 KB 且不含腳本／動畫、
  //      已發布主題的生效區間不得重疊（同一時間只能有一個主題；重疊時不知道該套哪個，與其猜不如擋下）。規則在 scripts/lib/theme.mjs。
  const themes = site.collections.themes ?? [];
  for (const th of themes) for (const msg of themeProblems(th)) push(th.__file, `[節慶主題] ${msg}`);
  for (const [a, b] of overlappingThemes(themes)) push(b.__file, `[節慶主題] 生效區間與 ${a.id}（${a.publishAt}～${a.unpublishAt}）重疊：同一時間只能有一個主題，請調整 publishAt／unpublishAt`);
  // 2a''. 第六十二輪：互動模組——放置位置白名單、檔期先後、測驗題答案序號與 basedOn 參照、模擬量表 key；規則在 scripts/lib/interactives.mjs
  for (const it of site.collections.interactives ?? []) for (const msg of interactiveProblems(it, site)) push(it.__file, `[互動模組] ${msg}`);

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
    else if (retiredUnitOf(list.owner, unitById, site.today)) push(file, retiredOwnerMsg('owner', retiredUnitOf(list.owner, unitById, site.today)));
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
      else if (it.owner && retiredUnitOf(it.owner, unitById, site.today)) push(file, `${at} ${retiredOwnerMsg('owner', retiredUnitOf(it.owner, unitById, site.today))}`);
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

export {
  MASK_CHARS_RE, MASKED_NAME_RE, NATIONAL_ID_RE, CANDIDATE_NO_ID_RE, NAME_FIELD_RE, nameFieldProblems, candidateNoProblems, jobPiiErrors, jobResultProblems, defaultUnpublishAt,
} from '../../src/client/careers-rules.js';

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
