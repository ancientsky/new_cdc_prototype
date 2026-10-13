// 國際重要疫情資訊：推送端點（scripts/lib/intl-feed-api.mjs）與後台手動匯入（閘道 /api/gateway/intl-epidemic/import）共用的上架流程
// （docs/intl-epidemic.md 第 4、6 節）。parse → plan → apply（寫 data/snapshots/ 兩個檔）→ 有 Git 供應者就把這兩個檔提交到目標分支 → 稽核。
//
// 為什麼抽出來：推送（疫情中心系統 POST）與後台貼上（承辦人登入）只差在「誰送的、怎麼認人」，之後的把關、寫檔、版本紀錄、稽核必須完全一樣，
// 否則兩條路會慢慢長成兩套規則。CLI（npm run intl:import）與 CI 排程拉取走同一個匯入器（scripts/lib/intl-epidemic.mjs），只是不經過這裡的提交。
//
// 現行清單以本機 data/snapshots/ 為準（原型：閘道與建置在同一台機器上）；正式環境若閘道與建置分開，應改成先從 Git 讀現行快照再規劃。
import fs from 'node:fs';
import path from 'node:path';
import { SERVICE_IDENTITY } from './gateway/git-local.mjs';
import { parseFeed, planImport, applyImport, describePlan, ROOT, SNAPSHOT_FILE, RECORD_FILE, SOURCES } from './intl-epidemic.mjs';

export const DEFAULT_SNAPSHOTS_DIR = path.join(ROOT, 'data', 'snapshots');
/** 版本庫裡兩個檔的路徑（與 snapshotsDir 無關：暫存目錄測試時也提交到同一個位置） */
export const REPO_PATHS = { snapshot: `data/snapshots/${SNAPSHOT_FILE}`, record: `data/snapshots/${RECORD_FILE}` };
export const INTL_UNIT = 'unit.epidemic-intelligence';
/** 來源 → 白話（後台與提交訊息共用；後台另有一份在 src/client/admin/intl-epidemic-core.js） */
export const SOURCE_LABEL = { push: '推送', manual: '後台手動匯入', feed: '排程拉取', 'official-export': '排程拉取（現行官網匯出）' };

export class PublishError extends Error {
  /** @param {number} status @param {string} code @param {string} message */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * 閘道身分能不能用國際疫情匯入：疫情中心的編輯／審核（含疫情發布角色），或跨單位角色（總編輯、治理幕僚、平台管理）。
 * @param {{ memberships?: {unit:string, role:string}[], crossUnit?: boolean }} p
 */
export function canImportIntl(p) {
  if (!p) return false;
  if (p.crossUnit) return true;
  return (p.memberships ?? []).some((m) => m.unit === INTL_UNIT && ['editor', 'reviewer', 'situation-publisher'].includes(m.role));
}

const readJSON = (p, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};

/** 匯入紀錄（給後台狀態框）：lastRun ＋ 近 30 次 */
export function readImportRecord(snapshotsDir = DEFAULT_SNAPSHOTS_DIR) {
  const rec = readJSON(path.join(snapshotsDir, RECORD_FILE), null);
  return { lastRun: rec?.lastRun ?? null, history: Array.isArray(rec?.history) ? rec.history.slice(0, 30) : [] };
}

/** 一次規劃 → 回應用的摘要（推送端點與後台共用的形狀） */
export function summarize(plan) {
  const r = plan.report;
  return {
    ok: !plan.held,
    held: plan.held,
    noop: plan.noop,
    heldReasons: plan.held ? r.held.reasons : [],
    changes: { new: r.counts.new, updated: r.counts.updated, withdrawn: r.counts.withdrawn, unchanged: r.counts.unchanged },
    rejected: r.rejected,
    unmapped: r.unmapped,
    message: describePlan(plan),
    report: r,
  };
}

/** 同一時間只有一次寫入（推送與後台可能同時到） */
let chain = Promise.resolve();
const serial = (fn) => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
};

const oneLine = (s, n = 200) =>
  String(s ?? '')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, n);

function versionMessage(plan, { source, producer, actor }) {
  const c = plan.report.counts;
  const label = SOURCE_LABEL[source] ?? source;
  const head = plan.held
    ? `data: 國際重要疫情資訊（${label}）整批保留，只更新匯入紀錄`
    : `data: 國際重要疫情資訊（${label}）新增 ${c.new}、更新 ${c.updated}、撤下 ${c.withdrawn}`;
  const lines = [head, '', describePlan(plan), '', `Source: ${source}`];
  if (producer) lines.push(`Producer: ${oneLine(producer)}`);
  if (actor)
    lines.push(
      `Imported-by: ${oneLine(actor.name, 60)} (AD: ${actor.account})`,
      `Gateway-Actor: ${oneLine(actor.name, 60)} (AD: ${actor.account})`,
      `Gateway-Auth: ${actor.authMode ?? ''}`,
    );
  return `${lines.join('\n')}\n`;
}

