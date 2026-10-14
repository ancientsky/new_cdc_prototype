// 給同事看的欄位名稱（第三十輪起在 scripts/lib/gateway/validate-item.mjs；第五十一輪移到這裡）。
// 閘道的錯誤訊息、審核人看到的欄位差異（field-diff.mjs）與上架頁「目前改動的欄位」（publish.js）共用同一份，
// 同一個欄位在三個地方叫同一個名字。純資料，瀏覽器與 Node 都能 import。

/** 錯誤訊息用的欄位名稱（validate-item.mjs 的 plainError 依這份判斷「訊息開頭是不是欄位」，新增鍵會改變錯誤訊息的歸屬，請小心） */
export const FIELD_LABELS = {
  id: '內容 ID', type: '型別', title: '標題', summary: '摘要', owner: '權責單位', steward: '承辦窗口', publishedAt: '發布日期', reviewedAt: '最後審閱日',
  reviewPeriodMonths: '審閱週期', status: '狀態', audience: '對象', sensitivity: '敏感等級', license: '授權', languages: '提供語言', tasks: '任務入口',
  keywords: '關鍵字', diseases: '相關疾病', vaccines: '相關疫苗', countries: '相關國家', basedOn: '依據正本', structured: '結構化欄位', assets: '附件與圖片',
  question: '問題', answerMarkdown: '答案內文', bodyMarkdown: '內文', clarificationMarkdown: '澄清說明', claim: '網傳訊息', verdict: '查證結果', shareText: '可轉傳短訊',
  introMarkdown: '簡介', abstractMarkdown: '摘要內文', machineReadableMarkdown: '文件全文', transcriptMarkdown: '逐字稿', blocks: '內容區塊', publishAt: '排程上線時間',
  urgent: '緊急發布', family: '文件系列', version: '版次', effectiveAt: '生效日', supersedes: '取代的版本', docType: '文件類型', newsType: '新聞類型', letterNo: '通函號',
  i18n: '其他語言譯文', aiWhitelist: 'AI 引用白名單', verification: '內容確認狀態', sourceLang: '來源語言', producedAt: '製作日期', mediaType: '影音類型',
  chapters: '章節', youtubeId: 'YouTube 影片', deadlineAt: '截止日', links: '相關連結', steps: '申請步驟', sections: '章節', authors: '作者', issueId: '卷期', articleNo: '篇次', pages: '頁碼',
};
export const labelOf = (field) => FIELD_LABELS[field] ?? field;

/** 只用在「改了哪些欄位」的顯示（不影響錯誤訊息的歸屬）：表單沒有、但修改時可能被改到的欄位也要叫得出名字 */
const DIFF_LABELS = {
  legacyUrls: '舊站網址', keyFacts: '重點摘要', slug: '網址代稱', nameEn: '英文名稱', legalCategory: '法定傳染病類別', notifyWithinHours: '通報時限',
  publicFunded: '公費對象', whoCanApply: '申請對象', requiredDocuments: '應備文件', forms: '表單下載', legalBasis: '法規依據', slaDays: '處理天數', fee: '費用',
  applyUrl: '線上申請網址', contact: '聯絡窗口', specimens: '檢體', labs: '檢驗單位', sendWithinHours: '送驗時限', disease: '疾病', profile: '首長簡介',
  kind: '專區類型', startAt: '開始日', endAt: '結束日', contentIds: '相關內容', image: '圖片', priority: '排序', serviceType: '服務類型', captions: '字幕',
  basedOnVersionLabel: '依據版本', pubType: '出版品類型', series: '系列', volume: '卷', issue: '期', edition: '版次', isbn: 'ISBN', issn: 'ISSN', gpn: 'GPN',
  articles: '篇目', year: '年度', projectStatus: '計畫狀態', fundingType: '經費來源', projectNo: '計畫編號', piUnit: '主持單位', datasets: '資料集',
  refNo: '案號', positions: '名額', budgetNtd: '預算金額', licenseNote: '授權備註', linkChecks: '連結檢查紀錄',
};
/** 差異顯示用的欄位名稱：認得的叫中文名，不認得的直接顯示欄位代碼（寧可難看，也不能漏報） */
export const fieldLabel = (field) => FIELD_LABELS[field] ?? DIFF_LABELS[field] ?? field;
