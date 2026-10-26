import { deflateSync } from 'node:zlib';
const crc = (bytes: Uint8Array) => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};
function chunk(type: string, bytes: Uint8Array) {
  const name = Buffer.from(type),
    body = Buffer.concat([name, bytes]),
    size = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  checksum.writeUInt32BE(crc(body));
  return Buffer.concat([size, body, checksum]);
}
export function appIcon(size: number) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((size * 4 + 1) * size),
    glyph = ['111101111', '100101000', '111101110', '100001000', '100001000'];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x / size - 0.18) / 0.071),
        gy = Math.floor((y / size - 0.3) / 0.08),
        marked = gx >= 0 && gx < 9 && gy >= 0 && gy < 5 && glyph[gy][gx] === '1';
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      rows[offset] = marked ? 169 : 17;
      rows[offset + 1] = marked ? 199 : 19;
      rows[offset + 2] = marked ? 255 : 22;
      rows[offset + 3] = 255;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
