// @ts-check
// 寫入閘道的通知（第三十輪）：送審 → 通知審核人；退回／核准上線 → 通知承辦人。
// 跟第二十八輪電子報一樣「不真的寄」：Email 寫成 .eml 到 .local/outbox/，Teams 寫成 JSON 到 .local/outbox/teams/。
// 正式環境把這兩個寫檔換成 SMTP（機關郵件主機）與 Teams 的 Incoming Webhook／Power Automate Workflows 即可，內容格式不變。
// 通知內文只用同事的語言（送審、退回、核准上線），不出現任何 Git 用語。
import fs from 'node:fs';
import path from 'node:path';
import { buildEml, writeEml } from '../mail-outbox.mjs';
/** HTML 跳脫（不引入 render.mjs，閘道模組自成一體） */
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const KIND_TEXT = {
  submitted: { subject: (s) => `【請審核】${s.title}`, lead: (s) => `${s.editorName} 送審了一筆內容，請您審核。`, action: '開啟審核畫面' },
  returned: { subject: (s) => `【已退回】${s.title}`, lead: (s) => `${s.actorName} 退回了您送審的內容，請依意見修改後再送審。`, action: '開啟並修改' },
  approved: { subject: (s) => `【已核准上線】${s.title}`, lead: (s) => `${s.actorName} 核准了您送審的內容${s.scheduled ? `，將於 ${s.scheduled} 上線` : '，網站將在下次更新時上線'}。`, action: '查看內容' },
  partial: { subject: (s) => `【已核准 ${s.approvals}/${s.required}】${s.title}`, lead: (s) => `${s.actorName} 已核准，還需要 ${s.required - s.approvals} 位審核。`, action: '查看內容' },
  'post-publish': { subject: (s) => `【上線後複核】${s.title}`, lead: (s) => `${s.editorName} 的內容已依快速上線規則上線，請於 ${s.hours} 小時內複核。`, action: '開啟審核畫面' },
};

/**
 * @param {{ outboxDir: string, now?: () => number }} opts
 */
export function createNotifier({ outboxDir, now = () => Date.now() }) {
  const teamsDir = path.join(outboxDir, 'teams');
  /**
   * @param {keyof typeof KIND_TEXT} kind
   * @param {{ to: {account:string,name:string,email?:string|null}[], title: string, link: string, comment?: string, [k: string]: any }} ctx
   * @returns {{ emails: string[], teams: string[] }}
   */
  function send(kind, ctx) {
    const k = KIND_TEXT[kind];
    if (!k || !ctx.to?.length) return { emails: [], teams: [] };
    const subject = k.subject(ctx);
    const lead = k.lead(ctx);
    const lines = [lead, '', `內容：${ctx.title}`, ctx.unitName ? `權責單位：${ctx.unitName}` : '', ctx.comment ? `意見：${ctx.comment}` : '', '', `${k.action}：${ctx.link}`, '', '（本信由疾管署網站內容管理系統自動發出；原型環境只寫入本機資料夾，不會真的寄出。）'].filter((x, i, arr) => x !== '' || arr[i - 1] !== '');
    const text = lines.join('\n');
    const html = `<p>${esc(lead)}</p><p>內容：<strong>${esc(ctx.title)}</strong>${ctx.unitName ? `<br>權責單位：${esc(ctx.unitName)}` : ''}</p>${ctx.comment ? `<blockquote>${esc(ctx.comment)}</blockquote>` : ''}<p><a href="${esc(ctx.link)}">${esc(k.action)}</a></p><p style="color:#666">本信由疾管署網站內容管理系統自動發出。</p>`;
    const emails = [];
    const teams = [];
    const date = new Date(now());
    for (const who of ctx.to) {
      if (who.email) {
        const eml = buildEml({ fromName: '疾管署網站內容管理系統', to: who.email, subject, text, html, date, headers: { 'X-CDC-Prototype': 'simulated message; written to the local outbox, never sent', 'Auto-Submitted': 'auto-generated', 'X-CDC-Gateway-Event': kind } });
        emails.push(writeEml(outboxDir, `gateway-${kind}`, eml, date));
      }
    }
    // Teams：一則訊息標註所有收件人（Adaptive Card；Incoming Webhook／Workflows 都吃這個形狀）
    fs.mkdirSync(teamsDir, { recursive: true });
    const card = {
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
          body: [
            { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: subject, wrap: true },
            { type: 'TextBlock', text: `${ctx.to.map((w) => `<at>${w.name}</at>`).join(' ')} ${lead}`, wrap: true },
            ...(ctx.comment ? [{ type: 'TextBlock', text: `意見：${ctx.comment}`, wrap: true, isSubtle: true }] : []),
          ],
          actions: [{ type: 'Action.OpenUrl', title: k.action, url: ctx.link }],
          msteams: { entities: ctx.to.map((w) => ({ type: 'mention', text: `<at>${w.name}</at>`, mentioned: { id: w.email ?? w.account, name: w.name } })) },
        },
      }],
    };
    const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const n = fs.readdirSync(teamsDir).filter((f) => f.endsWith('.json')).length + 1;
    const name = `${stamp}-${String(n).padStart(4, '0')}-${kind.replace(/[^a-z-]/g, '')}.json`;
    fs.writeFileSync(path.join(teamsDir, name), `${JSON.stringify(card, null, 2)}\n`);
    teams.push(`teams/${name}`);
    return { emails, teams };
  }
  return { send, outboxDir };
}
