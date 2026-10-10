// @ts-check
// 寫入閘道的兩份本機紀錄（第三十輪）：
//   1. 送審狀態索引 .local/gateway-state.json：每筆「送審件」目前在哪個狀態、誰編的、誰核准過。
//      它是索引不是正本：正本是 Git（分支、提交、合併請求）；正式環境索引壞了可以從 GitLab 的合併請求與標籤重建。
//   2. 稽核紀錄 .local/gateway-audit.jsonl：只增不改，一行一事件；每行帶前一行的雜湊（hash chain），
//      任何人事後改動或刪掉中間一行，verifyAudit() 都會發現。正式環境再送到集中式日誌（SIEM），保存一年以上。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createStateStore(file) {
  const read = () => { try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return d && typeof d.submissions === 'object' ? d : { version: 1, submissions: {} }; } catch { return { version: 1, submissions: {} }; } };
  const write = (d) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(d, null, 2)}\n`);
    fs.renameSync(tmp, file);
  };
  return {
    file,
    all: () => Object.values(read().submissions),
    get: (id) => read().submissions[id] ?? null,
    put(sub) { const d = read(); d.submissions[sub.id] = sub; write(d); return sub; },
  };
}

const hashOf = (prev, entry) => crypto.createHash('sha256').update(`${prev}\n${JSON.stringify(entry)}`).digest('hex');

export function createAuditLog(file, { now = () => Date.now() } = {}) {
  let last = null; // { seq, hash }
  function tail() {
    if (last) return last;
    try {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
      const e = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
      last = e ? { seq: e.seq, hash: e.hash } : { seq: 0, hash: '0'.repeat(64) };
    } catch { last = { seq: 0, hash: '0'.repeat(64) }; }
    return last;
  }
  return {
    file,
    /** 寫一筆；actor 只記帳號、姓名、單位與登入方式，不記 token 或內容本文 */
    write(action, { actor = null, detail = {}, result = 'ok' } = {}) {
      const t = tail();
      const entry = {
        seq: t.seq + 1, at: new Date(now()).toISOString(), action, result,
        actor: actor ? { account: actor.account, name: actor.name, unit: actor.primaryUnit ?? null, roles: actor.roles ?? [], auth: actor.authMode ?? null } : null,
        ...detail, prev: t.hash,
      };
      const hash = hashOf(t.hash, entry);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify({ ...entry, hash })}\n`);
      last = { seq: entry.seq, hash };
      return entry.seq;
    },
    read() { try { return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } },
  };
}

/** 驗證整條雜湊鏈；回傳 { ok, brokenAt } */
export function verifyAudit(entries) {
  let prev = '0'.repeat(64);
  for (const e of entries) {
    const { hash, ...rest } = e;
    if (rest.prev !== prev || hashOf(prev, rest) !== hash) return { ok: false, brokenAt: e.seq };
    prev = hash;
  }
  return { ok: true, brokenAt: null };
}
