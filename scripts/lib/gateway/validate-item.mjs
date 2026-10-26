// @ts-check
// 寫入前驗證（第三十輪）：閘道把同事送來的內容，用「建置時同一套」檢查跑一遍，不通過就不寫進 Git。
//
// 為什麼不另寫一套規則：後台、CI、建置若各有一套，遲早會出現「後台說可以、CI 說不行」。這裡直接呼叫建置用的
// validateSite()（JSON Schema＋跨檔參照＋治理門檻）與 validateAssets()，只是先把送來的那一筆放進站台資料、
// 再只挑出跟這一筆有關的錯誤，翻成同事看得懂的中文、標出是哪個欄位。
//
// 路徑也在這裡決定：檔名一律由「通過格式檢查的 id」推出來（content/<型別目錄>/<id 去掉前綴>.json），
// 不接受前端送來的路徑——這是防路徑穿越（../../）最可靠的做法：根本不讓外面決定路徑。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../../../site.config.mjs';
import { loadSite, ROOT } from '../load.mjs';
import { validateSite } from '../validate.mjs';
import { validateAssets, ASSETS_DIR } from '../assets.mjs';
import { FIELD_LABELS, labelOf, fieldLabel } from '../../../src/client/admin/field-labels.js';
import { ROW_FIELD_LABEL as MASTER_ROW_LABEL } from '../../../src/client/admin/vaxschedule-edit-core.js';

/** 閘道接受的型別 → content 子目錄（疫情態勢、移轉清單、主檔、治理設定不走閘道） */
export const TYPE_DIR = {
  faq: 'faq', disease: 'diseases', news: 'news', letter: 'news', document: 'documents', clarification: 'clarifications', vaccine: 'vaccines',
  dataset: 'datasets', banner: 'banners', page: 'pages', media: 'media', topic: 'topics', service: 'services', publication: 'publications',
  labtest: 'labtests', research: 'research', job: 'jobs', tender: 'tenders', article: 'articles',
  interactive: 'interactives', // 第六十二輪：互動模組（後台 /admin/interactives/ 的開關經閘道送審）
};
const COLLECTION_OF = { ...TYPE_DIR, letter: 'news' };
/**
 * 第五十二輪：閘道唯一接受的主檔——疫情報導分類主檔（只能跟疫情報導文章一起送）。路徑寫死在這裡，不從送來的資料推，
 * 更不收前端送的路徑；其他主檔（單位、疾病、詞彙…）與治理設定仍不走閘道。
 */
export const CATEGORIES_PATH = 'content/master/bulletin-categories.json';
/**
 * 第五十三輪（docs/deploy.md §25）：可以「單獨」經閘道送審的主檔。和分類主檔一樣：路徑寫死在這裡（只收名稱，不收路徑），
 * 以 key 欄位對應每一列、三方合併到網站上的主檔；一律一般車道（主檔變更需審核，與 CI 的 classifyFile 相同）。
 *   contentId：送審件的識別（master.<名稱>，符合 ID_RE）；owner：權責單位（誰能存、誰的審核人收到通知）；siteKey：站台資料裡的位置（validateSite 用）。
 * 其他主檔（單位、疾病、詞彙…）與治理設定仍不走閘道。
 */
