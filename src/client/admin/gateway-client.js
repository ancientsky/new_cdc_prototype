// 寫入閘道的瀏覽器端（第三十輪）：偵測閘道、帶身分與 CSRF token 呼叫 /api/gateway/*，以及不用 innerHTML 的 DOM 小工具。
//
// 漸進式：有閘道（npm run dev 或正式環境）就用它；沒有（GitHub Pages 靜態站）就什麼都不做，後台維持原本「只在瀏覽器裡示範」的行為。
// 網址加 ?gateway=off 可強制關閉（示範兩種模式用）。
// 給同事看的文字只用「草稿、送審、退回、核准、上線」——不出現任何 Git 用語；Git 是資訊室的事。
import { url, getSession } from './common.js';

export const STATUS_TONE = { draft: 'gray', in_review: 'warn', returned: 'bad', approved: 'info', published: 'ok' };

/** 建 DOM：el('p', { class: 'x', text: '…' }, child…)；文字一律走 textContent */
export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'text') n.textContent = String(v);
    else if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
export const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
export const fmtTime = (iso) => { try { return new Date(iso).toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' }); } catch { return String(iso ?? ''); } };

function b64url(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 偵測閘道；有就回傳 client，沒有回 null。
 * client.get(path)／client.post(path, body) → { ok, status, data }；data 錯誤時為 { error, message, fields? }
 */
export async function detectGateway({ timeoutMs = 2000 } = {}) {
  try { if (new URLSearchParams(location.search).get('gateway') === 'off') return null; } catch { /* ignore */ }
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  let info;
  try {
    const r = await fetch(url('/api/gateway/health'), { cache: 'no-store', credentials: 'same-origin', signal: ctl?.signal });
    if (!r.ok) return null;
    info = await r.json();
    if (info?.service !== 'cdc-web-gateway') return null;
  } catch { return null; } finally { clearTimeout(timer); }
  const devHeaders = () => (info.auth === 'dev' ? { 'X-CDC-Dev-Session': b64url(JSON.stringify(getSession() ?? {})) } : {});
  let csrf = '';
  const call = async (method, path, body) => {
    try {
      const r = await fetch(url(`/api/gateway${path}`), {
        method, cache: 'no-store', credentials: 'same-origin',
        headers: { accept: 'application/json', ...devHeaders(), ...(method === 'POST' ? { 'content-type': 'application/json', 'x-csrf-token': csrf } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const type = r.headers.get('content-type') ?? '';
      const data = type.includes('application/json') ? await r.json() : await r.text();
      return { ok: r.ok, status: r.status, data };
    } catch { return { ok: false, status: 0, data: { error: 'network', message: '連不上系統，請檢查網路後再試' } }; }
  };
  const ses = await call('GET', '/session');
  if (!ses.ok) return { auth: info.auth, user: null, error: ses.data, get: (p) => call('GET', p), post: async () => ses };
  csrf = ses.data.csrfToken;
  return { auth: info.auth, user: ses.data.user, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b) };
}

/** 錯誤 → 一句話＋欄位清單 */
export const errorText = (res) => res?.data?.message || (res?.status ? `系統回應錯誤（${res.status}）` : '連不上系統');
