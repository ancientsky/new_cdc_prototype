// 第四十六輪：疫情報導 PDF 解析修正——pdf-manuscript.js 依座標還原表格、略過圖內文字；splitManuscript 抓作者／頁碼／篇名／表格內容的新規則。
// 全部用小型合成輸入（字塊座標或版面文字），不讀真實 PDF、不載入 pdf.js。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linesFromItems, tableToMarkdown, tablesFromLines, chartTextLines, pageText, manuscriptText } from '../src/client/admin/pdf-manuscript.js';
import { splitManuscript } from '../src/client/bulletin-rules.js';
import { emptyState, applyManuscript } from '../src/client/admin/bulletin-edit-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 分類主檔直接讀 JSON（與 round35 的 site.master.bulletinCategories 同一份），不用整站建置
const CATS = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/master/bulletin-categories.json'), 'utf8'));
const TODAY = '2026-10-13';
const S = (text) => splitManuscript(text, { categories: CATS });

/** 合成字塊：w 預設為「字數 × 0.9 em」（中文字寬），拉丁字或數字可另給較窄的 w */
const it = (str, x, y, size = 10, w) => ({ str, x, y, w: w ?? str.length * size * 0.9, h: size, size });
/** 同一基線的一列字塊：[[文字, x, w?], …] */
const row = (y, cells) => cells.map(([s, x, w]) => it(s, x, y, 10, w));
const cellTexts = (lines) => lines.map((l) => l.cells.map((c) => c.text));

/* ───────── 1. linesFromItems ───────── */
test('linesFromItems：儲存格帶著字塊；拉丁字相鄰補一個空白；中文字超過 0.6 em 才切格', () => {
  // 拉丁字之間只差 0.2 em（pdf.js 常把一個英文詞切成兩塊）：要補空白，否則「Hello World」會黏成「HelloWorld」
  const lines = linesFromItems([it('Hello', 100, 50, 10, 25), it('World', 127, 50, 10, 25), it('甲', 100, 70), it('乙', 120, 70), it('丙', 200, 70)]);
  assert.equal(lines[0].text, 'Hello World');
  assert.deepEqual(lines[0].cells.map((c) => [c.text, c.items.length]), [['Hello World', 2]], '間距不到 0.6 em：同一格、兩個字塊都留在 items 裡（表格還原要用）');
  assert.deepEqual(lines[1].cells.map((c) => [c.text, c.items.length]), [['甲', 1], ['乙', 1], ['丙', 1]], '中文字間距超過 0.6 em 就是不同儲存格');
  assert.deepEqual(lines[1].cells[2].items[0], { text: '丙', x0: 200, x1: 209, size: 10, gap: 71 }, '字塊保留座標與前一塊的間距');
});

test('linesFromItems：完全疊在另一個較寬字塊範圍內的字塊（隱藏的側標「疫情描述」疊在單位名上）丟掉，留寬的', () => {
  // 42(17)：側標「疫情描述」以隱藏文字疊印在單位名同一座標，不丟掉的話單位名會變成「衛生福利部…疫情描述」，單位比對失敗
  const lines = linesFromItems([it('衛生福利部疾病管制署中區管制中心', 100, 90), it('疫情描述', 100, 90)]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, '衛生福利部疾病管制署中區管制中心');
  assert.deepEqual(lines[0].cells.map((c) => c.text), ['衛生福利部疾病管制署中區管制中心']);
  // 對照：只是相鄰、沒有被蓋住的字塊不能被丟
  assert.equal(linesFromItems([it('單位甲', 100, 90), it('疫情描述', 200, 90)])[0].cells.length, 2);
});

