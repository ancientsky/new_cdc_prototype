# Node.js 版本：怎麼決定升、怎麼驗、怎麼跟（第七十一輪，2026-11-12）

> 給誰看：資訊室（要部署閘道、答案服務、自架 runner 的人）、OASIS，以及日後負責升 Node 的工程同事。
> 一句話：**CI、`.nvmrc`、閘道部署都改用 Node 26（Active LTS）；`package.json` 的最低版本留在 22.13，因為程式沒有用到更新的功能，不必把還在維護期的 Node 22 擋在門外。**

## 1. 結論

| 項目 | 升版前 | 升版後 | 為什麼 |
| --- | --- | --- | --- |
| GitHub Actions（`pages.yml`、`content-pr.yml`、`lane-sla.yml`、`dast.yml`）`node-version` | 22 | **26** | 跟 Active LTS。只寫大版號，`actions/setup-node` 每次執行都解析成當時最新的 26.x，安全更新不必開 PR |
| `.nvmrc`、`.node-version` | 22 | **26** | 本機 `nvm use`／`fnm use` 直接拿到跟 CI 相同的大版 |
| `package.json` `engines.node` | `>=22` | **`>=22.13.0`** | 最低版本依「還在 LTS 支援期、且依賴允許」訂，不是依 CI 用什麼訂；22.13 是 `pdfjs-dist` 的下限（它需要 `Promise.withResolvers`，Issue #105），原本的 `>=22` 其實允許裝不起來的 22.0–22.12 |
| 閘道、答案服務的部署說明（deploy.md §14、line-chatbot.md） | Node 22 | **Node 26** | 跟建置同一版，少一組要驗的組合 |

Node 22 還能用到 2027-04-30（Maintenance LTS），所以同事機器上還是 22 的照常能 `npm ci`、`npm test`。等 22 結束支援，再把最低版本提到 24（見 §6）。

## 2. 官方狀態怎麼查（不要靠記憶或新聞稿）

Node 的版本資訊有兩個機器可讀的正本，查這兩個就夠，不必翻部落格：

```bash
# 每個大版最新一筆：版本、日期、是否 LTS（代號）、附帶的 npm
curl -s https://nodejs.org/dist/index.json | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ const seen={};
  for (const r of JSON.parse(s)) { const m=r.version.split(".")[0]; if(!seen[m]) seen[m]=r; }
  for (const m of ["v26","v24","v22"]) console.log(m, seen[m].version, seen[m].date, "lts:", seen[m].lts, "npm:", seen[m].npm); })'

# 時程：開始、進 LTS、進維護、結束
curl -s https://raw.githubusercontent.com/nodejs/Release/main/schedule.json | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ const a=JSON.parse(s);
  for (const k of ["v22","v24","v26"]) console.log(k, JSON.stringify(a[k])); })'
```

2026-11-12 查到的結果：

| 版本 | 最新 | 狀態 | 進 LTS | 進維護 | 結束 |
| --- | --- | --- | --- | --- | --- |
| v26「Lithium」 | 26.13.1（2026-11-10，npm 11.20.0） | **Active LTS** | 2026-10-28 | 2027-10-20 | 2029-04-30 |
| v24「Krypton」 | 24.22.3（2026-11-10） | Maintenance LTS | 2025-10-28 | 2026-10-20 | 2028-04-30 |
| v22「Jod」 | 22.23.5（2026-11-11） | Maintenance LTS | 2024-10-29 | 2025-10-21 | 2027-04-30 |

**為什麼現在升**：26 在 2026-10-28 剛進 Active LTS，24 同時進維護。CI 跟 Active LTS 是最省事的位置：三年支援期、安全修補最快、依賴的 `engines` 也以它為目標。再早（26 還是 Current）會踩到依賴尚未宣告支援；再晚只是把同一件事拖到被迫做。

**下載時順手驗 SHA**：`SHASUMS256.txt` 與 tarball 放在同一目錄，`grep node-v26.13.1-linux-x64.tar.xz SHASUMS256.txt | sha256sum -c -`。本輪驗過。

