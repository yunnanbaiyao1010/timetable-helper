/* 把网页工程同步到 www/，避免同一份代码存两处 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'web');
const DST = path.resolve(__dirname, 'www');
const ITEMS = ['index.html', 'manifest.json', 'icon.svg', 'css', 'js'];

fs.rmSync(DST, { recursive: true, force: true });
fs.mkdirSync(DST, { recursive: true });

for (const item of ITEMS) {
  const from = path.join(SRC, item);
  const to = path.join(DST, item);
  if (!fs.existsSync(from)) { console.warn('跳过（不存在）:', item); continue; }
  fs.cpSync(from, to, { recursive: true });
}
console.log('已同步网页到 www/:', ITEMS.join(', '));
