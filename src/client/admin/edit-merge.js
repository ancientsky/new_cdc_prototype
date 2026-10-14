// 第五十二輪：疫情報導、職缺、採購三個編輯頁「修改既有內容」共用的合併（docs/deploy.md §24）。
//
// 第五十一輪把 /admin/publish/?edit= 改成「以現行版為底，只套用同事改過的欄位」（§22，preprocess.js 的 mergeEdit）。
// 這三個編輯頁各有自己的匯出函式（buildArticle／buildJob／buildTender），以前也是「表單重組一份完整 JSON」：
// 什麼都沒改就匯出，也會把 AI 白名單的核准日改成今天、把已下架的甄選名單整段刪掉、把舊分類代號換成新代號、
// 把圖檔的替代文字換成圖表的替代文字，而且鍵的順序全部重排（PR 看起來整檔都改了）。
// 這裡直接沿用 mergeEdit（同一份三方合併、同一份「提供語言」與譯文 sourceHash 規則），只補兩件這三個表單特有的事：
//   1. 字串清單整欄套用：資格條件、工作內容、採購範圍、參考文獻、關鍵字……在這些表單裡是「每行一項」的完整清單，
//      順序有意義、表單也裝得下全部。mergeEdit 對字串清單只套「新增、移除了哪些」（為了上架頁只顯示部分建議詞的關鍵字），
//      用在這裡會把改過的那一行搬到最後。所以改過的字串清單直接用表單的版本。
//   2. 附件（assets）逐筆比對：疫情報導的表單每次都依圖表重新產生整份 assets[]（替代文字取自圖表、鍵順序也不同），
//      mergeEdit 的附件規則是「表單只列這次新選的檔」。所以先挑出跟載入時不同的那幾筆，逐筆與現行版三方合併後再交給 mergeEdit。
import { mergeEdit, mergeValue, sameValue, editDiff, EDIT_DERIVED } from './preprocess.js';
import { fieldLabel } from './field-labels.js';

const isPrim = (v) => v == null || ['string', 'number', 'boolean'].includes(typeof v);
const isPrimList = (v) => Array.isArray(v) && v.every(isPrim);

/**
 * 整欄表單的修改：以現行版為底，只套用 base（表單剛帶入、還沒動過時的匯出）與 out（目前的匯出）不同的欄位。
 * @param {any} out       目前表單的匯出（buildJob／buildTender／buildArticle 的結果）
 * @param {any} original  現行版（content 檔的內容；帶 sourceHash 時，改到正本文字會把既有譯文標成「依舊版翻譯」）
 * @param {any} base      表單剛帶入、還沒動過時的匯出（頁面在載入完成時記下）
 * @returns 要寫回 repo 的 JSON：未改的欄位與現行版逐位元組相同、鍵順序不變；EDIT_DERIVED（status、reviewedAt）用表單的值
 */
export function mergeFormEdit(out, original, base) {
  if (!original) return out;
  if (!base) throw new TypeError('mergeFormEdit 需要 base（表單剛帶入時的匯出），否則分不出哪些欄位是同事改的');
  const b = { ...base },
    o = { ...out };
  for (const k of new Set([...Object.keys(base), ...Object.keys(out)])) {
    if (sameValue(base[k], out[k])) continue;
    if (k === 'assets') {
      // 只留跟載入時不同的那幾筆；現行版有同名檔就逐筆三方合併（保留現行版的鍵順序與表單沒有的子欄位）
      const live = original.assets ?? [];
      const changed = (out.assets ?? [])
        .filter((c) => !(base.assets ?? []).some((x) => sameValue(x, c)))
        .map((c) => {
          const was = (base.assets ?? []).find((x) => x?.file === c?.file),
            now = live.find((x) => x?.file === c?.file);
          if (!was || !now) return c;
          const { url, ...rest } = now;
          void url; // API 形狀的附件帶公開網址，不寫回
          return mergeValue(rest, was, c);
        });
      if (changed.length) {
        b.assets = undefined;
        o.assets = changed;
      } else {
        // 只少了幾筆＝不動（表單本來就刪不掉現行版附件，與上架頁相同）
        delete b.assets;
        delete o.assets;
      }
    } else if (Array.isArray(out[k]) && (isPrimList(out[k]) || isPrimList(base[k]))) {
      b[k] = undefined; // 讓 mergeEdit 視為「整欄新值」：字串清單用表單的版本（順序照表單）
    }
  }
  return mergeEdit(o, original, b);
}

/**
 * 與現行版相比改了哪些欄位：{ fields, derived }。fields 不含 EDIT_DERIVED（editDiff 的規則）；
 * derived＝匯出時一定會更新、而且值真的不同的 EDIT_DERIVED 欄位（通常只有最後審閱日；狀態不同時也列出）。
 */
export function changedFields(merged, original) {
  const live = original ?? {};
  return { fields: editDiff(merged, original), derived: EDIT_DERIVED.filter((k) => merged?.[k] !== undefined && !sameValue(merged[k], live[k])) };
}

/** 這三個編輯頁的欄位名稱：第五十三輪起與審核人的差異共用 field-labels.js 的同一份（職缺、採購經閘道送審後，兩邊要叫同一個名字）；不認得的仍顯示代碼 */
export const editorFieldLabel = (k) => fieldLabel(k);
/** 「目前改動的欄位」一行字（給畫面）：內容與現行版相同時也明說，並列出匯出時一定會更新的欄位。輸入是 changedFields() 的結果 */
export function changedText({ fields = [], derived = [] } = {}) {
  const tail = derived.length ? `（另外匯出時會更新：${derived.map(editorFieldLabel).join('、')}）` : '';
  return fields.length ? `與現行版相比改動的欄位：${fields.map((k) => `${editorFieldLabel(k)}（${k}）`).join('、')}${tail}` : `內容與現行版相同${tail}`;
}
