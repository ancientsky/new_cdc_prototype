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
import { FIELD_LABELS, labelOf } from '../../../src/client/admin/field-labels.js';

/** 閘道接受的型別 → content 子目錄（疫情態勢、移轉清單、主檔、治理設定不走閘道） */
export const TYPE_DIR = {
  faq: 'faq', disease: 'diseases', news: 'news', letter: 'news', document: 'documents', clarification: 'clarifications', vaccine: 'vaccines',
  dataset: 'datasets', banner: 'banners', page: 'pages', media: 'media', topic: 'topics', service: 'services', publication: 'publications',
  labtest: 'labtests', research: 'research', job: 'jobs', tender: 'tenders', article: 'articles',
};
const COLLECTION_OF = { ...TYPE_DIR, letter: 'news' };
/**
 * 第五十二輪：閘道唯一接受的主檔——疫情報導分類主檔（只能跟疫情報導文章一起送）。路徑寫死在這裡，不從送來的資料推，
 * 更不收前端送的路徑；其他主檔（單位、疾病、詞彙…）與治理設定仍不走閘道。
 */
export const CATEGORIES_PATH = 'content/master/bulletin-categories.json';
export const ID_RE = /^[a-z]+\.[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/; // 比 schema 再嚴一點：不允許連續的點（避免 ..）
export const MAX_ID = 120;

/** 給同事看的欄位名稱：第五十一輪移到 src/client/admin/field-labels.js（後台「目前改動的欄位」與審核人的差異用同一份名稱） */
export { FIELD_LABELS, labelOf };


/** AJV 英文訊息 → 白話中文 */
function plainAjv(msg, label) {
  let m;
  if ((m = /^must have required property '([^']+)'/.exec(msg))) return { field: m[1], message: `「${labelOf(m[1])}」必填，請補上` };
  if ((m = /^must NOT have fewer than (\d+) characters/.exec(msg))) return { message: Number(m[1]) <= 1 ? `「${label}」不能空白` : `「${label}」至少要 ${m[1]} 個字` };
  if ((m = /^must NOT have more than (\d+) characters/.exec(msg))) return { message: `「${label}」最多 ${m[1]} 個字，請縮短` };
  if ((m = /^must NOT have fewer than (\d+) items/.exec(msg))) return { message: `「${label}」至少要選 ${m[1]} 項` };
  if ((m = /^must NOT have more than (\d+) items/.exec(msg))) return { message: `「${label}」最多 ${m[1]} 項` };
  if (/^must be equal to one of the allowed values/.test(msg) || /^must be equal to constant/.test(msg)) return { message: `「${label}」的選項不在允許的清單內` };
  if ((m = /^must match format "([^"]+)"/.exec(msg))) return { message: `「${label}」格式不對${m[1] === 'date' ? '（日期請寫成 2026-10-10）' : m[1] === 'date-time' ? '（請用日期與時間）' : m[1] === 'uri' ? '（請填完整網址）' : ''}` };
  if (/^must match pattern/.test(msg)) return { message: `「${label}」格式不對${label === FIELD_LABELS.id ? '（只能用小寫英文、數字與連字號，例：faq.dengue-fever-when）' : ''}` };
  if ((m = /^must be (string|number|integer|boolean|array|object|null)/.exec(msg))) return { message: `「${label}」的資料型態不對（應為${{ string: '文字', number: '數字', integer: '整數', boolean: '是／否', array: '清單', object: '一組欄位', null: '空值' }[m[1]]}）` };
  if (/^must NOT have additional properties/.test(msg)) return { message: `「${label}」裡有系統不認得的欄位` };
  if (/^must be >= /.test(msg) || /^must be <= /.test(msg)) return { message: `「${label}」的數值超出允許範圍` };
  return { message: `「${label}」${msg}` };
}

/**
 * validateSite／validateAssets 的一行錯誤（已去掉「檔案:」前綴）→ { field, label, message }
 * AJV：「/summary must …」或「/ must have required property 'x'」；跨檔參照：「owner unit.x 不在 units 主檔」
 */
export function plainError(raw) {
  const s = String(raw).trim();
  const ajv = /^(\/[^\s]*|\/) (must .*)$/.exec(s);
  if (ajv) {
    const segs = ajv[1].split('/').filter(Boolean);
    const field = segs[0] ?? '';
    const label = field ? labelOf(field) + (segs.length > 1 ? `（${segs.slice(1).map((x) => (/^\d+$/.test(x) ? `第 ${Number(x) + 1} 項` : labelOf(x))).join('・')}）` : '') : '內容';
    const p = plainAjv(ajv[2], label);
    const f = p.field ?? field;
    return { field: f || null, label: f ? labelOf(f) : '內容', message: p.message };
  }
  const head = /^\[?([a-zA-Z]+)(?:[\s.[\]：:]|$)/.exec(s);
  const field = head && FIELD_LABELS[head[1]] ? head[1] : /^重複 id/.test(s) ? 'id' : null;
  const message = field ? s.replace(new RegExp(`^${field}\\b ?`), `「${labelOf(field)}」`).replace(/ 不在 units 主檔/, ' 不在單位主檔') : s;
  return { field, label: field ? labelOf(field) : '內容', message };
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
