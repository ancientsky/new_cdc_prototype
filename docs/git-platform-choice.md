# Git 平台怎麼選：Gitea／Forgejo、GitLab、GitHub Enterprise（第六十九輪，2026-11-06）

> 給資訊室與問這個問題的同事。起因：有同事問「Gitea 是不是比 GitLab 更輕量、更好？」
> 依據：[deploy.md](deploy.md) §14（寫入閘道與自架 GitLab 的設計）、[ci-cd-overview.md](ci-cd-overview.md)（原型現在的 CI／CD）、[git-as-cms.md](git-as-cms.md) §3.4（資訊室要維運的清單）、Issue #130（Azure 託管與 GHES／GitLab 的討論）。
> 本文不含經費、人月或授權費估算（[transition-faq.md](transition-faq.md) §8 說明原因）。

## 0. 一句話結論

**「更輕量」是真的，「更好」要看機關已經有什麼。** 這個架構對 Git 平台的要求很低（§1），三個平台都能滿足；程式面唯一的差別是寫入閘道要多一個 Git 轉接器（§7）。所以**不要為了輕量而換平台**，而是：

1. **資訊室已經在維運 GitLab（或 GHES）** → 直接用它。多一套平台要多一組備份、升級、弱掃與值班，省下的記憶體抵不過多一套系統。
2. **機關目前沒有任何 Git 平台，而且資訊室人力吃緊** → Gitea 或 Forgejo 是合理選擇，條件是先通過 §6 的資安與採購核對，並且接受 §4 的 Actions 相容性差異（主要是部署排隊那一條）。
3. **資訊室要搬 Azure、同時考慮 GitHub Enterprise**（#130 的討論）→ 平台選型跟著主機與身分系統走（Entra ID 已有的話 GHES／GHEC 整合最少工），不要單獨為 Git 平台做決定。

不論選哪個，**承辦人永遠不碰 Git 平台**（deploy.md §14），所以這個選擇只影響資訊室和閘道，不影響各組室同事的操作。

## 1. 我們到底需要平台做什麼

先把需求列清楚，才知道「輕量」少掉的功能有沒有用到。寫入閘道（`scripts/lib/gateway/`）與 CI 對平台的要求只有這些：

| 需求 | 用在哪裡 | GitLab CE | Gitea／Forgejo | GitHub Enterprise |
| --- | --- | --- | --- | --- |
| REST API：讀檔、開分支、一次提交多檔、開合併請求、留言、合併、比較差異 | 閘道的 Git 轉接器（`git-gitlab.mjs` 用了十多個端點） | 有（v4） | 有（API 與 GitHub 相近，端點名稱不同） | 有 |
| 服務帳號或專案權杖，角色只到 Developer | 閘道用一個帳號代全署提交 | 有（Project Access Token） | 有（使用者 token，或組織層級的 bot 帳號） | 有（App 或 fine-grained PAT） |
| 保護分支：`main` 禁止直接推送、只有服務帳號能合併、禁止 force push | 四眼原則的最後一道鎖 | 有 | 有 | 有（rulesets） |
| 合併請求須通過 CI 才能合併 | 建置閘門 | 有 | 有（status check） | 有 |
| CI 能跑 Node、Playwright 容器（axe、ZAP） | 檢查與建置 | GitLab CI＋自架 runner | Gitea Actions＋act_runner（容器） | Actions＋自架 runner |
| CI 能排隊部署、不取消 | 第六十八輪的部署排隊（deploy.md §34） | `resource_group` | **沒有對應**（§4） | `concurrency` |
| 平台登入接 AD（給資訊室與查紀錄的人用） | deploy.md §14.4 | LDAP、SAML、OIDC | LDAP、OIDC（群組可對應 team） | SAML／OIDC |
| 提交訊息與合併紀錄可查、不可改 | `Edited-by:`／`Approved-by:` trailer | 有 | 有 | 有 |
| 平台本身的操作稽核（誰改了設定、誰加了成員） | 政風與資安查核 | 有，較完整的要 Premium（§5） | **社群版沒有**，企業版才有（§5） | 有 |

看得出來：**真正會動到程式碼的差異只有「API 端點名稱」**（多寫一個轉接器），其餘都是設定或維運面的差別。四眼原則、單位權限、審核到期這些治理規則都在閘道與建置裡，不靠平台的付費功能（deploy.md §14.4 已明講「不需要買 Premium 的核准規則」）。

## 2. 「更輕量」是真的

