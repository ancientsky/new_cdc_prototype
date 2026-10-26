// @ts-check
// 自動化探測的特徵（第六十二輪，Issue #140「防 AI 自動化攻擊探測」；說明見 docs/abuse-protection.md）。
//
// 為什麼放在 repo 裡、寫成資料：SOC 的告警規則與開發者的分析工具（scripts/analyze-404-log.mjs）要看「同一份清單」。
// 規則散在 SIEM 主控台裡，開發者改了網址結構不會知道要通知誰；放在這裡，改網址的 PR 就會碰到這份清單和它的測試。
// KQL 範例（docs/abuse-protection.md §5）的路徑清單也是從這裡抄的：改這裡時請一併更新文件。
//
// 本站是靜態網站：下面這些路徑在本站「一定不存在」，所以打到它們的請求不是迷路的民眾，是在找別的系統的弱點
// （WordPress、PHP、Spring Boot、設定檔外洩、目錄穿越）。一次命中不代表攻擊成功，但代表有人在自動化列舉。
// 例外：/openapi.json 是本站正式公開的 API 文件（dist/openapi.json），不是探測；所以 swagger／api-docs 規則刻意排除它。

/** @typedef {{ id: string, re: RegExp, label: string, publicOnly?: boolean }} ProbeSignature */