export const MASTER_FILES = {
  'immunization-schedule': {
    path: 'content/master/immunization-schedule.json', contentId: 'master.immunization-schedule', title: '疫苗接種時程表（主檔）',
    owner: 'unit.acute-infectious', key: 'id', maxRows: 400, siteKey: 'immunizationSchedule', rowName: '筆',
  },
};
export const MASTER_TYPE = 'master';
/** contentId（master.<名稱>）→ [名稱, 設定]；不是可送審的主檔 ⇒ null */
export function masterOf(contentId) {
  const name = String(contentId ?? '').replace(/^master\./, '');
  const m = Object.hasOwn(MASTER_FILES, name) ? MASTER_FILES[name] : null;
  return m && m.contentId === contentId ? { name, ...m } : null;
}
export const ID_RE = /^[a-z]+\.[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/; // 比 schema 再嚴一點：不允許連續的點（避免 ..）
export const MAX_ID = 120;

/** 給同事看的欄位名稱：第五十一輪移到 src/client/admin/field-labels.js（後台「目前改動的欄位」與審核人的差異用同一份名稱） */
export { FIELD_LABELS, labelOf };


/** AJV 英文訊息 → 白話中文 */
function plainAjv(msg, label) {
  let m;
  if ((m = /^must have required property '([^']+)'/.exec(msg))) return { field: m[1], message: `「${fieldLabel(m[1])}」必填，請補上` };
  if ((m = /^must NOT have fewer than (\d+) characters/.exec(msg))) return { message: Number(m[1]) <= 1 ? `「${label}」不能空白` : `「${label}」至少要 ${m[1]} 個字` };
  if ((m = /^must NOT have more than (\d+) characters/.exec(msg))) return { message: `「${label}」最多 ${m[1]} 個字，請縮短` };
  if ((m = /^must NOT have fewer than (\d+) items/.exec(msg))) return { message: `「${label}」至少要選 ${m[1]} 項` };
  if ((m = /^must NOT have more than (\d+) items/.exec(msg))) return { message: `「${label}」最多 ${m[1]} 項` };
  if (/^must be equal to one of the allowed values/.test(msg) || /^must be equal to constant/.test(msg)) return { message: `「${label}」的選項不在允許的清單內` };
  if ((m = /^must match format "([^"]+)"/.exec(msg))) return { message: `「${label}」格式不對${m[1] === 'date' ? '（日期請寫成 2026-10-10）' : m[1] === 'date-time' ? '（請用日期與時間）' : m[1] === 'uri' ? '（請填完整網址）' : ''}` };
  if (/^must match pattern/.test(msg)) return { message: `「${label}」格式不對${label === FIELD_LABELS.id ? '（只能用小寫英文、數字與連字號，例：faq.dengue-fever-when）' : ''}` };
  if ((m = /^must be (string|number|integer|boolean|array|object|null)/.exec(msg))) return { message: `「${label}」的資料型態不對（應為${{ string: '文字', number: '數字', integer: '整數', boolean: '是／否', array: '清單', object: '一組欄位', null: '空值' }[m[1]]}）` };
  if (/^must NOT have additional properties/.test(msg)) return { message: `「${label}」裡有系統不認得的欄位` };
  if (/^must NOT be valid/.test(msg)) return { message: `「${label}」有不允許的內容` };
  if (/^must be >= /.test(msg) || /^must be <= /.test(msg)) return { message: `「${label}」的數值超出允許範圍` };
  return { message: `「${label}」${msg}` };
}

/** 欄位裡面的子欄位名稱（職缺的甄選結果、異動紀錄，採購的決標資訊等；只用在錯誤訊息，不改變錯誤歸屬的欄位） */
const NESTED_LABEL = {
  admitted: '正取名單', waitlist: '備取名單', seq: '序號', candidateNo: '報名編號', rank: '備取順位', validUntil: '有效期限', unpublishAt: '下架日', publishedAt: '公告日',
  date: '日期', kind: '類別', text: '說明', refNo: '公告字號', winner: '得標廠商', amountNtd: '金額', label: '名稱', url: '網址', stage: '階段', note: '備註',
};

/**
 * 第五十三輪：主檔裡編號（key）重複的列 → 錯誤（「第 5 筆（…）的編號 x 與第 2 筆（…）重複」）。
 * 寫入閘道在合併「之前」就要檢查同事送來的版本：合併以編號對應，重複的列會被合併吃掉，同事卻不知道。
 */
export function duplicateRows(m, rows) {
  const rowLabel = (i) => `第 ${i + 1} ${m.rowName}${rows[i]?.label ? `（${String(rows[i].label).slice(0, 30)}）` : ''}`;
  const seen = new Map();
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((r, i) => {
    const k = String(r?.[m.key] ?? '');
    if (seen.has(k)) out.push({ field: 'master', label: m.title, message: `${rowLabel(i)}的編號 ${k || '（空白）'} 與${rowLabel(seen.get(k))}重複` });
    else seen.set(k, i);
  });
  return out;
}

/** 第五十三輪：職缺與採購的跨欄位檢查（scripts/lib/validate.mjs 2a）訊息開頭的欄位代碼 ⇒ 歸到那個欄位（同事點錯誤訊息就跳到表單上的欄位） */
const CAREER_FIELDS = new Set(['slug', 'hiringUnit', 'requestingUnit', 'legacyIds', 'applyStart', 'examPlan', 'manualStatus', 'announcedAt', 'openingAt', 'award']);

/**
 * validateSite／validateAssets 的一行錯誤（已去掉「檔案:」前綴）→ { field, label, message }
 * AJV：「/summary must …」或「/ must have required property 'x'」；跨檔參照：「owner unit.x 不在 units 主檔」
 */
export function plainError(raw) {
  const s0 = String(raw).trim();
  // AJV 的 propertyNames 錯誤：「/result/admitted/0 property name must be valid」⇒ 當成「有不允許的欄位名稱」
  const s = s0.replace(/^(\/\S*) property name must be valid$/, '$1 must NOT have additional properties');
  const ajv = /^(\/[^\s]*|\/) (must .*)$/.exec(s);
  if (ajv) {
    const segs = ajv[1].split('/').filter(Boolean);
    const field = segs[0] ?? '';
    const sub = (x) => (/^\d+$/.test(x) ? `第 ${Number(x) + 1} 項` : (NESTED_LABEL[x] ?? labelOf(x)));
    // 第五十三輪：欄位名稱用顯示用的那一份（職缺、採購的欄位不在 FIELD_LABELS，以前會顯示「result」這種代碼）
    const label = field ? fieldLabel(field) + (segs.length > 1 ? `（${segs.slice(1).map(sub).join('・')}）` : '') : '內容';
    // 欄位裡面少了子欄位（例：甄選結果的下架日、正取名單第 1 項的報名編號）⇒ 仍歸在外層欄位，訊息說是哪一個子欄位
    const req = field && /^must have required property '([^']+)'/.exec(ajv[2]);
    if (req) return { field, label: fieldLabel(field), message: `「${label}」少了「${sub(req[1])}」，請補上` };
    const p = plainAjv(ajv[2], label);
    const f = p.field ?? field;
    return { field: f || null, label: f ? fieldLabel(f) : '內容', message: p.message };
  }
  // 第五十三輪：職缺的個資閘門與甄選結果規則（careers-rules.js）開頭是中文，歸到「甄選結果」欄位，同事點錯誤訊息才跳得到
  if (/^(個資閘門|甄選結果)/.test(s)) return { field: /waitlistUpdates\[/.test(s) && !/result\./.test(s) ? 'waitlistUpdates' : 'result', label: /waitlistUpdates\[/.test(s) && !/result\./.test(s) ? '遞補公告' : '甄選結果', message: s };
  const head = /^\[?([a-zA-Z]+)(?:[\s.[\]：:「]|$)/.exec(s);
  const field = head && (FIELD_LABELS[head[1]] || CAREER_FIELDS.has(head[1])) ? head[1] : /^重複 id/.test(s) ? 'id' : null;
  const message = field
    ? s.replace(new RegExp(`^${field}(?:\\.(\\w+))?\\b ?`), (_, sub) => `「${fieldLabel(field)}${sub ? `的${NESTED_LABEL[sub] ?? sub}` : ''}」`).replace(/ 不在 units 主檔/, ' 不在單位主檔').replace(/ (deadlineAt|openingAt|announcedAt|applyStart) /g, (_, k) => ` ${fieldLabel(k)} `)
    : s;
  return { field, label: field ? fieldLabel(field) : '內容', message };
}

/** 分類主檔的一行錯誤 → { field: 'categories', … }（「第 N 個分類（名稱）的英文名稱…」；不出現 JSON 路徑） */
const CAT_FIELD = { key: '代號', label: '中文名稱', labelEn: '英文名稱', order: '順序', description: '說明', retiredAt: '停用日' };
function categoryError(raw, rows) {
  const s = String(raw).replace(/^\[疫情報導分類\] /, '');
  const m = /^\/(\d+)(?:\/(\w+))? (must .*)$/.exec(s);
  let message = s;
  if (m) {
    const row = rows?.[Number(m[1])];
    const label = `第 ${Number(m[1]) + 1} 個分類${row?.label ? `「${String(row.label).slice(0, 30)}」` : ''}${m[2] ? `的${CAT_FIELD[m[2]] ?? m[2]}` : ''}`;
    message = plainAjv(m[3], label).message;
    if (/additional properties/.test(m[3])) message = `${label}有系統不認得的欄位`;
  } else if (/^\/? ?must /.test(s)) message = '分類主檔的格式不對';
  return { field: 'categories', label: '分類管理', message: `分類主檔：${message}` };
}

/**
 * 由內容決定檔案路徑；任何不合格都回 { ok:false }。路徑只由 type 與 id 推出，並再確認落在 content/ 之內。
 * @returns {{ ok: true, path: string, dir: string } | { ok: false, errors: {field:string,label:string,message:string}[] }}
 */
export function contentPathOf(item) {
  const errs = [];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, errors: [{ field: null, label: '內容', message: '送來的不是一筆內容' }] };
  const dir = TYPE_DIR[item.type];
  if (!dir) errs.push({ field: 'type', label: labelOf('type'), message: `這個型別不能從後台送審（${String(item.type ?? '未填').slice(0, 30)}）` });
  const id = String(item.id ?? '');
  if (!ID_RE.test(id) || id.length > MAX_ID) errs.push({ field: 'id', label: labelOf('id'), message: '「內容 ID」格式不對（只能用小寫英文、數字與連字號，例：faq.dengue-fever-when）' });
  if (errs.length) return { ok: false, errors: errs };
  const slug = id.replace(/^[a-z]+\./, '');
  const rel = path.posix.join('content', dir, `${slug}.json`);
  // 雙重保險：正規化後仍必須是 content/<dir>/<一層檔名>.json
  if (rel !== `content/${dir}/${slug}.json` || rel.includes('..') || !/^content\/[a-z]+\/[a-z0-9][a-z0-9.-]*\.json$/.test(rel)) return { ok: false, errors: [{ field: 'id', label: labelOf('id'), message: '「內容 ID」不能用來組成檔案路徑' }] };
  return { ok: true, path: rel, dir };
}

/** 只允許 content/** 的路徑（給所有寫入點再擋一次） */
export function assertContentPath(p) {
  const n = path.posix.normalize(String(p));
  if (n !== p || !n.startsWith('content/') || n.includes('..') || n.includes('\\') || n.includes('\0')) throw Object.assign(new Error('path outside content/'), { code: 'path' });
  return n;
}

/**
 * 建一個驗證器（站台資料快取一次，約 0.1 秒；每次驗證約 0.5 秒）。
 * @param {{ loadBase?: () => any }} [opts]
 */
export function createValidator({ loadBase = () => loadSite(config) } = {}) {
  let base = null;
  const site = () => (base ??= loadBase());
  return {
    reload() { base = null; },
    /**
     * 第五十三輪：單獨送審的主檔（MASTER_FILES）。把整份換進站台資料，用建置同一套 validateSite 檢查，只回報這個主檔的錯誤，
     * 翻成「第 3 筆「MMR 疫苗 第 1 劑」的建議區間上限…」（不出現 JSON 路徑）；另外檢查每一列的 key 不重複（建置不查，但合併靠它）。
     * @param {string} name @param {any[]} rows
     * @returns {{ ok: boolean, path?: string, errors: {field:string|null,label:string,message:string}[] }}
     */
    validateMaster(name, rows) {
      const m = Object.hasOwn(MASTER_FILES, name) ? MASTER_FILES[name] : null;
      if (!m) return { ok: false, errors: [{ field: null, label: '主檔', message: '這個主檔不能從後台送審' }] };
      if (!Array.isArray(rows)) return { ok: false, path: m.path, errors: [{ field: 'master', label: m.title, message: `${m.title}的格式不對` }] };
      const s = site();
      const view = { ...s, master: { ...s.master, [m.siteKey]: structuredClone(rows) } };
      const prefix = `${m.path}: `;
      const rowLabel = (i) => `第 ${i + 1} ${m.rowName}${rows[i]?.label ? `（${String(rows[i].label).slice(0, 30)}）` : ''}`;
      const byKey = new Map(rows.map((r, i) => [String(r?.[m.key]), i]));
      const errors = [];
      for (const e of validateSite(view).filter((x) => x.startsWith(prefix)).map((x) => x.slice(prefix.length))) {
        const a = /^\/(\d+)(?:\/([\w/]+))? (must .*)$/.exec(e);
        let message = e;
        if (a) {
          const f = a[2]?.split('/')[0];
          const lab = `${rowLabel(Number(a[1]))}${f ? `的${MASTER_ROW_LABEL[f] ?? f}` : ''}`;
          message = /additional properties/.test(a[3]) ? `${lab}有系統不認得的欄位` : plainAjv(a[3], lab).message;
        } else if (/^\/? ?must /.test(e)) message = `${m.title}的格式不對`;
        else {
          const k = /^([^：]+)：(.*)$/.exec(e);
          if (k && byKey.has(k[1])) message = `${rowLabel(byKey.get(k[1]))}［${k[1]}］：${k[2].replace(/^vaccine /, '疫苗 ').replace(/\b(ageMaxMonths|ageMinMonths|hardLimitMonths)\b/g, (x) => MASTER_ROW_LABEL[x] ?? x)}`;
        }
        errors.push({ field: 'master', label: m.title, message });
      }
      errors.push(...duplicateRows(m, rows));
      const uniq = [...new Map(errors.map((x) => [x.message, x])).values()];
      return { ok: uniq.length === 0, path: m.path, errors: uniq };
    },
    /**
     * @param {any} item
     * @param {{ extra?: any[], files?: Record<string, Buffer>|null, categories?: any[]|null }} [opts]
     *   categories（第五十二輪）：跟疫情報導文章一起送的分類主檔（整份，已合併好）；錯誤以 field 'categories' 回報
     * @returns {{ ok: boolean, path?: string, errors: {field:string|null,label:string,message:string}[] }}
     */
    validate(item, { extra = [], files = null, categories = null } = {}) {
      const where = contentPathOf(item);
      if (where.ok === false) return { ok: false, errors: where.errors };
      const s = site();
      for (const x of extra) { const w = contentPathOf(x); if (w.ok === false) return { ok: false, path: where.path, errors: w.errors.map((e) => ({ ...e, message: `同時送出的「${x?.title ?? x?.id ?? ''}」：${e.message}` })) }; }
      const existing = s.byId.get(item.id);
      if (existing && existing.type !== item.type && !(TYPE_DIR[existing.type] === TYPE_DIR[item.type])) {
        return { ok: false, path: where.path, errors: [{ field: 'id', label: labelOf('id'), message: '這個「內容 ID」已經被另一種內容使用，請換一個' }] };
      }
      // 把這一筆放進站台資料（同 id 取代），其餘內容原封不動
      const copy = { ...structuredClone(item), __file: where.path };
      for (const k of Object.keys(copy)) if (k.startsWith('__') && k !== '__file') delete copy[k];
      // 第四十五輪：同時送出的配套內容（例如疫情報導文章的新卷期）也放進站台資料，文章的「所屬卷期存在」才查得到
      const adds = [copy, ...extra.map((x) => { const w = contentPathOf(x); const c = { ...structuredClone(x), __file: w.ok === false ? '' : w.path }; for (const k of Object.keys(c)) if (k.startsWith('__') && k !== '__file') delete c[k]; return c; })];
      const ids = new Set(adds.map((x) => x.id));
      const collections = { ...s.collections };
      for (const a of adds) { const c = COLLECTION_OF[a.type]; collections[c] = [...(collections[c] ?? []).filter((x) => !ids.has(x.id) && x !== a), a]; }
      const all = [...s.all.filter((x) => !ids.has(x.id)), ...adds];
      const byId = new Map(s.byId); for (const a of adds) byId.set(a.id, a);
      // 第五十二輪：疫情報導分類主檔跟文章一起送時，換成送來的那一份（文章的「分類存在」也依它檢查），並一起檢查主檔本身
      const master = categories ? { ...s.master, bulletinCategories: structuredClone(categories) } : s.master;
      const view = { ...s, collections, all, byId, master };
      const prefix = `${where.path}: `;
      const catPrefix = `${CATEGORIES_PATH}: `;
      const mine = (e) => e.startsWith(prefix) || e === `重複 id：${item.id}`;
      // 附件：送來的檔案（與這筆已在站上的檔案）放進暫存目錄，用建置同一套 validateAssets 查 bytes／sha256／mime／內容；查完就刪
      const assetErrors = (() => {
        if (!files) return validateAssets(view, config).errors;
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-assets-'));
        try {
          const dir = path.join(tmp, item.id);
          fs.mkdirSync(dir, { recursive: true });
          const existing = path.join(ASSETS_DIR, item.id);
          if (fs.existsSync(existing)) for (const f of fs.readdirSync(existing)) { const src = path.join(existing, f); if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(dir, f)); }
          for (const [name, buf] of Object.entries(files)) { if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name) || /\.\./.test(name)) continue; fs.writeFileSync(path.join(dir, name), buf); }
          // 錯誤訊息裡的暫存路徑換回正式庫的路徑，同事看到的才是「content/assets/…」
          const rel = path.relative(ROOT, tmp).split(path.sep).join('/');
          return validateAssets(view, config, { assetsDir: tmp }).errors.map((e) => String(e).split(rel).join('content/assets'));
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      })();
      const siteErrors = validateSite(view);
      const raw = [...siteErrors.filter(mine), ...assetErrors.filter(mine)].map((e) => e.startsWith(prefix) ? e.slice(prefix.length) : e);
      const seen = new Set();
      const catErrors = categories ? siteErrors.filter((e) => e.startsWith(catPrefix)).map((e) => categoryError(e.slice(catPrefix.length), categories)) : [];
      const errors = [...raw.map(plainError), ...catErrors].filter((e) => { const k = `${e.field}|${e.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
      return { ok: errors.length === 0, path: where.path, errors };
    },
  };
}
