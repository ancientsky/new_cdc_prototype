// @ts-check
// 寫入閘道的工作流程（第三十輪）：把同事的動作翻成 Git 動作，並守住規則。
//
//   同事按的鈕        閘道做的事（同事看不到這一欄）
//   儲存草稿          驗證 → 建立／更新分支 cms/<id>-<送審件>，提交（服務帳號；Edited-by: 承辦人）
//   送審              驗證 → 提交（status: review）→ 開合併請求、標籤「審核中」→ 通知審核人
//   退回修改（必填意見）  合併請求留言、標籤改「退回」→ 通知承辦人；已收的核准歸零（改過的內容要重審）
//   核准上線          四眼原則檢查 → 記一筆核准；核准數達車道要求 → 提交（status: published、Approved-by:）→ 合併到 main → 通知承辦人
//   送出重新審閱（第五十輪）  內容不改：把 main 上的現行版原樣放進送審件 → 之後與送審完全相同（車道、四眼、通知）；
//                     核准時只把 reviewedAt 改成核准當天（上線那一步本來就這樣做），稽核與提交訊息標明「重新審閱」
//
// 同時修改（第五十二輪，docs/deploy.md §23）：
//   - 一筆內容同一時間只有一個進行中的送審件（草稿／退回／審核中）；當成別件「配套內容」的也算。
//   - 存檔與送審要帶「開啟時的版本碼」（baseHash，src/client/admin/content-version.js）：
//     新送審件比 main 上的檔，既有送審件比它自己的分支；不同 ⇒ 409 stale，不寫入，回白話說明（誰、何時、改了哪些欄位）。
//   - 送審件開始之後 main 上的同一檔又變了（例如譯者、資訊室直接更新）⇒ 不能核准（409 outdated）；
//     承辦人重新開啟時閘道以欄位為單位三方合併（開始時的版本／送審件／main 現況），存檔時從 main 另開新分支寫入合併結果。
//   - 沒帶 baseHash（舊版頁面、其他編輯頁）照舊接受，稽核記 baseHash: missing。
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
import { assertContentPath, contentPathOf } from './validate-item.mjs';
import { SERVICE_IDENTITY } from './git-local.mjs';
import { contentVersion, versionOfText, NEW_VERSION } from '../../../src/client/admin/content-version.js';
import { canon } from '../../../src/client/admin/preprocess.js';
import { fieldLabel } from '../../../src/client/admin/field-labels.js';
import { sourceHashOf } from '../load.mjs';

export const STATUS = { draft: '草稿', in_review: '審核中', returned: '退回', approved: '已核准', published: '已上線' };
/** 送審件的種類（第五十輪）：一般修改／新內容（edit）與重新審閱（rereview：到期內容由權責單位確認仍正確，核准後更新最後審閱日） */
export const KIND_LABEL = { edit: '修改或新增內容', rereview: '重新審閱' };
export const REVIEW_LABEL = { in_review: '網站內容::審核中', returned: '網站內容::退回', approved: '網站內容::已核准' };

export class GatewayError extends Error {
  /** @param {number} status @param {string} code @param {string} message @param {any} [fields] @param {Record<string, any>} [extra] 回應本體多帶的資料（例：409 stale 的 { stale: {...} }） */
  constructor(status, code, message, fields, extra) { super(message); this.status = status; this.code = code; this.fields = fields; this.extra = extra; }
}

/** 進行中的送審件狀態：同一筆內容同時只能有一件 */
const OPEN = ['draft', 'returned', 'in_review'];
/** 三方合併時不比的欄位：存檔本來就會改（以送審件的為準） */
const DERIVED = new Set(['status', 'reviewedAt']);
const same = (a, b) => canon(a) === canon(b);
/** 給同事看的「你的版本」：字串原樣、其他轉 JSON；太長截斷 */
const showValue = (v) => { if (v == null) return '（空白）'; const t = typeof v === 'string' ? v : JSON.stringify(v, null, 1); return t.length > 1200 ? `${t.slice(0, 1200)}…` : t; };

/**
 * 欄位層級的三方合併（第五十二輪）：start＝送審件開始時 main 上的版本、mine＝送審件、theirs＝main 現況。
 * 只有一方改的欄位用那一方；兩方改成一樣也行；兩方改得不一樣 ⇒ 衝突，先用 main 的（不悄悄蓋掉已上線的更新），把送審件的值交給同事自己重新套用。
 * 鍵的順序跟 main 現況一樣，送審件新加的欄位接在後面；狀態、最後審閱日用送審件的。
 * @param {any} start @param {any} mine @param {any} theirs
 */
