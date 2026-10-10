// 模擬寄信：把「本來要寄出的信」組成標準 .eml（RFC 5322／MIME）寫進資料夾，而不是真的寄出（第二十八輪，Issue #38）。
//
// 為什麼寫成 .eml：資訊室與公關室要看的是「收件人實際會收到的那封信」——寄件人、主旨編碼、純文字與 HTML 兩個版本、
// 以及 List-Unsubscribe／List-Unsubscribe-Post 標頭（RFC 2369、RFC 8058；Gmail、Yahoo 對大量寄件者要求一鍵退訂）。
// .eml 用任何郵件程式（Thunderbird、Outlook、Apple Mail）雙擊就能開，也能原封不動丟進郵件測試工具檢查。
// 寄件網域用 .invalid（RFC 6761 保留，永遠不會解析），所以即使誤把這些檔案餵給 SMTP 也寄不出去。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MOCK_FROM_ADDR = 'no-reply@cdc-prototype.invalid';

const CRLF = '\r\n';
const b64 = (buf) => Buffer.from(buf).toString('base64');
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n').replace(/\r\n$/, '');

/** 標頭值不得含換行（防標頭注入）。任何來自使用者的值進標頭前都要過這關。 */
export function safeHeader(v) {
  const s = String(v ?? '');
  if (/[\r\n]/.test(s)) throw new Error('header value contains CR/LF');
  return s;
}

/** RFC 2047 encoded-word（UTF-8 / Base64）。純 ASCII 且短就原樣輸出；長字串依字元邊界切成 ≤75 字元的字，以折行串接。 */
export function encodeWord(text) {
  const s = safeHeader(text);
  if (/^[\x20-\x7e]*$/.test(s)) return s; // eslint-disable-line no-control-regex
  const words = [];
  let cur = '';
  for (const ch of s) {
    if (Buffer.byteLength(cur + ch) > 42) { words.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${b64(w)}?=`).join(`${CRLF} `);
}

const addr = (name, email) => (name ? `${encodeWord(name)} <${safeHeader(email)}>` : `<${safeHeader(email)}>`);

/**
 * 組 .eml。headers：額外標頭（物件，值不得含換行）。回傳 { raw, messageId, boundary }。
 * 一律 multipart/alternative（text/plain 在前、text/html 在後，符合 RFC 2046 的「越後面越優先」）。
 */
export function buildEml({ fromName, fromAddr = MOCK_FROM_ADDR, to, subject, text, html, date = new Date(), headers = {}, messageId = `<${crypto.randomUUID()}@cdc-prototype.invalid>` }) {
  const boundary = `=_cdc_${crypto.randomUUID().replaceAll('-', '')}`;
  const head = [
    `From: ${addr(fromName, fromAddr)}`,
    `To: ${addr('', to)}`,
    `Subject: ${encodeWord(subject)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${safeHeader(messageId)}`,
    'MIME-Version: 1.0',
    ...Object.entries(headers).map(([k, v]) => `${safeHeader(k)}: ${safeHeader(v)}`),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type, body) => [`--${boundary}`, `Content-Type: ${type}; charset=utf-8`, 'Content-Transfer-Encoding: base64', '', wrap76(b64(body.replace(/\r?\n/g, CRLF))), ''].join(CRLF);
  const raw = `${head.join(CRLF)}${CRLF}${CRLF}${part('text/plain', text)}${CRLF}${part('text/html', html)}${CRLF}--${boundary}--${CRLF}`;
  return { raw, messageId, boundary };
}

/** 寫進 outboxDir：檔名 {時間戳}-{種類}-{序號}.eml（依檔名排序＝寄出順序）。回傳檔名。 */
export function writeEml(outboxDir, kind, eml, now = new Date()) {
  fs.mkdirSync(outboxDir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const n = fs.readdirSync(outboxDir).filter((f) => f.endsWith('.eml')).length + 1;
  const name = `${stamp}-${String(n).padStart(4, '0')}-${kind.replace(/[^a-z-]/g, '')}.eml`;
  fs.writeFileSync(path.join(outboxDir, name), eml.raw);
  return name;
}

/* ───────── 解析（開發用列表與測試；不是通用 MIME 解析器，只吃本檔產生的格式） ───────── */
const unfold = (s) => s.replace(/\r?\n[ \t]+/g, ' ');
export function decodeWords(s) {
  // RFC 2047：相鄰的 encoded-word 之間的空白要忽略，其餘空白保留
  return s.replace(/(\?=)\s+(?==\?UTF-8\?B\?)/gi, '$1').replace(/=\?UTF-8\?B\?([^?]*)\?=/gi, (_, d) => Buffer.from(d, 'base64').toString('utf8'));
}
export function parseEml(raw) {
  const [headBlock, ...rest] = String(raw).split(/\r?\n\r?\n/);
  const headers = {};
  for (const line of unfold(headBlock).split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).toLowerCase()] = decodeWords(line.slice(i + 1).trim());
  }
  const boundary = /boundary="([^"]+)"/.exec(headers['content-type'] ?? '')?.[1];
  const parts = {};
  if (boundary) {
    for (const seg of rest.join('\n\n').split(`--${boundary}`).slice(1)) {
      if (seg.startsWith('--')) break;
      const [ph, ...pb] = seg.replace(/^\r?\n/, '').split(/\r?\n\r?\n/);
      const type = /Content-Type:\s*([^;\r\n]+)/i.exec(ph)?.[1]?.trim();
      if (type) parts[type] = Buffer.from(pb.join('\n\n').replace(/\s+/g, ''), 'base64').toString('utf8');
    }
  }
  return { headers, text: parts['text/plain'] ?? '', html: parts['text/html'] ?? '' };
}
