// 第五十輪（2026-10-14 Yulun 決定）：
//   一、「讓疾病頁的用藥段落也算數」——官方答案優先於用藥拒答（§14.7）的候選擴大到疾病頁「診斷與治療」段落（block＝treatment），只認那一段；
//   二、「開放給民眾版」——原本只給專業版的五個申請服務頁加上民眾對象，民眾模式也能回答。
// 規則與護欄見 docs/ask-search-llm.md §15。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { applyConsistency } from '../scripts/lib/consistency.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let SITE = null;
function site() {
  if (SITE) return SITE;
  SITE = loadSite(config);
  SITE.today = '2026-10-14';
  applyGovernance(SITE);
  SITE.searchIndex = buildSearchIndex(SITE);
  applyConsistency(SITE);
  return SITE;
}
let ENGINE = null;
async function engine() {
  if (ENGINE) return ENGINE;
  const { engineFromSite } = await import('../eval/run-eval.mjs');
  ENGINE = engineFromSite(site());
  return ENGINE;
}
const cites = (r) => r.sentences.flatMap((s) => s.cite);
const officialGuard = (r) => r.guards.find((g) => g.kind === 'official-over-refusal');

// ───────── 一、疾病頁用藥段落 ─────────
test('疾病頁用藥段落：問句點名疾病、治療段落寫到問句點名的藥 ⇒ 用那一段回答，句子只出自那一段，保留 1922', async () => {
  const e = await engine();
  for (const [q, unit, drug] of [
    ['水痘可以吃阿斯匹靈嗎', 'disease.varicella', '阿斯匹靈'],
    ['小孩出水痘可以吃阿斯匹靈嗎', 'disease.varicella', '阿斯匹靈'],
    ['流感可以吃阿斯匹靈嗎', 'disease.influenza', '阿斯匹靈'],
    ['小孩得流感可以吃克流感嗎', 'disease.influenza', '克流感'],
    ['得了百日咳可以吃抗生素嗎', 'disease.pertussis', '抗生素'],
    ['M痘可以使用抗病毒藥嗎', 'disease.mpox', '抗病毒藥'],
  ]) {
    const r = e.answer(q);
    assert.equal(r.refused, false, q);
    assert.ok(r.sentences.length > 0, q);
    // 只出自治療段落：不拿同一頁的症狀、「我該怎麼辦」卡片、一分鐘重點來湊句
    assert.ok(
      cites(r).every((c) => c === `${unit}#treatment`),
      `${q}：${cites(r).join()}`,
    );
    assert.ok(
      r.sentences.some((s) => s.text.includes(drug)),
      `${q}：${r.sentences.map((s) => s.text).join(' ')}`,
    );
    assert.ok(
      r.actions.some((a) => a.href === 'tel:1922'),
      `${q}：${r.actions.map((a) => a.href)}`,
    );
    const g = officialGuard(r);
    assert.ok(g && g.unit === unit && g.block === 'treatment', `${q}：${JSON.stringify(g)}`);
  }
});

test('疾病頁用藥段落：同一題有 FAQ 時仍由 FAQ 回答（FAQ 優先，不引疾病頁）', async () => {
  const e = await engine();
  const r = e.answer('登革熱可以吃阿斯匹靈嗎');
  assert.equal(r.refused, false);
  assert.ok(
    cites(r).every((c) => c.startsWith('faq.dengue-painkiller#')),
    cites(r).join(),
  );
  assert.equal(officialGuard(r)?.block, undefined);
});

test('疾病頁用藥段落的護欄：段落沒寫到那個藥、問劑量、急症、沒點名疾病、點名疫苗、外語、謠言頁都照舊拒答', async () => {
  const e = await engine();
  for (const [q, kind] of [
    ['水痘可以吃布洛芬嗎', 'medication'], // 水痘治療段落沒有寫布洛芬
    ['麻疹可以吃阿斯匹靈嗎', 'medication'], // 麻疹治療段落沒有寫任何藥名
    ['水痘可以吃退燒藥嗎', 'medication'], // 類別詞也要字面出現在段落裡
    ['水痘阿斯匹靈要吃幾顆', 'medication'], // 劑量：段落沒寫幾顆
    ['我小孩出水痘呼吸困難可以吃阿斯匹靈嗎', 'emergency'], // 急症永不改答
    ['可以給小孩吃阿斯匹靈嗎', 'medication'], // 沒點名疾病
    ['打完水痘疫苗可以吃阿斯匹靈嗎', 'medication'], // 點名疫苗：治療段落講的是生病時用藥
    ['去泰國可以吃阿斯匹靈嗎', 'medication'], // 出國推得的疾病不算點名
  ]) {
    const r = e.answer(q);
    assert.equal(r.refused, true, q);
    assert.equal(r.refusal.kind, kind, q);
  }
  assert.equal(officialGuard(e.answer('水痘可以吃阿斯匹靈嗎', { forceIntent: 'rumor' })), undefined);
  assert.equal(
    e.answer('Can I take aspirin for chickenpox?', { lang: 'en' }).guards.some((g) => g.kind === 'official-over-refusal'),
    false,
  );
});

test('疾病頁用藥段落：專業模式同樣只用治療段落', async () => {
  const e = await engine();
  const r = e.answer('水痘可以吃阿斯匹靈嗎', { view: 'pro' });
  assert.equal(r.refused, false);
  assert.ok(
    cites(r).every((c) => c === 'disease.varicella#treatment'),
    cites(r).join(),
  );
});

// ───────── 二、專業限定的申請服務開放民眾版 ─────────
const OPENED = [
  'service.case-data-request',
  'service.lab-test-request',
  'service.notifiable-disease-report',
  'service.research-data-request',
  'service.response-hospital-designation',
];

test('開放民眾版：五個申請服務的對象含民眾與專業，治理後進民眾答案索引（不繞過白名單）', () => {
  const s = site();
  for (const id of OPENED) {
    const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/services', `${id.replace('service.', '')}.json`), 'utf8'));
    assert.deepEqual([...file.audience].sort(), ['professional', 'public'], id);
    const item = s.byId.get(id);
    assert.equal(item.gov.whitelist.effective, true, id);
    assert.equal(item.gov.whitelist.public, true, id);
    assert.ok(
      s.searchIndex.public.some((c) => c.contentId === id),
      `${id} 不在民眾答案索引`,
    );
  }
  // 剩下的服務都已經是民眾版（沒有只給專業版的服務頁）
  for (const sv of s.collections.services.filter((x) => x.status === 'published')) assert.ok(sv.audience.includes('public'), sv.id);
});

test('開放民眾版：民眾模式的申請問句由這些服務頁回答', async () => {
  const e = await engine();
  for (const [q, unit] of [
    ['負壓隔離病房怎麼申請', 'service.response-hospital-designation'],
    ['怎麼成為傳染病應變醫院', 'service.response-hospital-designation'],
    ['檢驗委託怎麼申請', 'service.lab-test-request'],
    ['個案資料申請 IRB 要附嗎', 'service.case-data-request'],
    ['研究成果報告 申請', 'service.research-data-request'],
    ['醫師怎麼通報法定傳染病', 'service.notifiable-disease-report'],
  ]) {
    const r = e.answer(q);
    assert.equal(r.refused, false, q);
    assert.equal(r.sources[0]?.contentId, unit, `${q}：${r.sources.map((x) => x.contentId)}`);
  }
  // 檢體規格（容器、保存、運送）仍是專業內容：民眾模式照舊導向專業模式（第五十輪不改這條）
  assert.equal(e.answer('登革熱檢體容器').refusal?.kind, 'pro-only');
});