## 3. 驗了什麼（Node 26.13.1，Linux x64）

| 檢查 | 結果 |
| --- | --- |
| `npm ci` | 成功（兩個警告見 §4） |
| `npm run lint`（`--max-warnings=0`）、`format:check`、`typecheck`（`@types/node` 已是 ^26） | 全過 |
| `npm test`（106 個檔，含 Playwright 端到端） | 1280 項：1278 過、0 失敗、2 略過——**與 Node 24 完全相同** |
| `BASE_PATH='' BUILD_TODAY=2026-10-01 npm run build`、`npm run check`、`npm run audit:dist` | 全過；評估集 460/460 |
| Node 24 與 Node 26 各建一次 `dist/`，`diff -rq` 逐檔比對（deploy.md §9.1 的升 major 做法） | 189 檔不同，**全部只是時間戳**（`generatedAt`／`runAt`、`security.txt` 的 `Expires`、由 `runAt` 算出的 `etag`、連結檢查的毫秒數）；頁面與 JSON 內容零差異 |
| 執行期棄用警告（`DeprecationWarning`） | 沒有。只有一個 `ExperimentalWarning`，見 §4.2 |

**第一次跑 `npm test` 看到 51 項略過，不是 Node 26 的問題**：當時 `dist/` 還沒建，49 項「dist 若已建置」的測試照設計略過；先 `npm run build` 再測就是 2 項（跟 24 一樣）。比對兩個版本的測試結果時，要在**同一個 `dist/` 狀態**下比。

## 4. 升版時看到的三件事（都不擋，但要知道）

### 4.1 npm 11.20 的 `install-scripts` 允許清單

`npm ci` 末尾印：

```
npm warn install-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
```

Node 26 附的 npm 11.20 開始**預設不執行**沒有列在允許清單裡的套件安裝腳本（供應鏈防護：一個被接管的套件不能在 `npm ci` 時跑任意程式）。這是 npm 的改變，不是 Node 的。

對本專案**沒有影響**：`esbuild` 的 `install.js` 只是備援——它實際用的二進位檔來自 `@esbuild/linux-x64` 這類 optionalDependencies（純檔案、沒有腳本），本輪驗過 `require('esbuild').version` 正常、建置也正常。**不要**為了消掉警告就 `npm install-scripts approve esbuild`：這個警告正是我們想要的行為（第二十三輪供應鏈原則）。要列清單時用 `npm install-scripts ls`。

### 4.2 `localStorage` 變成全域 getter

Node 26 把 Web Storage 的 `localStorage`／`sessionStorage` 放到全域；沒有給 `--localstorage-file` 時，**讀一次就印一次** `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided`。

`tests/round23-security.test.mjs` 的 BYOK 測試要暫時換掉 `globalThis.localStorage` 再還原，原本用 `g.localStorage` 讀原值，就觸發這個警告（功能沒錯，只是吵）。改成 `Object.getOwnPropertyDescriptor(g, k)` 存描述子、還原時用描述子 `defineProperty`：不呼叫 getter，所以不印警告，而且還原得更精確（原本把 getter 還原成 value 屬性）。這是一個通用寫法：**要暫時覆蓋全域再還原，存描述子，不要讀值。**

前端程式（`src/client/*.js`）不受影響：它們只在瀏覽器執行；測試在 Node 裡 import 它們時都先 `defineProperty` 假的 storage，不會讀到 Node 的 getter。

### 4.3 `npm audit` 的 minimatch（與 Node 無關，順便記）

`npm audit` 報 5 個 moderate：`minimatch` 7.0.0–11.0.0 的 globparts 放大（GHSA-g3hv-75wg-m249），由 `eslint` 10 → `@eslint/config-array` 帶進來。升 Node 前就在，只影響開發機上的 lint，不進 `dist/`、不進閘道。`npm audit fix --force` 會把 eslint 退到 9，不要做；等 eslint 10 上游換掉它、Dependabot 的每週 npm minor／patch PR 自然會帶進來。

## 5. 版本寫在哪裡、改哪裡（下次升版的清單）

