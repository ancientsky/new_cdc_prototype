// /pending/：尚未遷移到新站的文件（表單、PDF、附件）的落地頁。noindex，七語皆輸出（站內連結帶語言前綴也不會 404）。
// 內容欄位用 /pending/?ref=<內容 id>&doc=<文件名稱> 取代佔位網址；本頁在 client 端讀 query：
//   - doc：顯示文件名稱（只用 textContent，不信任輸入）
//   - ref：先查建置時嵌入的對照表（所有被 /pending/ 引用的內容：標題、來源頁、權責單位），查不到再載 v1/catalog.json 反查；
//          都查不到才用 document.referrer（同源）當「回到來源頁」。
// 現行官網文件庫入口 https://www.cdc.gov.tw/Category/DiseaseManual（真實列表頁路由）。
import { html, raw, jsonScript } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { pageHead, hrefFor, unitName, L } from './_partials.mjs';

export const LEGACY_LIBRARY_URL = 'https://www.cdc.gov.tw/Category/DiseaseManual';

const S = {
  'zh-TW': {
    title: '文件尚未遷移', lead: '這份文件尚未遷移到新站。',
    body: '這份文件（{doc}）尚未遷移到新站，正式上線前由權責單位{owner}提供；原型期間請洽 1922 或至現行官網文件庫。',
    docFallback: '你點選的文件', ownerFallback: '', back: '回到來源頁：', legacy: '現行官網文件庫', call: '撥打防疫專線 1922', home: '回首頁',
    why: '為什麼會看到這頁？', whyText: '新官網原型只收錄已結構化、可機讀的內容；表單、PDF 與附件會在權責單位確認版本後逐批遷移，遷移前一律導到這裡，不會連到失效網址。',
  },
  en: {
    title: 'Document not yet migrated', lead: 'This document has not been migrated to the new site yet.',
    body: 'This document ({doc}) has not been migrated to the new site yet. It will be provided by the responsible unit{owner} before launch. During the prototype, please call 1922 or use the document library on the current website.',
    docFallback: 'the document you selected', ownerFallback: '', back: 'Back to: ', legacy: 'Document library on the current website (Chinese)', call: 'Call the 1922 hotline', home: 'Back to home',
    why: 'Why am I seeing this?', whyText: 'The prototype only includes structured, machine-readable content. Forms, PDFs and attachments are migrated in batches once the responsible unit confirms the version; until then, links lead here instead of to a broken address.',
  },
  ja: {
    title: '未移行の文書', lead: 'この文書はまだ新サイトに移行されていません。',
    body: 'この文書（{doc}）はまだ新サイトに移行されていません。正式公開までに担当部署{owner}が提供します。プロトタイプ期間中は 1922 にお電話いただくか、現行サイトの文書ライブラリをご利用ください。',
    docFallback: '選択した文書', ownerFallback: '', back: '元のページに戻る：', legacy: '現行サイトの文書ライブラリ（中国語）', call: '1922 に電話', home: 'ホームへ戻る',
    why: 'このページが表示される理由', whyText: 'プロトタイプには構造化された機械可読コンテンツのみを収録しています。書式・PDF・添付ファイルは担当部署が版を確認した後に順次移行します。',
  },
  tl: {
    title: 'Hindi pa nailipat ang dokumento', lead: 'Hindi pa nailipat sa bagong site ang dokumentong ito.',
    body: 'Hindi pa nailipat sa bagong site ang dokumentong ito ({doc}). Ibibigay ito ng responsableng yunit{owner} bago ang opisyal na paglulunsad. Habang prototype pa, tumawag sa 1922 o gamitin ang document library ng kasalukuyang website.',
    docFallback: 'ang dokumentong pinili mo', ownerFallback: '', back: 'Bumalik sa: ', legacy: 'Document library ng kasalukuyang website (Chinese)', call: 'Tumawag sa 1922', home: 'Bumalik sa home',
    why: 'Bakit ko ito nakikita?', whyText: 'Ang prototype ay may structured at machine-readable na nilalaman lamang. Ang mga form, PDF at attachment ay ililipat kapag nakumpirma ng responsableng yunit ang bersyon.',
  },
  vi: {
    title: 'Tài liệu chưa được chuyển', lead: 'Tài liệu này chưa được chuyển sang trang web mới.',
    body: 'Tài liệu này ({doc}) chưa được chuyển sang trang web mới; đơn vị phụ trách{owner} sẽ cung cấp trước khi ra mắt chính thức. Trong giai đoạn thử nghiệm, vui lòng gọi 1922 hoặc dùng thư viện tài liệu của trang web hiện tại.',
    docFallback: 'tài liệu bạn đã chọn', ownerFallback: '', back: 'Quay lại: ', legacy: 'Thư viện tài liệu của trang web hiện tại (tiếng Trung)', call: 'Gọi 1922', home: 'Về trang chủ',
    why: 'Vì sao tôi thấy trang này?', whyText: 'Bản thử nghiệm chỉ gồm nội dung có cấu trúc, máy đọc được. Biểu mẫu, PDF và tệp đính kèm sẽ được chuyển dần sau khi đơn vị phụ trách xác nhận phiên bản.',
  },
  id: {
    title: 'Dokumen belum dipindahkan', lead: 'Dokumen ini belum dipindahkan ke situs baru.',
    body: 'Dokumen ini ({doc}) belum dipindahkan ke situs baru; unit penanggung jawab{owner} akan menyediakannya sebelum peluncuran resmi. Selama masa prototipe, hubungi 1922 atau gunakan perpustakaan dokumen di situs saat ini.',
    docFallback: 'dokumen yang Anda pilih', ownerFallback: '', back: 'Kembali ke: ', legacy: 'Perpustakaan dokumen situs saat ini (bahasa Mandarin)', call: 'Hubungi 1922', home: 'Kembali ke beranda',
    why: 'Mengapa saya melihat halaman ini?', whyText: 'Prototipe hanya memuat konten terstruktur yang dapat dibaca mesin. Formulir, PDF, dan lampiran dipindahkan bertahap setelah unit penanggung jawab mengonfirmasi versinya.',
  },
  th: {
    title: 'เอกสารยังไม่ได้ย้าย', lead: 'เอกสารนี้ยังไม่ได้ย้ายมายังเว็บไซต์ใหม่',
    body: 'เอกสารนี้ ({doc}) ยังไม่ได้ย้ายมายังเว็บไซต์ใหม่ หน่วยงานที่รับผิดชอบ{owner}จะจัดให้ก่อนเปิดใช้งานจริง ระหว่างช่วงต้นแบบ โปรดโทร 1922 หรือใช้คลังเอกสารของเว็บไซต์ปัจจุบัน',
    docFallback: 'เอกสารที่คุณเลือก', ownerFallback: '', back: 'กลับไปที่: ', legacy: 'คลังเอกสารของเว็บไซต์ปัจจุบัน (ภาษาจีน)', call: 'โทร 1922', home: 'กลับหน้าแรก',
    why: 'ทำไมจึงเห็นหน้านี้', whyText: 'ต้นแบบนี้มีเฉพาะเนื้อหาที่มีโครงสร้างและเครื่องอ่านได้ แบบฟอร์ม PDF และไฟล์แนบจะย้ายเป็นระยะหลังหน่วยงานรับผิดชอบยืนยันฉบับ',
  },
};
const s = (lang) => S[lang] ?? S['zh-TW'];

