// 開發期一次性：由 world-atlas 110m 產生世界地圖路徑 → src/data/world-paths.json
// 用法：npm run gen:map（需 devDependencies：world-atlas、topojson-client、d3-geo、i18n-iso-countries）
// 產物 commit 進 repo；建置時 _travel-map.mjs 只讀 JSON，不需要這些套件。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
import { geoNaturalEarth1, geoPath } from 'd3-geo';

const require = createRequire(import.meta.url);
const isoCountries = require('i18n-iso-countries');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 960, H = 500;

const topo = JSON.parse(fs.readFileSync(require.resolve('world-atlas/countries-110m.json'), 'utf8'));
const all = feature(topo, topo.objects.countries);
// 去掉南極洲（id 010）
const features = all.features.filter((f) => String(f.id).padStart(3, '0') !== '010');
const fc = { type: 'FeatureCollection', features };

const projection = geoNaturalEarth1().fitSize([W, H], fc);
const gp = geoPath(projection).digits(1); // d3-geo 3.1+：座標輸出 1 位小數

// Natural Earth 110m 對少數國家沒有 ISO 數字碼（id 缺漏）或與 ISO 3166 不同，這裡手動補
const NAME_FIX = { Kosovo: 'XK', 'N. Cyprus': null, Somaliland: null };
const paths = {};
const skipped = [];
for (const f of features) {
  const id = f.id == null ? null : String(f.id).padStart(3, '0');
  let iso2 = id ? isoCountries.numericToAlpha2(id) : undefined;
  if (!iso2 && f.properties?.name in NAME_FIX) iso2 = NAME_FIX[f.properties.name];
  if (!iso2) { skipped.push(`${id ?? '(no id)'} ${f.properties?.name ?? ''}`); continue; }
  const d = gp(f);
  if (!d) { skipped.push(`${iso2} (empty path)`); continue; }
  // 同一 ISO2 多個 feature 時（理論上不會）串接
  paths[iso2] = paths[iso2] ? `${paths[iso2]}${d}` : d;
}

const sorted = Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b)));
const out = {
  viewBox: `0 0 ${W} ${H}`,
  projection: 'naturalEarth1',
  generatedAt: new Date().toISOString().slice(0, 10),
  source: 'world-atlas@110m',
  paths: sorted,
};
const dest = path.join(root, 'src/data/world-paths.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 0) + '\n');
const kb = (fs.statSync(dest).size / 1024).toFixed(1);
console.log(`[gen-world-map] ${Object.keys(sorted).length} countries, ${kb} KB → ${path.relative(root, dest)}`);
if (skipped.length) console.log(`[gen-world-map] skipped (no ISO2): ${skipped.join('; ')}`);
