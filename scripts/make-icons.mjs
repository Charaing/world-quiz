// 의존성 없이 PNG 아이콘 생성 (지구본 모티프: 원 + 경선/위선)
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const bg = [0x17, 0x18, 0x1a], fg = [0xf6, 0xf4, 0xef], ac = [0x7c, 0x9c, 0xff];
  const rows = [];
  const S = 4; // 슈퍼샘플링
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0];
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const u = ((x + (sx + 0.5) / S) / size) * 2 - 1, v = ((y + (sy + 0.5) / S) / size) * 2 - 1;
        const R = 0.56, r = Math.hypot(u, v), lw = 0.035;
        let c = bg;
        if (r < R) {
          c = bg;
          const ring = Math.abs(r - R) < lw;
          const eq = Math.abs(v) < lw * 0.9;
          const lat = Math.abs(Math.abs(v) - R * 0.55) < lw * 0.8 && r < R;
          const mer0 = Math.abs(u) < lw * 0.9;
          const ex = R * 0.52; // 타원 경선
          const ell = Math.abs(Math.hypot(u / ex, v / R) - 1) < lw / ex * 0.9;
          if (ring || eq || lat || mer0 || ell) c = fg;
          if (ell && u > 0) c = ac;
        } else if (Math.abs(r - R) < 0.035) c = fg;
        acc = acc.map((a, i) => a + c[i]);
      }
      const o = 1 + x * 4;
      row[o] = acc[0] / (S * S); row[o + 1] = acc[1] / (S * S); row[o + 2] = acc[2] / (S * S); row[o + 3] = 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [180, 192, 512]) writeFileSync(`icons/icon-${s}.png`, png(s));
writeFileSync('icons/icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#17181A"/><g fill="none" stroke="#F6F4EF" stroke-width="3.5"><circle cx="50" cy="50" r="28"/><path d="M22 50h56M50 22v56M27 35.5h46M27 64.5h46"/></g><ellipse cx="50" cy="50" rx="14.5" ry="28" fill="none" stroke="#7C9CFF" stroke-width="3.5"/></svg>`);
console.log('icons written');
