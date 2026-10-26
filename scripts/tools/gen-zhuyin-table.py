#!/usr/bin/env python3
# 第六十五輪：產生智慧問答「同音字／注音文」比對用的讀音表 src/client/answer/zhuyin-data.js（docs/ask-search-llm.md §19）。
#
# 為什麼是 Python、為什麼產出檔進版控：讀音資料來自 pypinyin（MIT 授權；底層是 Unicode Unihan 的 kMandarin／kHanyuPinyin），
# 只有改字集或更新讀音時才要重跑，建置與 CI 不需要 Python。產出檔是純資料，審查時看 diff 即可。
#
# 字集：Big5 常用字區（0xA440–0xC67E，5,401 字，台灣日常輸入幾乎都在這裡）＋ content/master 主檔名稱用到的所有漢字。
# 讀音：注音、不含聲調（台灣與大陸讀音的聲調差異不少，例如「期」「危」，比對時不看聲調比較穩），多音字全部列出。
#
# 用法：pip install pypinyin && python3 scripts/tools/gen-zhuyin-table.py
import json, pathlib, re
from pypinyin import pinyin, Style

ROOT = pathlib.Path(__file__).resolve().parents[2]
chars = set()
for hi in range(0xA4, 0xC7):
    for lo in list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF)):
        code = (hi << 8) | lo
        if code < 0xA440 or code > 0xC67E:
            continue
        try:
            chars.add(bytes([hi, lo]).decode('big5'))
        except UnicodeDecodeError:
            pass
for f in (ROOT / 'content' / 'master').glob('*.json'):
    chars.update(re.findall(r'[一-鿿]', f.read_text(encoding='utf-8')))

TONES = re.compile('[ˊˇˋ˙]')
groups = {}
for ch in sorted(chars):
    for r in sorted({TONES.sub('', x) for x in pinyin(ch, style=Style.BOPOMOFO, heteronym=True)[0]}):
        if not re.fullmatch('[ㄅ-ㄩ]+', r):
            continue
        groups.setdefault(r, []).append(ch)

body = '|'.join(f'{k}:{"".join(v)}' for k, v in sorted(groups.items()))
out = ROOT / 'src' / 'client' / 'answer' / 'zhuyin-data.js'
out.write_text(
    '// 自動產生，請勿手改：python3 scripts/tools/gen-zhuyin-table.py（說明見該檔與 docs/ask-search-llm.md §19）。\n'
    '// 格式：「無聲調注音:同音字…」以「|」分隔；多音字出現在每個讀音下。資料來源 pypinyin（MIT）／Unicode Unihan。\n'
    f'export default {json.dumps(body, ensure_ascii=False)};\n',
    encoding='utf-8')
print(f'{len(chars)} 字、{len(groups)} 個讀音 → {out.relative_to(ROOT)}（{out.stat().st_size} bytes）')