| | GitLab（Omnibus 單機） | Gitea／Forgejo |
| --- | --- | --- |
| 組成 | Rails 應用、PostgreSQL、Redis、Gitaly、Sidekiq、nginx、Prometheus 等十多個元件，由 Omnibus 包一起裝 | 一個 Go 執行檔（約數十 MB），資料庫可用內建 SQLite 或外接 PostgreSQL |
| 記憶體 | 官方文件建議單機至少 8 GB 起跳（不同版本寫法不同，較舊版寫 4 GB），另有「記憶體受限環境」的縮減設定 | 幾百 MB 就能跑；官方沒有硬性門檻 |
| 升級 | 有版本升級路徑限制（要照 upgrade path 逐版升），每月一個功能版、每年三個主要版本 | 下載新執行檔重啟；跨多版升級一般可直接升 |
| 備份 | `gitlab-backup` 一次包所有元件 | `gitea dump` 或直接備份資料目錄＋資料庫 |
| 弱掃面積 | 元件多，每月的 security release 要跟 | 單一執行檔，CVE 數量少但一樣要跟 |

這是同事說「更輕量」的來源，**而且是對的**。但資訊室要問自己的不是「哪個省記憶體」，而是「我們現在養了幾套東西、再加一套的代價是什麼」：

- 如果機關已有 GitLab 在跑別的系統，網站再用一個 Gitea 等於多一套帳號、多一套備份、多一套弱掃、多一個要升級的東西。**兩套輕量的加起來不會比一套重的輕。**
- 如果機關什麼都沒有，GitLab 的 8 GB 與升級路徑確實是負擔，Gitea 一台小 VM 就夠，這時輕量才是優勢。

## 3. Gitea 與 Forgejo 是什麼關係

- **Gitea**：2016 年從 Gogs 分支出來，MIT 授權。2022 年起由 Gitea Ltd 與其子公司 CommitGo 主導，CommitGo 另賣 **Gitea Enterprise**（稽核紀錄等功能在企業版）。
- **Forgejo**：2022 年底從 Gitea 分支，2024 年初成為硬分支（程式碼開始分歧），掛在德國非營利組織 Codeberg e.V. 之下；v9 起改為 GPL v3+ 授權。Codeberg 自己的公開服務就跑 Forgejo。
- 兩者功能大致相同、設定檔與資料庫結構在分歧前相容，**從 Gitea 搬到 Forgejo 在舊版還能直接升級，分歧後的新版不保證**。選一個就不要再換。
- 哪個比較好？對本機關的差別不在功能，在 **§6 的廠商認定與支援來源**：Gitea 有商業公司可簽支援，Forgejo 只有社群與第三方廠商。

## 4. Gitea Actions 與 GitHub Actions 的相容性：能省多少

Gitea Actions 刻意相容 GitHub Actions 的 YAML，這是同事覺得「Gitea 更好」的第二個理由：原型的五支工作流程（`content-pr.yml`、`pages.yml`、`preview-cleanup.yml`、`lane-sla.yml`、`dast.yml`）看起來可以直接搬。實際對照原型用到的功能：

| 原型用到的 | Gitea Actions | 影響 |
| --- | --- | --- |
| `on: pull_request`／`push`／`schedule`／`workflow_dispatch`、`jobs`、`steps`、`needs`、`if`、matrix | 支援 | 骨架可以直接搬 |
| `actions/checkout`、`actions/setup-node`、`actions/upload-artifact`、`actions/cache` | 支援（從 GitHub 或鏡像下載；內網要設 `DEFAULT_ACTIONS_URL` 指向自己的鏡像） | 內網 runner 要先把這些 action 鏡像進來 |
| **`concurrency: cancel-in-progress: false`**（第六十八輪的部署排隊） | **不支援**；Gitea 行為等同 `cancel-in-progress: true`，新觸發會取消進行中的執行 | 部署會回到「連續合併就無限取消」的問題（deploy.md §34）。要在部署腳本自己加鎖或改成定時部署 |
| `permissions:` 逐 job 收縮（`contents: read`、`id-token: write`） | 只支援部分範圍；`id-token`、`checks`、`statuses`、`environment` 等 GitHub 專屬的會被忽略 | 第二十三輪的「工作流程層級唯讀、寫入下放到 job」要改用不同權杖的方式做 |
| `environment:`（pages 部署） | 忽略 | 不影響正式環境（正式站不用 Pages） |
| `continue-on-error`、`timeout-minutes` | 較新版本已支援，較舊文件列為忽略 | 驗證用的版本 |
| `hashFiles()` | 不支援（永遠回空字串） | 快取鍵要改用其他方式算（原型快取鍵用 playwright 版本號，不受影響） |
| `gh api …`（`content-pr.yml` 的 `lane` 與 `reuse` job 靠 GitHub API 重新算變更檔案清單、找同一 commit 的執行結果、`--match-head-commit` 合併） | **這不是 Actions 語法，是 GitHub 平台 API**；Gitea 有對應 API 但端點、欄位、`tea` CLI 都不同 | 這段無論搬到 GitLab 還是 Gitea 都要重寫 |
| 第三方 action 固定 commit SHA（Dependabot 每週升版） | 支援 SHA；Gitea 沒有 Dependabot，要用 Renovate 或人工 | 供應鏈管控流程要另建 |
| 可重用工作流程（`workflow_call`） | 原型沒用；Gitea 2026 年中才改寫支援 | 不影響 |

