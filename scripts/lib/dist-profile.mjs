// @ts-check
// 第六十三輪（Issue #141「縮小可被自動盤點的攻擊面」）：正式部署產物白名單、內部站拆分、對外資產清冊。
//
// 為什麼：ARTEX 一類的 AI 滲透工具第一步不是攻擊，是「盤點」——把子網域、端點、可下載的檔案全部列成資產地圖，再挑最軟的目標。
// 原型的 dist/ 是給 GitHub Pages 示範用的，什麼都放：後台頁（9 MB）、後台 JS、source map（含原始碼與註解）、伺服器標頭設定檔、
// PR 預覽、型別宣告檔。這些在示範站是刻意公開的（開源專案，給同事和資訊室看），但正式站的公開主機不該出現，
// 每多一個檔，就多一個可被盤點、比對版本、找已知漏洞的入口。
//
// 做法分兩層：
//   1. FORBIDDEN_PUBLIC：明列「公開主機不得出現」的路徑規則與理由。分兩類——
//      prototypeOnly（後台、source map、標頭設定檔、預覽…）：原型站上是預期的（profile 'prototype' 回報為 expected），正式站一律不行；
//      防禦性（.git、.env、node_modules、tests、docs、備份檔、暫存檔、.local）：任何 profile 都不該出現，出現就是建置或部署流程出錯。
//   2. PUBLIC_EXTENSIONS：副檔名白名單。上面的規則是「已知不行」，白名單是「已知可以」——明天有人在 src/public/ 放一個 .sql、.zip、.pem，
//      規則清單不會知道，白名單會擋下來（理由見 docs/attack-surface.md「教訓」）。
//
// 檢查跑在「產物」上，不跑在原始碼上：原始碼乾淨不代表 dist 乾淨（複製步驟、PR 預覽、手動補檔都可能多放東西），
// 所以 scripts/audit-dist.mjs 也可以由資訊室對「實際部署的目錄」執行。
import fs from 'node:fs';
import path from 'node:path';
import { config, siteOrigin } from '../../site.config.mjs';
import { formSetting, askLogSetting, FORM_KEYS } from './forms.mjs';
import { securityHeaders } from './emit-headers.mjs';

