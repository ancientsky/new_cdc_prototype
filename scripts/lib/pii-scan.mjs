// 第三十輪（#55）：全庫個資掃描。內容、公開資料快照、會被複製到 dist 的內容附件，一律不得出現個人資料。
//
// 為什麼要有這一道：Git 是公開、永久的——一旦推上去，就算下一個 commit 刪掉，歷史裡還是查得到（只能靠改寫歷史＋請 GitHub 清快取補救）。
// 所以「個資不進 Git」不能只靠編輯小心，要在 PR 合併前（content-pr.yml）與建置時（build.mjs --check）各擋一次。
//
// 偵測項目（都是「看起來像個人資料」的樣式，寧可少報不要誤報，誤報太多大家就會習慣性加白名單）：
//   - national-id：身分證統一編號（A123456789）。只有通過檢查碼才算——隨手打的 10 碼（研究核准文號 N202502011 等）不會誤報。
//   - arc：居留證統一證號。舊式「第二碼英文 A–D」與 2021 起新式「第二碼 8／9」，同樣要過檢查碼。
//   - mobile：手機號碼 09xx-xxx-xxx 各種寫法（空白、連字號、點、+886、(886)）。市話、0800 不算（機關電話本來就該公開）。
//   - email：電子郵件，網域不在白名單（gov.tw、本站網域、保留給範例的網域）就算「個人信箱」。
//   - person-name：「錄取／正取／備取／申請人／報名人／應考人／姓名」後面緊接著像中文全名的字（常見姓氏＋1–2 字）。
//     遮罩過的姓名（王○明）一樣算——第三十輪起連遮罩姓名都不公布。
//     這是啟發式：要有上述語境、姓氏在常見姓氏表、後面要斷開，再排除常見詞（名單、人員…），所以只會抓到「正取：王小明」這種寫法。
//
// 不做的事（寫進 docs/deploy.md 13 節）：PNG／JPG 等圖片不做 OCR；PDF 只以 latin1 讀出未壓縮的文字（只套 ASCII 類偵測：身分證、居留證、手機、email），
// 壓縮過的 PDF 內文查不到——PDF 本身另有無障礙版本（.md）會被掃到。
//
// 白名單：content/governance/pii-allowlist.json，每一筆都要寫 reason（寫不出理由就不該放行）。
// 輸出：檔案、JSON 路徑（$.a.b[0]）或行號、類別、遮罩過的片段——絕不印出完整號碼或姓名（CI log 也是公開的）。
import fs from 'node:fs';
import path from 'node:path';

export const SCAN_ROOTS = ['content', 'data/snapshots'];
export const ALLOWLIST_PATH = 'content/governance/pii-allowlist.json';
const TEXT_EXT = new Set(['.json', '.md', '.csv', '.txt', '.svg', '.html', '.xml', '.yml', '.yaml', '.tsv', '.geojson']);
const LATIN1_EXT = new Set(['.pdf']);
// 圖片、字型、影音：不掃（不做 OCR）
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.woff', '.woff2', '.ttf', '.mp4', '.webm', '.mp3', '.zip']);

export const KIND_LABEL = { 'national-id': '身分證字號', arc: '居留證號', mobile: '手機號碼', email: '個人電子郵件', 'person-name': '疑似中文姓名' };

