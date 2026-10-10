// 電子報訂閱（第二十八輪，Issue #38）：瀏覽器與 Node 共用的純函式，沒有任何 import、不碰 DOM。
// 為什麼獨立成一檔：同一份「什麼算有效的訂閱」與「確認信長什麼樣子」要被三個地方共用——
//   (1) 瀏覽器端表單即時檢核（src/client/subscribe.js）、(2) 本機開發伺服器的模擬後端（scripts/lib/subscribe-mock.mjs，
//   伺服器端一定要再驗一次，不能信任前端）、(3) 週摘要產生器（scripts/newsletter-digest.mjs）。
// 正式寄信服務上線後，這份規則就是「前後端要對齊的契約」（docs/deploy.md〈電子報寄信服務〉）。

/** 可訂閱的主題＝RSS 摘要頻道的 id（feeds/{id}.xml）。tests/round28-newsletter.test.mjs 會比對它與 buildFeeds() 輸出完全一致。 */
export const TOPIC_IDS = ['news', 'documents', 'situation', 'publications', 'notices', 'careers', 'procurement'];
export const FREQUENCIES = ['instant', 'weekly'];
export const MAIL_LANGS = ['zh-TW', 'en'];
export const EMAIL_MAX = 254; // RFC 5321
/** 確認連結有效期（毫秒）：48 小時。逾期要重新訂閱。 */
export const CONFIRM_TTL_MS = 48 * 60 * 60 * 1000;

/** 主題的中英名稱（信件內文用；網頁介面字另放 i18n.js 的 subscribe.topic.*，七語） */
export const TOPIC_NAMES = {
  news: ['新聞稿與通函', 'News releases and circulars'],
  documents: ['文件版本異動', 'Document updates'],
  situation: ['疫情態勢', 'Outbreak situation'],
  publications: ['出版品', 'Publications'],
  notices: ['機關公告', 'Notices'],
  careers: ['人才招募', 'Careers'],
  procurement: ['採購公告', 'Procurement'],
};
export const topicName = (id, lang) => (TOPIC_NAMES[id] ?? [id, id])[lang === 'en' ? 1 : 0];

/** 只收 ASCII 位址（國際化網域與 SMTPUTF8 位址原型不支援，介面會明說）；本地端 ≤64、整體 ≤254、網域至少一個點且結尾是字母 */
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

export const normalizeEmail = (s) => String(s ?? '').trim().toLowerCase();

/** null＝通過；否則 'required' | 'invalid' */
export function emailProblem(s) {
  const v = normalizeEmail(s);
  if (!v) return 'required';
  if (v.length > EMAIL_MAX || v.includes('..') || v.startsWith('.') || v.split('@')[0].endsWith('.') || !EMAIL_RE.test(v)) return 'invalid';
  return null;
}

/**
 * 驗證一筆訂閱請求。回傳 { ok, errors, value }；errors 的 key 是欄位名、值是錯誤代碼（對應 i18n subscribe.err.*）。
 * 不信任輸入型別：topics 不是陣列、含未知 id、重複，一律處理；frequency／lang 不在清單就是錯。
 */
export function validateSubscription(input = {}) {
  const errors = {};
  const email = normalizeEmail(input.email);
  const ep = emailProblem(email);
  if (ep) errors.email = ep;
  const raw = Array.isArray(input.topics) ? input.topics : [];
  const topics = [...new Set(raw.map(String))];
  if (!topics.length) errors.topics = 'required';
  else if (topics.some((x) => !TOPIC_IDS.includes(x))) errors.topics = 'invalid';
  const frequency = String(input.frequency ?? '');
  if (!FREQUENCIES.includes(frequency)) errors.frequency = 'invalid';
  const lang = String(input.lang ?? '');
  if (!MAIL_LANGS.includes(lang)) errors.lang = 'invalid';
  if (input.consent !== true) errors.consent = 'required';
  return { ok: Object.keys(errors).length === 0, errors, value: { email, topics: TOPIC_IDS.filter((x) => topics.includes(x)), frequency, lang } };
}