/** 簡易 glob → 正規表示式：`**\/` 任意層目錄（含零層）、結尾 `/**` 該目錄底下全部、`*` 不跨 `/`、`?` 單一字元。比對 dist 的相對路徑（`/` 分隔）。 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length;) {
    if (glob.startsWith('**/', i)) {
      re += '(?:.*/)?';
      i += 3;
    } else if (glob.startsWith('/**', i) && i + 3 === glob.length) {
      re += '(?:/.*)?';
      i += 3;
    } else if (glob.startsWith('**', i)) {
      re += '.*';
      i += 2;
    } else if (glob[i] === '*') {
      re += '[^/]*';
      i++;
    } else if (glob[i] === '?') {
      re += '[^/]';
      i++;
    } else {
      re += glob[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * 公開主機不得出現的路徑。prototypeOnly：原型站預期會有（後台、除錯、維運素材）；其餘為防禦性規則（任何時候出現都是錯）。
 * except：同一規則下的例外（redirects/nginx.map 是 nginx 的 map 指令檔＝公開的舊網址對照，openapi.json 有寫，不是 source map）。
 * @type {Array<{ pattern: string, reason: string, prototypeOnly?: boolean, except?: string[] }>}
 */
export const FORBIDDEN_PUBLIC = [
  // ── 防禦性：先比對，避免被下面的 prototypeOnly 規則「吃掉」（例如 preview/pr-1/.env 必須報 .env，不是 preview）
  { pattern: '**/.git*', reason: '版本庫中繼資料（.git／.gitignore／.github）：可還原整個版本歷史或 CI 設定' },
  { pattern: '**/.git*/**', reason: '版本庫中繼資料目錄' },
  { pattern: '**/.env*', reason: '環境變數檔：可能含金鑰、權杖、連線字串' },
  { pattern: '**/node_modules/**', reason: '相依套件：暴露套件與版本，可直接比對已知漏洞' },
  { pattern: 'tests/**', reason: '測試程式與測試資料' },
  { pattern: 'docs/**', reason: '內部文件（部署、網路架構、閘道設計）' },
  { pattern: '**/*.bak', reason: '備份檔：常是舊版設定或原始碼' },
  { pattern: '**/*.orig', reason: '合併衝突留下的原始檔' },
  { pattern: '**/*.swp', reason: '編輯器暫存檔：可還原檔案內容' },
  { pattern: '**/*.log', reason: '執行紀錄：可能含路徑、帳號、錯誤堆疊' },
  { pattern: '**/.DS_Store', reason: 'macOS 目錄中繼檔：列出同目錄所有檔名' },
  { pattern: '**/Thumbs.db', reason: 'Windows 縮圖快取：列出同目錄圖檔' },
  { pattern: '.local/**', reason: '本機開發資料（模擬後端的訂閱者、查詢紀錄、閘道版本庫）' },
  { pattern: '**/.local/**', reason: '本機開發資料' },
  // ── 原型站預期、正式公開主機不得出現（splitForProduction 搬到內部站或刪除）
  { pattern: 'preview/**', reason: 'PR 預覽：未審核的內容與程式，各自又是一整套含後台的站', prototypeOnly: true },
  { pattern: 'admin/**', reason: '後台頁：只給同事，放在內部反向代理後面（docs/deploy.md §14.5）', prototypeOnly: true },
  { pattern: 'assets/js/admin/**', reason: '後台 JS：列出寫入閘道的每個端點與參數', prototypeOnly: true },
  { pattern: 'vendor/**', reason: '後台專用第三方函式庫（marked、pdf.js）：版本號可直接比對已知漏洞，公開頁不用', prototypeOnly: true },
  { pattern: '**/*.map', reason: 'source map：含完整原始碼與註解（決策理由、內部流程）', prototypeOnly: true, except: ['redirects/nginx.map'] },
  { pattern: 'headers/**', reason: '伺服器標頭設定檔：維運素材，屬於公開主機的 CDN／伺服器設定，不該當網頁提供', prototypeOnly: true },
  { pattern: 'assets/js/globals.d.ts', reason: '型別宣告檔：開發用，列出全域物件結構', prototypeOnly: true },
  { pattern: 'robots.production.txt', reason: '原型站對照用的正式版 robots，正式站直接輸出成 robots.txt', prototypeOnly: true },
];
const RULES = FORBIDDEN_PUBLIC.map((r) => ({ ...r, re: globToRegExp(r.pattern) }));

/** 公開站允許的副檔名（白名單）。不在清單的檔 ⇒ 報 allowlist 規則。新增副檔名要改這裡並說明理由。 */
export const PUBLIC_EXTENSIONS = [
  // 頁面與機讀格式
  'html',
  'md',
  'json',
  'xml',
  'txt',
  'csv',
  'ics',
  // 前端資源
  'js',
  'css',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'ico',
  'webmanifest',
  'woff2',
  // 內容附件（site.config.mjs assets.allowedExt）
  'pdf',
  'xlsx',
  'docx',
  'odt',
  // Pagefind 全文索引
  'pf_fragment',
  'pf_index',
  'pf_filter',
  'pf_meta',
  'pagefind',
];
/** 沒有副檔名、或副檔名不在白名單但確定公開的個別檔案（要逐一寫理由）。 */
export const PUBLIC_ALLOW_PATHS = {
  '.nojekyll': 'GitHub Pages 用的空白標記檔',
  'redirects/_redirects': '舊網址 301 對照（Netlify／Cloudflare Pages 格式；openapi.json 有寫）',
  'redirects/nginx.map': '舊網址 301 對照（nginx map 格式；openapi.json 有寫）',
};
const EXT_SET = new Set(PUBLIC_EXTENSIONS);

/** 一個相對路徑命中哪條規則（沒有則 null）。 */
export function matchRule(rel) {
  for (const r of RULES) if (r.re.test(rel) && !(r.except ?? []).includes(rel)) return r;
  return null;
}

function* walk(root, dir = root) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(root, p);
    else yield path.relative(root, p).split(path.sep).join('/');
  }
}

