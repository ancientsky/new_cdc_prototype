// 第三十輪（#55）：表單頁共用——端點設定（site.config.mjs forms）與「收件單位＋個資蒐集告知」區塊。底線開頭＝不會被當成頁面模板。
// 每個收個資的表單（報名、署長信箱、電子報）都要出現這個區塊：誰收、送到哪、為什麼收、保存多久、你有什麼權利。
import { html } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { formSetting } from '../../../scripts/lib/forms.mjs';
import { unitLink } from './_partials.mjs';

/** 某表單的生效設定（mock｜post｜link）；site.config 可由測試覆寫（ctx.site.config.forms） */
export const formOf = (ctx, key) => formSetting(ctx?.site?.config?.forms ? ctx.site.config : config, key);

/** 收件單位＋個資蒐集告知。key：careersApply｜directorMailbox｜newsletter */
export function formNotice(ctx, key, { id = `fn-${key}` } = {}) {
  const { t, url } = ctx;
  const f = formOf(ctx, key);
  const host = f.origin ? new URL(f.origin).host : '';
  return html`<aside class="c-alert c-alert--info c-formnotice" role="note" aria-labelledby="${id}" data-form-notice="${key}" data-form-mode="${f.active}">
  <strong class="c-alert__t" id="${id}">${t('form.notice.t')}</strong>
  <ul class="c-formnotice__list">
    <li data-fn="receiver">${t('form.notice.receiver')}${f.receiver ? unitLink(ctx, f.receiver) : '—'}</li>
    <li data-fn="where">${t(`form.notice.where.${f.active}`, { host })}</li>
    <li data-fn="purpose">${t(`form.notice.purpose.${key}`)}</li>
    <li data-fn="retention">${t('form.notice.retention')}</li>
    <li data-fn="rights">${t('form.notice.rights')} <a href="${url('/policy/privacy/')}">${t('form.notice.policy')}</a></li>
  </ul>
</aside>`;
}
