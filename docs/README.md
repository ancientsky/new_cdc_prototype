# docs/ 文件索引

> 第七十一輪（2026-11-12）新增。`docs/` 有 39 份文件，這裡用兩種方式找：**給誰看**（第 1 節，每份只列一次，放在最主要的讀者底下）與**主題**（第 2 節，同一份可出現在多個主題）。
> 系統現在長什麼樣、哪個子系統的規則在哪一節，先看 [ARCHITECTURE.md](../ARCHITECTURE.md) §0.5「現況地圖」；測試檔在哪，看 [tests/README.md](../tests/README.md)。
> 新增一份文件時，請在第 1 節與第 2 節各加一行。

## 1. 依「給誰看」

### 1.1 民眾

| 文件 | 一句話 |
| --- | --- |
| [guide-public.md](guide-public.md) | 民眾使用說明：怎麼問、怎麼看來源與更新日、七語與無障礙，也給協助長輩與新住民的人看 |

### 1.2 專業人員（醫事與防疫人員）

| 文件 | 一句話 |
| --- | --- |
| [guide-professional.md](guide-professional.md) | 公衛醫療人員使用說明：專業版、引用、訂閱異動、核對文件版次 |

### 1.3 同事上架（各組承辦人、公關室）

| 文件 | 一句話 |
| --- | --- |
| [guide-staff.md](guide-staff.md) | 同事操作手冊與各項 SOP：上架、送審、重新審閱、交接，每一輪新功能的操作都在這裡 |
| [assets-policy.md](assets-policy.md) | 附件、圖片、資料檔放哪裡、怎麼命名、建置時檢查什麼，PDF 可及性與下架 |
| [pdf-ingest.md](pdf-ingest.md) | PDF 怎麼轉成分章、帶頁碼的機讀版，讓智慧問答查得到也引用得到 |
| [bulletin.md](bulletin.md) | 《疫情報導》改成 MMWR 式全文閱讀：資料模型、卷期目錄、上傳 PDF 自動帶入 |
| [immunization-ia.md](immunization-ia.md) | 預防接種專區：官網分類子項對應到新站型別的對照與承辦人待辦 |
| [careers-privacy.md](careers-privacy.md) | 人才招募個資處理原則：報名資料不進 repo、公布方式、保存與刪除 |
| [legacy-import.md](legacy-import.md) | 舊站匯出批次轉換：匯出格式、規則檔、信心分級，以及各批次的處理經驗 |
| [migration-playbook.md](migration-playbook.md) | 舊站→新站內容移轉與轉址手冊：301／410、舊站保留期、切換日檢查清單 |

### 1.4 資訊室（部署、維運與資安）

| 文件 | 一句話 |
| --- | --- |
| [deploy.md](deploy.md) | 部署與維運總手冊：環境、安全標頭、Pagefind、閘道與 GitLab、各輪的環境變數與指令 |
| [git-as-cms.md](git-as-cms.md) | 為什麼用 Git＋CI 而不是傳統後台上架系統，以及資訊室要維運什麼 |
| [git-platform-choice.md](git-platform-choice.md) | Git 平台怎麼選（Gitea／Forgejo、GitLab、GitHub Enterprise）與要回答的四題 |
| [ci-cd-overview.md](ci-cd-overview.md) | 從按下送出到上線的每一道關卡、基準數字與常見質疑（拿去談的版本） |
| [ci-scaling.md](ci-scaling.md) | 內容越來越多 CI 會不會變慢：實測、推估與分層對策 |
| [performance-lighthouse.md](performance-lighthouse.md) | Lighthouse 效能檢測（第七十二輪）：量法、15 頁結果、逐項處置與不改的理由、CSS 壓縮與快取規則、答案頁為什麼要看 `perf:ask`、`npm run perf:lighthouse` |
| [admin-auth.md](admin-auth.md) | 後台登入設計：機關 SSO＋MFA、角色×單位對照、離職調動清單 |
| [attack-surface.md](attack-surface.md) | 攻擊面縮小：正式部署產物白名單、內部站拆分、對外資產清冊 |
| [abuse-protection.md](abuse-protection.md) | 防自動化濫用：速率限制、Bot 防護、探測偵測與告警 |
| [security-testing.md](security-testing.md) | 滲透測試、動態弱點掃描、AI 輔助自我檢測與修補時限（示意稿） |
| [a11y.md](a11y.md) | 無障礙基準與自我評量：WCAG 2.2 AA、axe 結果、CI 閘門、人工走查腳本 |
| [i18n.md](i18n.md) | 多語工程筆記：詞彙退回、外語頁中文比例檢查、機器翻譯初稿怎麼審 |
| [ask-log.md](ask-log.md) | 智慧問答查詢紀錄：記什麼不記什麼、k-匿名報表、正式收件端契約 |
| [denguemap-integration.md](denguemap-integration.md) | 與登革熱地圖整合：深連結、疫情小卡、專區嵌入、CSP 與排程 |
| [vaxmap-integration.md](vaxmap-integration.md) | 與疫苗及流感藥劑地圖（vaxmap-next）整合的四層做法與時程 |

