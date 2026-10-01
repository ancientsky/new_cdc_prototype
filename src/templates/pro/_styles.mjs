// 專業專區／開發者／透明報告／指南頁共用樣式（F 專用，只用 tokens.css 的變數）。
// 底線開頭的檔案不會被頁面登錄掃描到；各模板 import 後放在 body 開頭。
import { raw } from '../../../scripts/lib/render.mjs';

export const proStyles = raw(`<style>
.pf { padding-block: var(--sp-5) var(--sp-7); }
.pf h1 { font-size: var(--fs-2xl); margin: 0 0 var(--sp-2); }
.pf h2 { font-size: var(--fs-xl); margin: var(--sp-6) 0 var(--sp-3); }
.pf h3 { font-size: var(--fs-lg); margin: var(--sp-5) 0 var(--sp-2); }
.pf p, .pf li { line-height: 1.7; }
.pf .muted, .pf small { color: var(--ink-3); }
.pf a { color: var(--green-700); }
.pf code { overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .92em; background: var(--green-50); padding: 1px 5px; border-radius: 4px; }
.pf pre { background: var(--ink); color: #f1f3f5; padding: var(--sp-4); border-radius: var(--radius-sm); overflow-x: auto; font-size: var(--fs-sm); line-height: 1.55; }
.pf pre code { background: none; padding: 0; color: inherit; }
.pf .c-status-tag { white-space: nowrap; }
.pf-bar { display: flex; flex-wrap: wrap; gap: var(--sp-3); justify-content: space-between; align-items: center; background: var(--navy-700); color: #fff; border-radius: var(--radius); padding: var(--sp-3) var(--sp-5); }
.pf-bar strong { font-size: var(--fs-lg); }
.pf-bar small { color: #cfd5e6; display: block; }
.pf-grid { display: grid; gap: var(--sp-5); grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); align-items: start; margin-top: var(--sp-5); }
.pf-grid > div { display: grid; gap: var(--sp-4); min-width: 0; }
@media (max-width: 860px) { .pf-grid { grid-template-columns: 1fr; } }
.pf-card { background: var(--white); border: 1px solid var(--line); border-radius: var(--radius); padding: var(--sp-4) var(--sp-5); box-shadow: var(--shadow); min-width: 0; }
.pf-card > h2, .pf-card > h3 { margin-top: 0; }
.pf-card--letter { background: #fff6d9; border-color: #e3c966; }
.pf-card--note { background: var(--green-50); border-color: var(--green-100); }
.pf-pills { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin: var(--sp-2) 0 0; padding: 0; list-style: none; }
.pf-pill, .pf-chip { font: inherit; font-size: var(--fs-sm); border: 1px solid var(--line); background: var(--white); color: var(--ink); border-radius: var(--radius-pill); padding: 8px 16px; min-height: 40px; cursor: pointer; }
.pf-pill[aria-pressed="true"], .pf-chip[aria-pressed="true"] { background: var(--green-700); border-color: var(--green-700); color: #fff; }
.pf-chip[aria-pressed="true"]::before { content: "✓ "; }
.pf-pill:focus-visible, .pf-chip:focus-visible, .pf-btn:focus-visible { outline: var(--focus); outline-offset: 2px; }
.pf-ask { display: flex; gap: var(--sp-2); margin-top: var(--sp-2); }
.pf-ask input[type="search"] { flex: 1; min-width: 0; font: inherit; padding: 12px 14px; border: 2px solid var(--navy-700); border-radius: var(--radius-sm); }
.pf-btn { font: inherit; font-size: var(--fs-sm); border: 1px solid var(--line); background: var(--white); color: var(--ink); border-radius: var(--radius-sm); padding: 8px 14px; min-height: 40px; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
.pf-btn--navy { background: var(--navy-700); border-color: var(--navy-700); color: #fff; padding-inline: var(--sp-5); font-size: var(--fs-md); }
.pf-btn--primary { background: var(--green-700); border-color: var(--green-700); color: #fff; }
.pf .pf-btn--navy, .pf .pf-btn--primary { color: #fff; }
.pf-hint { font-size: var(--fs-sm); color: var(--ink-2); margin: var(--sp-2) 0 0; }
.pf-badge { display: inline-block; font-size: var(--fs-xs); border-radius: var(--radius-pill); padding: 2px 10px; background: var(--navy-100); color: var(--navy-700); }
.pf-badge--ok { background: var(--status-stable-bg); color: var(--status-stable); }
.pf-badge--warn { background: var(--alert-overdue-bg); color: var(--alert-overdue); }
.pf-badge--bad { background: var(--alert-superseded-bg); color: var(--alert-superseded); }
.pf-rows { list-style: none; margin: var(--sp-3) 0 0; padding: 0; }
.pf-rows > li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--sp-2) var(--sp-4); align-items: center; padding: var(--sp-3) 0; border-top: 1px solid var(--line); }
.pf-rows > li.is-match { background: linear-gradient(90deg, var(--green-50), transparent); }
.pf-rows .pf-row__title { font-weight: 600; }
.pf-rows .pf-row__ver { color: var(--ink-2); font-size: var(--fs-sm); }
.pf-rows .pf-row__old { color: var(--ink-3); font-size: var(--fs-xs); }
.pf-rows [hidden] { display: none; }
.pf-tasks { display: grid; gap: var(--sp-3); grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 560px) { .pf-tasks { grid-template-columns: 1fr; } }
.pf-task { display: block; border: 1px solid var(--line); border-radius: var(--radius); padding: var(--sp-4); background: var(--white); color: var(--ink); text-decoration: none; }
.pf-task:hover { border-color: var(--green-700); }
.pf-task.is-match { border-color: var(--green-700); box-shadow: inset 0 0 0 1px var(--green-700); }
.pf-task strong { display: block; font-size: var(--fs-md); }
.pf-task span { color: var(--ink-2); font-size: var(--fs-sm); }
.pf-table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
.pf-table th, .pf-table td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.pf-table th { background: var(--green-50); font-weight: 600; white-space: nowrap; }
.pf-table-wrap { overflow-x: auto; }
.pf-tiles { display: grid; gap: var(--sp-3); grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 760px) { .pf-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.pf-tile { background: var(--white); border: 1px solid var(--line); border-radius: var(--radius); padding: var(--sp-4); }
.pf-tile b { display: block; font-size: var(--fs-2xl); line-height: 1.1; color: var(--green-900); }
.pf-tile span { display: block; font-size: var(--fs-sm); color: var(--ink-2); margin-top: var(--sp-1); }
.pf-tile small { display: block; margin-top: var(--sp-1); }
.pf-bar-row { display: grid; grid-template-columns: 8em minmax(0, 1fr) 9.5em; gap: var(--sp-3); align-items: center; padding: 6px 0; font-size: var(--fs-sm); }
.pf-bar-row i { display: block; height: 14px; border-radius: 7px; background: var(--line); overflow: hidden; }
.pf-bar-row i > em { display: block; height: 100%; background: var(--status-stable); }
.pf-bar-row i > em.is-low { background: var(--status-rising); }
.pf-bar-row i > em.is-bad { background: var(--status-peak); }
.pf-shot { border: 2px dashed var(--line); border-radius: var(--radius); background: var(--paper); color: var(--ink-3); padding: var(--sp-5); text-align: center; font-size: var(--fs-sm); margin: var(--sp-3) 0; }
.pf-tabs { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin: var(--sp-4) 0; padding: 0; list-style: none; border-bottom: 2px solid var(--line); }
.pf-tabs a { display: block; padding: 10px 18px; text-decoration: none; color: var(--ink-2); border-radius: var(--radius-sm) var(--radius-sm) 0 0; font-weight: 600; }
.pf-tabs a[aria-current="true"] { background: var(--green-700); color: #fff; }
.pf-steps { counter-reset: step; list-style: none; padding: 0; display: grid; gap: var(--sp-3); }
.pf-steps > li { counter-increment: step; position: relative; padding-left: 44px; }
.pf-steps > li::before { content: counter(step); position: absolute; left: 0; top: 0; width: 30px; height: 30px; border-radius: 50%; background: var(--green-700); color: #fff; display: grid; place-items: center; font-weight: 700; }
[data-tabs="on"] > section[data-tab] { display: none; }
[data-tabs="on"] > section[data-tab].is-active { display: block; }
.pf dl.pf-dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--sp-2) var(--sp-4); }
.pf dl.pf-dl dt { font-weight: 600; }
.pf dl.pf-dl dd { margin: 0; }
@media (max-width: 560px) { .pf dl.pf-dl { grid-template-columns: 1fr; } }
.pf details.pf-ep { border: 1px solid var(--line); border-radius: var(--radius-sm); margin: var(--sp-2) 0; background: var(--white); }
.pf details.pf-ep > summary { cursor: pointer; padding: 10px 14px; display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-3); align-items: baseline; }
.pf details.pf-ep > div { padding: 0 14px 14px; }
.pf-get { font-size: var(--fs-xs); font-weight: 700; background: var(--status-stable-bg); color: var(--status-stable); padding: 1px 8px; border-radius: 4px; }
@media print { .pf-bar { background: none; color: #000; border: 1px solid #000; } }
</style>`);
