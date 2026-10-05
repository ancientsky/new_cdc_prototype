// report.md：給人讀的批次報告（report.json 是同一份資料的機器版，後台 /admin/import/ 讀它）。
import { ACTION_LABEL } from './migration.mjs';

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const EXTRA = { publication: '出版品', media: '影音', dataset: '資料集', labtest: '檢驗', service: '服務', clarification: '澄清稿', topic: '專區', vaccine: '疫苗' };
const TYPE_LABEL = { disease: '疾病頁', faq: 'Q&A', news: '新聞', document: '文件', page: '頁面', ...EXTRA };
const KIND_LABEL = { 'disease-block': '併入疾病頁', faq: 'Q&A', news: '新聞', document: '文件', page: '頁面', list: '清單頁', ...EXTRA };

export function renderReportMd(report, patch) {
  const s = report.summary;
  const L = [];
  L.push(`# 舊站匯出轉換報告：${report.batch}`);
  L.push('');
  L.push(`> ${report.simulated ? '**模擬匯出**（開發環境連不到舊站，依移轉清單合成；正式匯出取代即可）。' : '正式匯出。'}匯出日 ${report.exportedAt}；轉換時間 ${report.generatedAt}；規則檔 \`${report.rules.file}\`；移轉清單 ${report.manifest ? `\`${report.manifest.file}\`（${report.manifest.items} 筆）` : '（未指定）'}。`);
  L.push('');
  L.push('## 批次摘要');
  L.push('');
  L.push('| 項目 | 數字 |');
  L.push('| --- | --- |');
  L.push(`| 舊頁數 | ${s.pages} |`);
  L.push(`| 產出草稿 | ${s.drafts}（${Object.entries(s.byType).map(([k, v]) => `${TYPE_LABEL[k] ?? k} ${v}`).join('、')}） |`);
  L.push(`| 舊頁型別 | ${Object.entries(s.byKind).map(([k, v]) => `${KIND_LABEL[k] ?? k} ${v}`).join('、')} |`);
  L.push(`| 平均信心 | ${s.avgConfidence} |`);
  L.push(`| 需人工檢視（信心 < 0.6） | ${s.needsReview} |`);
  L.push(`| 既有內容已存在（供比對） | ${s.existing} |`);
  L.push(`| 附件與圖片 | ${s.assets.total}（附件 ${s.assets.attachment}、內文圖片 ${s.assets.image}、資料檔 ${s.assets.data}；圖片待補 alt ${s.assets.needsAlt}、PDF 無文字層 ${s.assets.noTextLayer}） |`);
  L.push(`| 草稿 schema 驗證 | ${s.drafts - s.schemaInvalid} / ${s.drafts} 通過 |`);
  L.push(`| 問題 | 錯誤 ${s.issues.error}、警告 ${s.issues.warn}、提示 ${s.issues.info} |`);
  if (patch?.summary && report.manifest) {
    const p = patch.summary;
    L.push(`| 移轉清單對應 | 對上 ${p.matched} / ${p.items} 筆；status 變化 ${report.migration.applied ? report.migration.statusChanges.length : `${p.statusChanges}（尚未套用）`}；note 更新 ${report.migration.applied ? report.migration.noteChanges : p.noteChanges}；仍待移轉 ${p.stillPending}；與清單判定不同 ${p.conflicts} |`);
    if (p.derivedItems) L.push(`| 模板推導項（清單只寫例外） | ${p.derivedItems} 項，對上 ${p.derivedMatched}；只列在 migration-patch.json 的 derivedItems，不寫回清單 |`);
    if (p.unmatchedPages) L.push(`| 清單沒有的舊頁 | ${p.unmatchedPages}（migration-patch.json 的 unmatchedPages 有建議的 pending 項目） |`);
  }
  L.push('');
  L.push('處理原則：一級內容（疾病頁、指引、手冊）一律人工確認後才入庫；近年新聞信心 ≥ 0.8 可核對後自動上線；久遠與歷史版本封存；草稿放在本目錄，**不會**寫進 `content/`。');
  L.push('');
  L.push('## 逐頁結果');
  L.push('');
  L.push('| # | 來源 | 型別 | 目標 | 信心 | 問題 | 建議動作 |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  report.pages.forEach((p, i) => {
    const outs = p.outputs.map((o) => `\`${o.id}\`${o.role === 'merged' ? `（併入${o.block ? `：${o.block}` : ''}）` : o.role === 'duplicate' ? '（重複，未輸出）' : ''}`).join('<br>') || '—';
    const target = p.target ? `\`${p.target}\`${p.existing ? '（既有）' : ''}` : '—';
    const iss = p.issues.filter((x) => x.severity !== 'info');
    const issues = iss.length ? iss.map((x) => `${x.code}`).join('、') : '—';
    L.push(`| ${i + 1} | ${esc(p.source.title)}<br><sub>${esc(p.source.url.replace(/^https?:\/\//, ''))}</sub> | ${KIND_LABEL[p.kind] ?? p.kind} → ${outs} | ${target} | ${p.confidence}${p.needsReview ? ' ⚠' : ''} | ${esc(issues)} | ${ACTION_LABEL[p.action] ?? p.action} |`);
  });
  L.push('');
  const rev = report.pages.filter((p) => p.needsReview);
  L.push(`## 需人工檢視（${rev.length} 頁）`);
  L.push('');
  if (!rev.length) L.push('無。'); else for (const p of rev) {
    L.push(`- **${p.source.title}**（信心 ${p.confidence}）`);
    for (const x of p.issues.filter((y) => y.severity !== 'info')) L.push(`  - ${x.severity === 'error' ? '錯誤' : '警告'}：${x.message}`);
  }
  L.push('');
  const merged = report.pages.filter((p) => p.kind === 'disease-block');
  L.push(`## 併入疾病頁（${merged.length} 頁）`);
  L.push('');
  for (const p of merged) L.push(`- 「${p.source.title}」→ \`${p.outputs[0]?.id}\` 區塊 ${p.outputs[0]?.block ?? '—'}${p.existing ? '（疾病頁既有內容已存在，供比對）' : ''}`);
  L.push('');
  L.push('## 附件與圖片需要處理的');
  L.push('');
  const attIssues = report.pages.flatMap((p) => p.issues.filter((x) => ['pdf-no-text-layer', 'image-no-alt', 'attachment-missing', 'image-missing', 'unlisted-file-link', 'asset-too-large'].includes(x.code)).map((x) => `- ${p.source.title}：${x.message}`));
  if (attIssues.length) L.push(...attIssues); else L.push('無。');
  L.push('');
  if (patch) {
    L.push('## 與移轉清單的差異');
    L.push('');
    L.push(`- 清單有、匯出沒有：${patch.missingPages.length ? patch.missingPages.map((x) => `\`${x.key}\``).join('、') : '無'}`);
    L.push(`- 匯出有、清單沒有：${patch.unmatchedPages.length ? patch.unmatchedPages.map((x) => x.page).join('、') : '無'}`);
    L.push(`- 與清單判定不同（不覆蓋，人工決定）：${patch.conflicts.length ? patch.conflicts.map((c) => `\`${c.key}\`（${c.current}→${c.suggestion}）`).join('、') : '無'}`);
    L.push(`- 套用規則：${patch.rule}`);
    L.push('');
  }
  return `${L.join('\n')}\n`;
}
