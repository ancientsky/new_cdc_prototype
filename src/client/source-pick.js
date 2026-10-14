// 來源語言正本的「內容欄位」（第五十一輪自 scripts/lib/load.mjs 抽出，建置與後台共用同一份）。
//
// 建置：sourceHashOf(item) = sha1(JSON.stringify(sourcePickOf(item)))，用來偵測譯文過期（ARCHITECTURE 14.2）。
// 後台：/admin/publish/?edit= 修改已上架內容時，用同一份欄位判斷「這次有沒有改到正本文字」；有改到才把既有譯文標成
// 「依據的是舊版正本」（languages[lang].sourceHash = 舊雜湊），交給治理規則 R5 顯示「中文已更新，譯文待複核」。
// 兩邊若各有一份清單，遲早會出現「後台說沒改到正本、建置說譯文過期」或反過來，所以只留這一份。
// 物件的鍵順序會影響雜湊值：不要調整順序，新增欄位請加在最後（加了就會讓所有內容的雜湊改變，請一併處理譯文狀態）。

/** @param {any} item */
export function sourcePickOf(item) {
  const pick = {
    title: item.title, summary: item.summary, question: item.question, answerMarkdown: item.answerMarkdown,
    bodyMarkdown: item.bodyMarkdown, blocks: item.blocks, keyFacts: item.keyFacts, machineReadableMarkdown: item.machineReadableMarkdown,
    clarificationMarkdown: item.clarificationMarkdown, claim: item.claim, publicFunded: item.publicFunded, headline: item.headline,
    transcriptMarkdown: item.transcriptMarkdown, introMarkdown: item.introMarkdown, steps: item.steps, abstractMarkdown: item.abstractMarkdown, specimens: item.specimens, articles: item.articles,
    // 第二十九輪：疫情報導文章的正文欄位
    highlights: item.highlights, figures: item.figures, references: item.references, authors: item.authors,
    // 連結檢查寫回的欄位（lastCheckedAt、status）不算內容變更，剔除後再雜湊
    links: item.links?.map(({ lastCheckedAt, status, ...rest }) => rest),
    forms: item.forms?.map(({ lastCheckedAt, status, ...rest }) => rest),
  };
  // 第七輪（ARCHITECTURE 15.1）：職缺與採購公告的正文欄位（只限 job／tender，其他型別雜湊不變；不含 result／waitlistUpdates／award：結果公告不影響譯文）
  if (item.type === 'job' || item.type === 'tender') {
    Object.assign(pick, { duties: item.duties, qualifications: item.qualifications, requiredDocuments: item.requiredDocuments, salaryNote: item.salaryNote, workplace: item.workplace, scope: item.scope, specialTerms: item.specialTerms });
  }
  return pick;
}
