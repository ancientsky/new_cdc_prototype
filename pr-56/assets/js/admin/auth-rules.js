// 後台登入與權限的共用規則（第十八輪）：瀏覽器與 Node 共用的純函式，沒有任何 import（同 careers-rules.js 的做法）。
// 原型沒有後端，所以「登入」是示範：身分存在瀏覽器 localStorage，模擬機關 SSO（OIDC）登入後拿到的身分宣告（claims）。
// 正式環境的設計與為什麼這樣設計，見 docs/admin-auth.md；這裡的角色、頁面規則與稽核事件名稱是前後端的契約（ARCHITECTURE §21）。

/** 角色：對應正式環境 IdP（AD／SSO）群組 → 後台角色的對照。一個人可以有多個角色。 */
export const ROLES = {
  editor: { label: '承辦人', desc: '上架、修改自己單位的內容；看自己單位的待辦與審閱到期' },
  reviewer: { label: '複核者', desc: '複核同單位送出的內容（科長／審核人）；通常同時是承辦人' },
  'situation-publisher': { label: '疫情發布', desc: '發布首頁疫情態勢（疫情中心）' },
  'chief-editor': { label: '內容總編輯', desc: '跨單位看全部內容與複核區（公關室）' },
  governance: { label: '治理幕僚', desc: '治理規則、AI 白名單、評估、AI 開關（OASIS）' },
  platform: { label: '平台管理', desc: '平台、帳號與稽核紀錄、AI 緊急開關（資訊室）' },
};
export const ROLE_ORDER = ['editor', 'reviewer', 'situation-publisher', 'chief-editor', 'governance', 'platform'];

/** 可以切換到「其他單位／全部單位」視角的角色；其他角色鎖定在自己的單位。 */
export const CROSS_UNIT_ROLES = ['chief-editor', 'governance', 'platform'];

/**
 * 頁面規則：後台頁 key（data-admin-page）→ 允許的角色。沒列的頁 = 任何已登入角色皆可。
 * 原則是最小權限：會改到全站行為（AI 開關、疫情發布）或牽涉治理判斷（複核、評估）的頁才限制。
 */
export const PAGE_RULES = {
  review: ['reviewer', 'chief-editor', 'governance'],
  situation: ['situation-publisher', 'governance'],
  'ai-status': ['platform', 'governance'],
  eval: ['governance', 'platform', 'chief-editor'],
  glossary: ['governance', 'editor', 'reviewer', 'chief-editor', 'platform', 'situation-publisher'],
};
/** 不需登入的後台頁 */
export const PUBLIC_ADMIN_PAGES = ['login'];

/** 示範帳號（姓名一律遮罩，依 docs/careers-privacy.md 的慣例；正式環境由 SSO 帶入真名與員工編號） */
export const DEMO_ACCOUNTS = [
  { sub: 'demo-001', name: '王○安', title: '承辦人', unit: 'unit.acute-infectious', roles: ['editor'] },
  { sub: 'demo-002', name: '林○慧', title: '科長', unit: 'unit.acute-infectious', roles: ['editor', 'reviewer'] },
  { sub: 'demo-003', name: '陳○宏', title: '承辦人', unit: 'unit.epidemic-intelligence', roles: ['editor', 'situation-publisher'] },
  { sub: 'demo-004', name: '張○玲', title: '內容總編輯', unit: 'unit.pr', roles: ['editor', 'reviewer', 'chief-editor'] },
  { sub: 'demo-005', name: '李○翰', title: '治理幕僚', unit: 'unit.oasis', roles: ['governance', 'reviewer'] },
  { sub: 'demo-006', name: '吳○瑜', title: '平台管理', unit: 'unit.it', roles: ['platform'] },
  { sub: 'demo-007', name: '黃○婷', title: '承辦人', unit: 'unit.personnel', roles: ['editor'] },
  { sub: 'demo-008', name: '劉○君', title: '承辦人', unit: 'unit.secretariat', roles: ['editor', 'reviewer'] },
];

/** 工作階段長度：8 小時（上班一天）；正式環境由 IdP 與閘道決定，並應有閒置逾時（建議 30 分鐘）。 */
export const SESSION_HOURS = 8;
export const IDLE_MINUTES = 30;