/** 偏好更新（不含 email、同意）：同 validateSubscription 的 topics／frequency／lang 規則 */
export function validatePreferences(input = {}) {
  const r = validateSubscription({ ...input, email: 'x@example.com', consent: true });
  const { email: _e, consent: _c, ...errors } = r.errors;
  void _e; void _c;
  return { ok: Object.keys(errors).length === 0, errors, value: { topics: r.value.topics, frequency: r.value.frequency, lang: r.value.lang } };
}

/** 遮罩信箱：a***@example.com（狀態畫面與日誌用，不回傳完整位址給只持有 token 的人以外的任何人） */
export function maskEmail(email) {
  const [l, d] = String(email ?? '').split('@');
  if (!d) return '***';
  return `${l.slice(0, 1)}***@${d}`;
}

/** Token 格式：crypto.randomUUID() 的輸出。伺服器只接受這個形狀，其餘直接當作找不到（不查表、不回顯輸入）。 */
export const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isToken = (s) => typeof s === 'string' && TOKEN_RE.test(s);

export const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ───────── 信件內容 ─────────
 * 信件語言＝訂閱者選的語言（zh-TW／en），不是網頁語言，所以字串放在這裡而不是 i18n.js（i18n.js 只有「頁面語言」一份表）。
 * 每種信都有純文字與 HTML 兩個版本（multipart/alternative），內容一致；連結一律用絕對網址。
 */
const M = {
  'zh-TW': {
    from: '疾管署（原型示範）',
    proto: '【原型示範】這是衛福部疾管署新官網原型的模擬信件，不是正式通知。',
    hello: '您好，',
    confirm: { subject: '請確認訂閱疾管署電子報', lead: '有人（希望是您）用這個信箱申請訂閱疾管署電子報。請在 48 小時內點下方連結確認；沒有確認就不會寄任何電子報給您。', cta: '確認訂閱', ignore: '如果不是您申請的，直接忽略這封信即可，我們不會再寄信給您。' },
    welcome: { subject: '訂閱已確認：疾管署電子報', lead: '您已完成訂閱。', manage: '管理訂閱（改主題、頻率、語言）', unsub: '退訂' },
    already: { subject: '您已訂閱疾管署電子報', lead: '有人用這個信箱再次申請訂閱，但此信箱已經訂閱中，我們沒有更動任何設定。如果是您本人，可以用下方連結管理或退訂。' },
    manage: { subject: '管理您的疾管署電子報訂閱', lead: '您（或有人用您的信箱）要求取得管理訂閱的連結：' },
    goodbye: { subject: '已退訂疾管署電子報', lead: '您已退訂，之後不會再收到電子報。若是誤按，可以重新訂閱。' },
    topics: '訂閱主題', freq: { instant: '即時（有新內容就通知）', weekly: '每週摘要（每週一寄出）' }, freqLabel: '頻率',
    privacy: '隱私權政策', footer: '本信由疾管署新官網原型模擬產生。您的信箱只用於寄送您訂閱的內容，退訂後即停止使用。',
    unsubLine: '不想再收到：', manageLine: '管理訂閱：', confirmLine: '確認連結：',
    digest: { subject: '疾管署每週摘要（{from}–{to}）', lead: '這是 {from} 至 {to} 的新增內容：', none: '這一週所訂閱的主題沒有新內容。', more: '完整內容與 RSS 見 {url}' },
  },
  en: {
    from: 'Taiwan CDC (prototype demo)',
    proto: '[Prototype demo] This is a simulated message from the Taiwan CDC website prototype. It is not an official notice.',
    hello: 'Hello,',
    confirm: { subject: 'Please confirm your Taiwan CDC newsletter subscription', lead: 'Someone (hopefully you) asked to subscribe this address to the Taiwan CDC newsletter. Please confirm within 48 hours using the link below. Until you confirm, we will not send you any newsletter.', cta: 'Confirm subscription', ignore: 'If this was not you, just ignore this message. We will not email you again.' },
    welcome: { subject: 'Subscription confirmed: Taiwan CDC newsletter', lead: 'Your subscription is confirmed.', manage: 'Manage subscription (topics, frequency, language)', unsub: 'Unsubscribe' },
    already: { subject: 'You are already subscribed to the Taiwan CDC newsletter', lead: 'Someone tried to subscribe this address again, but it is already subscribed. We changed nothing. If this was you, use the links below to manage or unsubscribe.' },
    manage: { subject: 'Manage your Taiwan CDC newsletter subscription', lead: 'You (or someone using your address) asked for a link to manage the subscription:' },
    goodbye: { subject: 'You have unsubscribed from the Taiwan CDC newsletter', lead: 'You are unsubscribed and will not receive further newsletters. If this was a mistake, you can subscribe again.' },
    topics: 'Topics', freq: { instant: 'Instant (as soon as something new is published)', weekly: 'Weekly digest (sent on Mondays)' }, freqLabel: 'Frequency',
    privacy: 'Privacy policy', footer: 'This message was generated by the Taiwan CDC website prototype. Your address is used only to send what you subscribed to, and not used after you unsubscribe.',
    unsubLine: 'Stop receiving these:', manageLine: 'Manage subscription:', confirmLine: 'Confirmation link:',
    digest: { subject: 'Taiwan CDC weekly digest ({from} to {to})', lead: 'New items from {from} to {to}:', none: 'No new items in your topics this week.', more: 'Full content and RSS: {url}' },
  },
};
const fill = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
export const mailText = (lang) => M[lang === 'en' ? 'en' : 'zh-TW'];