### 1.5 OASIS（AI推動辦公室）：治理與評估

| 文件 | 一句話 |
| --- | --- |
| [governance-model.md](governance-model.md) | 資料治理模型：欄位、31 條規則、KPI、白名單、授權、個資 |
| [publishing-lanes.md](publishing-lanes.md) | 發布車道建議書：三條車道、CI 當第一位審核者、SLA、試行計畫 |
| [eval-challenge.md](eval-challenge.md) | 換句話說挑戰集與封存盲測題組：怎麼量答案引擎、各輪分數 |
| [ask-engine-explainer.md](ask-engine-explainer.md) | 智慧問答不用 embedding 為什麼又快又準、限制在哪（同仁版） |
| [ask-search-llm.md](ask-search-llm.md) | 智慧問答與全文搜尋的技術比較、LLM 怎麼接、各輪弱項的補法 |
| [pageindex-evaluation.md](pageindex-evaluation.md) | PageIndex（樹索引＋模型翻目錄）對本站有沒有幫助的評估 |
| [intl-epidemic.md](intl-epidemic.md) | 國際重要疫情資訊自動上架：交換格式、三條路一個匯入器、機器把關；API 與 MCP 的選擇 |
| [line-chatbot.md](line-chatbot.md) | LINE「疾管家」能不能用新網站當知識庫：三種接法與要先問的問題 |

### 1.6 決策與回顧（主管、接手的同事或廠商）

| 文件 | 一句話 |
| --- | --- |
| [architecture-decisions.md](architecture-decisions.md) | 架構決策紀錄：每一項決策的決定、理由、代價、沒選的做法 |
| [architecture-ux-review.md](architecture-ux-review.md) | 第七十一輪架構與 UI/UX 全面檢視：哪裡穩、哪裡接手會卡、介面發現與本輪修正 |
| [roadmap-mapping.md](roadmap-mapping.md) | 原型功能與規劃文件三階段路線圖對照：已示範、部分、未做 |
| [plan-supplement.md](plan-supplement.md) | 規劃文件回補：原型做了、規劃沒寫到的作法 |
| [transition-faq.md](transition-faq.md) | 同事常問：舊站小改行不行、雙站並行、怎麼驗廠商、時程與切換 |
| [navigation.md](navigation.md) | 主選單要不要 mega menu 的評估，以及小型面板的設計決定 |
| [interactives.md](interactives.md) | 彩蛋與互動模組：做成有開關、有檔期、有權責的內容，放在哪、為什麼 |

## 2. 依主題

| 主題 | 文件 |
| --- | --- |
| 治理與內容模型 | governance-model.md、assets-policy.md、architecture-decisions.md、plan-supplement.md |
| 上架與發布流程 | guide-staff.md、publishing-lanes.md、git-as-cms.md、admin-auth.md、bulletin.md、pdf-ingest.md |
| 智慧問答與全文搜尋 | ask-engine-explainer.md、ask-search-llm.md、eval-challenge.md、ask-log.md、pageindex-evaluation.md、line-chatbot.md |
| 多語 | i18n.md、guide-public.md |
| 介面、導覽與無障礙 | architecture-ux-review.md、navigation.md、a11y.md、interactives.md |
| 部署與 CI | deploy.md、ci-cd-overview.md、ci-scaling.md、performance-lighthouse.md、git-platform-choice.md |
| 資安與個資 | attack-surface.md、abuse-protection.md、security-testing.md、careers-privacy.md、deploy.md（§9、§10、§30–§32） |
| 舊站移轉 | migration-playbook.md、legacy-import.md、transition-faq.md |
| 各專區與外部系統 | bulletin.md（疫情報導）、immunization-ia.md（預防接種）、intl-epidemic.md（國際疫情）、denguemap-integration.md、vaxmap-integration.md |
| 規劃與路線 | roadmap-mapping.md、plan-supplement.md、transition-faq.md、architecture-ux-review.md |
| 使用說明 | guide-public.md、guide-professional.md、guide-staff.md |

另有 `screenshots/` 資料夾：README 與各文件引用的畫面截圖。