/**
 * 上架一批國際疫情資訊。
 * @param {{ feed: string|object, shape?: 'v1'|'legacy'|'csv', source: 'push'|'manual'|'feed'|'official-export', mode?: 'full'|'delta',
 *           by?: string|null, producer?: string|null, actor?: any, dry?: boolean, git?: any, audit?: any, author?: {name:string,email:string},
 *           snapshotsDir?: string, now?: string, today?: string, diseases?: object[], countries?: object[] }} opt
 *   by：寫進快照 provenance.by 與匯入紀錄（會隨 /v1/travel-alerts.json 公開，只放帳號）；actor：閘道身分（姓名只寫進版本紀錄尾端與稽核）。
 * @returns {Promise<ReturnType<typeof summarize> & { dry: boolean, wrote: string[], version: { sha: string|null, unchanged?: boolean }|null }>}
 */
export async function publishFeed(opt) {
  if (!SOURCES.includes(opt.source)) throw new PublishError(500, 'source', `未知的來源 ${opt.source}`);
  if (opt.mode != null && !['full', 'delta'].includes(opt.mode))
    throw new PublishError(400, 'bad_mode', 'mode 只能是 full（這批就是現行全部）或 delta（只動送來的那幾則）');
  let feed;
  try {
    feed = parseFeed(opt.feed, opt.shape ? { shape: opt.shape } : {});
  } catch (e) {
    throw new PublishError(400, 'bad_feed', e.message);
  }
  const dir = opt.snapshotsDir ?? DEFAULT_SNAPSHOTS_DIR;
  return serial(async () => {
    const now = opt.now ?? new Date().toISOString();
    const current = readJSON(path.join(dir, SNAPSHOT_FILE), null);
    const plan = planImport({
      current,
      feed,
      now,
      ...(opt.today ? { today: opt.today } : {}),
      ...(opt.mode ? { mode: opt.mode } : {}),
      source: opt.source,
      producer: opt.producer ?? feed.producer ?? null,
      by: opt.by ?? null,
      ...(opt.diseases ? { diseases: opt.diseases } : {}),
      ...(opt.countries ? { countries: opt.countries } : {}),
    });
    const out = summarize(plan);
    if (opt.dry) return { ...out, dry: true, wrote: [], version: null };

    const applied = applyImport(plan, { snapshotsDir: dir, now, fetched: false });
    let version = null;
    if (opt.git && applied.wrote.length) {
      const files = applied.wrote.map((p) => ({
        path: path.basename(p) === SNAPSHOT_FILE ? REPO_PATHS.snapshot : REPO_PATHS.record,
        content: fs.readFileSync(p, 'utf8'),
      }));
      try {
        await opt.git.ensureReady?.();
        const r = await opt.git.commit({
          branch: opt.git.targetBranch ?? 'main',
          files,
          message: versionMessage(plan, { source: opt.source, producer: plan.producer, actor: opt.actor }),
          author: opt.author ?? SERVICE_IDENTITY,
        });
        version = { sha: r?.sha ?? null, ...(r?.unchanged ? { unchanged: true } : {}) };
      } catch (e) {
        opt.audit?.write?.('intl-epidemic-import', {
          actor: opt.actor ?? null,
          result: 'error',
          detail: { source: opt.source, reason: 'version-record-failed' },
        });
        console.error('[intl-epidemic] 版本紀錄失敗：', e?.message ?? e);
        throw new PublishError(500, 'version_failed', '資料已寫入網站的資料檔，但版本紀錄失敗；請洽資訊室確認後再送一次（同一批再送不會重複上架）');
      }
    }
    opt.audit?.write?.('intl-epidemic-import', {
      actor: opt.actor ?? null,
      result: plan.held ? 'held' : 'ok',
      detail: {
        source: opt.source,
        producer: plan.producer ? oneLine(plan.producer, 120) : null,
        mode: plan.mode,
        received: plan.report.received,
        counts: plan.report.counts,
        unmapped: plan.report.unmapped.length,
        held: plan.held ? plan.report.held.reasons : null,
        noop: plan.noop,
        version: version?.sha ?? null,
      },
    });
    return { ...out, dry: false, wrote: applied.wrote.map((p) => path.relative(ROOT, p).split(path.sep).join('/')), version };
  });
}
