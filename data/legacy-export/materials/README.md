# 舊站匯出（模擬）：宣導素材欄目（第十批）

> **這是模擬匯出。** 開發環境連不到 www.cdc.gov.tw，這 24 頁由 `scripts/lib/legacy-import/sim-export-materials.mjs` 合成：列表 6 頁（宣導素材、海報、單張、手冊、多媒體、影片）、MPage 3 頁（多國語言衛教素材、商業媒體運用一覽表、數位學習課程）、素材內頁 9 頁（多圖海報系列、七語海報、純圖單張、久遠海報、懶人包圖卡、手冊、無文字稿影片、1922 社群入口等）、既有 media 反推 3 頁（影片、動畫、廣播），另**原樣複製**結核病批匯出的 3 頁宣導素材（連同附件與圖檔）。
>
> 宣導素材根、多媒體、影片、多國語言衛教素材、商業媒體運用一覽表、數位學習課程的網址 ID 是**真實**的；其餘 ID、經費、數字、站外連結皆為**示意**。素材內頁的 `/Category/ListContent/{listId}?uaid={id}` 是**推測的網址模式**，正式匯出以真實網址為準。**正式匯出取代整個目錄即可**，不需要改程式。

## 重新產生

```
node scripts/lib/legacy-import/sim-export-materials.mjs data/legacy-export/materials
```

## 轉換

```
node scripts/import-legacy.mjs data/legacy-export/materials --out data/legacy-import/materials --apply-migration
```

移轉清單：`content/migration/materials.json`（欄目範圍，逐頁一筆；複製的 3 頁與結核病批是同一頁，不列入清單，轉換器會判定為「已在 tuberculosis 批轉過」）。匯出格式見 `docs/legacy-import.md` 第 2 節。