/* ───────── 檢查碼 ───────── */
// 字母對照（內政部）：A=10 B=11 C=12 D=13 E=14 F=15 G=16 H=17 I=34 J=18 K=19 L=20 M=21 N=22 O=35 P=23 Q=24 R=25 S=26 T=27 U=28 V=29 W=32 X=30 Y=31 Z=33
const LETTER = { A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18, K: 19, L: 20, M: 21, N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33 };
const W = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1];
function checksumOk(first, rest9) {
  const c = LETTER[first]; if (!c) return false;
  const d = [Math.floor(c / 10), c % 10, ...rest9];
  return d.reduce((s, x, i) => s + x * W[i], 0) % 10 === 0;
}
/** 身分證（第二碼 1／2）與新式居留證（第二碼 8／9）：同一套檢查碼 */
export function validTwId(s) {
  const m = /^([A-Z])([1289])(\d{8})$/.exec(s); if (!m) return false;
  return checksumOk(m[1], [Number(m[2]), ...m[3].split('').map(Number)]);
}
/** 舊式居留證：第二碼英文 A–D，以該字母代碼的個位數代入 */
export function validOldArc(s) {
  const m = /^([A-Z])([A-D])(\d{8})$/.exec(s); if (!m) return false;
  return checksumOk(m[1], [LETTER[m[2]] % 10, ...m[3].split('').map(Number)]);
}

/* ───────── 遮罩 ───────── */
/** 號碼類：保留前 2、後 2 碼，中間一律以 * 取代（長度不變，方便對照是哪一筆） */
export function maskValue(s) {
  const t = String(s);
  if (t.length <= 4) return '*'.repeat(t.length);
  return t.slice(0, 2) + t.slice(2, -2).replace(/[^\s\-.()]/g, '*') + t.slice(-2);
}
const maskEmail = (s) => { const [u, d] = s.split('@'); return `${u.slice(0, 1)}***@${d}`; };
const maskName = (s) => s.slice(0, 1) + '＊'.repeat(s.length - 1);
const maskOf = (kind, v) => (kind === 'email' ? maskEmail(v) : kind === 'person-name' ? maskName(v) : maskValue(v));