/* ───────── 2. tableToMarkdown ───────── */
test('tableToMarkdown：只隔約 0.6 em 的緊密數字欄「33 (45.2)」「24 (32.9)」（三行以上同位置起頭）切成兩欄', () => {
  // pdf.js 會把兩個緊鄰的數字欄排成同一個儲存格（間距 ≤ 0.6 em）；只看儲存格左緣會少一欄，數字全擠在一格
  const lines = linesFromItems([
    ...row(100, [['變項', 50], ['男', 150], ['女', 230]]),
    ...row(120, [['年齡<65', 50], ['33 (45.2)', 150, 45], ['24 (32.9)', 201, 45]]),
    ...row(140, [['年齡≥65', 50], ['40 (54.8)', 150, 45], ['49 (67.1)', 201, 45]]),
    ...row(160, [['合計', 50], ['73 (100)', 150, 40], ['73 (100)', 196, 40]]),
  ]);
  assert.deepEqual(cellTexts(lines)[1], ['年齡<65', '33 (45.2) 24 (32.9)'], '前提：linesFromItems 把兩欄併成同一格');
  assert.deepEqual(tableToMarkdown(lines), {
    markdown: '| 變項 | 男 | 女 |\n| --- | --- | --- |\n| 年齡<65 | 33 (45.2) | 24 (32.9) |\n| 年齡≥65 | 40 (54.8) | 49 (67.1) |\n| 合計 | 73 (100) | 73 (100) |',
    spans: [],
    hasData: true,
  });
});

test('tableToMarkdown：「案 1」被切成兩個字塊、但只有兩行這樣——不夠成欄，仍是同一格', () => {
  // 欄起點若每個字塊都算，「案」「1」會被切成兩欄，整張表的欄位錯位
  const lines = linesFromItems([
    ...row(100, [['個案', 50], ['發病日', 150], ['ALT', 250, 18]]),
    ...row(120, [['案', 50], ['1', 62, 5], ['2024/12/05', 150, 50], ['30 IU/L', 250, 35]]),
    ...row(140, [['案', 50], ['2', 62, 5], ['2024/12/09', 150, 50], ['45 IU/L', 250, 35]]),
    ...row(160, [['合計', 50], ['2 例', 150], ['-', 250, 5]]),
  ]);
  assert.equal(tableToMarkdown(lines).markdown, '| 個案 | 發病日 | ALT |\n| --- | --- | --- |\n| 案 1 | 2024/12/05 | 30 IU/L |\n| 案 2 | 2024/12/09 | 45 IU/L |\n| 合計 | 2 例 | - |');
});

test('tableToMarkdown：多行表頭逐欄合併；蓋住兩個欄錨點的上層表頭放進 spans', () => {
  // 上層表頭「疫苗接種」橫跨「有」「無」兩欄：塞進任何一欄都錯，改列為表頭上層；「(人)」是第二行表頭，要接在同一欄
  const lines = linesFromItems([
    ...row(100, [['疫苗接種', 160, 72]]),
    ...row(115, [['變項', 50], ['有', 160], ['無', 220]]),
    ...row(130, [['(人)', 155, 18], ['(人)', 215, 18]]),
    ...row(150, [['男', 50], ['12', 160, 10], ['8', 220, 5]]),
    ...row(170, [['女', 50], ['15', 160, 10], ['6', 220, 5]]),
  ]);
  assert.deepEqual(tableToMarkdown(lines), {
    markdown: '| 變項 | 有 (人) | 無 (人) |\n| --- | --- | --- |\n| 男 | 12 | 8 |\n| 女 | 15 | 6 |',
    spans: ['疫苗接種'],
    hasData: true,
  });
});

test('tableToMarkdown：從不同時有字的相鄰兩欄（表頭置中、數字靠右的兩個起點）併成一欄', () => {
  // 表頭「病例數」「(人)」從 x≈140 起頭，數字靠右從 x≈170 起頭：各自都有兩行以上，會被當成兩欄，表頭與數字分家
  const lines = linesFromItems([
    ...row(100, [['地區', 50], ['病例數', 140]]),
    ...row(115, [['(人)', 145, 18]]),
    ...row(130, [['北區', 50], ['120', 170, 15]]),
    ...row(145, [['中區', 50], ['85', 175, 10]]),
    ...row(160, [['南區', 50], ['9', 180, 5]]),
  ]);
  assert.equal(tableToMarkdown(lines).markdown, '| 地區 | 病例數 (人) |\n| --- | --- |\n| 北區 | 120 |\n| 中區 | 85 |\n| 南區 | 9 |');
});

