// 使用指南 /guide/：民眾怎麼用／公衛醫療專業人員怎麼用／同事怎麼管
// 沒有 JS 時三段全部顯示；pro.js 會把它們變成分頁（網址 #public / #pro / #staff）。
import { html } from '../../../scripts/lib/render.mjs';
import { proStyles } from '../pro/_styles.mjs';

export function pages() { return [{ path: '/guide/', lang: 'zh-TW' }]; }

export function meta() {
  return {
    title: '使用指南',
    description: '民眾、公衛醫療專業人員與同事各自怎麼使用這個網站：一句話提問、三層露出、版本異動、訂閱、Steward 日常工作與系統自動做的事。',
    scripts: ['/assets/js/pro.js'],
  };
}

const shot = (label) => html`<div class="pf-shot" role="img" aria-label="截圖位置：${label}">截圖位置：${label}</div>`;

export function render(ctx) {
  const { url } = ctx;
  const A = (path, label) => html`<a href="${url(path)}">${label}</a>`;
  const tasks = ctx.site.config.tasks;
  const auto = [
    ['下次審閱日計算', '填好 reviewedAt 與審閱週期，nextReviewAt 與「剩幾天」由系統算，不用記。'],
    ['逾期退白名單＋警示', '超過下次審閱日，頁首出現黃色警示，內容立刻退出 AI 白名單，並進入權責單位待辦。'],
    ['版本鏈失效標示', '文件新版發布，舊版自動標紅色警示、noindex、退出索引，並在 redirects.json 增一筆 301。'],
    ['基於正本修訂的加註與待辦', '正本（basedOn 指向的文件）有新版，衍生的新聞稿、Q&A 自動加註「相關建議已於…修訂」，退出白名單，並給權責單位 7 日待辦。'],
    ['反向稽核', '主檔或文件宣告的規則（例如 MMR 不得再出現「1981 年」）掃描全站文字，命中就開待辦。'],
    ['翻譯過期標示', '中文正本改了，譯文的 sourceHash 對不上，該語言頁標「中文已更新，譯文待複核」。'],
    ['資料集時效與授權告警', '超過更新頻率、或授權不在 OGDL-1.0／CC0／CC BY 4.0，開待辦。'],
    ['KPI 與季報', '治理 KPI 與 AI 透明報告每次建置重算，不需要手動整理報表。'],
    ['評估集閘門', '版本題只要有一題引用到失效版，建置失敗，不能發布。'],
  ];
  const who = [
    ['公關室', '內容總編輯：新聞稿、澄清、首頁 Banner、對外措辭；錯答回報的第一線分派。'],
    ['資訊室', '平台與資安：部署、CI、每日排程、網域與備援；AI 暫停開關的技術後盾。'],
    ['OASIS', '目錄與詞彙標準：白名單政策、詞彙主檔、資料目錄、授權檢核、評估集。'],
    ['各組（Data Steward）', '疾病、疫苗、指引等正本內容的審閱與修訂；處理自己名下的待辦。'],
    ['疫情中心', '態勢層四級狀態的人工發布、nidss 資料集 Owner。'],
  ];
  return html`${proStyles}
<div class="pf">
  <h1>使用指南</h1>
  <p class="lead">同一個網站，三種人用法不同。選你的身分，看對應的步驟；每段都附可直接點開的頁面。文字版完整說明在 <code>docs/</code> 資料夾。</p>
  <ul class="pf-tabs" role="list" aria-label="選擇身分">
    <li><a href="#public" data-tab-link="public">民眾怎麼用</a></li>
    <li><a href="#pro" data-tab-link="pro">公衛醫療專業人員怎麼用</a></li>
    <li><a href="#staff" data-tab-link="staff">同事怎麼管</a></li>
  </ul>

  <div data-tabs-root>
  <section id="public" data-tab="public" aria-labelledby="public-h">
    <h2 id="public-h">民眾怎麼用</h2>
    <ol class="pf-steps">
      <li><strong>一句話問。</strong>在 ${A('/', '首頁')}的問題框用平常說話的方式問，例如「小孩發燒起紅疹要不要看醫生」。系統會整理出答案頁，不用先知道要去哪個分類找。</li>
      <li><strong>先看「現在的疫情」態勢卡。</strong>首頁與 ${A('/situation/', '疫情頁')}有四級狀態（平穩、上升、高峰、下降）、本週數字與資料日。狀態由疫情中心人工發布，不是 AI 猜的。</li>
      <li><strong>六個常見任務。</strong>${tasks.map((k, i) => html`${i ? '、' : ''}${A(`/tasks/${k.key}/`, k.label)}`)}。</li>
      <li><strong>看懂答案頁的三層資訊。</strong>預設只有一行「權責單位 · 最後審閱」與每句話後面的來源編號；內容過期或被取代時，頁首會出現黃色或紅色警示；想核對時展開「來源卡」與「本頁的資料與授權」，看到原文、版本、授權與 API。</li>
      <li><strong>發現錯誤就回報。</strong>每則答案底下有「回報錯誤」，會自動帶入稽核編號（A-年月日-四碼）。回報會交給該內容的權責單位。</li>
      <li><strong>七種語言。</strong>右上角切換繁中、English、日本語、Tagalog、Tiếng Việt、Bahasa Indonesia、ไทย。譯文分「已審核」與「機器翻譯 · 待審核」兩種標示；沒有該語言的頁面會顯示中文原文並說明。</li>
      <li><strong>AI 無法回答的事。</strong>個人症狀判斷、用藥劑量、法律責任、尚未發布的疫情，系統會拒答並請你撥打 <a href="tel:1922">1922</a> 防疫專線（0800-001922）。</li>
    </ol>
    ${shot('首頁問題框與態勢卡')}
    ${shot('答案頁：來源編號、來源卡展開、回報錯誤')}
    <p>延伸：${A('/ask/', '提問頁')} · ${A('/factcheck/', '謠言查證')} · ${A('/accessibility/', '無障礙說明')} · ${A('/policy/ai/', 'AI 與資料使用聲明')}。完整版：<code>docs/guide-public.md</code>。</p>
  </section>

  <section id="pro" data-tab="pro" aria-labelledby="pro-h">
    <h2 id="pro-h">公衛醫療專業人員怎麼用</h2>
    <ol class="pf-steps">
      <li><strong>切換身分。</strong>點頁首「醫事與防疫人員」，或在任何網址加上 <code>?view=pro</code>，進入專業模式。設定記在這台瀏覽器；公開指引不需要登入。</li>
      <li><strong>選角色。</strong>在 ${A('/pro/', '專業人員專區')}選醫師、護理、感染管制、檢驗或地方衛生單位，下方文件與常用作業會依角色重新排序。</li>
      <li><strong>專業問答。</strong>專業問題框會用專業模式回答：直接引用手冊條次與生效日，不做白話化，只引用<em>現行版</em>文件。</li>
      <li><strong>核對版本與異動。</strong>專區的「指引與手冊版本異動」列出每份文件的現行版與前版；按「查看異動對照」看逐段前後差異。舊版標示失效但仍可查閱。</li>
      <li><strong>引用本頁。</strong>專業模式下頁面有「引用本頁」，複製格式為：<code>衛生福利部疾病管制署（審閱日 審閱）。標題。網址（版次，生效 日期）</code>。</li>
      <li><strong>訂閱異動。</strong>在「我的訂閱」勾選關注項目；可複製 RSS/Atom 網址（<code>/feeds/documents.xml</code>）或下載 .ics，把下次審閱日加進行事曆。原型不會真的寄信。</li>
      <li><strong>通報、送驗、處置。</strong>「常用作業」直接連到現行通報系統 NIDRS、檢體送驗規定、臨床處置指引與感染管制查核。</li>
      <li><strong>機讀版與 API。</strong>每頁有同名 <code>.md</code> 機讀版；系統整合請見 ${A('/developers/', '開發者入口')}。</li>
    </ol>
    ${shot('專業人員專區：角色、版本異動、常用作業')}
    ${shot('文件頁：版本鏈與異動對照')}
    <p>延伸：${A('/documents/', '文件庫')} · ${A('/developers/', '開發者入口')} · ${A('/transparency/', 'AI 透明報告')}。完整版：<code>docs/guide-professional.md</code>。</p>
  </section>

  <section id="staff" data-tab="staff" aria-labelledby="staff-h">
    <h2 id="staff-h">同事怎麼管</h2>
    <h3>Steward 日常只做三件事</h3>
    <ol class="pf-steps">
      <li><strong>填對欄位。</strong>上架時填權責單位、審閱日與週期、對象、依據正本（basedOn）、提供語言。缺必填欄位，建置不會通過。</li>
      <li><strong>處理待辦。</strong>每週看 ${A('/admin/todos/', '待辦頁')}與 ${A('/admin/due/', '審閱到期')}；待辦由系統產生，處理完（改內容並更新審閱日）自動消失。</li>
      <li><strong>確認預處理。</strong>在 ${A('/admin/publish/', '上架頁')}送出預處理後，確認關鍵字、摘要、一致性檢查與多語初稿，再匯出 JSON。</li>
    </ol>
    <h3>系統自動做的事</h3>
    <div class="pf-table-wrap"><table class="pf-table"><thead><tr><th scope="col">自動項目</th><th scope="col">做什麼</th></tr></thead><tbody>
      ${auto.map(([k, v]) => html`<tr><th scope="row">${k}</th><td>${v}</td></tr>`)}
    </tbody></table></div>
    <h3>誰負責什麼</h3>
    <dl class="pf-dl">${who.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
    <h3>正式環境流程</h3>
    <p><code>content/</code> 改檔 → 開 Pull Request → CI 驗證（schema、治理規則、評估集）→ 合併即發布。後台是同一流程的操作面：產生可直接放進 <code>content/</code> 的 JSON，不直接寫入伺服器。</p>
    ${shot('後台儀表板：KPI 與待辦')}
    <p>後台入口：<a href="${url('/admin/', { noLang: true })}">/admin/</a> ·
      ${A('/admin/publish/', '上架')} · ${A('/admin/review/', '複核')} · ${A('/admin/due/', '審閱到期')} · ${A('/admin/todos/', '待辦')} · ${A('/admin/situation/', '態勢發布')} · ${A('/admin/ai-status/', 'AI 開關')} · ${A('/admin/reports/', '錯答回報')} · ${A('/admin/eval/', '評估')}。
      完整 SOP：<code>docs/guide-staff.md</code>、<code>docs/governance-model.md</code>。</p>
  </section>
  </div>
</div>`;
}