const extOf = (rel) => {
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
};

/**
 * 稽核一個建置產物目錄。
 * @param {string} dist
 * @param {{ profile?: 'public'|'prototype', cfg?: any }} [opts]
 * @returns {{ ok: boolean, profile: string, files: number, forbidden: Array<{ path: string, rule: string, reason: string }>, expected: Array<{ rule: string, reason: string, count: number, sample: string[] }>, inventory: any }}
 */
export function auditDist(dist, { profile = 'public', cfg = config } = {}) {
  if (!fs.existsSync(dist)) throw new Error(`找不到目錄：${dist}`);
  const forbidden = [];
  /** @type {Map<string, { rule: string, reason: string, count: number, sample: string[] }>} */
  const expected = new Map();
  const files = [];
  for (const rel of walk(dist)) {
    files.push(rel);
    const r = matchRule(rel);
    if (r) {
      if (r.prototypeOnly && profile === 'prototype') {
        const e = expected.get(r.pattern) ?? { rule: r.pattern, reason: r.reason, count: 0, sample: [] };
        e.count++;
        if (e.sample.length < 3) e.sample.push(rel);
        expected.set(r.pattern, e);
      } else forbidden.push({ path: rel, rule: r.pattern, reason: r.reason });
      continue;
    }
    if (rel in PUBLIC_ALLOW_PATHS) continue;
    if (!EXT_SET.has(extOf(rel)))
      forbidden.push({
        path: rel,
        rule: 'allowlist:extension',
        reason: `副檔名「${extOf(rel) || '（無）'}」不在公開站白名單（scripts/lib/dist-profile.mjs PUBLIC_EXTENSIONS）`,
      });
  }
  return { ok: forbidden.length === 0, profile, files: files.length, forbidden, expected: [...expected.values()], inventory: buildInventory(dist, files, cfg) };
}

