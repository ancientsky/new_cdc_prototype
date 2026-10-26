// @ts-check
// 第六十六輪：單位改組時，把內容的權責單位（owner）從 A 單位整批改成 B 單位（docs/guide-staff.md §61、docs/deploy.md §33）。
//
// 為什麼要有工具：內容屬於單位（owner 是單位 id，不是人），所以同事離職、調動都不用改內容；只有「單位本身」改組、合併、
// 更名時才需要改 owner。一個單位常有上百筆內容，手改容易漏，漏一筆就會有內容的待辦、審閱到期通知寄到已不存在的單位。
//
// 只做一件事：把 JSON 裡 "owner": "<A>" 換成 "owner": "<B>"（以文字替換，檔案其他地方的格式、欄位順序一個字都不動）。
// 不碰 reviewedAt、publishedAt（改組不代表重新審閱過內容）、不碰 steward 與 hiringUnit 等其他欄位：那些列在報告的「請人工確認」。
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['assets']); // content/assets/ 是附件，不是內容檔

/** content/ 底下所有 .json（相對於 root） */
function listJson(root) {
  const base = path.join(root, 'content');
  const out = [];
  const walk = (dir, depth) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.name.startsWith('.')) continue;
      const abs = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (!(depth === 0 && SKIP_DIRS.has(d.name))) walk(abs, depth + 1);
      } else if (d.name.endsWith('.json')) out.push(path.relative(root, abs).split(path.sep).join('/'));
    }
  };
  if (fs.existsSync(base)) walk(base, 0);
  return out.sort();
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 找出 JSON 裡 owner === from 的節點，回報表用的列 */
function ownedNodes(json, from, rel) {
  const rows = [];
  const top = json && typeof json === 'object' && !Array.isArray(json) ? json : null;
  const visit = (node, parent) => {
    if (Array.isArray(node)) {
      for (const x of node) visit(x, parent);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (node.owner === from) {
      const id = node.id ?? (node.key && parent?.id ? `${parent.id}#${node.key}` : node.key) ?? parent?.id ?? path.basename(rel, '.json');
      rows.push({
        id: String(id),
        type: String(node.type ?? (node === top ? '—' : top?.type ? `${top.type}（項目）` : '主檔')),
        title: String(node.title ?? node.name ?? node.label ?? node.question ?? ''),
        path: rel,
        steward: typeof node.steward === 'string' ? node.steward : null,
      });
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v, node.id ? node : parent);
  };
  visit(json, null);
  return rows;
}

export class ReassignError extends Error {}

/**
 * @param {{ root: string, from: string, to: string, types?: string[]|null, dryRun?: boolean, today?: string }} o
 * @returns {{ rows: {id:string,type:string,title:string,path:string,steward:string|null}[], files: string[], others: {path:string,line:number,text:string}[], stewardHints: {id:string,steward:string}[], dryRun: boolean, from: any, to: any, types: string[]|null }}
 */
export function reassignOwner({ root, from, to, types = null, dryRun = false }) {
  const units = JSON.parse(fs.readFileSync(path.join(root, 'content/master/units.json'), 'utf8'));
  const byId = new Map(units.map((u) => [u.id, u]));
  if (!from || !to) throw new ReassignError('請指定 --from 與 --to（單位 id，例：unit.acute-infectious）');
  if (from === to) throw new ReassignError('--from 與 --to 是同一個單位');
  const A = byId.get(from),
    B = byId.get(to);
  if (!A) throw new ReassignError(`--from ${from} 不在 content/master/units.json`);
  if (!B) throw new ReassignError(`--to ${to} 不在 content/master/units.json（新單位要先加進單位主檔）`);
  if (B.publishes === false) throw new ReassignError(`--to ${to}（${B.name}）不上架內容（publishes: false），不能當權責單位`);
  if (B.retiredAt) throw new ReassignError(`--to ${to}（${B.name}）已於 ${B.retiredAt} 裁撤，請改指向承接單位${B.successor ? ` ${B.successor}` : ''}`);
  const typeSet = types?.length ? new Set(types) : null;
  const re = new RegExp(`("owner"\\s*:\\s*)"${esc(from)}"`, 'g');
  const rows = [],
    files = [],
    others = [];
  for (const rel of listJson(root)) {
    if (rel === 'content/master/units.json') continue;
    const abs = path.join(root, rel);
    const text = fs.readFileSync(abs, 'utf8');
    if (!text.includes(`"${from}"`)) continue;
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    const isItem = json && typeof json === 'object' && !Array.isArray(json) && typeof json.type === 'string';
    const typeOk = !typeSet || (isItem && typeSet.has(json.type));
    // owner 以外提到這個單位的地方（用人單位、需求單位、審核單位…）：不自動改，列給人看
    text.split('\n').forEach((line, i) => {
      if (line.includes(`"${from}"`) && !/"owner"\s*:/.test(line)) others.push({ path: rel, line: i + 1, text: line.trim().slice(0, 160) });
    });
    if (!typeOk) continue;
    const found = ownedNodes(json, from, rel);
    if (!found.length) continue;
    const next = text.replace(re, `$1"${to}"`);
    // 自我檢查：換完仍是合法 JSON，而且除了 owner 以外完全一樣
    const strip = (j) => JSON.stringify(j, (k, v) => (k === 'owner' && (v === from || v === to) ? '<owner>' : v));
    if (strip(JSON.parse(next)) !== strip(json)) throw new ReassignError(`${rel}：替換後內容不只 owner 改變，已停止（請回報資訊室）`);
    rows.push(...found);
    files.push(rel);
    if (!dryRun) fs.writeFileSync(abs, next);
  }
  const stewardHints = rows
    .filter((r) => r.steward && A.name && r.steward.includes(A.name))
    .map((r) => ({ id: r.id, steward: /** @type {string} */ (r.steward) }));
  return { rows, files, others, stewardHints, dryRun, from: A, to: B, types: typeSet ? [...typeSet] : null };
}

const cell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '｜')
    .replace(/\n/g, ' ');

