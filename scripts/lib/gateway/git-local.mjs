// @ts-check
// Git 供應者：local（第三十輪）。在 .local/gateway-repo/ 用「真的 git」做分支、提交、合併，讓資訊室可以直接檢查：
//   git -C .local/gateway-repo log --graph --all --format='%h %s%n   %b'
//
// 這是一個 bare repo（沒有工作目錄）：所有寫入都用 git 的底層指令（hash-object／update-index／write-tree／commit-tree／update-ref）
// 在暫時的 index 檔上完成，不需要 checkout，也不會出現「工作目錄有未提交變更」這類狀態。合併用 git merge-tree --write-tree（git ≥ 2.38）。
// 「合併請求」在本機沒有對應物，用 gateway-reviews.json（放在 bare repo 目錄內，不進版本）模擬 GitLab 的 MR：標籤、留言、核准、狀態。
//
// 介面（gitlab 供應者實作同一組方法；見 git-gitlab.mjs）：
//   ensureReady() readFile(ref, path) branchExists(b) createBranch(b, from) commit({branch, files, message, author})
//   openReview({branch, title, description, labels}) setLabels(id, labels) comment(id, body) approve(id, who) merge(id, {message, author})
//   changedFiles(branch) closeReview(id)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const SERVICE_IDENTITY = { name: 'CDC Web Gateway', email: 'web-gateway@cdc-prototype.invalid' };

/**
 * 跑 git；失敗丟錯（含 stderr）。input 會寫進 stdin。
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ input?: string, env?: Record<string, string>, okCodes?: number[] }} [o]
 * @returns {Promise<any>}
 */
function git(cwd, args, { input, env = {}, okCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...env }, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      if (!okCodes.includes(code)) return reject(Object.assign(new Error(`git ${args[0]} 失敗：${String(stderr || err?.message).trim()}`), { code: 'git', exitCode: code }));
      resolve({ stdout: String(stdout), code });
    });
    if (input != null) child.stdin?.end(input); else child.stdin?.end();
  });
}

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

const REPO_README = `# 寫入閘道的本機模擬庫（第三十輪）

這是開發用的 bare repo，由 scripts/lib/gateway/git-local.mjs 建立，模擬正式環境的自架 GitLab。
同事在後台按「儲存草稿／送審／核准上線」時，閘道在這裡建分支、提交、合併；提交者一律是服務帳號，
真正的承辦人與審核人寫在提交訊息尾端（Edited-by:、Approved-by:）與 .local/gateway-audit.jsonl。

檢查方式：git -C .local/gateway-repo log --graph --all --format='%h %an %s%n%b'
`;

/**
 * @param {{ dir: string, seedDir?: string, seedPrefix?: string, targetBranch?: string, identity?: {name:string,email:string} }} opts
 */