const HTML_WRAP = (lang, title, inner, m) => `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${escHtml(title)}</title></head>
<body style="margin:0;padding:16px;background:#f4f6f5;font-family:'Noto Sans TC','Microsoft JhengHei',Arial,sans-serif;color:#1c2b24;line-height:1.6">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d3dcd7;border-radius:6px;padding:20px">
<p style="margin:0 0 12px;padding:8px 10px;background:#fff4d6;border-left:4px solid #e8a400;font-size:13px">${escHtml(m.proto)}</p>
${inner}
<hr style="border:0;border-top:1px solid #d3dcd7;margin:20px 0 8px">
<p style="margin:0;font-size:12px;color:#55645c">${escHtml(m.footer)}</p>
</div></body></html>
`;
const btn = (href, label) => `<p style="margin:16px 0"><a href="${escHtml(href)}" style="display:inline-block;background:#1b5e3f;color:#ffffff;text-decoration:none;font-weight:700;padding:10px 20px;border-radius:4px">${escHtml(label)}</a></p><p style="margin:0 0 12px;font-size:12px;word-break:break-all"><a href="${escHtml(href)}">${escHtml(href)}</a></p>`;

/**
 * 組信：kind＝confirm | welcome | already | manage | goodbye。
 * links：{ confirmUrl?, manageUrl?, unsubscribeUrl?, privacyUrl? }（絕對網址）；sub：{ topics, frequency, lang }。
 * 回傳 { subject, text, html }。所有插入 HTML 的值都經 escHtml。
 */
export function composeMail(kind, { lang = 'zh-TW', links = {}, sub = null } = {}) {
  const m = mailText(lang);
  const k = m[kind];
  const lines = [m.proto, '', m.hello, '', k.lead, ''];
  let inner = `<p style="margin:0 0 8px">${escHtml(m.hello)}</p><p style="margin:0 0 8px">${escHtml(k.lead)}</p>`;
  const prefs = () => {
    if (!sub) return;
    const names = sub.topics.map((id) => topicName(id, lang)).join(lang === 'en' ? ', ' : '、');
    lines.push(`${m.topics}：${names}`, `${m.freqLabel}：${m.freq[sub.frequency] ?? sub.frequency}`, '');
    inner += `<ul style="margin:8px 0 12px;padding-left:20px"><li>${escHtml(m.topics)}: ${escHtml(names)}</li><li>${escHtml(m.freqLabel)}: ${escHtml(m.freq[sub.frequency] ?? sub.frequency)}</li></ul>`;
  };
  if (kind === 'confirm') {
    prefs();
    lines.push(`${m.confirmLine}`, links.confirmUrl, '', k.ignore, '');
    inner += btn(links.confirmUrl, k.cta) + `<p style="margin:0 0 8px">${escHtml(k.ignore)}</p>`;
  } else if (kind === 'welcome') {
    prefs();
    lines.push(`${m.manageLine}`, links.manageUrl, '', `${m.unsubLine}`, links.unsubscribeUrl, '');
    inner += `<p style="margin:0 0 4px"><a href="${escHtml(links.manageUrl)}">${escHtml(k.manage)}</a></p><p style="margin:0 0 8px"><a href="${escHtml(links.unsubscribeUrl)}">${escHtml(k.unsub)}</a></p>`;
  } else if (kind === 'already') {
    lines.push(`${m.manageLine}`, links.manageUrl, '', `${m.unsubLine}`, links.unsubscribeUrl, '');
    inner += `<p style="margin:0 0 4px"><a href="${escHtml(links.manageUrl)}">${escHtml(m.welcome.manage)}</a></p><p style="margin:0 0 8px"><a href="${escHtml(links.unsubscribeUrl)}">${escHtml(m.welcome.unsub)}</a></p>`;
  } else if (kind === 'manage') {
    lines.push(links.manageUrl, '', `${m.unsubLine}`, links.unsubscribeUrl, '');
    inner += `<p style="margin:0 0 4px"><a href="${escHtml(links.manageUrl)}">${escHtml(m.welcome.manage)}</a></p><p style="margin:0 0 8px"><a href="${escHtml(links.unsubscribeUrl)}">${escHtml(m.welcome.unsub)}</a></p>`;
  }
  if (links.privacyUrl) { lines.push(`${m.privacy}：${links.privacyUrl}`, ''); inner += `<p style="margin:0;font-size:13px"><a href="${escHtml(links.privacyUrl)}">${escHtml(m.privacy)}</a></p>`; }
  lines.push('--', m.footer);
  return { subject: k.subject, text: lines.join('\n'), html: HTML_WRAP(lang, k.subject, inner, m) };
}

