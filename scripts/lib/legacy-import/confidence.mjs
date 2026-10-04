// 信心計算（ARCHITECTURE 17.3）：型別對應明確 +0.4、owner 對應 +0.2、Markdown 無轉換警告 +0.2、附件全部找到 +0.1、無重複 +0.1。
// 權重放在規則檔 confidence 區塊；< thresholds.reviewConfidence（預設 0.6）⇒ 建議人工檢視。
export const DEFAULT_WEIGHTS = { type: 0.4, owner: 0.2, markdown: 0.2, attachments: 0.1, unique: 0.1 };

/** @param {{typeClear:boolean, ownerMapped:boolean, markdownClean:boolean, attachmentsOk:boolean, unique:boolean}} p */
export function computeConfidence(p, weights = DEFAULT_WEIGHTS) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const parts = {
    type: p.typeClear ? w.type : 0,
    owner: p.ownerMapped ? w.owner : 0,
    markdown: p.markdownClean ? w.markdown : 0,
    attachments: p.attachmentsOk ? w.attachments : 0,
    unique: p.unique ? w.unique : 0,
  };
  const sum = Object.values(parts).reduce((a, b) => a + b, 0);
  return { confidence: Math.round(sum * 100) / 100, parts };
}

export const needsReview = (confidence, rules) => confidence < (rules?.thresholds?.reviewConfidence ?? 0.6);

/** Markdown 轉換警告＝會讓「Markdown 無轉換警告」不得分的 issue code */
export const MARKDOWN_WARNING_CODES = new Set(['word-residue', 'table-complex', 'embedded-media', 'content-dropped', 'body-short', 'image-no-alt', 'image-missing', 'section-unassigned', 'faq-structure-missing']);