export function createLocalGit({ dir, seedDir, seedPrefix = 'content', targetBranch = 'main', identity = SERVICE_IDENTITY }) {
  const reviewsFile = path.join(dir, 'gateway-reviews.json');
  const idEnv = (author = identity) => ({ GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: identity.name, GIT_COMMITTER_EMAIL: identity.email });
  const run = (args, o) => git(dir, args, o);
  const rev = async (ref) => { const r = await run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { okCodes: [0, 1] }); return r.code === 0 ? r.stdout.trim() : null; };
  const readReviews = () => { try { return JSON.parse(fs.readFileSync(reviewsFile, 'utf8')); } catch { return { next: 1, reviews: {} }; } };
  const writeReviews = (d) => { const tmp = `${reviewsFile}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(d, null, 2)}\n`); fs.renameSync(tmp, reviewsFile); };

  /** 在暫時 index 上組一棵樹：base（commit 或空）＋ files，回傳 tree oid */
  async function buildTree(base, files) {
    const tmpIndex = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gw-idx-')), 'index');
    const env = { GIT_INDEX_FILE: tmpIndex };
    try {
      if (base) await run(['read-tree', base], { env });
      const lines = [];
      for (const f of files) {
        if (f.content == null) { lines.push(`0 ${'0'.repeat(40)}\t${f.path}`); continue; } // 刪除
        const sha = (await run(['hash-object', '-w', '--stdin'], { input: f.content })).stdout.trim();
        lines.push(`100644 ${sha}\t${f.path}`);
      }
      if (lines.length) await run(['update-index', '--add', '--index-info'], { env, input: `${lines.join('\n')}\n` });
      return (await run(['write-tree'], { env })).stdout.trim();
    } finally { fs.rmSync(path.dirname(tmpIndex), { recursive: true, force: true }); }
  }

  const api = {
    name: 'local', dir, targetBranch,
    async ensureReady() {
      if (fs.existsSync(path.join(dir, 'HEAD')) && await rev(targetBranch)) return;
      fs.mkdirSync(dir, { recursive: true });
      await git(path.dirname(dir), ['init', '--bare', '--quiet', '-b', targetBranch, dir]);
      // 種子：把目前工作目錄的 content/ 當成「正式庫 main 的現況」匯入成第一個提交
      const files = [{ path: 'README.md', content: REPO_README }];
      if (seedDir && fs.existsSync(seedDir)) {
        const rel = walk(seedDir);
        const shas = (await run(['hash-object', '-w', '--stdin-paths'], { input: `${rel.map((r) => path.join(seedDir, r)).join('\n')}\n` })).stdout.trim().split('\n');
        const tmpIndex = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gw-seed-')), 'index');
        try {
          const env = { GIT_INDEX_FILE: tmpIndex };
          await run(['update-index', '--add', '--index-info'], { env, input: `${rel.map((r, i) => `100644 ${shas[i]}\t${seedPrefix}/${r}`).join('\n')}\n` });
          const readme = (await run(['hash-object', '-w', '--stdin'], { input: REPO_README })).stdout.trim();
          await run(['update-index', '--add', '--cacheinfo', `100644,${readme},README.md`], { env });
          const tree = (await run(['write-tree'], { env })).stdout.trim();
          const c = (await run(['commit-tree', tree, '-F', '-'], { env: idEnv(), input: `初始匯入：${seedPrefix}/ 快照（${rel.length} 個檔）\n` })).stdout.trim();
          await run(['update-ref', `refs/heads/${targetBranch}`, c]);
        } finally { fs.rmSync(path.dirname(tmpIndex), { recursive: true, force: true }); }
      } else {
        const tree = await buildTree(null, files);
        const c = (await run(['commit-tree', tree, '-F', '-'], { env: idEnv(), input: '初始化\n' })).stdout.trim();
        await run(['update-ref', `refs/heads/${targetBranch}`, c]);
      }
    },
    async readFile(ref, filePath) {
      const r = await run(['cat-file', '-p', `${ref}:${filePath}`], { okCodes: [0, 128] });
      return r.code === 0 ? r.stdout : null;
    },
    async branchExists(branch) { return !!(await rev(`refs/heads/${branch}`)); },
    async createBranch(branch, from = targetBranch) {
      const base = await rev(from);
      if (!base) throw new Error(`找不到 ${from}`);
      await run(['update-ref', `refs/heads/${branch}`, base, '0'.repeat(40)]);
      return { sha: base };
    },
    /** 一次提交多個檔；內容沒變就不產生空提交（回傳 unchanged） */
    async commit({ branch, files, message, author = identity }) {
      const parent = await rev(`refs/heads/${branch}`);
      if (!parent) throw new Error(`分支 ${branch} 不存在`);
      const tree = await buildTree(parent, files);
      const parentTree = (await run(['rev-parse', `${parent}^{tree}`])).stdout.trim();
      if (tree === parentTree) return { sha: parent, unchanged: true };
      const sha = (await run(['commit-tree', tree, '-p', parent, '-F', '-'], { env: idEnv(author), input: message.endsWith('\n') ? message : `${message}\n` })).stdout.trim();
      await run(['update-ref', `refs/heads/${branch}`, sha, parent]); // 比對舊值：有人同時寫就失敗，不會蓋掉
      return { sha };
    },
    async openReview({ branch, title, description = '', labels = [] }) {
      const d = readReviews();
      const open = Object.values(d.reviews).find((r) => r.branch === branch && r.state === 'opened');
      if (open) { Object.assign(open, { title, description, labels }); writeReviews(d); return { id: open.id }; }
      const id = d.next++;
      d.reviews[id] = { id, branch, targetBranch, title, description, labels, state: 'opened', notes: [], approvals: [], createdAt: new Date().toISOString() };
      writeReviews(d);
      return { id };
    },
    async getReview(id) { return readReviews().reviews[id] ?? null; },
    async setLabels(id, labels) { const d = readReviews(); if (d.reviews[id]) { d.reviews[id].labels = labels; writeReviews(d); } },
    async comment(id, body) { const d = readReviews(); d.reviews[id]?.notes.push({ at: new Date().toISOString(), body }); writeReviews(d); },
    async approve(id, who) { const d = readReviews(); d.reviews[id]?.approvals.push({ at: new Date().toISOString(), by: who }); writeReviews(d); },
    async closeReview(id) { const d = readReviews(); if (d.reviews[id]) { d.reviews[id].state = 'closed'; writeReviews(d); } },
    async changedFiles(branch) {
      const r = await run(['diff', '--name-only', `${targetBranch}...refs/heads/${branch}`]);
      return r.stdout.split('\n').filter(Boolean);
    },
    /** 合併到 main（--no-ff 等價）：衝突就丟 code=conflict，main 不動 */
    async merge(id, { message, author = identity }) {
      const d = readReviews();
      const rv = d.reviews[id];
      if (!rv || rv.state !== 'opened') throw new Error('沒有開啟中的審核');
      const head = await rev(`refs/heads/${rv.branch}`);
      const main = await rev(targetBranch);
      if (!head || !main) throw new Error('分支不存在');
      const mt = await run(['merge-tree', '--write-tree', '--no-messages', main, head], { okCodes: [0, 1] });
      if (mt.code === 1) throw Object.assign(new Error('內容在審核期間已被其他人更新，無法自動合併'), { code: 'conflict' });
      const tree = mt.stdout.split('\n')[0].trim();
      const sha = (await run(['commit-tree', tree, '-p', main, '-p', head, '-F', '-'], { env: idEnv(author), input: message.endsWith('\n') ? message : `${message}\n` })).stdout.trim();
      await run(['update-ref', `refs/heads/${targetBranch}`, sha, main]);
      await run(['update-ref', '-d', `refs/heads/${rv.branch}`, head]); // 與 GitLab「合併後刪來源分支」一致；歷史仍在 main 的合併提交裡
      rv.state = 'merged'; rv.mergedAt = new Date().toISOString(); rv.mergeCommit = sha;
      writeReviews(d);
      return { sha };
    },
    /** 測試與資訊室用：某個 ref 的提交訊息 */
    async log(ref = targetBranch, n = 20) {
      const r = await run(['log', '-n', String(n), '--format=%H%x1f%an%x1f%ae%x1f%B%x1e', ref], { okCodes: [0, 128] });
      return r.stdout.split('\x1e').map((s) => s.trim()).filter(Boolean).map((s) => { const [sha, an, ae, body] = s.split('\x1f'); return { sha, authorName: an, authorEmail: ae, message: body }; });
    },
  };
  return api;
}
