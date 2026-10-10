// @ts-check
// 寫入閘道的工作流程（第三十輪）：把同事的動作翻成 Git 動作，並守住規則。
//
//   同事按的鈕        閘道做的事（同事看不到這一欄）
//   儲存草稿          驗證 → 建立／更新分支 cms/<id>-<送審件>，提交（服務帳號；Edited-by: 承辦人）
//   送審              驗證 → 提交（status: review）→ 開合併請求、標籤「審核中」→ 通知審核人
//   退回修改（必填意見）  合併請求留言、標籤改「退回」→ 通知承辦人；已收的核准歸零（改過的內容要重審）
//   核准上線          四眼原則檢查 → 記一筆核准；核准數達車道要求 → 提交（status: published、Approved-by:）→ 合併到 main → 通知承辦人
//
// 規則：
//   - 角色由 AD 群組來（編輯／審核／管理）；只能動自己單位的內容，跨單位角色（總編輯、治理幕僚、平台管理）與車道指定審核單位例外。
//   - 四眼原則：只要在這個送審件存過任何一版，就不能核准或退回它（即使同時有審核角色）。
//   - 要幾位核准、能不能免審直接上線，照 content/governance/lanes.json（與 CI 同一份）：
//     自動上線車道（快車道、緊急發布）只有 allowedAuthors 名單內的人可用（名單可寫 team:<AD 群組>），其他人一律降為一般車道。
//   - 任何寫入前先過 validate-item.mjs（與建置同一套檢查）；路徑只由驗證過的 id 推出。
import crypto from 'node:crypto';
import { config } from '../../../site.config.mjs';
import { loadLanes, laneOfItem, authorAllowed, publishAtMs, taipeiDate, taipeiTime } from '../lanes.mjs';
import { DEMO_ACCOUNTS, CROSS_UNIT_ROLES } from '../../../src/client/admin/auth-rules.js';
import { normAccount } from './auth.mjs';
import { fieldDiff } from './field-diff.mjs';
import { assertContentPath } from './validate-item.mjs';
import { SERVICE_IDENTITY } from './git-local.mjs';

export const STATUS = { draft: '草稿', in_review: '審核中', returned: '退回', approved: '已核准', published: '已上線' };
export const REVIEW_LABEL = { in_review: '網站內容::審核中', returned: '網站內容::退回', approved: '網站內容::已核准' };

export class GatewayError extends Error {
  /** @param {number} status @param {string} code @param {string} message @param {any} [fields] */
  constructor(status, code, message, fields) { super(message); this.status = status; this.code = code; this.fields = fields; }
}

/** 示範用的人員名冊（正式環境改查 AD：CDC-WEB-<unit>-reviewer 等群組的成員與信箱） */
export function createDemoDirectory(accounts = DEMO_ACCOUNTS) {
  const people = accounts.map((a) => ({ account: normAccount(a.sub), name: a.name, email: `${normAccount(a.sub)}@cdc-prototype.invalid`, unit: a.unit, roles: a.roles }));
  return {
    /** 某些單位的審核人（排除指定帳號） */
    reviewersFor(units, exclude = []) {
      return people.filter((p) => units.includes(p.unit) && p.roles.some((r) => ['reviewer', 'chief-editor', 'governance'].includes(r)) && !exclude.includes(p.account));
    },
  };
}