**結論：** Actions 相容性省的是「YAML 骨架與步驟」那一半，另一半（呼叫平台 API 做車道判斷、沿用檢查結果、自動合併）本來就要跟著平台重寫，Gitea 不比 GitLab CI 省。而且 **concurrency 排隊這一條是真的會倒退**，要在部署腳本補鎖。GitLab CI 則是整支 YAML 重寫（`.gitlab-ci.yml` 語法不同），但 `resource_group` 直接解決排隊，`rules:` 可以做內容／程式分流。兩邊的移植工作量**同一個量級**，不該是選平台的決定因素。

## 5. 權限、四眼原則與稽核

這個架構把治理規則放在閘道與建置，**平台只是最後一道鎖與不可改的紀錄**，所以三個平台在這裡差距很小：

- **四眼原則**：閘道強制（同一人不能既編輯又核准，見 architecture-decisions §52）。平台上只有服務帳號在動作，不需要 GitLab Premium 的「核准規則」或 GitHub 的「required reviewers」。
- **單位權限**：來自 AD 群組 `CDC-WEB-<單位>-<角色>`，閘道查；平台不知道有單位這回事。
- **誰改誰核**：寫在提交訊息 trailer 與閘道稽核檔 `gateway-audit.jsonl`（鏈式雜湊、只增不改，deploy.md §14.6）。平台只要保證提交歷史不可改寫（禁 force push）就夠。
- **平台自己的操作稽核**（誰給了誰 Maintainer、誰改了保護分支、誰換了 token）才是真正的差別：
  - GitLab：Free 版有基本的登入與專案層級事件；**整站層級的稽核事件、匯出、冒用紀錄要 Premium**。
  - Gitea 社群版：**沒有稽核紀錄功能**，只有一般的應用程式 log；稽核紀錄是 Gitea Enterprise 的付費功能。Forgejo 同樣沒有。
  - GitHub Enterprise：組織與企業層級的 audit log 完整，可串流到 SIEM。
  - **對本機關的意義**：資安責任等級 A 級要有紀錄留存。用 Gitea／Forgejo 社群版時，要把「平台管理操作」的稽核改用**縮小管理員人數＋設定檔納入版控＋反向代理的存取 log 進集中式日誌**來補；這能做，但是人工約束，不是系統保證。這是選 Gitea 時資訊室要簽字接受的一點。

## 6. 資安與政府採購要核對的事

這一節不是結論，是資訊室在採用任何一個平台前都要過一遍的清單；Gitea／Forgejo 因為比較少被政府機關正式採用，更需要逐項留紀錄。

1. **「各機關對危害國家資通安全產品限制使用原則」的認定**：原則要求從嚴認定，涵蓋軟體與服務。開放原始碼軟體本身沒有「廠牌」，但維護主體與商業支援來源有。GitLab Inc.（美國）與 GitHub（微軟）認定單純；Gitea Ltd 的登記地**本文件查不到公開的官方登記資料**（其子公司 CommitGo 的第三方目錄列為美國），Forgejo 掛在德國非營利組織下。**請資訊室依現行原則與資安署函釋自行認定，不要引用本文件當依據。**
2. **弱點修補節奏**：三個平台都有定期 security release；Gitea 的安全公告會先通知付費客戶、Forgejo 對所有人同時公告。資訊室要能在公告後幾天內升級，Gitea 單一執行檔在這點最省事。
3. **供應鏈**：Actions／CI 用到的第三方 action 與容器映像都要固定版本並鏡像到內網（deploy.md §2 的 SHA 固定原則不變）；Gitea 沒有 Dependabot，要用 Renovate 或人工週檢。
4. **弱掃與滲透測試**：平台本身要納入 A 級機關的定期弱掃；Gitea 攻擊面小但一樣要掃。平台只開內網（#130 討論已確認），對外只有靜態網站與閘道的反向代理。
5. **商業支援**：GitLab 可買 Premium 支援；Gitea 可向 CommitGo 買企業版支援；Forgejo 只有社群與第三方廠商。合約期內誰負責升級與修補要寫進維運合約（transition-faq §3）。
6. **帳號與 MFA**：平台登入一律接 AD／Entra ID，MFA 由身分系統強制；不要在平台上建本機帳號（服務帳號除外，且只能 API 存取）。三個平台都做得到。
7. **資料出境**：自架版三者都在機關內；若考慮 GitHub Enterprise Cloud（GHEC），程式碼與內容會在境外主機，公開網站的內容是公開資料，但閘道稽核、審核中的草稿要另案評估（#132 的個資原則）。