/** 終端機用的表 */
export function formatTable(r) {
  const lines = [
    `${r.dryRun ? '［試算，沒有改任何檔］' : '［已改寫］'} ${r.from.id}（${r.from.name}）→ ${r.to.id}（${r.to.name}）${r.types ? `，只限型別 ${r.types.join('、')}` : ''}：${r.rows.length} 筆、${r.files.length} 個檔`,
  ];
  const w = (s, n) => {
    const t = String(s);
    return t.length >= n ? t : t + ' '.repeat(n - t.length);
  };
  for (const x of r.rows) lines.push(`  ${w(x.id, 48)} ${w(x.type, 14)} ${w(x.title.slice(0, 30), 32)} ${x.path}`);
  if (r.others.length)
    lines.push(
      '',
      `owner 以外提到 ${r.from.id} 的地方（${r.others.length} 處，沒有自動改，請人工確認）：`,
      ...r.others.map((o) => `  ${o.path}:${o.line}  ${o.text}`),
    );
  return lines.join('\n');
}

/** 給 PR 用的 Markdown 報告 */
export function formatReport(r, { today = new Date().toISOString().slice(0, 10) } = {}) {
  return [
    `# 權責單位移轉：${r.from.name} → ${r.to.name}`,
    '',
    `- 日期：${today}`,
    `- 從：\`${r.from.id}\`（${r.from.name}）`,
    `- 到：\`${r.to.id}\`（${r.to.name}）`,
    `- 範圍：${r.types ? `型別 ${r.types.join('、')}` : '全部型別'}`,
    `- 模式：${r.dryRun ? '試算（--dry-run，沒有改任何檔）' : '已改寫'}`,
    `- 筆數：${r.rows.length} 筆、${r.files.length} 個檔`,
    '',
    '只改了 `owner`。`reviewedAt`、`publishedAt` 沒有動：改組不代表內容重新審閱過，審閱到期日照舊，到期時由新單位審閱。',
    '這個變更動到內容檔，走一般車道，由 OASIS 與公關室審核（docs/publishing-lanes.md）。',
    '',
    '| id | 型別 | 標題 | 檔案 |',
    '| --- | --- | --- | --- |',
    ...r.rows.map((x) => `| \`${cell(x.id)}\` | ${cell(x.type)} | ${cell(x.title)} | \`${cell(x.path)}\` |`),
    '',
    ...(r.stewardHints.length
      ? ['## 請順手確認：steward（職稱說明）還寫著舊單位', '', ...r.stewardHints.map((h) => `- \`${h.id}\`：${cell(h.steward)}`), '']
      : []),
    ...(r.others.length
      ? ['## 請人工確認：owner 以外提到舊單位的地方（沒有自動改）', '', ...r.others.map((o) => `- \`${o.path}\` 第 ${o.line} 行：\`${cell(o.text)}\``), '']
      : []),
    '## 接著要做',
    '',
    `1. 單位主檔 \`content/master/units.json\` 的 \`${r.from.id}\` 加上 \`retiredAt\`（裁撤日）與 \`successor: "${r.to.id}"\`；之後若還有內容指到舊單位，建置會失敗並提示再跑一次本工具。`,
    `2. AD 群組：\`CDC-WEB-${r.from.id.replace(/^unit\./, '')}-*\` 的成員移到 \`CDC-WEB-${r.to.id.replace(/^unit\./, '')}-*\`（資訊室）。`,
    '3. 寫入閘道裡舊單位進行中的送審件：由新單位的同事在「我的內容 → 單位進行中的送審件」按「接手」（guide-staff §61）。',
    '',
  ].join('\n');
}