export function mergeFields(start, mine, theirs) {
  if (!theirs) return { item: mine, conflicts: [], changed: [] };
  const s = start ?? {}, m = mine ?? {};
  const out = {}, conflicts = [], changed = [];
  for (const k of [...Object.keys(theirs), ...Object.keys(m).filter((x) => !(x in theirs))]) {
    if (DERIVED.has(k)) { const v = m[k] !== undefined ? m[k] : theirs[k]; if (v !== undefined) out[k] = v; continue; }
    const sv = s[k], mv = m[k], tv = theirs[k];
    if (!same(sv, tv)) changed.push(k);
    let v;
    if (same(mv, sv)) v = tv;
    else if (same(tv, sv) || same(mv, tv)) v = mv;
    else { v = tv; conflicts.push({ field: k, label: fieldLabel(k), yours: showValue(mv) }); }
    if (v !== undefined) out[k] = v;
  }
  return { item: out, conflicts, changed };
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
      files: sub.files ?? [], companions: (sub.companions ?? []).map(({ id, title }) => ({ id, title })),
      kind: sub.kind ?? 'edit', kindLabel: KIND_LABEL[sub.kind ?? 'edit'], reReviewNote: sub.reReviewNote ?? null, reviewedAt: sub.reviewedAt ?? null,
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
  /** 這筆內容進行中的送審件（exceptSid：不算這一件） */
  const openFor = (contentId, exceptSid) => store.all().find((s) => s.id !== exceptSid && s.contentId === contentId && OPEN.includes(s.status));
  /** 把這筆內容當「配套內容」帶著的進行中送審件（第五十二輪：配套內容也算「進行中」，不能同時在別處當主內容改） */
  const holderOf = (contentId, exceptSid) => store.all().find((s) => s.id !== exceptSid && OPEN.includes(s.status) && (s.companions ?? []).some((c) => c.id === contentId));
  const readJson = async (ref, p) => { const raw = await git.readFile(ref, p); if (raw == null) return null; try { return JSON.parse(raw); } catch { return null; } };
  const versionAt = async (ref, p) => versionOfText(await git.readFile(ref, p));
  /** 改了哪些欄位（白話名稱；最後審閱日每次存檔都會變，不列） */
  const fieldsOf = (before, after) => [...new Set(fieldDiff(before, after, { unitNames }).changes.filter((c) => c.field !== 'reviewedAt').map((c) => fieldLabel(c.field)))];
  const fmtAt = (at) => taipeiTime(Date.parse(at) || now());
  const namesOf = (list) => [...new Set(list.map((x) => x.name).filter(Boolean))].join('、');

  /** 送審件開始之後 main 上的同一檔有沒有變（舊送審件沒記開始版本 ⇒ 不知道，當作沒變） */
  async function mainMoved(sub) {
    if (!sub?.base) return null;
    const version = await versionAt(git.targetBranch, sub.path);
    return version === sub.base.version ? null : { version };
  }
  /**
   * main 上這筆內容在 version 之後由閘道核准上線的紀錄（誰改、誰核准、何時、改了哪些欄位）。
   * 從閘道自己的上線紀錄找；version 對不上任何一筆（例如資訊室直接改檔）⇒ 空清單，畫面只說「已更新」。
   */
  function publishedSince(contentId, version, exceptSid) {
    const done = store.all().filter((s) => s.id !== exceptSid && s.contentId === contentId && s.published).sort((a, b) => String(a.published.at).localeCompare(String(b.published.at)));
    let from = -1;
    for (let i = done.length - 1; i >= 0; i--) {
      if (done[i].published.after === version) { from = i + 1; break; }
      if (done[i].published.before === version) { from = i; break; }
    }
    return (from < 0 ? [] : done.slice(from)).map((s) => ({ submissionId: s.id, name: namesOf(s.editors), approvedBy: namesOf(s.approvals ?? []), at: s.published.at, atText: fmtAt(s.published.at), label: s.kind === 'rereview' ? '重新審閱' : '核准上線', fields: s.published.fields ?? [] }));
  }
  /** 同一個送審件裡，version 之後又存過的版本（誰、何時）與改了哪些欄位 */
  async function savedSince(sub, version) {
    const vs = sub.versions ?? [];
    const key = String(version ?? '').split('+')[0];
    let i = -1; for (let j = vs.length - 1; j >= 0; j--) if (vs[j].version === key) { i = j; break; }
    let before;
    if (i >= 0) before = await readJson(vs[i].commit, sub.path);
    else if (sub.base && sub.base.version === key) before = sub.base.commit ? await readJson(sub.base.commit, sub.path) : null;
    const known = i >= 0 || (sub.base && sub.base.version === key);
    const after = await readJson(sub.branch, sub.path);
    const later = known ? vs.slice(i + 1) : vs.slice(-1);
    return { by: later.map((v) => ({ name: v.name, at: v.at, atText: fmtAt(v.at), label: v.label ?? '儲存' })), fields: known ? fieldsOf(before ?? null, after) : [], fromSite: i < 0 && !!known };
  }
  /** 「林○慧修改、張○玲核准，2026-10-14 10:30 上線」「王○安在 2026-10-14 10:35 存了一版」 */
  const describeBy = (by) => by.map((b) => (b.label === '核准上線' || b.label === '重新審閱'
    ? `${b.name || '同事'}${b.label === '重新審閱' ? '送出重新審閱' : '修改'}${b.approvedBy ? `、${b.approvedBy}核准` : ''}，${b.atText} ${b.label === '重新審閱' ? '核准' : '上線'}`
    : `${b.name || '同事'}在 ${b.atText} 存了一版`)).join('；');
  const fieldText = (fields) => (fields.length ? `改了：${fields.slice(0, 12).join('、')}${fields.length > 12 ? ` 等 ${fields.length} 個欄位` : ''}` : '');

  /**
   * 送審件目前的內容與版本碼（第五十二輪）。送審件開始之後 main 又變了 ⇒ 內容是三方合併的結果，版本碼是「分支版本＋main 版本」，
   * 承辦人拿這一版改、存檔時帶這個碼，閘道就知道他已經看過 main 的更新，從 main 另開新分支寫入。
   */
  async function draftState(sub) {
    const branchItem = await readJson(sub.branch, sub.path);
    const branchVersion = contentVersion(branchItem);
    const moved = OPEN.includes(sub.status) ? await mainMoved(sub) : null;
    if (!moved) return { item: branchItem, token: branchVersion, branchVersion, moved: null };
    const start = sub.base.commit ? await readJson(sub.base.commit, sub.path) : null;
    const mainItem = await readJson(git.targetBranch, sub.path);
    const m = mergeFields(start, branchItem, mainItem);
    const by = publishedSince(sub.contentId, sub.base.version, sub.id);
    return { item: m.item, token: `${branchVersion}+${moved.version}`, branchVersion, moved, update: { fields: m.changed.map(fieldLabel), conflicts: m.conflicts, by, text: `這個送審件開始之後，網站上的版本已經更新${by.length ? `（${describeBy(by)}）` : ''}${m.changed.length ? `，${fieldText(m.changed.map(fieldLabel))}` : ''}。` } };
  }

  /** 版本不符 ⇒ 409（白話；不出現 Git 用語）。kind：site（網站上的版本更新了）／exists（網站上已有同 ID）／draft（同一件裡別人又存了）／open（已有進行中的送審件）／moved（送審件開始後網站版本更新了） */
  function staleError(kind, text, info) {
    const tail = kind === 'exists' ? '' : '為了不蓋掉別人的修改，這一版還沒有存。請按「載入最新版」：你在這頁的修改會保留並重新套用，確認後再存。';
    return new GatewayError(409, kind === 'exists' ? 'exists' : 'stale', `${text}${tail}`, undefined, { stale: { kind, ...info } });
  }
  /** 存檔前的版本檢查：baseHash 是同事開啟時的版本碼；對不上就丟 staleError */
  async function checkVersion(sub, path, baseHash, contentId) {
    if (!sub) {
      const cur = await versionAt(git.targetBranch, path);
      if (baseHash === cur) return;
      if (baseHash === NEW_VERSION) {
        const it = await readJson(git.targetBranch, path);
        throw staleError('exists', `網站上已經有這個內容 ID（${contentId}）的內容「${it?.title ?? contentId}」。要修改它，請從那一頁的「修改這頁」進來；如果是新內容，請換一個內容 ID。`, { contentId, contentHash: cur });
      }
      const by = publishedSince(contentId, baseHash);
      const fields = [...new Set(by.flatMap((b) => b.fields))];
      throw staleError('site', `這頁在你開啟之後，網站上的版本已經更新${by.length ? `（${describeBy(by)}）` : ''}${fields.length ? `，${fieldText(fields)}` : ''}。`, { contentId, contentHash: cur, by, fields });
    }
    const st = await draftState(sub);
    if (baseHash === st.token) return st;
    const info = { contentId: sub.contentId, submissionId: sub.id, title: sub.title, status: sub.status, statusLabel: STATUS[sub.status], editors: sub.editors.map((e) => e.name), contentHash: st.token };
    if (st.moved && baseHash === st.branchVersion) throw staleError('moved', st.update.text, { ...info, by: st.update.by, fields: st.update.fields });
    const since = await savedSince(sub, baseHash);
    if (since.fromSite) throw staleError('open', `這筆內容已經有一個進行中的送審件（${STATUS[sub.status]}，承辦：${namesOf(sub.editors)}）${since.fields.length ? `，裡面已經${fieldText(since.fields)}` : ''}。你開啟的是網站上的版本，不含這些修改。`, { ...info, by: since.by, fields: since.fields });
    throw staleError('draft', `這個送審件在你開啟之後又有人存過${since.by.length ? `（${describeBy(since.by)}）` : ''}${since.fields.length ? `，${fieldText(since.fields)}` : ''}。`, { ...info, by: since.by, fields: since.fields });
  }

  function validated(item, status, { extra = [], files = null } = {}) {
    const copy = { ...item, status };
    const v = validator.validate(copy, { extra, files });
    if (!v.ok) throw new GatewayError(422, 'invalid', `內容有 ${v.errors.length} 個地方需要修正，還沒有存進系統`, v.errors);
    return { item: copy, path: assertContentPath(v.path) };
  }
  /**
   * 配套內容（第四十五輪）：各自也要通過檢查；回傳 [{ item, path }]。配套內容不能跟主內容同 id，也不能是已上線且正在別的送審件裡的內容。
   * 第五十二輪：配套內容只能「新增」或「與網站上相同」（網站上已有、內容又不同 ⇒ 409，不蓋掉已上線的版本）；
   * 別的進行中送審件也帶著同一筆配套內容時（例：同一期的兩篇文章），兩邊內容要相同。
   */
  async function validatedCompanions(main, companions, selfSid) {
    const out = [];
    for (const c of companions ?? []) {
      if (!c || typeof c !== 'object') continue;
      const name = c.title ?? c.id;
      if (c.id === main.id) throw new GatewayError(422, 'invalid', '配套內容不能與主內容同一個 ID', [{ field: 'id', label: '內容 ID', message: '配套內容不能與主內容同一個 ID' }]);
      const other = openFor(c.id, selfSid);
      if (other) throw new GatewayError(409, 'busy', `配套內容「${name}」已有一個進行中的送審件（${STATUS[other.status]}）`);
      const v = validator.validate({ ...c, status: c.status ?? 'published' }, { extra: [main, ...(companions ?? []).filter((x) => x !== c)] });
      if (!v.ok) throw new GatewayError(422, 'invalid', `配套內容「${name}」有 ${v.errors.length} 個地方需要修正`, v.errors.map((e) => ({ ...e, message: `配套內容「${name}」：${e.message}` })));
      const item = { ...c, status: c.status ?? 'published' }, cpath = assertContentPath(v.path);
      const mine = contentVersion(item);
      const onMain = await versionAt(git.targetBranch, cpath);
      if (onMain !== NEW_VERSION && onMain !== mine) throw new GatewayError(409, 'stale', `配套內容「${name}」網站上已經有了，內容和你送的不同（可能是同事先送的那一篇已經上線）。為了不蓋掉網站上的版本，這一版還沒有存；請重新整理頁面，改選網站上已有的那一個。`, undefined, { stale: { kind: 'companion', contentId: c.id } });
      const holder = holderOf(c.id, selfSid);
      const theirs = holder ? await versionAt(holder.branch, cpath) : NEW_VERSION;
      if (theirs !== NEW_VERSION && theirs !== mine) throw new GatewayError(409, 'busy', `配套內容「${name}」也在另一個進行中的送審件「${holder.title}」裡（${STATUS[holder.status]}，承辦：${namesOf(holder.editors)}），兩邊的內容不同。請先跟對方確認一致（例如卷期的出刊日）再送。`);
      out.push({ item, path: cpath });
    }
    return out;
  }
  /** 送審件分支上已有的附件（之前存過草稿）：{ name: Buffer }；再存一版時沒重傳的附件仍要一起檢查 */
  async function branchFiles(sub) {
    const out = {};
    for (const name of sub?.files ?? []) { const buf = await git.readFile(sub.branch, `content/assets/${sub.contentId}/${name}`, { raw: true }); if (buf) out[name] = Buffer.from(buf); }
    return out;
  }
  function addEditor(sub, p) { if (!sub.editors.some((e) => e.account === p.account)) sub.editors.push({ account: p.account, name: p.name, email: p.email ?? null }); }

  /**
   * 存一版到分支（儲存草稿與送審共用）。
   * baseHash（第五十二輪）：同事開啟時的版本碼；undefined ＝ 舊版頁面沒送（照舊接受，回傳 legacy: true 給稽核）。
   * internal：閘道自己讀出來再寫回的（送審不改內容、重新審閱），不需要版本碼。
   */
  async function writeVersion(p, item, sid, status, action, { files = null, companions = [], baseHash = undefined, internal = false } = {}) {
    const checkedEdit = editBlock(p, item?.owner);
    if (checkedEdit) throw new GatewayError(403, 'forbidden', checkedEdit);
    const prior = sid ? store.get(sid) : (item?.id ? openFor(item.id) : null);
    let sub = prior;
    if (sid && !sub) throw new GatewayError(404, 'notfound', '找不到這筆送審件');
    if (sub && sub.contentId !== item?.id) throw new GatewayError(409, 'mismatch', '這筆送審件是另一筆內容的，不能拿來存這份內容（內容 ID 不同）');
    if (sub && sub.status === 'in_review') throw new GatewayError(409, 'in_review', '這筆內容正在審核中，審核結束前不能修改；需要修改請請審核人先退回');
    if (sub && !['draft', 'returned'].includes(sub.status)) sub = null; // 已上線的舊送審件不再沿用，開一個新的
    if (sub && sub.owner !== item.owner) { const e2 = editBlock(p, sub.owner); if (e2) throw new GatewayError(403, 'forbidden', e2); }
    if (!sub && item?.id) {
      const other = openFor(item.id);
      if (other) throw new GatewayError(409, 'busy', `這筆內容已有一個進行中的送審件（${STATUS[other.status]}，承辦：${namesOf(other.editors)}），請從那一件繼續`, undefined, { open: { submissionId: other.id, status: other.status } });
      const holder = holderOf(item.id);
      if (holder) throw new GatewayError(409, 'busy', `這筆內容是另一個進行中送審件「${holder.title}」的配套內容（${STATUS[holder.status]}，承辦：${namesOf(holder.editors)}）；那一件結束前不能另外修改`, undefined, { open: { submissionId: holder.id, status: holder.status } });
    }
    // 第五十二輪：版本檢查放在內容檢查之前——版本不對時，先修欄位也是白費
    const where = contentPathOf(item ?? {});
    let state = null;
    if (where.ok !== false && baseHash !== undefined) state = await checkVersion(sub, sub ? sub.path : where.path, baseHash, item.id);
    // 送審件開始後 main 變了、而同事帶的是合併後的版本碼 ⇒ 從 main 另開新分支，寫入他這一版（他已經看過 main 的更新）
    const rebase = !!(sub && state?.moved);
    // 附件：這次送來的＋分支上已有的（沒重傳的）；都沒有就照舊只看站上檔案
    const allFiles = files || prior?.files?.length ? { ...(prior ? await branchFiles(prior) : {}), ...(files ?? {}) } : null;
    const comps = await validatedCompanions(item, companions, sub?.id);
    const { item: clean, path } = validated(item, status, { extra: comps.map((c) => c.item), files: allFiles });
    if (!sub) {
      const id = `gw-${taipeiDate(now()).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
      const onMain = await git.readFile(git.targetBranch, path);
      sub = { id, contentId: clean.id, type: clean.type, title: clean.title, path, owner: clean.owner, branch: branchOf(clean.id, id), reviewId: null, status: 'draft', isNew: onMain == null, editors: [], approvals: [], comments: [], history: [], createdAt: iso(), updatedAt: iso(), createdBy: p.account, lane: null };
      const b = await git.createBranch(sub.branch, git.targetBranch);
      sub.base = { version: versionOfText(onMain), commit: b?.sha ?? null }; // 第五十二輪：開始時 main 上的版本（之後用來判斷「送審期間網站版本有沒有變」）
    } else if (rebase) {
      const n = (sub.rebases ?? 0) + 1;
      const branch = `${branchOf(sub.contentId, sub.id)}-v${n + 1}`;
      const b = await git.createBranch(branch, git.targetBranch);
      if (sub.reviewId != null) { try { await git.closeReview(sub.reviewId); } catch { /* 舊的審核紀錄關不掉不影響；送審時會開新的 */ } sub.reviewId = null; }
      Object.assign(sub, { branch, rebases: n, base: { version: state.moved.version, commit: b?.sha ?? null } });
      sub.history.push({ at: iso(), action: 'rebase', label: '併入網站上的最新版本', account: p.account, name: p.name });
    }
    addEditor(sub, p);
    Object.assign(sub, { title: clean.title, owner: clean.owner, type: clean.type, publishAt: clean.publishAt ?? null, lane: laneFor(clean, p), updatedAt: iso() });
    // 新分支（rebase）上沒有之前的附件：全部重寫；否則只寫這次送來的
    const fileEntries = Object.entries(rebase ? allFiles ?? {} : files ?? {});
    const commitFiles = [{ path, content: stableJson(clean) }, ...comps.map((c) => ({ path: c.path, content: stableJson(c.item) })), ...fileEntries.map(([name, buf]) => ({ path: `content/assets/${clean.id}/${name}`, content: buf }))];
    sub.files = [...new Set([...(sub.files ?? []), ...Object.keys(files ?? {})])];
    sub.companions = comps.map((c) => ({ id: c.item.id, title: c.item.title ?? c.item.id, path: c.path }));
    const r = await git.commit({ branch: sub.branch, files: commitFiles, message: message(action, sub, p), author: SERVICE_IDENTITY });
    const contentHash = contentVersion(JSON.parse(stableJson(clean)));
    sub.versions = [...(sub.versions ?? []), { version: contentHash, at: iso(), account: p.account, name: p.name, label: action, commit: r.sha }].slice(-30);
    return { sub, item: clean, commit: r.sha, unchanged: !!r.unchanged, contentHash, legacy: baseHash === undefined && !internal, rebased: rebase };
  }

  /* ───────── 動作 ───────── */
  /** 版本檢查的稽核欄位：沒帶版本碼（舊版頁面）記 missing；從 main 另開新分支記 rebased */
  const versionAudit = (w) => ({ ...(w.legacy ? { baseHash: 'missing' } : {}), ...(w.rebased ? { rebased: true } : {}) });

  async function saveDraft(p, { item, submissionId, files = null, companions = [], baseHash = undefined }) {
    await ensureReady();
    return queue(async () => {
      try {
        const w = await writeVersion(p, item, submissionId, 'draft', '儲存草稿', { files, companions, baseHash });
        const { sub, commit, unchanged } = w;
        sub.status = 'draft';
        sub.history.push({ at: iso(), action: 'save', label: '儲存草稿', account: p.account, name: p.name });
        store.put(sub);
        audit.write('save-draft', { actor: p, detail: { submission: sub.id, contentId: sub.contentId, path: sub.path, branch: sub.branch, commit, unchanged, ...versionAudit(w) } });
        return { ...view(sub, p), contentHash: w.contentHash };
      } catch (e) { auditFail('save-draft', p, e, { contentId: item?.id }); throw e; }
    });
  }

  async function submit(p, { item, submissionId, files = null, companions = [], reReview = false, baseHash = undefined }, ctx = {}) {
    await ensureReady();
    return queue(async () => {
      try {
        let w;
        if (item) w = await writeVersion(p, item, submissionId, 'review', '送審', { files, companions, baseHash });
        else {
          // 不改內容直接送審（例：「審閱到期」頁的「不用修改，再送出」）：閘道讀分支上的版本原樣送
          const s0 = store.get(submissionId);
          if (!s0) throw new GatewayError(404, 'notfound', '找不到這筆送審件');
          const eb = editBlock(p, s0.owner); if (eb) throw new GatewayError(403, 'forbidden', eb);
          if (!['draft', 'returned'].includes(s0.status)) throw new GatewayError(409, 'state', `目前狀態是「${STATUS[s0.status]}」，不能送審`);
          const st = await draftState(s0);
          // 第五十二輪：送審件開始後網站版本變了 ⇒ 沒有衝突就由閘道直接併入；有衝突要承辦人開啟修改頁自己決定
          if (st.moved && st.update.conflicts.length) throw staleError('moved', `${st.update.text}其中「${st.update.conflicts.map((c) => c.label).join('、')}」這個送審件也改了，系統不能替你決定用哪一版。請按「開啟修改」，確認後再送審。`, { contentId: s0.contentId, submissionId: s0.id, by: st.update.by, fields: st.update.fields, conflicts: st.update.conflicts });
          const curComps = []; for (const c of s0.companions ?? []) { const j = await readJson(s0.branch, c.path); if (j) curComps.push(j); }
          w = await writeVersion(p, st.item, s0.id, 'review', '送審', { companions: curComps, internal: true, ...(st.moved ? { baseHash: st.token } : {}) });
        }
        const { sub, commit } = w;
        // 第五十二輪：沒帶版本碼的舊頁面在網站版本變了之後送審 ⇒ 不送（審核人也核准不了），請承辦人重新開啟
        if (!w.rebased) {
          const moved = await mainMoved(sub);
          if (moved) { const st = await draftState(sub); sub.history.push({ at: iso(), action: 'save', label: '儲存草稿（網站版本已更新，未送審）', account: p.account, name: p.name }); store.put(sub); throw staleError('moved', st.update.text, { contentId: sub.contentId, submissionId: sub.id, by: st.update.by, fields: st.update.fields, contentHash: st.token }); }
        }
        // 第五十輪：承辦人在上架頁修改到期內容時可勾「這也是重新審閱」；之後退回再送審，種類沿用
        if (reReview === true && !sub.isNew) sub.kind = 'rereview';
        const out = await enterReview(p, sub, commit, ctx, sub.kind === 'rereview' ? 'rereview' : 'submit', versionAudit(w));
        return { ...out, contentHash: w.contentHash };
      } catch (e) { auditFail('submit', p, e, { submission: submissionId, contentId: item?.id }); throw e; }
    });
  }

  /**
   * 送出重新審閱（第五十輪）：內容不改，把網站上的現行版原樣送審。
   * 為什麼要有這個動作：到期內容常常「內容仍正確，只是到了該確認的時候」。以前只能從上架頁重新匯出一份，
   * 表單會順手改掉摘要、關鍵字、譯文狀態等欄位（見 docs/deploy.md §21），審核人也看不出這是重新審閱。
   * 這裡直接讀 main 上的檔，不經過表單；之後的規則（車道、四眼、通知）與一般送審完全相同；核准上線時 publish() 把 reviewedAt 改成核准當天。
   * @param {any} p
   * @param {{ contentId: string, type: string, note?: string }} args
   */
  async function reReview(p, { contentId, type, note }, ctx = {}) {
    await ensureReady();
    return queue(async () => {
      try {
        const where = contentPathOf({ id: contentId, type });
        if (where.ok === false) throw new GatewayError(422, 'invalid', '找不到這筆內容（內容 ID 或型別不對）', where.errors);
        const raw = await git.readFile(git.targetBranch, where.path);
        let cur = null; try { cur = raw ? JSON.parse(raw) : null; } catch { cur = null; }
        if (!cur || cur.id !== contentId || cur.type !== type) throw new GatewayError(404, 'notfound', '網站上找不到這筆內容；新內容請從「上架」送審');
        if (cur.status !== 'published') throw new GatewayError(409, 'state', '只有已上線的內容可以重新審閱');
        const text = String(note ?? '').trim();
        if (text.length > 2000) throw new GatewayError(422, 'note', '說明最多 2000 字', [{ field: 'note', label: '說明', message: '說明最多 2000 字' }]);
        const eb = editBlock(p, cur.owner); if (eb) throw new GatewayError(403, 'forbidden', eb);
        const other = openFor(contentId) ?? holderOf(contentId);
        if (other) throw new GatewayError(409, 'busy', `這筆內容已有一個進行中的送審件（${STATUS[other.status]}，承辦：${namesOf(other.editors)}），請從那一件繼續；它核准上線時最後審閱日也會一起更新`, undefined, { open: { submissionId: other.id, status: other.status } });
        const { sub, commit } = await writeVersion(p, cur, null, 'review', '重新審閱（內容未修改）', { internal: true });
        sub.kind = 'rereview'; sub.reReviewNote = text || null;
        return await enterReview(p, sub, commit, ctx, 'rereview');
      } catch (e) { auditFail('rereview', p, e, { contentId: String(contentId ?? '').slice(0, 130) }); throw e; }
    });
  }

  /** 存好送審版之後的共同步驟：狀態改審核中、開審核、稽核、通知（或自動上線車道直接上線） */
  async function enterReview(p, sub, commit, ctx, auditAction, auditExtra = {}) {
    const rr = sub.kind === 'rereview';
    sub.status = 'in_review'; sub.submittedAt = iso(); sub.approvals = [];
    const rv = await git.openReview({ branch: sub.branch, title: `${rr ? '重新審閱' : '送審'}：${sub.title}`, description: reviewDescription(sub), labels: [REVIEW_LABEL.in_review] });
    sub.reviewId = rv.id;
    sub.history.push({ at: iso(), action: 'submit', label: rr ? '送出重新審閱' : '送審', account: p.account, name: p.name });
    audit.write(auditAction, { actor: p, detail: { submission: sub.id, contentId: sub.contentId, path: sub.path, branch: sub.branch, commit, review: rv.id, lane: sub.lane.id, ...(rr ? { kind: 'rereview', ...(sub.reReviewNote ? { noteChars: sub.reReviewNote.length } : {}) } : {}), ...auditExtra } });
    if (sub.lane.autoMerge) {
      // 自動上線車道（送審人在授權名單）：CI 就是審核者，直接上線；上線後由指定單位複核
      await publish(sub, p, [], ctx);
      const pr = sub.lane.postPublishReview;
      if (pr) notifier.send('post-publish', { to: directory.reviewersFor([pr.unit], [p.account]), title: sub.title, unitName: unitName(sub.owner), editorName: p.name, hours: pr.hours, link: link(ctx, 'review', sub.id) });
    } else {
      notifier.send('submitted', { to: directory.reviewersFor([sub.owner, ...sub.lane.reviewers], sub.editors.map((e) => e.account)), title: sub.title, unitName: unitName(sub.owner), editorName: p.name, reReview: rr, comment: sub.reReviewNote ?? undefined, link: link(ctx, 'review', sub.id) });
    }
    store.put(sub);
    return view(sub, p);
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
        audit.write('return', { actor: p, detail: { submission: sub.id, contentId: sub.contentId, review: sub.reviewId, commentChars: text.length, ...(sub.kind === 'rereview' ? { kind: 'rereview' } : {}) } });
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
        await assertCurrent(sub, false); // 第五十二輪：網站版本在送審期間變了 ⇒ 先擋下，核准不記
        const text = String(comment ?? '').trim().slice(0, 2000);
        sub.approvals.push({ account: p.account, name: p.name, email: p.email ?? null, at: iso() });
        await git.approve(sub.reviewId, p.account);
        await git.comment(sub.reviewId, `核准（${who(p)}）${text ? `：\n\n${text}` : ''}`);
        if (text) sub.comments.push({ at: iso(), kind: 'approve', account: p.account, name: p.name, text });
        sub.history.push({ at: iso(), action: 'approve', label: '核准', account: p.account, name: p.name });
        audit.write('approve', { actor: p, detail: { submission: sub.id, contentId: sub.contentId, review: sub.reviewId, approvals: sub.approvals.length, required: sub.lane.requiredApprovals, ...(sub.kind === 'rereview' ? { kind: 'rereview' } : {}) } });
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

  /**
   * 第五十二輪：送審件開始之後，網站上的同一頁（或它帶的配套內容）有沒有被別的管道更新。有 ⇒ 409 outdated，不核准、不上線。
   * 為什麼要在核准前擋：審核人看到的差異是依開始時的版本算的；直接合併，要嘛衝突卡住，要嘛把那次更新悄悄蓋回去或混在一起沒人看過。
   * auto：自動上線車道（對象是承辦人）；否則對象是審核人（請他退回）。
   */
  async function assertCurrent(sub, auto) {
    let text = null, info = {}, companion = false;
    const moved = await mainMoved(sub);
    if (moved) { const st = await draftState(sub); text = st.update.text; info = { by: st.update.by, fields: st.update.fields, conflicts: st.update.conflicts.map((c) => c.label) }; }
    else {
      for (const c of sub.companions ?? []) {
        const m = await versionAt(git.targetBranch, c.path);
        if (m === NEW_VERSION) continue;
        const b = await versionAt(sub.branch, c.path);
        if (b !== NEW_VERSION && b !== m) { text = `配套內容「${c.title}」在送審期間已經上線，內容和這個送審件裡的不同。`; companion = true; break; }
      }
    }
    if (!text) return;
    const fix = companion ? '請承辦人重新整理頁面，改選網站上已有的那一個，再送審' : '請承辦人重新開啟這個送審件（系統會把網站上的更新併進來，他的修改會保留），確認後再送審';
    throw new GatewayError(409, 'outdated', auto ? `${text}這個送審件是依更新前的版本改的，所以還沒有上線。${fix.replace('請承辦人', '請你').replace('他的修改', '你的修改')}。` : `${text}這個送審件是依更新前的版本改的，直接核准會蓋掉那次更新，所以還不能核准。請按「退回修改」，${fix}。`, undefined, { outdated: { text, companion, ...info } });
  }

  /** 最後一步：提交上線版（status: published）並合併到 main */
  async function publish(sub, p, approvals, ctx) {
    await assertCurrent(sub, approvals.length === 0);
    const cur = await readJson(sub.branch, sub.path);
    if (!cur) throw new GatewayError(409, 'missing', '找不到送審的內容');
    const today = taipeiDate(now());
    const final = { ...cur, status: 'published', reviewedAt: today, ...(sub.isNew ? { publishedAt: today } : {}) };
    const rr = sub.kind === 'rereview';
    const before = await readJson(git.targetBranch, sub.path);
    // 重新審閱：記下內容有沒有跟著改（稽核用；只比內容，不比狀態與審閱日）
    let contentChanged = null;
    if (rr) { const strip = (x) => (x ? stableJson({ ...x, status: null, reviewedAt: null }) : ''); contentChanged = strip(before) !== strip(cur); }
    const comps = []; for (const c of sub.companions ?? []) { const j = JSON.parse(await git.readFile(sub.branch, c.path) ?? 'null'); if (j) comps.push(j); }
    const { path } = validated(final, 'published', { extra: comps, files: sub.files?.length ? await branchFiles(sub) : null });
    const trailers = approvals.map((a) => `Approved-by: ${who(a)}`);
    if (!approvals.length) trailers.push(`Approved-by: 自動（${sub.lane.label}，送審人在授權名單）`);
    trailers.push(`Lane: ${sub.lane.id}`);
    if (rr) trailers.push(`Review-Kind: re-review (reviewedAt ${cur.reviewedAt ?? '-'} -> ${today}; content ${contentChanged ? 'changed' : 'unchanged'})`);
    const c = await git.commit({ branch: sub.branch, files: [{ path, content: stableJson(final) }], message: message(rr ? '核准上線（重新審閱）' : '核准上線', sub, p, trailers), author: SERVICE_IDENTITY });
    let merged;
    try { merged = await git.merge(sub.reviewId, { message: message('上線', sub, p, trailers), author: SERVICE_IDENTITY }); } catch (e) {
      if (e?.code === 'conflict') {
        // 第五十二輪：第五十二輪以前開始的送審件沒記開始版本，上面的 assertCurrent 擋不到，才會走到這裡。
        // 記一個「開始版本不明」：承辦人重新開啟時，與網站版本不同的欄位都列為「兩邊都改了」，由他確認（不再卡在無法上線）。
        const fresh = store.get(sub.id);
        if (fresh && !fresh.base) { fresh.base = { version: 'unknown', commit: null }; store.put(fresh); }
        throw new GatewayError(409, 'conflict', '這筆內容在送審期間，網站上的版本已被更新，無法直接上線（這次核准沒有生效）。請按「退回修改」，請承辦人重新開啟這個送審件：系統會列出網站上不同的欄位，由他確認後再送審。');
      }
      throw e;
    }
    const scheduled = final.publishAt && (publishAtMs(final.publishAt) ?? 0) > now();
    sub.status = scheduled ? 'approved' : 'published';
    sub.publishedAt = iso(); sub.updatedAt = iso(); sub.reviewedAt = today;
    // 第五十二輪：上線紀錄（之前／之後的版本碼、改了哪些欄位）——別人存檔時版本不符，用它說明「誰、何時、改了什麼」
    sub.published = { at: iso(), before: contentVersion(before), after: contentVersion(final), fields: fieldsOf(before, final) };
    sub.history.push({ at: iso(), action: 'publish', label: scheduled ? `已核准，排程 ${taipeiTime(publishAtMs(final.publishAt) ?? 0)} 上線` : rr ? `已重新審閱，最後審閱日更新為 ${today}` : '已上線', account: p.account, name: p.name });
    audit.write('publish', { actor: p, detail: { submission: sub.id, contentId: sub.contentId, path, commit: c.sha, merge: merged.sha, approvedBy: approvals.map((a) => a.account), lane: sub.lane.id, ...(rr ? { kind: 'rereview', reviewedAtBefore: cur.reviewedAt ?? null, reviewedAt: today, contentChanged } : {}) } });
    notifier.send('approved', { to: sub.editors, title: sub.title, unitName: unitName(sub.owner), actorName: approvals.length ? p.name : '系統（快速上線）', scheduled: scheduled ? taipeiTime(publishAtMs(final.publishAt) ?? 0) : null, reReview: rr, reviewedAt: today, link: link(ctx, rr ? 'due' : 'publish', sub.id) });
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
  const reviewDescription = (sub) => [...(sub.kind === 'rereview' ? ['重新審閱：權責單位確認內容仍正確（審閱期限到了）；核准後只把「最後審閱日」更新為核准當天。', ...(sub.reReviewNote ? [`說明：${sub.reReviewNote}`] : []), ''] : []), `權責單位：${unitName(sub.owner)}`, `承辦：${sub.editors.map((e) => e.name).join('、')}`, `車道：${sub.lane.label}（需 ${sub.lane.requiredApprovals} 位核准）`, ...sub.lane.reasons, '', '本合併請求由網站內容管理系統（寫入閘道）代為建立；請在後台「複核區」審核，不要直接在 GitLab 合併。'].join('\n');
  const link = (ctx, page, sid) => `${ctx.origin ?? ''}${ctx.basePath ?? config.basePath}/admin/${page}/${page === 'due' ? '' : `?${page === 'review' ? 'item' : 'gw'}=${encodeURIComponent(sid)}`}`;

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
  /**
   * 承辦人開啟送審件（?gw=）用（第五十二輪）：內容＋版本碼（存檔時帶回來）。送審件開始後網站版本變了 ⇒ 內容是合併後的版本，
   * update 說明網站上改了什麼、哪些欄位兩邊都改了（先顯示網站上的，送審件原本的值放在 conflicts[].yours）。
   */
  async function contentFor(p, sid) {
    const sub = getVisible(p, sid);
    await ensureReady();
    return queue(async () => {
      if (!(await git.branchExists(sub.branch))) { const item = await readJson(git.targetBranch, sub.path); return { item, contentHash: contentVersion(item) }; }
      const st = await draftState(sub);
      return { item: st.item, contentHash: st.token, ...(st.moved ? { update: st.update } : {}) };
    });
  }
  /**
   * ?edit= 開啟已上架內容時用（第五十二輪）：main 上的現行版、版本碼、進行中的送審件；帶 base（頁面上的版本碼）時，順便說明有沒有過期。
   * 為什麼需要：修改頁的內容來自網站的 API，網站更新要幾分鐘；剛核准上線的修改，API 可能還沒有。
   * @param {any} p @param {{ contentId: string, type: string, base?: string }} q
   */
  async function current(p, { contentId, type, base }) {
    const where = contentPathOf({ id: contentId, type });
    if (where.ok === false) throw new GatewayError(422, 'invalid', '找不到這筆內容（內容 ID 或型別不對）', where.errors);
    await ensureReady();
    return queue(async () => {
      const item = await readJson(git.targetBranch, where.path);
      const contentHash = contentVersion(item);
      const sub = openFor(contentId) ?? holderOf(contentId);
      const seeOwner = (owner) => inUnit(p, owner) || p.adminRoles.some((r) => CROSS_UNIT_ROLES.includes(r));
      let open = null;
      if (sub && canSee(p, sub)) {
        const st = sub.contentId === contentId ? await draftState(sub) : null;
        open = { ...view(sub, p), companionOf: sub.contentId === contentId ? null : sub.title, contentHash: st?.token ?? null };
      }
      const out = { exists: !!item, contentHash, open, item: item && seeOwner(item.owner) ? { ...item, sourceHash: sourceHashOf(item) } : null };
      if (base && base !== contentHash && !(open && base === open.contentHash)) {
        if (base === NEW_VERSION) return { ...out, stale: { kind: 'exists', text: `網站上已經有這個內容 ID 的內容「${item?.title ?? contentId}」。` } };
        const by = publishedSince(contentId, base);
        const fields = [...new Set(by.flatMap((b) => b.fields))];
        return { ...out, stale: { kind: 'site', by, fields, text: `網站上的版本比這頁顯示的新${by.length ? `（${describeBy(by)}）` : ''}${fields.length ? `，${fieldText(fields)}` : ''}。網站更新要幾分鐘，這頁可能還沒跟上。` } };
      }
      return out;
    });
  }
  async function diff(p, sid) {
    const sub = getVisible(p, sid);
    await ensureReady();
    if (!(await git.branchExists(sub.branch))) return { isNew: sub.isNew, changes: [], note: sub.status === 'published' || sub.status === 'approved' ? '這筆內容已經上線，沒有待審的修改' : '沒有內容' };
    // 第五十二輪：送審件開始後網站版本變了 ⇒ 差異改跟「開始時的版本」比（審核人看到的是這個送審件自己改的），並說明為什麼還不能核准
    const moved = OPEN.includes(sub.status) ? await mainMoved(sub) : null;
    const before = moved && sub.base.commit ? await git.readFile(sub.base.commit, sub.path) : await git.readFile(git.targetBranch, sub.path);
    const after = await git.readFile(sub.branch, sub.path);
    const d0 = fieldDiff(before ? JSON.parse(before) : null, after ? JSON.parse(after) : null, { unitNames });
    /** @type {any} */
    let d = d0;
    if (moved) { const st = await draftState(sub); d = { ...d0, outdated: { text: `${st.update.text}這個送審件是依更新前的版本改的（下面列的是它自己改的地方），直接核准會蓋掉那次更新，所以還不能核准。請按「退回修改」，請承辦人重新開啟這個送審件（系統會把網站上的更新併進來，他的修改會保留），確認後再送審。`, fields: st.update.fields, conflicts: st.update.conflicts.map((c) => c.label), by: st.update.by } }; }
    // 第五十輪：重新審閱要讓審核人一眼看出「這是確認，不是修改」，以及核准後會發生什麼
    if (sub.kind === 'rereview') {
      const was = before ? JSON.parse(before).reviewedAt ?? null : null;
      return { ...d, reReview: { lastReviewedAt: was, note: sub.reReviewNote ?? null, text: d.changes.length ? `重新審閱（同時修改了 ${d.changes.length} 個欄位）：核准後內容照下列修改上線，最後審閱日更新為核准當天。` : `重新審閱：承辦人確認內容仍正確，內容沒有修改。核准後最後審閱日由 ${was ?? '（未填）'} 更新為核准當天，網站下次更新後離開逾期清單、回到 AI 引用範圍。請確認內容（含所依據的指引）仍正確再核准。` } };
    }
    return d;
  }

  return { saveDraft, submit, reReview, returnForChanges, approve, list, detail, content, contentFor, current, diff, laneFor, reviewBlock, ensureReady, STATUS };
}
