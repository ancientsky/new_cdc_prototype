// 自寫 ZIP（store-only，不壓縮）：local file header ＋ central directory ＋ EOCD，CRC32 自算，檔名 UTF-8 旗標（bit 11）。
// 純函式、零依賴，瀏覽器與 Node 共用。上架包最多幾十個檔，不壓縮換來實作可逐位元組驗證（見 tests/admin-editor.test.mjs 的最小 ZIP reader）。
// 限制：不支援 ZIP64（單檔與總大小 < 4 GiB、檔數 < 65535）；日期為 DOS 格式（2 秒精度、1980 起）。

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32（IEEE 802.3，與 zip／gzip／PNG 相同）。可串接：crc32(b, crc32(a)) ＝ crc32(a+b)。 */
export function crc32(bytes, prev = 0) {
  let c = (prev ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
const toBytes = (d) => (typeof d === 'string' ? enc.encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d));

/** Date → DOS [time, date]（本地時間，2 秒精度）。早於 1980 以 1980-01-01 計。 */
export function dosDateTime(d = new Date()) {
  const y = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time & 0xffff, date & 0xffff];
}

/** 路徑正規化：反斜線→斜線、去開頭 /、禁 .. 與空段（避免 zip-slip）。 */
export function zipPath(name) {
  const parts = String(name).replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  if (!parts.length || parts.includes('..')) throw new Error(`不合法的 ZIP 路徑：${name}`);
  return parts.join('/');
}

/**
 * entries：[{ name, data: Uint8Array|ArrayBuffer|string, date?: Date }]（name 以 / 分層，結尾 / 表示空目錄）
 * 回傳 Uint8Array（完整 .zip）。
 */
export function createZip(entries, opts = {}) {
  const now = opts.date ?? new Date();
  const files = [];
  let size = 22; // EOCD
  for (const e of entries) {
    const isDir = String(e.name).endsWith('/');
    const name = enc.encode(zipPath(e.name) + (isDir ? '/' : ''));
    const data = isDir ? new Uint8Array(0) : toBytes(e.data ?? '');
    if (data.length >= 0xffffffff) throw new Error(`檔案太大（不支援 ZIP64）：${e.name}`);
    const [time, date] = dosDateTime(e.date ?? now);
    files.push({ name, data, crc: crc32(data), time, date, isDir });
    size += 30 + name.length + data.length + 46 + name.length;
  }
  if (files.length > 0xfffe) throw new Error('檔案數量過多（不支援 ZIP64）');
  if (size >= 0xffffffff) throw new Error('總大小過大（不支援 ZIP64）');
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let p = 0;
  const w16 = (v) => { dv.setUint16(p, v, true); p += 2; };
  const w32 = (v) => { dv.setUint32(p, v >>> 0, true); p += 4; };
  const wb = (b) => { out.set(b, p); p += b.length; };
  const GP = 0x0800; // bit 11：檔名為 UTF-8
  for (const f of files) {
    f.offset = p;
    w32(0x04034b50); w16(20); w16(GP); w16(0); w16(f.time); w16(f.date);
    w32(f.crc); w32(f.data.length); w32(f.data.length); w16(f.name.length); w16(0);
    wb(f.name); wb(f.data);
  }
  const cdStart = p;
  for (const f of files) {
    w32(0x02014b50); w16(0x031e); w16(20); w16(GP); w16(0); w16(f.time); w16(f.date);
    w32(f.crc); w32(f.data.length); w32(f.data.length); w16(f.name.length); w16(0); w16(0);
    w16(0); w16(0); w32(f.isDir ? 0x41ed0010 : 0x81a40000); w32(f.offset); // external attrs：unix 0644 檔／0755 目錄（high 16 bits）
    wb(f.name);
  }
  const cdSize = p - cdStart;
  w32(0x06054b50); w16(0); w16(0); w16(files.length); w16(files.length); w32(cdSize); w32(cdStart); w16(0);
  return out;
}

/** 瀏覽器用：回傳 Blob */
export function zipBlob(entries, opts) {
  return new Blob([createZip(entries, opts)], { type: 'application/zip' });
}
