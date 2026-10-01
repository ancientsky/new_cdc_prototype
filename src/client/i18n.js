// 七語 UI 字串（Node 與瀏覽器共用）。內容翻譯在 content/*.json 的 i18n；這裡只有介面字。
// Agent C 補完全部字串；缺字 fallback 英文再 fallback 中文。
export const STRINGS = {
  'zh-TW': {
    'site.name': '衛生福利部疾病管制署', 'site.short': '疾管署', 'nav.public': '民眾', 'nav.pro': '醫事與防疫人員', 'nav.research': '研究與媒體',
    'home.h1': '想問什麼？一句話，得到整理好的答案', 'home.ask': '問', 'home.placeholder': '例如：小孩發燒起紅疹要不要看醫生',
    'home.situation': '現在的疫情', 'home.tasks': '你想做什麼', 'home.news': '最新消息', 'home.clar': '澄清專區', 'home.pro': '專業人員專區',
    'home.pro.sub': '依角色進入：醫師 · 護理 · 感染管制 · 檢驗 · 地方衛生單位 — 通報、送驗、病例定義、指引版本異動', 'home.enter': '進入',
    'status.stable': '平穩', 'status.rising': '上升', 'status.peak': '高峰', 'status.declining': '下降',
    'prov.owner': '權責單位', 'prov.reviewed': '最後審閱', 'prov.next': '下次審閱', 'prov.current': '現行版', 'prov.version': '版次', 'prov.effective': '生效日',
    'ai.badge': 'AI 整理', 'ai.disclosure': '依官方內容整理', 'feedback.helpful': '有幫助', 'feedback.report': '回報錯誤',
    'footer.about': '關於疾管署', 'footer.privacy': '隱私權與資料保護', 'footer.ai': 'AI 與資料使用聲明', 'footer.license': '開放資料授權', 'footer.api': '開發者 API', 'footer.a11y': '無障礙 AA',
    'skip': '跳到主要內容', 'hotline': '防疫專線 1922', 'a11y': '無障礙', 'sitemap': '網站導覽',
    'translation.reviewed': '已審核譯文', 'translation.machine': '機器翻譯 · 待審核', 'translation.none': '此語言無此頁 · 顯示中文原文',
    'pagedata.title': '本頁的資料與授權', 'pagedata.whitelist': '本頁可被 AI 引用（白名單）', 'pagedata.notwhitelist': '本頁目前不在 AI 白名單',
    'alert.paused': 'AI 問答暫停中。目前提供關鍵字搜尋與人工諮詢 1922。',
    'more': '更多', 'all': '全部', 'source': '來源', 'dataDate': '資料日',
  },
  en: {
    'site.name': 'Taiwan Centers for Disease Control', 'site.short': 'Taiwan CDC', 'nav.public': 'Public', 'nav.pro': 'Health professionals', 'nav.research': 'Research & media',
    'home.h1': 'Ask anything. Get one organized answer.', 'home.ask': 'Ask', 'home.placeholder': "e.g. I'm a migrant worker with fever and a rash. What should I do?",
    'home.situation': 'Current outbreaks in Taiwan', 'home.tasks': 'What do you need?', 'home.news': 'Latest news', 'home.clar': 'Fact check', 'home.pro': 'Health professionals',
    'home.pro.sub': 'By role: physician · nurse · infection control · lab · local health — reporting, specimens, case definitions, guideline changes', 'home.enter': 'Enter',
    'status.stable': 'Stable', 'status.rising': 'Rising', 'status.peak': 'Peak', 'status.declining': 'Declining',
    'prov.owner': 'Responsible unit', 'prov.reviewed': 'Last reviewed', 'prov.next': 'Next review', 'prov.current': 'Current version', 'prov.version': 'Version', 'prov.effective': 'Effective',
    'ai.badge': 'AI summary', 'ai.disclosure': 'from official content', 'feedback.helpful': 'Helpful', 'feedback.report': 'Report an error',
    'footer.about': 'About Taiwan CDC', 'footer.privacy': 'Privacy & data protection', 'footer.ai': 'AI & data use statement', 'footer.license': 'Open data licence', 'footer.api': 'Developer API', 'footer.a11y': 'Accessibility AA',
    'skip': 'Skip to main content', 'hotline': 'Hotline 1922', 'a11y': 'Accessibility', 'sitemap': 'Site map',
    'translation.reviewed': 'Reviewed translation', 'translation.machine': 'Machine translation · pending review', 'translation.none': 'Not available in this language · showing Chinese original',
    'pagedata.title': 'Data and licence for this page', 'pagedata.whitelist': 'This page may be cited by AI (whitelisted)', 'pagedata.notwhitelist': 'This page is currently not on the AI whitelist',
    'alert.paused': 'AI answers are paused. Keyword search and the 1922 hotline are available.',
    'more': 'More', 'all': 'All', 'source': 'Source', 'dataDate': 'Data as of',
  },
  ja: { 'site.name': '台湾衛生福利部疾病管制署', 'home.h1': '何でも聞いてください。整理された答えを一つ。', 'home.ask': '質問', 'home.situation': '台湾の現在の流行状況', 'home.tasks': '何をお探しですか', 'status.stable': '安定', 'status.rising': '増加', 'status.peak': 'ピーク', 'status.declining': '減少', 'hotline': '防疫ホットライン 1922', 'translation.machine': '機械翻訳 · 確認待ち' },
  tl: { 'site.name': 'Taiwan Centers for Disease Control', 'home.h1': 'Magtanong. Isang maayos na sagot.', 'home.ask': 'Itanong', 'home.situation': 'Kasalukuyang sitwasyon sa Taiwan', 'home.tasks': 'Ano ang kailangan mo?', 'status.stable': 'Matatag', 'status.rising': 'Tumataas', 'status.peak': 'Rurok', 'status.declining': 'Bumababa', 'hotline': 'Hotline 1922', 'translation.machine': 'Machine translation · hinihintay ang pagsusuri' },
  vi: { 'site.name': 'Trung tâm Kiểm soát Dịch bệnh Đài Loan', 'home.h1': 'Bạn muốn hỏi gì? Một câu hỏi, một câu trả lời rõ ràng.', 'home.ask': 'Hỏi', 'home.situation': 'Tình hình dịch bệnh hiện nay tại Đài Loan', 'home.tasks': 'Bạn cần gì?', 'status.stable': 'Ổn định', 'status.rising': 'Đang tăng', 'status.peak': 'Đỉnh dịch', 'status.declining': 'Đang giảm', 'hotline': 'Đường dây phòng dịch 1922 (có thông dịch)', 'translation.machine': 'Bản dịch máy · đang chờ kiểm duyệt' },
  id: { 'site.name': 'Pusat Pengendalian Penyakit Taiwan', 'home.h1': 'Tanyakan apa saja. Satu jawaban yang tertata.', 'home.ask': 'Tanya', 'home.situation': 'Situasi wabah saat ini di Taiwan', 'home.tasks': 'Apa yang Anda butuhkan?', 'status.stable': 'Stabil', 'status.rising': 'Meningkat', 'status.peak': 'Puncak', 'status.declining': 'Menurun', 'hotline': 'Hotline 1922', 'translation.machine': 'Terjemahan mesin · menunggu tinjauan' },
  th: { 'site.name': 'ศูนย์ควบคุมโรคไต้หวัน', 'home.h1': 'ถามอะไรก็ได้ รับคำตอบที่เรียบเรียงแล้ว', 'home.ask': 'ถาม', 'home.situation': 'สถานการณ์โรคระบาดในไต้หวันขณะนี้', 'home.tasks': 'คุณต้องการอะไร', 'status.stable': 'คงที่', 'status.rising': 'เพิ่มขึ้น', 'status.peak': 'จุดสูงสุด', 'status.declining': 'ลดลง', 'hotline': 'สายด่วน 1922', 'translation.machine': 'แปลด้วยเครื่อง · รอการตรวจสอบ' },
};

export function t(lang, key, vars = {}) {
  const s = STRINGS[lang]?.[key] ?? STRINGS.en?.[key] ?? STRINGS['zh-TW'][key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

if (typeof window !== 'undefined') { window.CDC = window.CDC || {}; window.CDC.t = (k, v) => t(document.documentElement.lang, k, v); }
