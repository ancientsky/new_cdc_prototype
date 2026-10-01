// 本機預覽：node scripts/serve.mjs [port]；會依 basePath 服務 dist/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../site.config.mjs';
import { ROOT } from './lib/load.mjs';

const DIST = path.join(ROOT, 'dist');
const port = Number(process.argv[2] || process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (config.basePath && url.startsWith(config.basePath)) url = url.slice(config.basePath.length) || '/';
  let file = path.join(DIST, url);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { file = path.join(DIST, '404.html'); res.statusCode = 404; }
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}${config.basePath}/`));
