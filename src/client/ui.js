// 共用互動（骨架版；Agent C 補完：身分切換、來源卡浮層、回報表單、details 單開）
import './i18n.js';
const root = document.documentElement;
window.CDC = window.CDC || {};
window.CDC.base = root.dataset.base || '';
window.CDC.langPath = root.dataset.langPath || '';
window.CDC.url = (p, { noLang = false } = {}) => (/^https?:|^tel:|^mailto:/.test(p) ? p : `${window.CDC.base}${noLang ? '' : window.CDC.langPath}${p.startsWith('/') ? p : `/${p}`}`);
window.CDC.api = async (name) => (await fetch(`${window.CDC.base}/v1/${name}.json`)).json();

// 身分切換（記在本機）
const params = new URLSearchParams(location.search);
if (params.get('view') === 'pro') localStorage.setItem('cdc.view', 'pro');
if (params.get('view') === 'public') localStorage.setItem('cdc.view', 'public');
root.dataset.view = localStorage.getItem('cdc.view') || 'public';
document.querySelectorAll('.audience__btn[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === root.dataset.view)));
document.querySelector('.audience__btn[data-view="public"]')?.addEventListener('click', () => { localStorage.setItem('cdc.view', 'public'); root.dataset.view = 'public'; });