test('tableToMarkdown：列名折成兩行（液化／天然氣船）夾著一行只有數值的行 → 依 y 距離併成一列；沒有列名的數值行是上一列的 <br> 續行', () => {
  // 列名垂直置中、上下各一行時，若照行輸出會變成三列（「液化」空列、數值列、「天然氣船」空列）
  const lines = linesFromItems([
    ...row(100, [['船舶種類', 50], ['艘數', 150], ['不合格', 220]]),
    ...row(120, [['貨櫃船', 50], ['30', 150, 10], ['2', 220, 5]]),
    ...row(135, [['液化', 50]]),
    ...row(142, [['12', 150, 10], ['1', 220, 5]]),
    ...row(149, [['天然氣船', 50]]),
    ...row(165, [['散裝船', 50], ['20', 150, 10], ['0', 220, 5]]),
    ...row(175, [['8', 150, 5], ['3', 220, 5]]),
  ]);
  assert.equal(tableToMarkdown(lines).markdown, [
    '| 船舶種類 | 艘數 | 不合格 |',
    '| --- | --- | --- |',
    '| 貨櫃船 | 30 | 2 |',
    '| 液化天然氣船 | 12 | 1 |',
    '| 散裝船 | 20<br>8 | 0<br>3 |',
  ].join('\n'));
});

test('tableToMarkdown：只有表頭、多半是單字格（直排表頭）的跨頁殘段 → markdown 空字串、hasData false', () => {
  // 跨頁表格在前一頁只剩直排表頭；若輸出成表格，下一頁「(續上頁)」接回時會多一張只有「別｜例｜亡」的假表
  const lines = linesFromItems([
    ...row(100, [['年', 50], ['病', 150], ['死', 220]]),
    ...row(115, [['別', 50], ['例', 150], ['亡', 220]]),
    ...row(130, [['數', 150], ['數', 220]]),
  ]);
  assert.deepEqual(tableToMarkdown(lines), { markdown: '', spans: [], hasData: false });
});

/* ───────── 3. tablesFromLines ───────── */
const tableBody = (y0) => [
  ...row(y0, [['地區', 50], ['病例數', 150], ['死亡', 220]]),
  ...row(y0 + 15, [['北區', 50], ['12', 150, 10], ['1', 220, 5]]),
  ...row(y0 + 30, [['南區', 50], ['8', 150, 5], ['0', 220, 5]]),
];
const TABLE_MD = '| 地區 | 病例數 | 死亡 |\n| --- | --- | --- |\n| 北區 | 12 | 1 |\n| 南區 | 8 | 0 |';

test('tablesFromLines：「表一、」圖說之後的多格行是表格，表下「a. 註解」收進 notes，註解之後的正文不收', () => {
  // 沒有在註解後停下，表格後面的正文段落會被吞進表格區塊、從正文消失
  const lines = linesFromItems([
    ...row(50, [['前文一段說明表格的內容。', 50]]),
    ...row(70, [['表一、各區病例數', 50]]),
    ...tableBody(90),
    ...row(140, [['a. 病例數含疑似個案', 50]]),
    ...row(155, [['正文接著說明這個表的意義，這是一般段落的文字，長度超過四十個字元，不會被當成表格。', 50]]),
  ]);
  assert.deepEqual(tablesFromLines(lines), [{ start: 1, end: 6, caption: '表一、各區病例數', markdown: TABLE_MD, notes: ['a. 病例數含疑似個案'], spans: [] }]);
  assert.deepEqual(pageText(lines).split('\n'), ['前文一段說明表格的內容。', '表一、各區病例數', ...TABLE_MD.split('\n'), 'a. 病例數含疑似個案', '正文接著說明這個表的意義，這是一般段落的文字，長度超過四十個字元，不會被當成表格。']);
});