/** @type {ProbeSignature[]} */
export const PROBE_SIGNATURES = [
  { id: 'env-file', re: /(?:^|\/)\.env(?:\.[\w-]+)?(?:$|[/?#])/i, label: '環境設定檔 .env（祕密外洩）' },
  { id: 'git-dir', re: /(?:^|\/)\.git(?:\/|$)/i, label: '.git 目錄（原始碼外洩）' },
  { id: 'svn-dir', re: /(?:^|\/)\.svn(?:\/|$)/i, label: '.svn 目錄（原始碼外洩）' },
  { id: 'wp-login', re: /wp-login\.php/i, label: 'WordPress 登入頁' },
  { id: 'wp-admin', re: /\/wp-(?:admin|content|includes)(?:\/|$)/i, label: 'WordPress 管理／外掛目錄' },
  { id: 'xmlrpc', re: /\/xmlrpc\.php/i, label: 'WordPress XML-RPC' },
  { id: 'phpmyadmin', re: /\/(?:phpmyadmin|pma|myadmin)(?:\/|$)/i, label: 'phpMyAdmin' },
  { id: 'aws-credentials', re: /\/\.aws\/(?:credentials|config)/i, label: 'AWS 金鑰檔' },
  { id: 'server-status', re: /\/server-(?:status|info)(?:$|[/?])/i, label: 'Apache server-status' },
  { id: 'actuator', re: /\/actuator(?:\/|$)/i, label: 'Spring Boot actuator' },
  { id: 'cgi-bin', re: /\/cgi-bin\//i, label: 'CGI 程式目錄' },
  { id: 'phpunit', re: /\/vendor\/phpunit\//i, label: 'PHPUnit 遠端執行漏洞' },
  // 目錄穿越：../、編碼過的 ..%2f、%2e%2e（大小寫、雙重編碼都算）。排在 /etc/passwd 前面：穿越本身就是重點，目標檔案是什麼是其次
  { id: 'path-traversal', re: /(?:\.\.\/|\.\.\\|\.\.%2f|\.\.%5c|%2e%2e|%252e%252e)/i, label: '目錄穿越（../）' },
  { id: 'etc-passwd', re: /etc\/(?:passwd|shadow)/i, label: '系統帳號檔 /etc/passwd' },
  { id: 'ds-store', re: /\/\.DS_Store(?:$|[?#])/i, label: 'macOS .DS_Store（目錄清單外洩）' },
  { id: 'web-config', re: /\/web\.config(?:$|[?#])/i, label: 'IIS web.config' },
  // 網站根目錄的備份檔：/backup.zip、/site.sql、/www.tar.gz、/index.php.bak……（只看根目錄：深層的 .zip 可能是正式附件）
  {
    id: 'backup-file',
    re: /^\/(?:[^/?#]*\.(?:bak|old|sql|zip|tar|tgz|tar\.gz|7z|rar)|backups?(?:\/|$)[^?#]*)(?:$|[?#])/i,
    label: '根目錄備份檔（.bak／.sql／.zip）',
  },
  // API 文件探測：/swagger、/swagger-ui.html、/v2/api-docs、/api-docs……；本站自己的 /openapi.json 不算（見檔頭）
  { id: 'api-docs', re: /\/(?:swagger(?:-ui)?(?:\.html|\.json)?|api-docs|v[23]\/api-docs)(?:\/|$|[?#])/i, label: 'API 文件探測（swagger／api-docs）' },
  // 後台與寫入閘道：正式環境「不應該從網際網路連得到」（只在機關內網或 VPN）。所以只有分析對外入口的 log（--public）才算探測；
  // 內網 log 裡同事正常使用後台，不能被當成攻擊。
  { id: 'admin', re: /^\/(?:[\w-]+\/)?admin(?:\/|$|[?#])/i, label: '後台 /admin/（對外不應可達）', publicOnly: true },
  { id: 'gateway', re: /^\/(?:[\w-]+\/)?api\/gateway(?:\/|$|[?#])/i, label: '寫入閘道 /api/gateway/（對外不應可達）', publicOnly: true },
];

/**
 * 可疑的 User-Agent（掃描器與通用 HTTP 程式庫）。
 * 注意：這是「弱訊號」。AI 自動化工具（例如 ARTEX 這類多代理滲透工具）常直接用一般的 HTTP 程式庫（python-requests、aiohttp、
 * Go 的 net/http），也可以把 UA 改成任何瀏覽器字串——UA 是請求自己報的，攻擊者想怎麼寫就怎麼寫。
 * 反過來，資料介接的正當使用者也常用 curl 或 python 抓開放資料（v1/*.json）。所以 UA 只加分、不單獨構成告警；
 * 強訊號是「短時間大量 404」（爆量）與「打到上面的特徵路徑」。
 * @type {{ id: string, re: RegExp }[]}
 */
export const SUSPICIOUS_UAS = [
  { id: 'python-requests', re: /python-requests/i },
  { id: 'aiohttp', re: /aiohttp/i },
  { id: 'go-http-client', re: /Go-http-client/i },
  { id: 'curl', re: /^curl\//i },
  { id: 'libwww', re: /libwww/i },
  { id: 'sqlmap', re: /sqlmap/i },
  { id: 'nikto', re: /nikto/i },
  { id: 'nuclei', re: /nuclei/i },
  { id: 'zgrab', re: /zgrab/i },
  { id: 'masscan', re: /masscan/i },
  { id: 'httpx', re: /(?:^|[\s/(-])httpx(?:[\s/)]|$)/i },
  { id: 'dirbuster', re: /dirbuster/i },
  { id: 'gobuster', re: /gobuster/i },
  { id: 'ffuf', re: /(?:^|\W)ffuf(?:\W|$)/i },
];

/** 這是不是「明確的掃描器」（不是通用程式庫）：分數加重 */
export const SCANNER_UA_IDS = new Set(['sqlmap', 'nikto', 'nuclei', 'zgrab', 'masscan', 'dirbuster', 'gobuster', 'ffuf']);

/**
 * 路徑 → 命中的特徵（一個路徑可能命中多個，回傳第一個；先解一次 percent-encoding 再比，編碼過的 %2e%2e 也比原字串）
 * @param {string} p
 * @param {{ public?: boolean }} [opts]
 * @returns {ProbeSignature | null}
 */
export function matchSignature(p, { public: pub = false } = {}) {
  const raw = String(p ?? '');
  let dec = raw;
  try {
    dec = decodeURIComponent(raw);
  } catch {
    /* 壞掉的編碼本身就可疑，但交給原字串比 */
  }
  for (const s of PROBE_SIGNATURES) {
    if (s.publicOnly && !pub) continue;
    if (s.re.test(raw) || s.re.test(dec)) return s;
  }
  return null;
}

/**
 * UA → 可疑原因（沒有 UA 或空白也算：一般瀏覽器一定會帶）
 * @param {string | null | undefined} ua
 * @returns {string | null}
 */
export function suspiciousUa(ua) {
  const s = String(ua ?? '').trim();
  if (!s || s === '-') return 'empty';
  return SUSPICIOUS_UAS.find((u) => u.re.test(s))?.id ?? null;
}