/** 一個 mutex：所有寫入排隊執行（同一時間只有一個人在動 Git 與索引） */
function serial() {
  let chain = Promise.resolve();
  return (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
}

const stableJson = (item) => {
  const clean = {};
  for (const [k, v] of Object.entries(item)) if (!k.startsWith('__') && k !== 'sourceHash' && k !== 'gov') clean[k] = v;
  return `${JSON.stringify(clean, null, 2)}\n`;
};
const who = (p) => `${p.name} (AD: ${p.account})`;

/**
 * @param {{ git: any, validator: any, store: any, audit: any, notifier: any, directory?: any, lanesCfg?: any, unitNames?: Record<string,string>, now?: () => number, tier1Types?: string[] }} deps
 */
export function createWorkflow({ git, validator, store, audit, notifier, directory = createDemoDirectory(), lanesCfg = loadLanes(), unitNames = {}, now = () => Date.now(), tier1Types = config.tier1Types ?? ['disease', 'vaccine', 'clarification', 'situation'] }) {
  const queue = serial();
  let ready = null;
  const ensureReady = () => (ready ??= git.ensureReady().catch((e) => { ready = null; throw e; }));
  const iso = () => new Date(now()).toISOString();
  const unitName = (u) => unitNames[u] ?? u;

  /* ───────── 規則 ───────── */
  const isEditor = (p) => p.roles.includes('編輯');
  const isReviewer = (p) => p.roles.includes('審核') || p.roles.includes('管理');
  const inUnit = (p, unit) => p.units.includes(unit) || p.crossUnit;

  /** 這筆內容走哪條車道、要幾位核准、誰審（與 CI 的 laneForFiles 同一份設定） */
  function laneFor(item, p) {
    const reasons = [];
    let id = laneOfItem(item, lanesCfg);
    const want = lanesCfg.lanes[id];
    if (want?.autoMerge) {
      const gate = authorAllowed(p.account, want.allowedAuthors, { teams: p.groups });
      const urgentGate = item.urgent === true && id === 'emergency' && lanesCfg.rules?.urgentAllowedAuthors ? authorAllowed(p.account, lanesCfg.rules.urgentAllowedAuthors, { teams: p.groups }) : { allowed: true };
      if (gate.allowed && urgentGate.allowed) reasons.push(`${want.label}：送審人在授權名單內，檢查通過即上線`);
      else { reasons.push(`${want.label}只限授權名單內的同事；改走${lanesCfg.lanes.standard.label}，需要審核`); id = 'standard'; }
    }
    const l = lanesCfg.lanes[id];
    let reviewers = [...(l.reviewers ?? [])];
    if (id === 'standard' && tier1Types.includes(item.type) && l.tier1Reviewers) reviewers = [...new Set([...reviewers, ...l.tier1Reviewers])];
    return { id, label: l.label, autoMerge: !!l.autoMerge, requiredApprovals: l.autoMerge ? 0 : Math.max(1, l.requiredApprovals ?? 1), reviewers, reasons, postPublishReview: l.postPublishReviewHours ? { unit: l.postPublishReviewer ?? 'unit.pr', hours: l.postPublishReviewHours } : null };
  }

  /** 能不能審（退回或核准）這個送審件；不能就回原因（白話） */
  function reviewBlock(p, sub) {
    if (!isReviewer(p)) return '只有具「審核」或「管理」角色的同事可以審核';
    if (sub.editors.some((e) => e.account === p.account)) return '你編輯過這筆內容，依「四眼原則」不能自己審核，請另一位同事審核';
    const laneUnits = sub.lane?.reviewers ?? [];
    if (!inUnit(p, sub.owner) && !p.units.some((u) => laneUnits.includes(u))) return '這筆內容不屬於你的單位，也不在你負責審核的範圍';
    if (sub.approvals.some((a) => a.account === p.account)) return '你已經核准過這一版';
    return null;
  }
  function editBlock(p, owner) {
    if (!isEditor(p)) return '只有具「編輯」角色的同事可以存草稿或送審';
    if (!inUnit(p, owner)) return `這筆內容的權責單位是「${unitName(owner)}」，不是你的單位`;
    return null;
  }

  /* ───────── 對外呈現（不含任何 Git 字眼） ───────── */
  function effectiveStatus(sub) {
    if (sub.status === 'approved' && sub.publishAt && (publishAtMs(sub.publishAt) ?? 0) <= now()) return 'published';
    return sub.status;
  }
  function view(sub, p) {
    const st = effectiveStatus(sub);
    const rb = p ? reviewBlock(p, sub) : null;
    const eb = p ? editBlock(p, sub.owner) : null;
    return {
      id: sub.id, contentId: sub.contentId, type: sub.type, title: sub.title, owner: sub.owner, ownerName: unitName(sub.owner), isNew: sub.isNew,
      status: st, statusLabel: STATUS[st], createdAt: sub.createdAt, updatedAt: sub.updatedAt, submittedAt: sub.submittedAt ?? null,
      editors: sub.editors.map(({ account, name }) => ({ account, name })), approvals: sub.approvals.map(({ account, name, at }) => ({ account, name, at })),
      requiredApprovals: sub.lane?.requiredApprovals ?? 1, laneLabel: sub.lane?.label ?? null, laneNotes: sub.lane?.reasons ?? [],
      comments: sub.comments, history: sub.history, publishAt: sub.publishAt ?? null, scheduledFor: sub.publishAt ? taipeiTime(publishAtMs(sub.publishAt) ?? 0) : null,
      ...(p ? {
        can: {
          edit: !eb && ['draft', 'returned'].includes(st), submit: !eb && ['draft', 'returned'].includes(st),
          approve: !rb && st === 'in_review', return: !rb && st === 'in_review',
        },
        why: { edit: eb, review: st === 'in_review' ? rb : '目前不在審核中' },
      } : {}),
    };
  }

  /* ───────── Git 輔助 ───────── */
  function message(action, sub, p, extra = []) {
    const lines = [`${action}：${sub.title}`, '', `內容：${sub.contentId}（${sub.path}）`, `送審件：${sub.id}`, '',
      ...sub.editors.map((e) => `Edited-by: ${who(e)}`), ...extra, `Content-Owner: ${sub.owner}`, `Gateway-Submission: ${sub.id}`, `Gateway-Actor: ${who(p)}`, `Gateway-Auth: ${p.authMode}`];
    return `${lines.join('\n')}\n`;
  }
  const branchOf = (contentId, sid) => `cms/${contentId.replace(/[^a-z0-9-]/g, '-')}-${sid.slice(-6)}`;
  const openFor = (contentId) => store.all().find((s) => s.contentId === contentId && ['draft', 'returned', 'in_review'].includes(s.status));

  function validated(item, status) {
    const copy = { ...item, status };
    const v = validator.validate(copy);
    if (!v.ok) throw new GatewayError(422, 'invalid', `內容有 ${v.errors.length} 個地方需要修正，還沒有存進系統`, v.errors);
    return { item: copy, path: assertContentPath(v.path) };
  }
  function addEditor(sub, p) { if (!sub.editors.some((e) => e.account === p.account)) sub.editors.push({ account: p.account, name: p.name, email: p.email ?? null }); }

  /** 存一版到分支（儲存草稿與送審共用） */
  async function writeVersion(p, item, sid, status, action) {
    const checkedEdit = editBlock(p, item?.owner);
    if (checkedEdit) throw new GatewayError(403, 'forbidden', checkedEdit);
    const { item: clean, path } = validated(item, status);
    let sub = sid ? store.get(sid) : openFor(clean.id);
    if (sid && !sub) throw new GatewayError(404, 'notfound', '找不到這筆送審件');
    if (sub && sub.contentId !== clean.id) throw new GatewayError(409, 'mismatch', '這筆送審件是另一筆內容的，不能拿來存這份內容（內容 ID 不同）');
    if (sub && sub.status === 'in_review') throw new GatewayError(409, 'in_review', '這筆內容正在審核中，審核結束前不能修改；需要修改請請審核人先退回');
    if (sub && !['draft', 'returned'].includes(sub.status)) sub = null; // 已上線的舊送審件不再沿用，開一個新的
    if (sub && sub.owner !== clean.owner) { const e2 = editBlock(p, sub.owner); if (e2) throw new GatewayError(403, 'forbidden', e2); }
    if (!sub) {
      const other = openFor(clean.id);
      if (other) throw new GatewayError(409, 'busy', `這筆內容已有一個進行中的送審件（${STATUS[other.status]}），請從那一件繼續`);
      const id = `gw-${taipeiDate(now()).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
      const onMain = await git.readFile(git.targetBranch, path);
      sub = { id, contentId: clean.id, type: clean.type, title: clean.title, path, owner: clean.owner, branch: branchOf(clean.id, id), reviewId: null, status: 'draft', isNew: onMain == null, editors: [], approvals: [], comments: [], history: [], createdAt: iso(), updatedAt: iso(), createdBy: p.account, lane: null };
      await git.createBranch(sub.branch, git.targetBranch);
    }
    addEditor(sub, p);
    Object.assign(sub, { title: clean.title, owner: clean.owner, type: clean.type, publishAt: clean.publishAt ?? null, lane: laneFor(clean, p), updatedAt: iso() });
    const r = await git.commit({ branch: sub.branch, files: [{ path, content: stableJson(clean) }], message: message(action, sub, p), author: SERVICE_IDENTITY });
    return { sub, item: clean, commit: r.sha, unchanged: !!r.unchanged };
  }

  /* ───────── 動作 ───────── */
  async function saveDraft(p, { item, submissionId }) {
    await ensureReady();
    return queue(async () => {
      try {
        const { sub, commit, unchanged } = await writeVersion(p, item, submissionId, 'draft', '儲存草稿');
        sub.status = 'draft';
        sub.history.push({ at: iso(), action: 'save', label: '儲存草稿', account: p.account, name: p.name });
        store.put(sub);
        audit.write('save-draft', { actor: p, detail: { submission: sub.id, contentId: sub.contentId, path: sub.path, branch: sub.branch, commit, unchanged } });
        return view(sub, p);
      } catch (e) { auditFail('save-draft', p, e, { contentId: item?.id }); throw e; }
    });
  }

  async function submit(p, { item, submissionId }, ctx = {}) {
    await ensureReady();
    return queue(async () => {
      try {
        let sub, commit;
        if (item) ({ sub, commit } = await writeVersion(p, item, submissionId, 'review', '送審'));
        else {
          sub = store.get(submissionId);
          if (!sub) throw new GatewayError(404, 'notfound', '找不到這筆送審件');
          const eb = editBlock(p, sub.owner); if (eb) throw new GatewayError(403, 'forbidden', eb);
          if (!['draft', 'returned'].includes(sub.status)) throw new GatewayError(409, 'state', `目前狀態是「${STATUS[sub.status]}」，不能送審`);
          const cur = JSON.parse(await git.readFile(sub.branch, sub.path) ?? 'null');
          ({ sub, commit } = await writeVersion(p, cur, sub.id, 'review', '送審'));
        }
        sub.status = 'in_review'; sub.submittedAt = iso(); sub.approvals = [];
        const rv = await git.openReview({ branch: sub.branch, title: `送審：${sub.title}`, description: reviewDescription(sub), labels: [REVIEW_LABEL.in_review] });
        sub.reviewId = rv.id;
        sub.history.push({ at: iso(), action: 'submit', label: '送審', account: p.account, name: p.name });
        audit.write('submit', { actor: p, detail: { submission: sub.id, contentId: sub.contentId, path: sub.path, branch: sub.branch, commit, review: rv.id, lane: sub.lane.id } });
        if (sub.lane.autoMerge) {
          // 自動上線車道（送審人在授權名單）：CI 就是審核者，直接上線；上線後由指定單位複核
          await publish(sub, p, [], ctx);
          const pr = sub.lane.postPublishReview;
          if (pr) notifier.send('post-publish', { to: directory.reviewersFor([pr.unit], [p.account]), title: sub.title, unitName: unitName(sub.owner), editorName: p.name, hours: pr.hours, link: link(ctx, 'review', sub.id) });
        } else {
          notifier.send('submitted', { to: directory.reviewersFor([sub.owner, ...sub.lane.reviewers], sub.editors.map((e) => e.account)), title: sub.title, unitName: unitName(sub.owner), editorName: p.name, link: link(ctx, 'review', sub.id) });
        }
        store.put(sub);
        return view(sub, p);
      } catch (e) { auditFail('submit', p, e, { submission: submissionId, contentId: item?.id }); throw e; }
    });
  }

  async function returnForChanges(p, { submissionId, comment }, ctx = {}) {
    await ensureReady();
    return queue(async () => {
      try {
        const sub = mustReview(p, submissionId);
        const text = String(comment ?? '').trim();
        if (!text) throw new GatewayError(422, 'comment', '請寫下退回原因，承辦人才知道要改什麼', [{ field: 'comment', label: '退回原因', message: '請寫下退回原因，承辦人才知道要改什麼' }]);
        if (text.length > 2000) throw new GatewayError(422, 'comment', '退回原因最多 2000 字', [{ field: 'comment', label: '退回原因', message: '退回原因最多 2000 字' }]);
        await git.comment(sub.reviewId, `退回修改（${who(p)}）：\n\n${text}`);
        await git.setLabels(sub.reviewId, [REVIEW_LABEL.returned]);
        sub.status = 'returned'; sub.approvals = []; sub.updatedAt = iso();
        sub.comments.push({ at: iso(), kind: 'return', account: p.account, name: p.name, text });
        sub.history.push({ at: iso(), action: 'return', label: '退回修改', account: p.account, name: p.name });
        store.put(sub);
        audit.write('return', { actor: p, detail: { submission: sub.id, contentId: sub.contentId, review: sub.reviewId, commentChars: text.length } });
        notifier.send('returned', { to: sub.editors, title: sub.title, unitName: unitName(sub.owner), actorName: p.name, comment: text, link: link(ctx, 'publish', sub.id) });
        return view(sub, p);
      } catch (e) { auditFail('return', p, e, { submission: submissionId }); throw e; }
    });
  }

  async function approve(p, { submissionId, comment }, ctx = {}) {
    await ensureReady();
    return queue(async () => {
      try {
        const sub = mustReview(p, submissionId);
        const text = String(comment ?? '').trim().slice(0, 2000);
        sub.approvals.push({ account: p.account, name: p.name, email: p.email ?? null, at: iso() });
        await git.approve(sub.reviewId, p.account);
        await git.comment(sub.reviewId, `核准（${who(p)}）${text ? `：\n\n${text}` : ''}`);
        if (text) sub.comments.push({ at: iso(), kind: 'approve', account: p.account, name: p.name, text });
        sub.history.push({ at: iso(), action: 'approve', label: '核准', account: p.account, name: p.name });
        audit.write('approve', { actor: p, detail: { submission: sub.id, contentId: sub.contentId, review: sub.reviewId, approvals: sub.approvals.length, required: sub.lane.requiredApprovals } });
        if (sub.approvals.length >= sub.lane.requiredApprovals) await publish(sub, p, sub.approvals, ctx);
        else {
          sub.updatedAt = iso();
          notifier.send('partial', { to: sub.editors, title: sub.title, actorName: p.name, approvals: sub.approvals.length, required: sub.lane.requiredApprovals, link: link(ctx, 'publish', sub.id) });
        }
        store.put(sub);
        return view(sub, p);
      } catch (e) { auditFail('approve', p, e, { submission: submissionId }); throw e; }
    });
  }

  /** 最後一步：提交上線版（status: published）並合併到 main */
  async function publish(sub, p, approvals, ctx) {
    const cur = JSON.parse(await git.readFile(sub.branch, sub.path) ?? 'null');
    if (!cur) throw new GatewayError(409, 'missing', '找不到送審的內容');
    const today = taipeiDate(now());
    const final = { ...cur, status: 'published', reviewedAt: today, ...(sub.isNew ? { publishedAt: today } : {}) };
    const { path } = validated(final, 'published');
    const trailers = approvals.map((a) => `Approved-by: ${who(a)}`);
    if (!approvals.length) trailers.push(`Approved-by: 自動（${sub.lane.label}，送審人在授權名單）`);
    trailers.push(`Lane: ${sub.lane.id}`);
    const c = await git.commit({ branch: sub.branch, files: [{ path, content: stableJson(final) }], message: message('核准上線', sub, p, trailers), author: SERVICE_IDENTITY });
    let merged;
    try { merged = await git.merge(sub.reviewId, { message: message('上線', sub, p, trailers), author: SERVICE_IDENTITY }); } catch (e) {
      if (e?.code === 'conflict') throw new GatewayError(409, 'conflict', '這筆內容在審核期間已被其他人更新上線，無法直接上線。請承辦人重新開啟最新版、修改後再送審。');
      throw e;
    }
    const scheduled = final.publishAt && (publishAtMs(final.publishAt) ?? 0) > now();
    sub.status = scheduled ? 'approved' : 'published';
    sub.publishedAt = iso(); sub.updatedAt = iso();
    sub.history.push({ at: iso(), action: 'publish', label: scheduled ? `已核准，排程 ${taipeiTime(publishAtMs(final.publishAt) ?? 0)} 上線` : '已上線', account: p.account, name: p.name });
    audit.write('publish', { actor: p, detail: { submission: sub.id, contentId: sub.contentId, path, commit: c.sha, merge: merged.sha, approvedBy: approvals.map((a) => a.account), lane: sub.lane.id } });
    notifier.send('approved', { to: sub.editors, title: sub.title, unitName: unitName(sub.owner), actorName: approvals.length ? p.name : '系統（快速上線）', scheduled: scheduled ? taipeiTime(publishAtMs(final.publishAt) ?? 0) : null, link: link(ctx, 'publish', sub.id) });
  }

  function mustReview(p, sid) {
    const sub = store.get(sid);
    if (!sub) throw new GatewayError(404, 'notfound', '找不到這筆送審件');
    if (sub.status !== 'in_review') throw new GatewayError(409, 'state', `目前狀態是「${STATUS[effectiveStatus(sub)]}」，不在審核中`);
    const rb = reviewBlock(p, sub);
    if (rb) throw new GatewayError(403, 'forbidden', rb);
    return sub;
  }
  function auditFail(action, p, e, detail) {
    if (e instanceof GatewayError) audit.write(action, { actor: p, result: e.status === 422 ? 'rejected' : 'denied', detail: { ...detail, reason: e.code, fields: e.fields?.map((f) => f.field) } });
    else audit.write(action, { actor: p, result: 'error', detail: { ...detail, reason: String(e?.message ?? e).slice(0, 200) } });
  }
  const reviewDescription = (sub) => [`權責單位：${unitName(sub.owner)}`, `承辦：${sub.editors.map((e) => e.name).join('、')}`, `車道：${sub.lane.label}（需 ${sub.lane.requiredApprovals} 位核准）`, ...sub.lane.reasons, '', '本合併請求由網站內容管理系統（寫入閘道）代為建立；請在後台「複核區」審核，不要直接在 GitLab 合併。'].join('\n');
  const link = (ctx, page, sid) => `${ctx.origin ?? ''}${ctx.basePath ?? config.basePath}/admin/${page}/?${page === 'review' ? 'item' : 'gw'}=${encodeURIComponent(sid)}`;

  /* ───────── 查詢 ───────── */
  /**
   * @param {any} p
   * @param {{ view?: string, contentId?: string }} [o]
   */
  function list(p, { view: v = 'mine', contentId } = {}) {
    let subs = store.all();
    if (contentId) subs = subs.filter((s) => s.contentId === contentId);
    if (v === 'queue') subs = subs.filter((s) => s.status === 'in_review' && isReviewer(p) && (inUnit(p, s.owner) || p.units.some((u) => (s.lane?.reviewers ?? []).includes(u))));
    else if (v === 'mine') subs = subs.filter((s) => s.editors.some((e) => e.account === p.account) || (contentId && inUnit(p, s.owner)));
    else if (v === 'all') subs = subs.filter((s) => inUnit(p, s.owner) || (isReviewer(p) && p.units.some((u) => (s.lane?.reviewers ?? []).includes(u))));
    return subs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map((s) => view(s, p));
  }
  /** 看得到：自己單位的、自己負責審核單位的；跨單位角色看全部 */
  function canSee(p, sub) { return inUnit(p, sub.owner) || p.units.some((u) => (sub.lane?.reviewers ?? []).includes(u)) || p.adminRoles.some((r) => CROSS_UNIT_ROLES.includes(r)); }
  function getVisible(p, sid) {
    const sub = store.get(sid);
    if (!sub || !canSee(p, sub)) throw new GatewayError(404, 'notfound', '找不到這筆送審件');
    return sub;
  }
  const detail = (p, sid) => view(getVisible(p, sid), p);
  async function content(p, sid) {
    const sub = getVisible(p, sid);
    await ensureReady();
    const ref = (await git.branchExists(sub.branch)) ? sub.branch : git.targetBranch;
    const raw = await git.readFile(ref, sub.path);
    return raw ? JSON.parse(raw) : null;
  }
  async function diff(p, sid) {
    const sub = getVisible(p, sid);
    await ensureReady();
    if (!(await git.branchExists(sub.branch))) return { isNew: sub.isNew, changes: [], note: sub.status === 'published' || sub.status === 'approved' ? '這筆內容已經上線，沒有待審的修改' : '沒有內容' };
    const before = await git.readFile(git.targetBranch, sub.path);
    const after = await git.readFile(sub.branch, sub.path);
    return fieldDiff(before ? JSON.parse(before) : null, after ? JSON.parse(after) : null, { unitNames });
  }

  return { saveDraft, submit, returnForChanges, approve, list, detail, content, diff, laneFor, reviewBlock, ensureReady, STATUS };
}