## 7. 對原型的影響：只差一個轉接器

寫入閘道目前有兩個 Git 供應者：`local`（原型示範）與 `gitlab`（REST v4，13 個端點，以假的 fetch 做單元測試）。換平台只要再寫一個同介面的檔案：

| 目標平台 | 要新增的檔 | 備註 |
| --- | --- | --- |
| GitLab | 已有 `git-gitlab.mjs` | 上線前仍要在測試專案實跑（deploy.md §14.7） |
| Gitea／Forgejo | `git-gitea.mjs` | API 與 GitHub 的 contents／pulls／branches 端點相近；合併用 `POST /repos/{owner}/{repo}/pulls/{index}/merge`，核准用 reviews |
| GitHub Enterprise | `git-github.mjs` | 與 Gitea 版約八成相同，可共用 |

其餘不變：`workflow.mjs` 的狀態機、四眼檢查、稽核、`baseHash` 過期判斷都在轉接器之上。CI 的移植（§4）則是平台選定後才做，三個平台都要做一次。

## 8. 決策建議與要資訊室回答的問題

**建議資訊室照這個順序回答，答案就決定了平台：**

1. 機關現在有沒有在維運 GitLab 或 GHES？給哪些系統用？版本與授權等級？→ **有就用它**（deploy.md §14.8 第 5 題本來就在問）。
2. 若沒有：搬 Azure 時身分系統是 AD 還是 Entra ID？資訊室有沒有打算把 CI runner 也放進 Azure？→ 若已是 Entra ID 且考慮 GitHub，GHES／GHEC 與原型的工作流程零移植，應與 #130 一起評估。
3. 若仍要自架且什麼都沒有：資訊室能不能接受「平台管理操作沒有系統級稽核」（§5），並用管理員人數與日誌補？→ 能接受則 **Gitea 或 Forgejo**，依 §6 第 1 項與第 5 項（廠牌認定、支援來源）二擇一；不能接受則 GitLab。
4. 選 Gitea／Forgejo 時的三個先決工作：(a) §6 清單逐項留紀錄；(b) 部署排隊改由部署腳本加鎖（§4）；(c) 把 `actions/*` 與 Playwright 容器鏡像到內網。

**本輪不改變正式環境的規劃**（deploy.md §14 仍以 GitLab 為例寫），因為第 1 題還沒有答案。

## 9. 為什麼這樣回答，而不是直接說「Gitea 比較好」或「GitLab 比較好」

- **同事的問題其實是兩個問題**：「哪個省資源」（Gitea，無疑）與「哪個適合我們」（看機關現況）。把兩個混在一起回答會得出錯誤結論：省資源的平台，在已經有另一套平台的機關裡反而增加維運。
- **這個架構刻意不依賴平台的進階功能**（四眼、單位權限、稽核都在閘道），所以平台選錯的代價很低——多寫一個轉接器、重寫一次 CI。正因為代價低，不值得為它開一場長期的工具之爭；資訊室手上有什麼就用什麼。
- **真正要留紀錄的只有兩件事**：Gitea／Forgejo 社群版沒有平台稽核紀錄，以及廠牌認定要由機關自己做。這兩件是日後被問「當初為什麼選這個」時要拿得出來的答案，所以寫成清單而不是結論。
- **Actions 相容性被高估了**：相容的是 YAML 語法，不是平台 API；而原型 CI 裡最花心思的部分（車道判斷、沿用檢查結果、排隊部署）正好都是平台 API 與 concurrency 語意。把這點量出來（§4 的表），同事才不會以為搬 Gitea 是零成本。

## 10. 查核狀態

本文件在不能連到各平台官網全文的開發環境寫成，依據是各平台的官方文件摘要與公開資料（2026-11）。以下幾點採用前要再查：

- Gitea Actions 對 `concurrency`、`continue-on-error`、`timeout-minutes` 的支援隨版本變動，以資訊室要裝的那一版的 `usage/actions/comparison` 文件為準。
- GitLab 各功能的 Free／Premium 分級以 docs.gitlab.com 當期頁面為準。
- Gitea Ltd 的登記地與 Gitea Enterprise 的供應主體，以公司登記資料為準。