/**
 * 週摘要信：items＝[{ topic, title, link, date, summary }]（依主題分組輸出）。
 * 與即時通知共用同一份版型；週摘要產生器（scripts/newsletter-digest.mjs）呼叫它，正式寄信服務只需負責「寄」。
 */
export function composeDigest({ lang = 'zh-TW', from, to, items = [], links = {}, siteUrl = '' }) {
  const m = mailText(lang);
  const d = m.digest;
  const subject = fill(d.subject, { from, to });
  const lead = fill(d.lead, { from, to });
  const lines = [m.proto, '', m.hello, '', items.length ? lead : d.none, ''];
  let inner = `<p style="margin:0 0 8px">${escHtml(m.hello)}</p><p style="margin:0 0 8px">${escHtml(items.length ? lead : d.none)}</p>`;
  const groups = new Map();
  for (const it of items) { if (!groups.has(it.topic)) groups.set(it.topic, []); groups.get(it.topic).push(it); }
  for (const [topic, list] of groups) {
    lines.push(`■ ${topicName(topic, lang)}`);
    inner += `<h2 style="font-size:16px;margin:16px 0 4px;color:#1b5e3f">${escHtml(topicName(topic, lang))}</h2><ul style="margin:0;padding-left:20px">`;
    for (const it of list) {
      lines.push(`- ${it.date}　${it.title}`, `  ${it.link}`);
      inner += `<li style="margin:0 0 6px"><span style="color:#55645c">${escHtml(it.date)}</span>　<a href="${escHtml(it.link)}">${escHtml(it.title)}</a>${it.summary ? `<br><span style="font-size:13px;color:#55645c">${escHtml(String(it.summary).slice(0, 120))}</span>` : ''}</li>`;
    }
    lines.push('');
    inner += '</ul>';
  }
  if (siteUrl) { lines.push(fill(d.more, { url: siteUrl }), ''); inner += `<p style="margin:16px 0 0;font-size:13px">${escHtml(fill(d.more, { url: siteUrl }))}</p>`; }
  if (links.manageUrl) { lines.push(`${m.manageLine}`, links.manageUrl); inner += `<p style="margin:8px 0 0;font-size:13px"><a href="${escHtml(links.manageUrl)}">${escHtml(m.welcome.manage)}</a></p>`; }
  if (links.unsubscribeUrl) { lines.push(`${m.unsubLine}`, links.unsubscribeUrl, ''); inner += `<p style="margin:4px 0 0;font-size:13px"><a href="${escHtml(links.unsubscribeUrl)}">${escHtml(m.welcome.unsub)}</a></p>`; }
  lines.push('--', m.footer);
  return { subject, text: lines.join('\n'), html: HTML_WRAP(lang, subject, inner, m) };
}