/* ───────── 偵測 ───────── */
const ID_RE = /(?<![A-Za-z0-9])[A-Z][1289A-D]\d{8}(?![A-Za-z0-9])/g;
const MOBILE_RE = /(?<![\d.\w])(?:(?:\+|\(\+?)?886\)?[\s-]?|0)9\d{2}[\s.-]?\d{3}[\s.-]?\d{3}(?![\d.]\d|\d)/g;
const EMAIL_RE = /(?<![\w.%+-])[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g;
const FILE_TLD = /\.(png|jpe?g|gif|svg|webp|avif|js|mjs|css|pdf|json|html?)$/i;
// 常見姓氏（臺灣前 100 大＋複姓）；只有這些開頭才算「像姓名」
const SURNAMES = '陳林黃張李王吳劉蔡楊許鄭謝洪郭邱曾廖賴徐周葉蘇莊呂江何蕭羅高潘簡朱鍾游彭詹胡施沈余盧梁趙顏柯翁魏孫戴范方宋鄧杜傅侯曹薛丁卓阮馬董温溫唐藍蔣石古紀姚連馮歐程湯黎田康姜白汪鄒尤巫鐘涂龔嚴韓袁金童陸夏柳凃邵錢伍倪溫于譚駱熊任甘秦顧毛章史官萬俞雷粘饒張'.split('');
const COMPOUND = ['歐陽', '司馬', '諸葛', '上官', '張簡', '范姜', '周黃', '江謝', '張廖', '簡林', '陳李'];
// 語境詞：後面要接冒號／「為」／空白，或本身就是「人」結尾的身分詞
const NAME_CTX_RE = /(錄取人員|錄取者|錄取|正取|備取|申請人|報名人|應考人|考生|報到人|姓名)(?:[：:]\s*|為\s*|是\s*|\s+)([一-鿿][一-鿿○◯〇＊]{1,3})(?=$|[^一-鿿○◯〇＊])/gu;
const LIST_NEXT_RE = /^([、，,及和與]\s*)([一-鿿][一-鿿○◯〇＊]{1,3})(?=$|[^一-鿿○◯〇＊])/u;
// 「像姓名」但其實是一般詞：姓氏字開頭的常用詞
const NOT_NAME = /^(名單|人員|方式|方法|程序|時間|日期|結果|資格|條件|公告|通知|規定|名額|順序|梯次|高雄|高中|高等|林業|林務|金門|金額|馬祖|江蘇|石門|白天|白話|田野|黃熱|成員|任務|任用|任何|陳情|周知|周邊|周末|于是|毛額|章程|史料|官網|萬人|萬元|雷同|童年|夏季|柳營|伍拾|韓國|連續|連結|連絡|程式|唐氏|康復|甘油|秦漢|顧問|童軍|施打|施行|施政|余額|盧森|梁柱|趙州|顏色|柯林|翁婿|魏晉|孫中|戴口|范例|方案|宋體|鄧氏|杜絕|傅立|侯選|曹操|薛西|丁型|卓越|阮內|馬上|董事|蔣中|古典|紀錄|紀念|姚明|馮京|歐盟|歐洲|湯匙|黎明|田園|姜黃|汪洋|鄒族|尤其|巫師|鐘點|涂料|龔氏|嚴重|嚴格|嚴禁|袁氏|金融|陸續|陸地|夏令|邵族|錢財|倪氏|譚氏|駱駝|熊貓|任職|章節|史上|萬一|俞氏|粘貼|饒富|葉酸|葉片|蘇丹|蘇格|莊園|呂氏|何時|何處|何謂|蕭條|羅馬|羅氏|潘朵|簡介|簡易|簡章|簡報|簡稱|簡單|朱紅|鍾愛|游泳|游離|彭湖|詹氏|胡椒|施工|沈澱|梁氏|余氏|許可|許多|鄭重|謝謝|洪水|郭氏|邱氏|曾經|曾任|廖氏|賴以|徐徐|吳郭|劉海|蔡氏|楊梅|楊桃|李子|王國|王氏|張貼|張數|張氏|陳列|陳述|陳報|林口|林內|黃色|黃金|黃疸|黃昏|高度|高齡|高風|高危|江湖|何者|羅列|潘氏|朱氏|方面|方向|方便|石化|白喉|白色|白血)/;

/** 判斷一段語境後面的字是不是像中文全名 */
function nameLike(s) {
  if (NOT_NAME.test(s)) return null;
  const cmp = COMPOUND.find((c) => s.startsWith(c));
  if (cmp) return s.length >= 3 && s.length <= 4 ? s : null;
  if (!SURNAMES.includes(s[0])) return null;
  return s.length >= 2 && s.length <= 3 ? s : null;
}

const digitsOf = (s) => { const d = String(s).replace(/\D/g, ''); return d.startsWith('886') ? `0${d.slice(3)}` : d; };

/**
 * 載入白名單；格式錯（沒寫 reason）直接回 errors。
 * @returns {{ numbers: Set<string>, domains: string[], entries: {kind?:string,value:string,files?:string[],reason:string}[], errors: string[] }}
 */
export function loadAllowlist(root, rel = ALLOWLIST_PATH) {
  const out = { numbers: new Set(), domains: [], entries: [], errors: [] };
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return out;
  let j;
  try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { out.errors.push(`${rel}：JSON 格式錯誤（${e.message}）`); return out; }
  const need = (arr, name, key) => (arr ?? []).forEach((x, i) => {
    if (!x || typeof x[key] !== 'string' || !x[key]) out.errors.push(`${rel} ${name}[${i}]：缺少 ${key}`);
    if (!x || typeof x.reason !== 'string' || x.reason.trim().length < 4) out.errors.push(`${rel} ${name}[${i}]：每一筆都要寫 reason（為什麼這不是個資／為什麼可以公開）`);
  });
  need(j.numbers, 'numbers', 'value'); need(j.domains, 'domains', 'domain'); need(j.entries, 'entries', 'value');
  for (const n of j.numbers ?? []) if (n?.value) out.numbers.add(digitsOf(n.value));
  out.domains = (j.domains ?? []).map((d) => String(d?.domain ?? '').toLowerCase().replace(/^\.+/, '')).filter(Boolean);
  out.entries = (j.entries ?? []).filter((e) => e?.value);
  return out;
}

const domainAllowed = (allow, domain) => allow.domains.some((d) => domain === d || domain.endsWith(`.${d}`));
const NUMBER_KINDS = new Set(['mobile', 'national-id', 'arc']);
/** 號碼類比對時忽略空白、連字號與 +886 寫法差異；其他類別逐字比對 */
const normOf = (kind, v) => (NUMBER_KINDS.has(kind) ? `${String(v).toUpperCase().replace(/[^A-Z]/g, '')}${digitsOf(v)}` : String(v));
function allowed(allow, kind, value, file) {
  if (kind === 'mobile' && allow.numbers.has(digitsOf(value))) return true;
  if (kind === 'email' && domainAllowed(allow, value.split('@')[1].toLowerCase())) return true;
  return allow.entries.some((e) => (!e.kind || e.kind === kind) && normOf(kind, e.value) === normOf(kind, value) && (!e.files || e.files.includes(file)));
}

/**
 * 掃一段字串。回傳命中的 { kind, value, index }（value 是原文，只在記憶體裡用來遮罩；不要直接印）。
 * @param {string} s
 * @param {{ ascii?: boolean }} [opt] ascii：只套 ASCII 類偵測（PDF 用）
 */
export function detect(s, opt = {}) {
  const hits = [];
  if (typeof s !== 'string' || !s) return hits;
  for (const m of s.matchAll(ID_RE)) {
    const v = m[0];
    if (/^[A-Z][12]/.test(v) && validTwId(v)) hits.push({ kind: 'national-id', value: v, index: m.index });
    else if (/^[A-Z][89]/.test(v) && validTwId(v)) hits.push({ kind: 'arc', value: v, index: m.index });
    else if (/^[A-Z][A-D]/.test(v) && validOldArc(v)) hits.push({ kind: 'arc', value: v, index: m.index });
  }
  for (const m of s.matchAll(MOBILE_RE)) hits.push({ kind: 'mobile', value: m[0], index: m.index });
  for (const m of s.matchAll(EMAIL_RE)) { if (!FILE_TLD.test(m[0])) hits.push({ kind: 'email', value: m[0], index: m.index }); }
  if (!opt.ascii) {
    for (const m of s.matchAll(NAME_CTX_RE)) {
      const n = nameLike(m[2]);
      if (!n) continue;
      let at = m.index + m[0].lastIndexOf(m[2]);
      hits.push({ kind: 'person-name', value: n, index: at, ctx: m[1] });
      // 「正取：王小明、林大華、陳○宏」：同一串名單後面的名字也要抓（否則片段會把第二個名字原樣印出來）
      at += m[2].length;
      for (;;) {
        const nx = LIST_NEXT_RE.exec(s.slice(at));
        if (!nx || !nameLike(nx[2])) break;
        hits.push({ kind: 'person-name', value: nx[2], index: at + nx[1].length, ctx: m[1] });
        at += nx[0].length;
      }
    }
  }
  return hits;
}

/** 片段：命中前後各 12 字，片段內所有命中都遮罩 */
function excerptOf(s, hit, all) {
  const a = Math.max(0, hit.index - 12), b = Math.min(s.length, hit.index + hit.value.length + 12);
  let out = '', i = a;
  for (const h of [...all].filter((x) => x.index < b && x.index + x.value.length > a).sort((x, y) => x.index - y.index)) {
    if (h.index < i) continue;
    out += s.slice(i, h.index) + maskOf(h.kind, h.value); i = h.index + h.value.length;
  }
  out += s.slice(i, b);
  return `${a > 0 ? '…' : ''}${out.replace(/\s+/g, ' ')}${b < s.length ? '…' : ''}`;
}

const jsonKey = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`);
function walk(v, p, cb) {
  if (typeof v === 'string') cb(v, p);
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`, cb));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { cb(k, `${p}${jsonKey(k)}（欄位名）`); walk(x, `${p}${jsonKey(k)}`, cb); }
}