test('tablesFromLines：「(接下頁)」結束表格區塊（本身不輸出）；無編號的「表、病人特徵」也認得是表格圖說', () => {
  // (接下頁) 若留在文字裡會變成正文雜訊；舊刊（29 卷）表格沒有編號，只認「表 N」會整張表變成一堆散行
  const cont = linesFromItems([...row(70, [['表 2 各區病例數', 50]]), ...tableBody(90), ...row(140, [['(接下頁)', 200, 36]]), ...row(160, [['後面的字', 50]])]);
  assert.deepEqual(tablesFromLines(cont), [{ start: 0, end: 5, caption: '表 2 各區病例數', markdown: TABLE_MD, notes: [], spans: [] }]);
  assert.deepEqual(pageText(cont).split('\n'), ['表 2 各區病例數', ...TABLE_MD.split('\n'), '後面的字']);
  const old = linesFromItems([...row(70, [['表、病人特徵', 50]]), ...tableBody(90)]);
  assert.deepEqual(tablesFromLines(old).map((t) => [t.caption, t.markdown]), [['表、病人特徵', TABLE_MD]]);
});

test('tablesFromLines：(接下頁) 之前只有表頭殘段 → 只留圖說、不輸出表格內容（交給續頁）', () => {
  // 只剩表頭的殘段輸出成表格，splitManuscript 接回續頁時會把殘段當成表頭重複
  const lines = linesFromItems([
    ...row(70, [['表三、各年病例數', 50]]),
    ...row(100, [['年', 50], ['病', 150], ['死', 220]]),
    ...row(115, [['別', 50], ['例', 150], ['亡', 220]]),
    ...row(140, [['(接下頁)', 200, 36]]),
  ]);
  assert.deepEqual(tablesFromLines(lines).map((t) => [t.caption, t.markdown, t.spans]), [['表三、各年病例數', '', []]]);
});

/* ───────── 4. chartTextLines / pageText ───────── */
test('chartTextLines／pageText：圖說上方的短行裡有三行以上純數字（刻度）→ 整段略過，換成一行「〔圖內文字 N 行已略過〕」；上方的一般段落保留', () => {
  // 向量圖的刻度、圖例、月份標籤若留著，會變成正文裡一串「150 100 50 確定病例 0 1 月…」
  const lines = linesFromItems([
    ...row(30, [['本段是一般正文，說明病例數的趨勢變化，長度超過三十個字，不能被當成圖內文字略過。', 50]]),
    ...row(45, [['150', 50, 15]]),
    ...row(55, [['100', 50, 15]]),
    ...row(65, [['50', 50, 10], ['確定病例', 150]]),
    ...row(80, [['0', 50, 5]]),
    ...row(95, [['1 月   2 月   3 月', 60, 80]]),
    ...row(115, [['圖一、2026 年每月病例數', 50]]),
    ...row(135, [['如圖一所示，病例數於三月下降。', 50]]),
  ]);
  const { skip, markerAt } = chartTextLines(lines);
  assert.deepEqual([...skip], [1, 2, 3, 4, 5]);
  assert.deepEqual([...markerAt], [[1, 5]]);
  assert.deepEqual(pageText(lines).split('\n'), ['本段是一般正文，說明病例數的趨勢變化，長度超過三十個字，不能被當成圖內文字略過。', '〔圖內文字 5 行已略過〕', '圖一、2026 年每月病例數', '如圖一所示，病例數於三月下降。']);
});

