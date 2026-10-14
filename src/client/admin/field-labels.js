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
  refNo: '公告字號', positions: '名額', budgetNtd: '預算金額', licenseNote: '授權備註', linkChecks: '連結檢查紀錄',
  // 第五十三輪：職缺、採購、疫情報導編輯頁的欄位（第五十二輪放在 edit-merge.js）。職缺、採購經閘道送審後，審核人的差異也要叫得出這些名字，所以移到這裡共用
  hiringUnit: '用人單位', jobType: '職類', workplace: '工作地點', salaryNote: '薪資待遇', qualifications: '資格條件', duties: '工作內容', applyStart: '報名開始日',
  applyMethod: '報名方式', examPlan: '甄試日程', resultPlannedAt: '結果預計公布日', attachments: '附件連結', amendments: '異動紀錄', manualStatus: '取消／補實',
  manualStatusNote: '取消／補實原因', result: '甄選結果', waitlistUpdates: '遞補公告', tenderNo: '標案案號', requestingUnit: '需求單位', method: '採購方式', awardRule: '決標原則',
  category: '標的分類', announcedAt: '公告日', openingAt: '開標日', briefingAt: '廠商說明會', pccUrl: '政府電子採購網連結', scope: '採購範圍', specialTerms: '特別條款',
  contractPeriod: '履約期限', award: '決標資訊', titleEn: '英文篇名', affiliations: '服務單位', articleType: '分類', keywordsEn: '英文關鍵字', doi: 'DOI', legacyDoiUrl: '舊 DOI 網址',
  receivedAt: '投稿日期', acceptedAt: '接受日期', abstractEn: '英文摘要', highlights: '重點三句話', figures: '圖表', references: '參考文獻', acknowledgementsMarkdown: '誌謝',
  pdfUrl: 'PDF', note: '備註', legacyIds: '舊內容 ID', postPublishReview: '上線後複核',
};
/** 差異顯示用的欄位名稱：認得的叫中文名，不認得的直接顯示欄位代碼（寧可難看，也不能漏報） */
export const fieldLabel = (field) => FIELD_LABELS[field] ?? DIFF_LABELS[field] ?? field;