/**
 * 掃一個檔。rel 是相對 repo 根目錄的路徑（白名單 files 以此比對、輸出也用這個）。
 * @returns {{ file:string, where:string, kind:string, label:string, excerpt:string }[]}
 */
export function scanFile(abs, rel, allow) {
  const ext = path.extname(abs).toLowerCase();
  if (SKIP_EXT.has(ext)) return [];
  const out = [];
  const add = (s, where, opt) => {
    const hits = detect(s, opt);
    for (const h of hits) {
      if (allowed(allow, h.kind, h.value, rel)) continue;
      out.push({ file: rel, where, kind: h.kind, label: KIND_LABEL[h.kind], masked: maskOf(h.kind, h.value), excerpt: excerptOf(s, h, hits) });
    }
  };
  if (LATIN1_EXT.has(ext)) {
    const lines = fs.readFileSync(abs, 'latin1').split(/\r?\n|\r/);
    lines.forEach((l, i) => add(l, `第 ${i + 1} 行（PDF 文字層）`, { ascii: true }));
    return out;
  }
  if (!TEXT_EXT.has(ext) && ext !== '') return [];
  const text = fs.readFileSync(abs, 'utf8');
  if (ext === '.json' || ext === '.geojson') {
    let j; try { j = JSON.parse(text); } catch { j = undefined; }
    if (j !== undefined) { walk(j, '$', (s, p) => add(s, p)); return out; }
  }
  text.split(/\r?\n/).forEach((l, i) => add(l, `第 ${i + 1} 行`));
  return out;
}