/** 掃內容找出所有 /pending/?ref=… 的 ref（建置時嵌入對照表用） */
export function pendingRefs(site) {
  const refs = new Set();
  const visit = (v) => {
    if (typeof v === 'string') { for (const m of v.matchAll(/\/pending\/\?ref=([^&"#\s]+)/g)) refs.add(decodeURIComponent(m[1])); return; }
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'gov' && k !== 'legacyUrls') visit(x);
  };
  for (const item of site.all ?? []) visit(item);
  return [...refs].sort();
}

function refMap(ctx) {
  const out = {};
  for (const id of pendingRefs(ctx.site)) {
    const item = ctx.site.byId?.get(id);
    if (!item) continue;
    out[id] = { title: L(ctx, item, 'title') ?? item.title, href: hrefFor(ctx, item), owner: unitName(ctx, item.owner) };
  }
  return out;
}

export function meta(ctx) {
  const x = s(ctx.lang);
  return { title: x.title, description: x.lead, noindex: true, bodyClass: 'page-pending' };
}

export function render(ctx) {
  const { url, lang, t } = ctx;
  const x = s(lang);
  const [pre, post] = x.body.split('{doc}');
  const [mid, tail] = post.split('{owner}');
  const cjk = lang === 'zh-TW' || lang === 'ja';
  const data = { base: config.basePath, refs: refMap(ctx), catalog: url('/v1/catalog.json', { noLang: true }), docFallback: x.docFallback, paren: cjk ? ['（', '）'] : [' (', ')'] };
  return html`${pageHead(ctx, { trail: [{ label: x.title }], h1: x.title, lead: x.lead })}
<section class="c-callout c-pending" aria-labelledby="pd-h">
  <h2 id="pd-h" class="sr-only">${x.title}</h2>
  <p class="c-pending__msg">${pre}<strong data-pd-doc>${x.docFallback}</strong>${mid}<span data-pd-owner></span>${tail}</p>
  <p class="c-pending__back" data-pd-back hidden>${x.back}<a href="${url('/')}" data-pd-back-link></a></p>
</section>
<ul class="c-linklist c-pending__links">
  <li><a href="tel:1922">${x.call}</a></li>
  <li><a href="${LEGACY_LIBRARY_URL}" rel="noopener">${x.legacy}<span aria-hidden="true"> ↗</span><span class="sr-only"> (${t('external')})</span></a></li>
  <li><a href="${url('/')}">${x.home}</a></li>
</ul>
<section class="c-block" aria-labelledby="pd-why"><h2 id="pd-why">${x.why}</h2><p class="muted">${x.whyText}</p></section>
<script type="application/json" id="pending-data">${raw(jsonScript(data))}</script>
<script>${raw(CLIENT)}</script>`;
}

// client：只用 textContent／href，不插入 HTML
const CLIENT = `(function(){
  var el=document.getElementById('pending-data'); if(!el) return;
  var D={}; try{D=JSON.parse(el.textContent)}catch(e){}
  var q=new URLSearchParams(location.search), ref=q.get('ref')||'', doc=(q.get('doc')||'').trim().slice(0,200);
  var $=function(s){return document.querySelector(s)};
  if(doc){ $('[data-pd-doc]').textContent=doc; document.title=doc+' | '+document.title; }
  function show(title,href,owner){
    if(owner){ var pr=D.paren||['（','）']; $('[data-pd-owner]').textContent=pr[0]+owner+pr[1]; }
    if(href && /^\\//.test(href)){ var a=$('[data-pd-back-link]'); a.href=href; a.textContent=title||href; $('[data-pd-back]').hidden=false; }
  }
  function fromReferrer(){
    try{ var r=new URL(document.referrer); if(r.origin===location.origin && r.pathname.indexOf('/pending/')<0) show(r.pathname,r.pathname+r.search+r.hash,''); }catch(e){}
  }
  var hit=ref && D.refs && D.refs[ref];
  if(hit){ show(hit.title,hit.href,hit.owner); return; }
  if(!ref){ fromReferrer(); return; }
  fetch(D.catalog).then(function(r){return r.ok?r.json():null}).then(function(c){
    var it=c&&(c.data||[]).filter(function(x){return x.id===ref})[0];
    if(it){ var p; try{p=new URL(it.page,location.href).pathname}catch(e){} show(it.title,p,it.ownerName); } else fromReferrer();
  }).catch(fromReferrer);
})();`;

export function pages() { return [{ path: '/pending/', lang: '*', noindex: true, props: {} }]; }
