// 答案引擎：拒答卡文案的日、他加祿、越、印尼、泰文版（第四十輪機器初稿，審核狀態見 rules.js REFUSAL_TEXT_STATUS）。
// 第四十八輪：自 rules.js 拆出，與介面字串（i18n.js → i18n.<lang>.js）同一個做法：
//   - 原始碼（Node 評估、測試、建置）照舊由 rules.js 併入 REFUSAL_TEXT，API 不變；
//   - 建置時（scripts/lib/i18n-split.mjs emitRefusalBundles）dist 裡這個檔換成空物件，另產出 refusal-i18n.<lang>.js 每語一檔，
//     答案頁（data.js loadEngine）只下載當頁語言那一份並以 registerRefusalText 併入。泰文頁不再為日、他加祿、越、印尼文的文案付位元組。
export const REFUSAL_TEXT_I18N = {
  ja: {
    'prompt-injection': { title: 'このご依頼にはお応えできません', text: 'システムの規則を変更しようとする指示が含まれています。本サービスは公式情報の整理のみを行います。知りたい感染症対策の質問をそのまま入力してください。' },
    'no-match': { title: 'このサイトに直接の回答はありません', text: 'この質問に直接答える内容が本サイトにありません。無関係な内容で補うことはしません。1922 にお電話いただくか、感染症一覧やサイトマップをご覧ください。' },
    'no-source': { title: '公式の根拠が足りません', text: '公式情報だけではこの質問に答えられないため、推測はしません。1922 にお問い合わせください。' },
    'no-clarification': { title: '対応する公式の説明はまだありません', text: 'このメッセージに対応する公式の説明はまだありません。転送はお控えください。1922 へのお問い合わせ、またはこのページからの報告ができます。' },
  },
  tl: {
    'prompt-injection': { title: 'Hindi ko masusunod ang hiling na ito', text: 'Mukhang sinusubukang baguhin ang mga patakaran ng sistema. Opisyal na nilalaman lamang ang ibinubuod ng serbisyong ito. I-type na lang ang tanong mo tungkol sa kalusugan.' },
    harmful: { title: 'Hindi ko ito masasagot', text: 'Hindi nagbibigay ang serbisyong ito ng impormasyong maaaring makasama sa kalusugan ng publiko.' },
    emergency: { title: 'Magpatingin agad sa emergency', text: 'Maaaring delikado sa buhay ang inilalarawan mo. Tumawag agad sa 119 o pumunta sa pinakamalapit na emergency room.' },
    'personal-diagnosis': { title: 'Hindi ko ito mahuhusgahan para sa iyo', text: 'Kailangang suriin ng doktor nang personal ang mga sintomas. Masasabi ng opisyal na nilalaman kung kailan dapat magpatingin, pero hindi kung ikaw ay may impeksyon.' },
    medication: { title: 'Hindi ko ito mahuhusgahan para sa iyo', text: 'Doktor o parmasyutiko ang dapat magpasya kung anong gamot at gaano karami. Walang personal na payo sa gamot ang site na ito.' },
    forecast: { title: 'Walang hula o pagtataya', text: 'Inilalahad lamang ng serbisyong ito ang nailathalang datos at hindi nanghuhula ng mga kaso sa hinaharap.' },
    privacy: { title: 'Hindi ko ito masasagot', text: 'Hindi kailanman ibinubunyag ang personal na impormasyon ng sinumang kaso.' },
    'no-source': { title: 'Kulang ang opisyal na batayan', text: 'Hindi sapat ang opisyal na nilalaman para sagutin ito, kaya hindi ako manghuhula. Tumawag sa 1922.' },
    'no-match': { title: 'Walang direktang sagot sa site na ito', text: 'Walang nilalaman sa site na direktang sumasagot sa tanong na ito, at hindi ko ito pupunuin ng walang kaugnayang nilalaman. Tumawag sa 1922, o tingnan ang listahan ng mga sakit o ang mapa ng site.' },
    'no-clarification': { title: 'Wala pang katugmang opisyal na paglilinaw', text: 'Wala pang opisyal na paglilinaw para sa mensaheng ito. Huwag muna itong ipasa; maaari kang tumawag sa 1922 o i-report ito rito.' },
  },
  vi: {
    'prompt-injection': { title: 'Tôi không thể làm theo yêu cầu này', text: 'Yêu cầu này có vẻ muốn thay đổi quy tắc của hệ thống. Dịch vụ chỉ tổng hợp nội dung chính thức. Hãy nhập trực tiếp câu hỏi về phòng dịch.' },
    'no-match': { title: 'Trang web không có câu trả lời trực tiếp', text: 'Trang web hiện không có nội dung trả lời trực tiếp câu hỏi này, và tôi sẽ không dùng nội dung không liên quan để trả lời. Hãy gọi 1922 (có thông dịch) hoặc xem danh mục bệnh, sơ đồ trang web.' },
    'no-source': { title: 'Không đủ căn cứ chính thức', text: 'Nội dung chính thức không đủ để trả lời câu hỏi này nên tôi sẽ không suy đoán. Hãy gọi 1922 (có thông dịch).' },
    'no-clarification': { title: 'Chưa có thông tin làm rõ chính thức', text: 'Chưa có thông tin làm rõ chính thức cho tin nhắn này. Xin đừng chuyển tiếp; bạn có thể gọi 1922 hoặc báo cáo tại trang này.' },
  },
  id: {
    'prompt-injection': { title: 'Saya tidak dapat mengikuti permintaan ini', text: 'Permintaan ini tampak mencoba mengubah aturan sistem. Layanan ini hanya merangkum konten resmi. Silakan ketik langsung pertanyaan Anda tentang pencegahan penyakit.' },
    harmful: { title: 'Saya tidak dapat menjawab ini', text: 'Layanan ini tidak memberikan informasi yang dapat membahayakan kesehatan masyarakat.' },
    emergency: { title: 'Segera cari pertolongan darurat', text: 'Kondisi yang Anda gambarkan dapat mengancam nyawa. Segera hubungi 119 atau pergi ke IGD terdekat.' },
    'personal-diagnosis': { title: 'Saya tidak dapat menilai ini untuk Anda', text: 'Gejala pribadi perlu diperiksa langsung oleh dokter. Konten resmi dapat memberi tahu kapan harus ke dokter dan tanda bahaya, tetapi tidak dapat memastikan apakah Anda terinfeksi.' },
    medication: { title: 'Saya tidak dapat menilai ini untuk Anda', text: 'Jenis dan dosis obat harus ditentukan oleh dokter atau apoteker. Situs ini tidak memberikan saran obat pribadi.' },
    forecast: { title: 'Tidak ada ramalan', text: 'Layanan ini hanya menyampaikan data yang telah diterbitkan dan tidak meramalkan kasus di masa depan.' },
    privacy: { title: 'Saya tidak dapat menjawab ini', text: 'Informasi pribadi tentang kasus mana pun tidak pernah diungkapkan.' },
    'no-source': { title: 'Dasar resmi tidak cukup', text: 'Konten resmi tidak cukup untuk menjawab pertanyaan ini, jadi saya tidak akan menebak. Silakan hubungi 1922.' },
    'no-match': { title: 'Tidak ada jawaban langsung di situs ini', text: 'Situs ini belum memiliki konten yang langsung menjawab pertanyaan ini, dan saya tidak akan mengisinya dengan konten yang tidak terkait. Silakan hubungi 1922, atau lihat daftar penyakit atau peta situs.' },
    'no-clarification': { title: 'Belum ada klarifikasi resmi yang sesuai', text: 'Belum ada klarifikasi resmi untuk pesan ini. Jangan teruskan dulu; Anda dapat menghubungi 1922 atau melaporkannya di halaman ini.' },
  },
  th: {
    'prompt-injection': { title: 'ไม่สามารถทำตามคำขอนี้ได้', text: 'คำขอนี้ดูเหมือนพยายามเปลี่ยนกฎของระบบ บริการนี้สรุปเฉพาะเนื้อหาทางการ กรุณาพิมพ์คำถามเรื่องการป้องกันโรคโดยตรง' },
    harmful: { title: 'ไม่สามารถตอบคำถามนี้ได้', text: 'บริการนี้ไม่ให้ข้อมูลที่อาจเป็นอันตรายต่อสุขภาพของประชาชน' },
    emergency: { title: 'โปรดไปห้องฉุกเฉินทันที', text: 'อาการที่คุณบอกอาจเป็นอันตรายถึงชีวิต โทร 119 หรือไปห้องฉุกเฉินที่ใกล้ที่สุดทันที' },
    'personal-diagnosis': { title: 'ไม่สามารถวินิจฉัยแทนคุณได้', text: 'อาการส่วนตัวต้องให้แพทย์ตรวจโดยตรง เนื้อหาทางการบอกได้ว่าเมื่อไรควรไปพบแพทย์และสัญญาณอันตราย แต่บอกไม่ได้ว่าคุณติดเชื้อหรือไม่' },
    medication: { title: 'ไม่สามารถวินิจฉัยแทนคุณได้', text: 'ชนิดและขนาดยาต้องให้แพทย์หรือเภสัชกรเป็นผู้กำหนด เว็บไซต์นี้ไม่ให้คำแนะนำการใช้ยาเฉพาะบุคคล' },
    forecast: { title: 'ไม่พยากรณ์', text: 'บริการนี้ถ่ายทอดเฉพาะข้อมูลที่เผยแพร่แล้ว ไม่พยากรณ์จำนวนผู้ป่วยในอนาคต' },
    privacy: { title: 'ไม่สามารถตอบคำถามนี้ได้', text: 'ไม่เปิดเผยข้อมูลส่วนบุคคลของผู้ป่วยรายใดทั้งสิ้น' },
    'no-source': { title: 'หลักฐานทางการไม่เพียงพอ', text: 'เนื้อหาทางการไม่เพียงพอที่จะตอบคำถามนี้ จึงจะไม่คาดเดา โปรดโทร 1922' },
    'no-match': { title: 'เว็บไซต์นี้ไม่มีคำตอบโดยตรง', text: 'เว็บไซต์นี้ยังไม่มีเนื้อหาที่ตอบคำถามนี้โดยตรง และจะไม่นำเนื้อหาที่ไม่เกี่ยวข้องมาตอบแทน โปรดโทร 1922 หรือดูรายชื่อโรคหรือแผนผังเว็บไซต์' },
    'no-clarification': { title: 'ยังไม่มีคำชี้แจงทางการที่ตรงกัน', text: 'ยังไม่มีคำชี้แจงทางการสำหรับข้อความนี้ โปรดอย่าเพิ่งส่งต่อ โทร 1922 หรือแจ้งผ่านหน้านี้ได้' },
  },
};