/** 範圍內才掃（預設 content/、data/snapshots/）；白名單檔本身不掃 */
export function inScope(rel, roots = SCAN_ROOTS) {
  const r = rel.split(path.sep).join('/').replace(/^\.\//, '');
  if (r === ALLOWLIST_PATH) return false;
  return roots.some((x) => r === x || r.startsWith(`${x}/`));
}
function listFiles(abs) {
  const st = fs.statSync(abs);
  if (st.isFile()) return [abs];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((d) => (d.name.startsWith('.') ? [] : listFiles(path.join(abs, d.name))));
}

/**
 * 掃描多個路徑（檔或目錄）。不在範圍內、不存在（PR 刪掉的檔）的路徑略過。
 * @param {string} root repo 根目錄
 * @param {string[]} [paths] 預設 SCAN_ROOTS
 * @param {{ all?: boolean, allowlist?: ReturnType<typeof loadAllowlist> }} [opt] all：不限範圍（給測試與手動檢查）
 */
export function scanPaths(root, paths = SCAN_ROOTS, opt = {}) {
  const allow = opt.allowlist ?? loadAllowlist(root);
  const hits = [], skipped = [];
  let files = 0;
  for (const p of paths) {
    const abs = path.resolve(root, p);
    if (!fs.existsSync(abs)) { skipped.push(p); continue; }
    for (const f of listFiles(abs)) {
      const rel = path.relative(root, f).split(path.sep).join('/');
      if (!opt.all && !inScope(rel)) continue;
      files++;
      hits.push(...scanFile(f, rel, allow));
    }
  }
  return { hits, files, skipped, allowlistErrors: allow.errors };
}

export const formatHit = (h) => `${h.file} ${h.where}：${h.label} ${h.masked}（片段：${h.excerpt}）`;

/** 給 build.mjs：掃預設範圍，回傳錯誤字串（與 validateSite 的錯誤合併，--check 與建置都會失敗） */
export function piiErrors(root) {
  const r = scanPaths(root);
  return [...r.allowlistErrors.map((e) => `[個資掃描] ${e}`), ...r.hits.map((h) => `[個資掃描] ${formatHit(h)}；若確定不是個資，請加進 ${ALLOWLIST_PATH} 並寫明理由`)];
}