/** CSP 字串 → [{ origin, directives[] }]（只取 https:// 來源） */
export function cspOrigins(csp) {
  const out = new Map();
  for (const part of String(csp).split(';')) {
    const [dir, ...vals] = part.trim().split(/\s+/);
    for (const v of vals) if (/^https:\/\//.test(v)) out.set(v, [...(out.get(v) ?? []), dir]);
  }
  return [...out].map(([origin, directives]) => ({ origin, directives }));
}

function originPurpose(origin, cfg) {
  const o = (u) => (u ? new URL(u).origin : '');
  const p = [];
  if (origin === o(cfg.vaxmapUrl)) p.push('疫苗及流感藥劑地圖（iframe）');
  if (origin === o(cfg.denguemapUrl)) p.push('登革熱地圖（iframe）');
  if (/youtube(-nocookie)?\.com$/.test(origin)) p.push('YouTube 影片嵌入');
  if (origin === 'https://i.ytimg.com') p.push('YouTube 縮圖');
  if (origin === 'https://api.anthropic.com') p.push('BYOK 示範（同事自帶金鑰呼叫 LLM；正式站拿掉）');
  for (const k of FORM_KEYS) if (formSetting(cfg, k).origin === origin) p.push(`表單端點 forms.${k}`);
  if (askLogSetting(cfg).origin === origin) p.push('查詢紀錄端點 askLog');
  return p.join('；') || '（未標註用途，請確認）';
}

/** 對外資產清冊中「建置端推得出來」的部分。網域、子網域、IP、憑證要資訊室補（docs/attack-surface.md §4）。 */
function buildInventory(dist, files, cfg) {
  const byTopDir = {};
  let bytes = 0;
  for (const rel of files) {
    const top = rel.includes('/') ? `${rel.slice(0, rel.indexOf('/'))}/` : '（根目錄檔案）';
    const size = fs.statSync(path.join(dist, rel)).size;
    bytes += size;
    const d = (byTopDir[top] ??= { files: 0, bytes: 0 });
    d.files++;
    d.bytes += size;
  }
  const html = files.filter((f) => f.endsWith('.html'));
  const adminPages = html
    .filter((f) => f.startsWith('admin/'))
    .map((f) => `/${f.replace(/index\.html$/, '')}`)
    .sort();
  const v1Json = files
    .filter((f) => f.startsWith('v1/') && f.endsWith('.json'))
    .map((f) => `/${f}`)
    .sort();
  // CSP：優先讀產物裡的 headers.json（部署的就是它）；沒有（正式站已把 headers/ 移出公開樹）就用設定推
  const hj = path.join(dist, 'headers/headers.json');
  let csp = '',
    cspSource = 'site.config.mjs';
  if (fs.existsSync(hj)) {
    try {
      csp = JSON.parse(fs.readFileSync(hj, 'utf8')).headers['Content-Security-Policy'] ?? '';
      cspSource = 'headers/headers.json';
    } catch {}
  }
  if (!csp) csp = securityHeaders({})['Content-Security-Policy'];
  const externalOrigins = cspOrigins(csp).map((e) => ({ ...e, purpose: originPurpose(e.origin, cfg) }));
  const dm = formSetting(cfg, 'directorMailbox');
  if (dm.active === 'link') externalOrigins.push({ origin: new URL(dm.petitionUrl).origin, directives: ['link'], purpose: '署長信箱：連到既有陳情系統' });
  const al = askLogSetting(cfg);
  const nl = formSetting(cfg, 'newsletter');
  const endpoints = [
    {
      path: '/api/gateway/*',
      purpose: '寫入閘道（後台儲存草稿、送審、退回、核准上線）',
      exposure: 'internal',
      mode: 'server（scripts/serve.mjs；正式＝內部反向代理後的閘道，GATEWAY=off 可關）',
    },
    {
      path: '/api/intl-epidemic',
      purpose: '國際疫情資訊推送（Bearer INTL_FEED_TOKEN，伺服器對伺服器）',
      exposure: 'internal',
      mode: 'server（沒設 INTL_FEED_TOKEN 時回 503）',
    },
    {
      path: '/api/ask-log',
      purpose: '智慧問答查詢紀錄',
      exposure: al.active === 'post' ? 'external' : 'dev-only',
      mode: al.active,
      ...(al.endpoint ? { endpoint: al.endpoint } : {}),
    },
    {
      path: '/api/subscriptions*',
      purpose: '電子報訂閱（原型為本機模擬後端）',
      exposure: nl.active === 'post' ? 'external' : 'dev-only',
      mode: nl.active,
      ...(nl.endpoint ? { endpoint: nl.endpoint } : {}),
    },
    { path: '/api/dev/*', purpose: '本機開發用（模擬信件匣、查詢紀錄報表）：正式環境不得存在', exposure: 'dev-only', mode: 'dev' },
    ...FORM_KEYS.filter((k) => k !== 'newsletter').map((k) => {
      const s = formSetting(cfg, k);
      return {
        path: `forms.${k}`,
        purpose: '表單送出',
        exposure: s.active === 'mock' ? 'browser-only' : 'external',
        mode: s.active,
        ...(s.endpoint ? { endpoint: s.endpoint } : {}),
        ...(s.petitionUrl ? { endpoint: s.petitionUrl } : {}),
      };
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    mode: cfg.mode,
    publicOrigin: siteOrigin(),
    adminOrigin: cfg.adminOrigin || '',
    counts: { files: files.length, bytes, html: html.length, byTopDir },
    api: { v1JsonCount: v1Json.length, v1Json },
    adminPages,
    endpoints,
    cspSource,
    externalOrigins,
    note: '本清冊只含建置端推得出來的部分；正式網域、子網域、IP、憑證（簽發者、到期日）請資訊室依 docs/attack-surface.md §4 補齊並每月比對。',
  };
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name),
      d = path.join(dst, e.name);
    if (e.isDirectory()) n += copyDir(s, d);
    else {
      fs.copyFileSync(s, d);
      n++;
    }
  }
  return n;
}
const countFiles = (dir) => (fs.existsSync(dir) ? [...walk(dir)].length : 0);
function moveDir(dist, internal, rel) {
  const src = path.join(dist, rel);
  if (!fs.existsSync(src)) return 0;
  const n = copyDir(src, path.join(internal, rel));
  fs.rmSync(src, { recursive: true, force: true });
  return n;
}

export const SOURCE_MAP_COMMENT = /\n?\/\/# sourceMappingURL=[^\n]*\n?$/;

/**
 * 正式建置：把只給同事的東西從公開樹搬到內部站目錄。
 *   搬走：admin/、assets/js/admin/、vendor/、headers/、assets/js/globals.d.ts、所有 source map
 *   刪除：robots.production.txt、preview/
 *   複製：assets/、v1/（內部站自給自足：後台頁要 CSS、共用 JS、v1 JSON）
 *   公開 JS 結尾的 `//# sourceMappingURL=` 註解拿掉（map 已不在公開站，留著只是告訴盤點工具去哪找）；內部站的保留，方便除錯。
 * @param {string} dist
 * @param {string} internalDir
 * @param {{ inventory?: any }} [opts] inventory：寫成 exposure.json（建議傳拆分前的完整清冊）
 */
export function splitForProduction(dist, internalDir, { inventory } = {}) {
  const inv = inventory ?? auditDist(dist, { profile: 'prototype' }).inventory;
  fs.rmSync(internalDir, { recursive: true, force: true });
  fs.mkdirSync(internalDir, { recursive: true });
  const copied = {
    assets: copyDir(path.join(dist, 'assets'), path.join(internalDir, 'assets')),
    v1: copyDir(path.join(dist, 'v1'), path.join(internalDir, 'v1')),
  };
  const moved = {
    admin: moveDir(dist, internalDir, 'admin'),
    headers: moveDir(dist, internalDir, 'headers'),
    vendor: moveDir(dist, internalDir, 'vendor'),
    assetsAdmin: 0,
    maps: 0,
    other: 0,
  };
  // assets/ 已整包複製到內部站，公開樹這邊直接刪
  const adminJs = path.join(dist, 'assets/js/admin');
  moved.assetsAdmin = countFiles(adminJs);
  fs.rmSync(adminJs, { recursive: true, force: true });
  const dts = path.join(dist, 'assets/js/globals.d.ts');
  if (fs.existsSync(dts)) {
    fs.rmSync(dts);
    moved.other++;
  }
  const deleted = { previews: countFiles(path.join(dist, 'preview')), robotsProduction: 0 };
  fs.rmSync(path.join(dist, 'preview'), { recursive: true, force: true });
  if (fs.existsSync(path.join(dist, 'robots.production.txt'))) {
    fs.rmSync(path.join(dist, 'robots.production.txt'));
    deleted.robotsProduction = 1;
  }
  let stripped = 0;
  for (const rel of [...walk(dist)]) {
    const r = matchRule(rel);
    if (r?.pattern === '**/*.map') {
      const dst = path.join(internalDir, rel);
      if (!fs.existsSync(dst)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(dist, rel), dst);
      }
      fs.rmSync(path.join(dist, rel));
      moved.maps++;
    } else if (rel.endsWith('.js')) {
      const p = path.join(dist, rel);
      const s = fs.readFileSync(p, 'utf8');
      if (SOURCE_MAP_COMMENT.test(s)) {
        fs.writeFileSync(p, s.replace(SOURCE_MAP_COMMENT, '\n'));
        stripped++;
      }
    }
  }
  fs.writeFileSync(path.join(internalDir, 'exposure.json'), JSON.stringify(inv, null, 2) + '\n');
  fs.writeFileSync(path.join(internalDir, 'README.md'), internalReadme(inv));
  return { copied, moved, deleted, strippedSourceMapComments: stripped, internalFiles: countFiles(internalDir) };
}

