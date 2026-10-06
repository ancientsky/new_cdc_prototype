#!/usr/bin/env node
// PDF（或已抽好的文字）→ 文件 JSON 的機讀版（第十九輪；說明見 docs/pdf-ingest.md）。
//
//   node scripts/pdf-to-md.mjs <指引.pdf|指引.txt> --meta <meta.json> --out content/documents/<id>.json [--report report.json]
//
// meta.json 放人工填的欄位（id、family、title、version、effectiveAt、owner、diseases、pdfUrl…，與 schemas/document.json 相同）；
// 這支程式只產生「機器做得到的部分」：sections（章／節／附件＋頁碼標記）、machineReadableMarkdown、pageCount、derivedFrom。
// 產出的 derivedFrom.reviewStatus 一律是 'machine'：權責單位對過 PDF 原頁、補完表格之後才改成 'reviewed'（guide-staff §20）。
//
// 為什麼要另存一份 JSON 而不是建置時每次重抽：抽字結果要「人看過」才能被答案引用；
// 存進 repo 之後，人工修正（表格轉 Markdown、紅字異動填 changes）會留在 git 紀錄，下次換版也能比對。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pdfTextToSections, sectionsToMarkdown } from './lib/pdf-text.mjs';

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

const opt = args(process.argv.slice(2));
const input = opt._[0];
if (!input || !opt.meta) {
  console.error('用法：node scripts/pdf-to-md.mjs <檔案.pdf|檔案.txt> --meta meta.json [--out 文件.json] [--report report.json]');
  process.exit(2);
}

const buf = fs.readFileSync(input);
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-';
let text, tool;
if (isPdf) {
  // 不加 -layout：-layout 會保留欄位空白，段落接回會更難；表格本來就交給人工
  text = execFileSync('pdftotext', ['-enc', 'UTF-8', input, '-'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  tool = 'pdftotext';
} else {
  text = buf.toString('utf8').replace(/^﻿/, '');
  tool = 'text';
}

const meta = JSON.parse(fs.readFileSync(opt.meta, 'utf8'));
const { sections, report } = pdfTextToSections(text);
const doc = {
  ...meta,
  pageCount: report.pageCount,
  sections,
  machineReadableMarkdown: sectionsToMarkdown(meta.title, sections),
  derivedFrom: {
    file: path.basename(input),
    sha256,
    sourceKind: isPdf ? 'pdf' : 'extracted-text',
    tool,
    extractedAt: new Date().toISOString().slice(0, 10),
    reviewStatus: 'machine',
    tablePages: report.tablePages,
    inlineTablePages: report.inlineTablePages,
    excludedSections: [...report.formSections, ...report.figureSections, ...sections.filter((s) => s.index === false && !report.formSections.includes(s.key) && !report.figureSections.includes(s.key)).map((s) => s.key)],
    ...(meta.derivedFrom ?? {}),
  },
};

const summary = {
  input, sha256, tool,
  pageCount: report.pageCount,
  sections: sections.length,
  indexedSections: sections.filter((s) => s.index).length,
  tablePages: report.tablePages,
  inlineTablePages: report.inlineTablePages,
  formSections: report.formSections,
  figureSections: report.figureSections,
  joinedAcrossPages: report.joinedAcrossPages,
  warnings: report.warnings,
};
if (opt.out) fs.writeFileSync(opt.out, JSON.stringify(doc, null, 2) + '\n');
if (opt.report) fs.writeFileSync(opt.report, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
if (!opt.out) process.stdout.write(doc.machineReadableMarkdown);