test('chartTextLines：圖說上方是一般短段落（沒有三行純數字）→ 不略過', () => {
  // 不能把圖說上方的正文小標或短句當成圖內文字吃掉
  const lines = linesFromItems([...row(50, [['疫情趨勢', 50]]), ...row(65, [['如下圖所示。', 50]]), ...row(85, [['圖二、流行曲線', 50]])]);
  const { skip, markerAt } = chartTextLines(lines);
  assert.equal(skip.size, 0); assert.equal(markerAt.size, 0);
  assert.equal(pageText(lines), '疫情趨勢\n如下圖所示。\n圖二、流行曲線');
});

/* ───────── 5. splitManuscript ───────── */
const BODY = '摘要\n本文描述一起群聚事件的調查與處置過程，供各縣市參考。\n\n前言\n臺灣每年皆有零星的群聚事件發生，本文整理一起事件的經過。\n';
const HEAD = '某醫院群聚事件調查\n\n王大明 1*、李小華 2\n\n';
const authorsOf = (r) => r.authors.map((a) => [a.name, a.affiliations, a.corresponding]);

test('splitManuscript：作者列用全形「＊」與點號分隔的「1.2」→ 姓名、單位編號、通訊作者都抓得到', () => {
  // 42(18) 作者名沒抓到的根本原因：「＊」與「1.2」讓整行不符合作者列格式
  const r = S(`某港國際商船船舶衛生檢查結果分析\n\n紀錦昇 1＊、李宜學 1、柯靜芬 1.2\n${BODY}`);
  assert.deepEqual(authorsOf(r), [['紀錦昇', [1], true], ['李宜學', [1], false], ['柯靜芬', [1, 2], false]]);
  assert.equal(r.title, '某港國際商船船舶衛生檢查結果分析');
});

test('splitManuscript：頁尾少了「導」的「疫情報 168」與舊版左頁頁首「464 疫情報導 2014年9月23日」都推得出頁碼，且不留在正文', () => {
  // 文字層缺字或舊版頁首格式不同時抓不到頁碼，而且頁碼行會混進段落
  const r1 = S(`${HEAD}${BODY}疫情報 168\n\n討論\n內容二段。\n疫情報 169\n`);
  assert.equal(r1.meta.pages, '168-169');
  assert.deepEqual(r1.sections.map((s) => [s.key, s.markdown]), [['intro', '臺灣每年皆有零星的群聚事件發生，本文整理一起事件的經過。'], ['discussion', '內容二段。']]);
  const r2 = S(`464 疫情報導 2014年9月23日\n${HEAD}${BODY}\n討論\n內容二段。\n466 疫情報導\n`);
  assert.equal(r2.meta.pages, '464-466');
  assert.equal(r2.title, '某醫院群聚事件調查', '左頁頁首不能被當成篇名');
  assert.deepEqual(r2.sections.map((s) => s.markdown), ['臺灣每年皆有零星的群聚事件發生，本文整理一起事件的經過。', '內容二段。']);
});

test('splitManuscript：篇名折成兩行、與作者列隔一個空行、上方是分類名 → 分類被拿走、兩行篇名接起來', () => {
  // 只看作者列上一行時，篇名只抓到後半「結果分析」；分類名若沒先拿掉會被併進篇名
  const r = S(`2026 年 10 月 20 日 第 42 卷 第 18 期\n疫情調查\n臺中港國際商船船舶衛生檢查\n結果分析\n\n紀錦昇 1＊、李宜學 1、柯靜芬 1.2\n${BODY}`);
  assert.equal(r.title, '臺中港國際商船船舶衛生檢查結果分析');
  assert.equal(r.meta.category, 'investigation');
  assert.equal(r.meta.volume, 42); assert.equal(r.meta.issue, 18);
  assert.deepEqual(r.unassigned, []);
});

test('splitManuscript：舊版上標數字另成一行「1 1 2 3」放在作者列上方 → 依序配給作者，且不算進篇名', () => {
  // 舊版排版的上標在上一行；沒處理時作者沒有單位，且「1  1  2  3」會被當成篇名的一部分
  const r = S(`疫情調查\n某醫院群聚事件調查\n1  1  2  3\n王大明、李小華、陳美玲、林志明\n${BODY}`);
  assert.deepEqual(authorsOf(r), [['王大明', [1], false], ['李小華', [1], false], ['陳美玲', [2], false], ['林志明', [3], false]]);
  assert.equal(r.title, '某醫院群聚事件調查');
});

