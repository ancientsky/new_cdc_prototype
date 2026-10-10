// /admin/login/ 後台登入（第十八輪，示範）。沒有後端，所以這頁模擬「機關 SSO（OIDC）登入」：選一個示範帳號 ≈ IdP 回傳身分宣告，
// 存進瀏覽器 localStorage（cdc.admin.session），其他後台頁由 common.js 檢查。正式環境的設計見 docs/admin-auth.md。
import { html } from '../../../scripts/lib/render.mjs';
import { adminMeta, dataScript } from './_partials.mjs';
import { DEMO_ACCOUNTS, ROLES, ROLE_ORDER, SESSION_HOURS, IDLE_MINUTES, PAGE_RULES, CROSS_UNIT_ROLES } from '../../client/admin/auth-rules.js';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/login/', props: {}, noindex: true }]; }
export function meta() { return { ...adminMeta('登入', 'login', ['/assets/js/admin/login.js']), bodyClass: 'adm-login' }; }

export function render(ctx) {
  const { site, url } = ctx;
  const unitName = (id) => site.unitById.get(id)?.name ?? id;
  const units = site.master.units.filter((u) => u.publishes !== false);
  return html`
<header class="adm-pagehead"><h1>後台登入</h1><p class="adm-pagehead__what">內容管理後台只給署內同事使用。正式環境以<strong>機關單一簽入（SSO）＋雙因子</strong>登入，不另設帳號密碼；登入後的單位與角色由人事／AD 群組帶入，不是在這裡自己選。</p>
<p class="adm-pagehead__flow"><strong>原型示範：</strong>這頁沒有後端，下面「選一個示範帳號」等於模擬 SSO 回傳的身分；身分只存在你的瀏覽器，${SESSION_HOURS} 小時或閒置 ${IDLE_MINUTES} 分鐘後失效。設計說明見 <a href="${url('/guide/', { noLang: true })}">使用說明</a> 與 <code>docs/admin-auth.md</code>。</p></header>
<div class="adm-login__grid">
<section class="adm-card adm-login__sso" aria-labelledby="lg-sso"><h2 id="lg-sso">1. 機關 SSO 登入（模擬）</h2>
  <p class="adm-card__sub">正式環境：按下去會被導到機關的身分提供者（IdP）登入並完成雙因子驗證，再帶著簽章過的身分回到後台。這裡用示範帳號代替 IdP 的回應。</p>
  <ol class="adm-login__steps" aria-label="正式環境登入流程"><li>導向機關 IdP</li><li>帳號密碼＋第二因子</li><li>IdP 回傳身分（姓名、員編、單位、群組）</li><li>後台對照群組 → 角色，開始工作階段</li></ol>
  <form id="lg-form" class="adm-login__accounts" aria-label="選一個示範帳號">
    <fieldset class="adm-fieldset"><legend>示範帳號（姓名已遮罩）</legend>
    ${DEMO_ACCOUNTS.map((a, i) => html`<label class="adm-login__acct"><input type="radio" name="acct" value="${a.sub}" ${i === 0 ? 'checked' : ''}>
      <span class="adm-login__acct-main"><strong>${a.name}</strong> · ${a.title}<br><span class="adm-muted">${unitName(a.unit)}</span></span>
      <span class="adm-login__acct-roles">${a.roles.map((r) => html`<span class="adm-tag">${ROLES[r]?.label ?? r}</span>`)}</span></label>`)}
    </fieldset>
    <p class="adm-login__actions"><button type="submit" class="adm-btn" id="lg-sso-btn">以機關 SSO 登入（模擬）</button> <span class="adm-muted" id="lg-next-note"></span></p>
  </form>
</section>
<section class="adm-card" aria-labelledby="lg-manual"><h2 id="lg-manual">2. 自訂示範身分</h2>
  <p class="adm-card__sub">要測某個單位或角色組合時用。正式環境<strong>沒有</strong>這個表單：單位與角色一律由 AD 群組決定，使用者不能自己改。</p>
  <form id="lg-manual-form" class="adm-login__manual">
    <div class="adm-field"><label for="lg-name">姓名（顯示用，建議遮罩，例：王○安）</label><input type="text" id="lg-name" maxlength="20" value="示範○員"></div>
    <div class="adm-field"><label for="lg-unit">單位</label><select id="lg-unit">${units.map((u) => html`<option value="${u.id}">${u.name}</option>`)}</select></div>
    <fieldset class="adm-fieldset"><legend>角色（可複選）</legend><div class="adm-pills">${ROLE_ORDER.map((r) => html`<label class="adm-pill"><input type="checkbox" name="role" value="${r}" ${r === 'editor' ? 'checked' : ''}><span>${ROLES[r].label}</span></label>`)}</div>
    <ul class="adm-login__roledesc">${ROLE_ORDER.map((r) => html`<li><strong>${ROLES[r].label}</strong>：${ROLES[r].desc}</li>`)}</ul></fieldset>
    <p class="adm-login__actions"><button type="submit" class="adm-btn adm-btn--ghost">以此身分進入（模擬）</button></p>
  </form>
</section>
<section class="adm-card" aria-labelledby="lg-rules"><h2 id="lg-rules">誰能進哪些頁</h2>
  <p class="adm-card__sub">最小權限：只有會改到全站行為或牽涉治理判斷的頁才限制角色；其餘頁任何已登入同事都能看，但<strong>只看得到自己單位</strong>的內容。能切換到別的單位或全部單位的角色：${CROSS_UNIT_ROLES.map((r) => ROLES[r].label).join('、')}。</p>
  <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table"><thead><tr><th scope="col">後台頁</th><th scope="col">允許的角色</th></tr></thead><tbody>
  ${Object.entries(PAGE_RULES).map(([k, roles]) => html`<tr><td>${PAGE_NAMES[k] ?? k}</td><td>${roles.map((r) => ROLES[r]?.label ?? r).join('、')}</td></tr>`)}
  <tr><td>其他後台頁</td><td>任何已登入角色（限自己單位）</td></tr></tbody></table></div>
</section>
<section class="adm-card" aria-labelledby="lg-audit"><h2 id="lg-audit">最近的登入稽核（本機示範）</h2>
  <p class="adm-card__sub">正式環境：登入、登出、被拒絕的存取、切換單位視角，都寫到集中式稽核日誌（資訊室保管，使用者不能刪），保存至少一年。這裡只存在你的瀏覽器，最多 200 筆。</p>
  <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table" id="lg-audit-table"><thead><tr><th scope="col">時間</th><th scope="col">事件</th><th scope="col">誰</th><th scope="col">單位</th><th scope="col">說明</th></tr></thead><tbody></tbody></table></div>
  <p class="adm-empty" id="lg-audit-empty">尚無紀錄。</p>
  <p><button type="button" class="adm-btn adm-btn--ghost" id="lg-audit-clear">清除本機稽核（示範）</button></p>
</section>
</div>
${dataScript('lg-accounts', DEMO_ACCOUNTS)}
${dataScript('lg-units', Object.fromEntries(site.master.units.map((u) => [u.id, u.name])))}`;
}

const PAGE_NAMES = { review: '複核區', situation: '疫情發布', 'ai-status': 'AI 開關', eval: '評估', glossary: '詞彙主檔' };