function internalReadme(inv) {
  return `# 內部站（dist-internal/）：只給同事，不對外

由 \`SITE_MODE=production npm run build\` 產生（scripts/lib/dist-profile.mjs，第六十三輪，Issue #141）。建置日 ${inv.generatedAt.slice(0, 10)}。

## 這是什麼

正式建置把「只給同事」的東西從公開站產物（\`dist/\`）搬到這裡，公開主機上就不存在這些檔案，自動盤點工具也就列不到：

| 路徑 | 內容 |
| --- | --- |
| \`admin/\` | 後台頁（${inv.adminPages.length} 頁） |
| \`assets/\` | 整份 CSS／JS（含 \`assets/js/admin/\`、source map \`*.js.map\`、\`globals.d.ts\`），讓內部站自給自足 |
| \`v1/\` | 機讀 API（後台頁會讀） |
| \`vendor/\` | 後台專用第三方函式庫（marked、pdf.js） |
| \`headers/\` | 安全標頭設定檔（見下） |
| \`exposure.json\` | 對外資產清冊（建置端推得出來的部分；docs/attack-surface.md §4） |

## 怎麼放

- **只放在同事用的內部反向代理後面，和寫入閘道（\`/api/gateway/\`）同一台**（docs/deploy.md §14.5）。絕不對網際網路開放。
- 存取控制：限內網或 VPN；若走雲端，加 Entra ID 條件式存取（受管裝置、機關網路位置）。後台頁本身的登入（AD／Google）是第二道，不是唯一一道。
- 路由：\`/admin/\`、\`/api/gateway/\`、\`/assets/\`、\`/v1/\`、\`/vendor/\` 由本目錄與閘道提供；其他路徑（公開頁、\`/files/\`、\`/pagefind/\`）轉到公開站。
- 若公開頁要直接連到這裡，建置時設 \`ADMIN_ORIGIN=https://<內部站網域>\`，公開頁的「同事修改這頁」等連結會指向該網域。

## headers/ 不是給這台用的

\`headers/\` 是**公開主機**的伺服器／CDN 標頭設定（CSP、HSTS、要拿掉的指紋標頭），由資訊室套到公開站的 nginx、IIS 或 Azure Front Door。
它不該被當成網頁提供，所以放在這裡交接，不在 \`dist/\`。內部站也建議套同一份（至少 HSTS、nosniff、拿掉 Server／X-Powered-By）。
`;
}

/** adminOrigin 設定檢查：只能是 origin（https://host[:port]，本機可 http://localhost），不能帶路徑。 */
export function adminOriginErrors(cfg = config) {
  const v = cfg.adminOrigin;
  if (!v) return [];
  try {
    const u = new URL(v);
    const local = u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
    if (u.protocol !== 'https:' && !local) return [`[內部站] ADMIN_ORIGIN 必須是 https://（現在是 ${v}）`];
    if (u.origin !== v) return [`[內部站] ADMIN_ORIGIN 只能是網域（例 https://staff.example.gov.tw），不能帶路徑或結尾斜線（現在是 ${v}）`];
  } catch {
    return [`[內部站] ADMIN_ORIGIN 不是有效網址（${v}）`];
  }
  return [];
}