test('splitManuscript：作者名用相容漢字 U+F9C7（劉）→ NFC 正規化後認得是作者列', () => {
  // 相容字不在 [一-鿿] 範圍，作者列整行認不出來；正規化後要變成一般的「劉」U+5289
  const r = S(`某某調查報告\n\n劉大明 1*、李小華 2\n${BODY}`);
  assert.deepEqual(authorsOf(r), [['劉大明', [1], true], ['李小華', [2], false]]);
  assert.equal(r.title, '某某調查報告');
});

test('splitManuscript：「表一、」之後的 | 列、（表頭上層：…）、a. 註解掛到表一；(接下頁) 丟掉；(續上頁) 表一 接回同一張表，不重複表頭', () => {
  // SIDEBAR_RE 舊版會把「| a | b |」當側標吃掉；續頁的表頭若不去重，表格中間會出現第二組表頭
  const r = S(`${HEAD}摘要\n本文描述一起群聚事件。\n\n結果\n各區病例數如表一。\n表一、各區病例數與死亡數
| 地區 | 病例數 | 死亡 |
| --- | --- | --- |
| 北區 | 12 | 1 |
(接下頁)
疫情報導 201

(續上頁) 表一、各區病例數與死亡數
| 地區 | 病例數 | 死亡 |
| --- | --- | --- |
| 南區 | 8 | 0 |
（表頭上層：人數）
a. 含疑似個案
註：資料截至 9 月底
本表顯示北區病例數最多，南區次之，兩區皆有個案發生。

討論
略。
`);
  assert.deepEqual(r.figures, [{
    kind: 'table',
    no: 1,
    caption: '各區病例數與死亡數',
    markdown: '| 地區 | 病例數 | 死亡 |\n| --- | --- | --- |\n| 北區 | 12 | 1 |\n| 南區 | 8 | 0 |\n\n（表頭上層：人數）\n\na. 含疑似個案\n\n註：資料截至 9 月底',
  }]);
  assert.deepEqual(r.sections.map((s) => [s.key, s.markdown]), [['results', '各區病例數如表一。\n\n本表顯示北區病例數最多，南區次之，兩區皆有個案發生。'], ['discussion', '略。']]);
  assert.ok(!JSON.stringify(r).includes('接下頁'));
});

test('splitManuscript：表頭上層或註解出現在跨頁表格的第一段之後，續頁的列仍要接在表格列之後（不能接在註解後面）', () => {
  // pageText 會把「（表頭上層：…）」緊接在第一頁的表格列之後輸出；續頁的列若接在它後面，渲染時就變成一張沒有表頭的第二張表
  const r = S(`${HEAD}結果\n各區病例數如表一。\n表一、各區病例數
| 地區 | 病例數 | 死亡 |
| --- | --- | --- |
| 北區 | 12 | 1 |
（表頭上層：人數）

(續上頁) 表一、各區病例數
| 地區 | 病例數 | 死亡 |
| --- | --- | --- |
| 南區 | 8 | 0 |
`);
  assert.equal(r.figures[0].markdown, '| 地區 | 病例數 | 死亡 |\n| --- | --- | --- |\n| 北區 | 12 | 1 |\n| 南區 | 8 | 0 |\n\n（表頭上層：人數）');
});