/** 建立工作階段物件（模擬 OIDC id_token 的常見宣告：sub、name、exp、iat，加上我們需要的 unit 與 roles） */
export function makeSession(account, { now = Date.now(), method = 'sso-demo' } = {}) {
  const roles = (account.roles ?? []).filter((r) => ROLES[r]);
  if (!account.unit || !roles.length) return null;
  return {
    sub: account.sub ?? `manual-${now.toString(36)}`, name: String(account.name ?? '').trim() || '示範使用者', title: account.title ?? '',
    unit: account.unit, roles, method, iat: now, exp: now + SESSION_HOURS * 3600 * 1000, lastSeen: now,
  };
}

/** 工作階段是否有效（過期或閒置逾時都算無效）；回傳 null 或原因字串 */
export function sessionProblem(s, now = Date.now()) {
  if (!s || typeof s !== 'object') return 'none';
  if (!s.unit || !Array.isArray(s.roles) || !s.roles.length) return 'malformed';
  if (typeof s.exp !== 'number' || now >= s.exp) return 'expired';
  if (typeof s.lastSeen === 'number' && now - s.lastSeen > IDLE_MINUTES * 60 * 1000) return 'idle';
  return null;
}

export const hasRole = (s, role) => !!s?.roles?.includes(role);
/** 能否切換單位視角（看別的單位或全部） */
export const canCrossUnit = (s) => (s?.roles ?? []).some((r) => CROSS_UNIT_ROLES.includes(r));
/** 能否進某個後台頁 */
export function canAccess(s, pageKey) {
  if (PUBLIC_ADMIN_PAGES.includes(pageKey)) return true;
  if (sessionProblem(s)) return false;
  const allowed = PAGE_RULES[pageKey];
  return !allowed || s.roles.some((r) => allowed.includes(r));
}
/** 能否以某單位的視角操作（unitId 可為 'all'） */
export function canActAsUnit(s, unitId) {
  if (sessionProblem(s)) return false;
  if (unitId === s.unit) return true;
  return canCrossUnit(s);
}
export const roleLabels = (s) => (s?.roles ?? []).map((r) => ROLES[r]?.label ?? r);

/** 稽核事件（append-only；正式環境寫到集中式日誌，不可被使用者自己刪） */
export const AUDIT_EVENTS = ['login', 'logout', 'denied', 'unit-switch', 'expired'];
export function auditEntry(kind, s, detail = '', now = Date.now()) {
  if (!AUDIT_EVENTS.includes(kind)) throw new Error(`unknown audit event ${kind}`);
  return { at: new Date(now).toISOString(), kind, sub: s?.sub ?? null, name: s?.name ?? null, unit: s?.unit ?? null, roles: s?.roles ?? [], detail: String(detail ?? '') };
}

/* ───────── 第三十輪：AD 群組 ↔ 單位×角色（寫入閘道與正式 SSO 共用的對照；docs/admin-auth.md §7） ─────────
 * 群組名稱：CDC-WEB-<unitId 去掉 unit.>-<role>，例：CDC-WEB-acute-infectious-editor、CDC-WEB-pr-chief-editor。
 * 角色名稱本身可能含連字號（situation-publisher、chief-editor），所以解析時「從尾巴比對已知角色」，剩下的才是單位。 */
export const AD_GROUP_PREFIX = 'CDC-WEB-';
export const adGroupName = (unitId, role) => `${AD_GROUP_PREFIX}${String(unitId).replace(/^unit\./, '')}-${role}`;
/** 群組名稱 → { unit, role }；不是本站群組（或角色未知）回 null。網域前綴（CDC\）與大小寫差異都容忍。 */
export function parseAdGroup(name) {
  const g = String(name ?? '').trim().replace(/^.*\\/, '');
  if (g.slice(0, AD_GROUP_PREFIX.length).toUpperCase() !== AD_GROUP_PREFIX) return null;
  const rest = g.slice(AD_GROUP_PREFIX.length).toLowerCase();
  const role = [...ROLE_ORDER].sort((a, b) => b.length - a.length).find((r) => rest.endsWith(`-${r}`));
  if (!role) return null;
  const unit = rest.slice(0, rest.length - role.length - 1);
  return /^[a-z0-9][a-z0-9-]*$/.test(unit) ? { unit: `unit.${unit}`, role } : null;
}
/** 工作階段（或示範帳號）→ 它在 AD 會有的群組清單 */
export const adGroupsOf = (s) => (s?.roles ?? []).filter((r) => ROLES[r]).map((r) => adGroupName(s.unit, r));
/** 後台角色 → 寫入閘道給同事看的三種角色：編輯／審核／管理 */
export const GATEWAY_ROLE_OF = { editor: '編輯', 'situation-publisher': '編輯', reviewer: '審核', 'chief-editor': '審核', governance: '審核', platform: '管理' };