```bash
grep -rn "node-version:\|engines\|Node 2[0-9]\|Node.js 2[0-9]" .github package.json .nvmrc .node-version tests/lanes.test.mjs docs README.md ARCHITECTURE.md | grep -v package-lock
```

| 地方 | 內容 | 說明 |
| --- | --- | --- |
| `.github/workflows/*.yml` × 5 處 | `node-version: 26` | 四個 workflow、五個 job；`content-pr.yml` 的 `lane` job 刻意沒有 setup-node（第四十輪，#81），不要加 |
| `tests/lanes.test.mjs` | `'node-version: 26'` | 測試釘住 workflow 的關鍵行（和 action SHA 一樣，deploy.md §9.1）；不改測試就紅燈，這是**預期的** |
| `.nvmrc`、`.node-version` | `26` | 兩個檔同內容：nvm 讀前者、fnm／asdf／Volta 讀後者 |
| `package.json` `engines.node` | `>=22.13.0` | 最低版本，見 §6 的規則 |
| `docs/deploy.md` 開頭、§2、§14 圖；`docs/line-chatbot.md` 分工表；`README.md` 快速開始 | Node 26 | 部署與入門文字 |
| `package-lock.json` | 不改 | 鎖的是依賴版本，不鎖 Node；`npm ci` 在 22／24／26 都用同一份 |
| 端到端測試檔裡 `PW_MODULE`／`CHROME_BIN` 的預設路徑（`/opt/node22/...`、`/opt/pw-browsers/chromium-1194/...`） | 不改 | 那是開發容器裡 Playwright 與 Chromium 的位置，路徑裡的 `node22` 只是歷史名稱，Node 26 下照樣載入（本輪端到端就是這樣跑的）。本機要跑端到端時用這兩個環境變數指到自己的 Playwright 與 Chromium；路徑不存在時測試以「沒有 Playwright／Chromium」略過 |

**Dependabot 不會幫你升 `node-version`**：它只管 action 的 SHA 與 npm 依賴。Node 大版升級每年一次、要人看 §3 的清單，所以留給人做；但 26.x 的 patch（安全修補）不必等人，因為 workflow 只寫大版號，`setup-node` 每次都拿最新的 26.x。

## 6. 規則：CI 跟 Active LTS，最低版本跟最舊的維護版

- **CI 與部署用 Active LTS**。每年 10 月底 Node 會把當年的新版升為 Active LTS，之後一個月內升版、跑 §3 的清單、留一段像本文 §4 的紀錄。
- **`engines.node` 的最低版本 = 還在支援期且依賴允許的最舊版本**。它是「給同事機器的門檻」，不是「CI 用什麼」。提高門檻要有理由（用到新 API、或依賴要求），不是因為 CI 升了。目前 `>=22.13.0`；2027-04-30 Node 22 結束支援後改成 `>=24`。
- **Node 27 起發布模式改了**：26 是最後一個「奇數版不進 LTS」模式下的版本；之後每年只出一個大版（27、28……），每個都在當年 10 月進 LTS。所以 2027-10 升 27、2028-10 升 28，不再有「跳過奇數版」的事。
- **升版 PR 的內容固定**：§5 的清單 + 本文補一節「這次看到什麼」。沒有看到任何新警告或差異也要寫一行，讓下一個人知道那一版是乾淨的。

## 7. 給資訊室

- **自架 runner**：不必裝 Node，`actions/setup-node` 會下載；只要 runner 連得到 `nodejs.org`（或內部鏡像，`setup-node` 支援 `node-version-file` 與自訂鏡像）。
- **閘道（deploy.md §14）與答案服務（line-chatbot.md）**：用 Node 26 的官方容器映像或發行版套件；兩支服務只用 Node 內建模組（`node:http`、`node:crypto`、`node:fs`）加 `ajv`、`marked`，沒有原生擴充，所以升 Node 不需要重編任何東西。
- **要排的事**：Node 26 進維護是 2027-10-20、結束是 2029-04-30；在那之前（2027 年 10 月後）跟著本文 §6 升 27。