const SECOND = `另一篇的篇名\n\n張三 1、李四 1\n\n摘要\n第二篇摘要內容。\n\n前言\n第二篇前言內容。\n`;
test('splitManuscript：出現兩個「摘要」（整期合刊）→ 只帶第一篇，其餘放 unassigned，report 提醒整期合刊', () => {
  // 整期合刊一起切，第二篇的摘要、前言會蓋掉或混進第一篇
  const r = S(`${HEAD}摘要\n第一篇摘要內容。\n\n前言\n第一篇前言內容。\n\n${SECOND}`);
  assert.equal(r.title, '某醫院群聚事件調查');
  assert.equal(r.abstract, '第一篇摘要內容。');
  assert.equal(r.sections.length, 1); assert.equal(r.sections[0].key, 'intro');
  assert.match(r.sections[0].markdown, /^第一篇前言內容。/);
  assert.ok(!r.sections.some((s) => s.markdown.includes('第二篇')));
  assert.equal(r.unassigned.length, 1);
  assert.match(r.unassigned[0], /摘要\n第二篇摘要內容。\n前言\n第二篇前言內容。$/);
  assert.ok(r.report.some((x) => /2 個「摘要」.*整期合刊/.test(x)));
});

test('splitManuscript：整期合刊時，第二篇的篇名與作者列也不留在第一篇的最後一段', () => {
  const r = S(`${HEAD}摘要\n第一篇摘要內容。\n\n前言\n第一篇前言內容。\n\n${SECOND}`);
  assert.equal(r.sections[0].markdown, '第一篇前言內容。');
});

const LONG = '世界肝炎日是每年七月二十八日，旨在提升大眾對病毒性肝炎的認識，鼓勵民眾接受篩檢與治療。'.repeat(3);
test('splitManuscript：沒有任何章節標題（焦點特寫）→ 全文當一段 key body、標題「正文」，report 提醒摘要自填', () => {
  // 沒有標題時原本全文落到 unassigned，正文是空的、建置會擋
  const r = S(`焦點特寫\n世界肝炎日：消除 C 肝的最後一哩路\n\n王大明 1*、李小華 1\n\n${LONG}\n${LONG}\n`);
  assert.equal(r.title, '世界肝炎日：消除 C 肝的最後一哩路');
  assert.equal(r.meta.category, 'feature');
  assert.deepEqual(r.sections, [{ key: 'body', heading: '正文', markdown: `${LONG}\n${LONG}` }]);
  assert.equal(r.abstract, '');
  assert.deepEqual(r.unassigned, []);
  assert.ok(r.report.includes('稿件沒有章節標題，整篇當作一段「正文」；摘要請自行填寫'));
});

test('splitManuscript：沒有篇名也沒有作者列（國內外疫情焦點）但有分類 → 篇名以分類名代入並 report', () => {
  // 篇名空白會擋建置；用分類名代入讓同事至少能存檔，並提醒改成正式篇名
  const r = S(`國內外疫情焦點\n${LONG}\n\n國內疫情\n${LONG}\n`);
  assert.equal(r.meta.category, 'global-focus');
  assert.equal(r.title, '國內外疫情焦點');
  assert.deepEqual(r.authors, []);
  assert.ok(r.report.includes('稿件裡找不到篇名（也沒有作者列），先以分類名「國內外疫情焦點」代入，請改成正式篇名'));
});

const SINGLE_AFF = `食物中李斯特菌調查\n\n王大明、李小華、陳美玲\n\n摘要\n本文描述一起調查。\n\n前言\n內容一段。\n\n討論\n內容二段。\n衛生福利部食品藥物管理署南區管理中心\n投稿日期：2025 年 05 月 14 日\n通訊作者：王大明\n`;
test('splitManuscript：作者沒有編號、投稿日期附近只有一行機構名 → 當單位 1 配給所有作者', () => {
  // 42(17)：全部作者同一單位時沒有上標，也沒有「1 單位」的編號，原本單位清單是空的
  const r = S(SINGLE_AFF);
  assert.deepEqual(authorsOf(r), [['王大明', [1], true], ['李小華', [1], false], ['陳美玲', [1], false]]);
  assert.deepEqual(r.affiliations, [{ no: 1, name: '衛生福利部食品藥物管理署南區管理中心' }]);
  assert.equal(r.meta.receivedAt, '2025-05-14');
});

