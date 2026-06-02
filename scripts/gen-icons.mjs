// Generates the PWA PNG icons with no dependencies (Node zlib only).
// A dark brand square with a centered light "node" dot; iOS rounds the corners.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(size) {
  const bg = [14, 15, 19] // #0e0f13
  const fg = [236, 237, 240]
  const cx = size / 2, cy = size / 2, r = size * 0.26
  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const [R, G, B] = d <= r ? fg : bg
      const o = y * stride + 1 + x * 4
      raw[o] = R; raw[o + 1] = G; raw[o + 2] = B; raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8-bit, RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

mkdirSync('public', { recursive: true })
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  writeFileSync('public/' + name, png(size))
  console.log('wrote public/' + name + ' (' + size + 'px)')
}