test('splitManuscript：當成單位 1 的那行機構名不再留在最後一段正文裡', () => {
  const r = S(SINGLE_AFF);
  assert.equal(r.sections.find((s) => s.key === 'discussion').markdown, '內容二段。');
});

const FIG_HEAD = `${HEAD}摘要\n本文描述一起群聚事件。\n\n結果\n`;
test('splitManuscript：「圖二為…」是句子不是圖說；「圖二、…」「圖三 …」才是', () => {
  // 舊版 FIG_RE 讓「圖二為各週病例數的流行曲線」被抽成圖說，正文少一句、圖說也錯
  const r = S(`${FIG_HEAD}圖二為各週病例數的流行曲線\n圖二、各週病例數流行曲線\n圖三 各區分布\n病例集中於第 30 週。\n`);
  assert.deepEqual(r.figures, [{ kind: 'figure', no: 2, caption: '各週病例數流行曲線' }, { kind: 'figure', no: 3, caption: '各區分布' }]);
  assert.match(r.sections[0].markdown, /^圖二為各週病例數的流行曲線/);
});

test('splitManuscript：「〔圖內文字 12 行已略過〕」標記行 → report 只提醒一次，不進任何段落', () => {
  // 標記行是 pdf-manuscript 留給後台的訊號，若進正文會變成文章裡的一行怪字
  const r = S(`${FIG_HEAD}病例集中於第 30 週。\n〔圖內文字 12 行已略過〕\n圖一、各週病例數流行曲線\n〔圖內文字 3 行已略過〕\n圖二、各區分布\n`);
  assert.equal(r.report.filter((x) => x.startsWith('圖內的文字')).length, 1);
  assert.ok(!JSON.stringify(r.sections).includes('圖內文字'));
  assert.ok(!r.unassigned.join('').includes('圖內文字'));
  assert.deepEqual(r.figures.map((f) => f.no), [1, 2]);
});

/* ───────── 6. 端到端與 applyManuscript ───────── */
test('manuscriptText → splitManuscript：依座標還原的表格掛到 figures[].markdown', () => {
  // 確認兩層接得起來：pdf-manuscript 輸出的 Markdown 列不會被 splitManuscript 當側標或正文
  const text = manuscriptText([{ items: [
    ...row(20, [['某醫院群聚事件調查', 50]]),
    ...row(40, [['王大明 1*、李小華 2', 50]]),
    ...row(60, [['結果', 50]]),
    ...row(80, [['各區病例數如表一。', 50]]),
    ...row(100, [['表一、各區病例數', 50]]),
    ...tableBody(120),
  ] }]);
  const r = S(text);
  assert.deepEqual(r.figures, [{ kind: 'table', no: 1, caption: '各區病例數', markdown: TABLE_MD }]);
  assert.deepEqual(r.sections.map((s) => s.markdown), ['各區病例數如表一。']);
});

test('applyManuscript：表格圖表保留稿件的 markdown，report 寫「N 個表格含內容」', () => {
  // applyManuscript 原本只帶 kind／no／caption，PDF 還原好的表格內容到後台就不見了
  const r = applyManuscript(emptyState({ today: TODAY, categories: CATS }), `${HEAD}摘要\n本文描述一起群聚事件。\n\n結果\n各區病例數如表一，流行曲線如圖一。\n表一、各區病例數\n| 地區 | 病例數 |\n| --- | --- |\n| 北區 | 12 |\n圖一、流行曲線\n`, { issues: [] });
  assert.deepEqual(r.state.figures, [
    { kind: 'figure', no: '1', caption: '流行曲線', markdown: '', alt: '', file: '' },
    { kind: 'table', no: '1', caption: '各區病例數', markdown: '| 地區 | 病例數 |\n| --- | --- |\n| 北區 | 12 |', alt: '', file: '' },
  ]);
  assert.ok(r.report.includes('2 個圖表說明（1 個表格含內容）'));
});
