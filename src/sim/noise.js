import { createNoise2D } from 'simplex-noise'

// GLSL: 2D simplex noise (Ashima / McEwan) + fbm, shared by several shaders.
// The JS versions below are line-for-line ports so CPU and GPU agree on terrain heights.
export const GLSL_NOISE = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x){ return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * snoise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; }
  return s;
}
float fbm3(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * snoise(p); p = p * 2.07 + vec2(11.3, 5.1); a *= 0.5; }
  return s;
}
float fbm2(vec2 p){
  return 0.5 * snoise(p) + 0.25 * snoise(p * 2.03 + vec2(17.1, 9.7));
}
float ridged(vec2 p){
  float a = 0.5, s = 0.0, w = 1.0;
  for (int i = 0; i < 4; i++) {
    float v = 1.0 - abs(snoise(p));
    v = v * v * w;
    w = min(1.0, v * 2.0);
    s += a * v;
    p = p * 2.1 + vec2(3.7, 1.3);
    a *= 0.5;
  }
  return s;
}
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
`

// Colours in shaders are written as sRGB and converted to linear.
export const GLSL_SRGB = /* glsl */ `
vec3 S(float r, float g, float b){ return pow(vec3(r, g, b), vec3(2.2)); }
`

// ---- JS ports of the GLSL above -------------------------------------------

const C0 = 0.211324865405187, C1 = 0.366025403784439, C2 = -0.577350269189626, C3 = 0.024390243902439
const mod289 = x => x - Math.floor(x * (1 / 289)) * 289
const permute = x => mod289(((x * 34) + 1) * x)
const fract = x => x - Math.floor(x)

export function snoise(vx, vy) {
  const s = (vx + vy) * C1
  let ix = Math.floor(vx + s), iy = Math.floor(vy + s)
  const t = (ix + iy) * C0
  const x0x = vx - ix + t, x0y = vy - iy + t
  const i1x = x0x > x0y ? 1 : 0, i1y = 1 - i1x
  const x1x = x0x + C0 - i1x, x1y = x0y + C0 - i1y
  const x2x = x0x + C2, x2y = x0y + C2
  ix = mod289(ix); iy = mod289(iy)
  const p0 = permute(permute(iy) + ix)
  const p1 = permute(permute(iy + i1y) + ix + i1x)
  const p2 = permute(permute(iy + 1) + ix + 1)
  let m0 = Math.max(0.5 - (x0x * x0x + x0y * x0y), 0)
  let m1 = Math.max(0.5 - (x1x * x1x + x1y * x1y), 0)
  let m2 = Math.max(0.5 - (x2x * x2x + x2y * x2y), 0)
  m0 *= m0; m0 *= m0; m1 *= m1; m1 *= m1; m2 *= m2; m2 *= m2
  const xx0 = 2 * fract(p0 * C3) - 1, xx1 = 2 * fract(p1 * C3) - 1, xx2 = 2 * fract(p2 * C3) - 1
  const h0 = Math.abs(xx0) - 0.5, h1 = Math.abs(xx1) - 0.5, h2 = Math.abs(xx2) - 0.5
  const a0 = xx0 - Math.floor(xx0 + 0.5), a1 = xx1 - Math.floor(xx1 + 0.5), a2 = xx2 - Math.floor(xx2 + 0.5)
  m0 *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h0 * h0)
  m1 *= 1.79284291400159 - 0.85373472095314 * (a1 * a1 + h1 * h1)
  m2 *= 1.79284291400159 - 0.85373472095314 * (a2 * a2 + h2 * h2)
  const g0 = a0 * x0x + h0 * x0y, g1 = a1 * x1x + h1 * x1y, g2 = a2 * x2x + h2 * x2y
  return 130 * (m0 * g0 + m1 * g1 + m2 * g2)
}
export function fbm(x, y) {
  let a = 0.5, s = 0
  for (let i = 0; i < 4; i++) { s += a * snoise(x, y); const nx = x * 2.03 + 17.1; y = y * 2.03 + 9.7; x = nx; a *= 0.5 }
  return s
}
export function fbm3(x, y) {
  let a = 0.5, s = 0
  for (let i = 0; i < 3; i++) { s += a * snoise(x, y); const nx = x * 2.07 + 11.3; y = y * 2.07 + 5.1; x = nx; a *= 0.5 }
  return s
}
export function fbm2(x, y) { return 0.5 * snoise(x, y) + 0.25 * snoise(x * 2.03 + 17.1, y * 2.03 + 9.7) }
export function ridged(x, y) {
  let a = 0.5, s = 0, w = 1
  for (let i = 0; i < 4; i++) {
    let v = 1 - Math.abs(snoise(x, y))
    v = v * v * w
    w = Math.min(1, v * 2)
    s += a * v
    const nx = x * 2.1 + 3.7; y = y * 2.1 + 1.3; x = nx
    a *= 0.5
  }
  return s
}

// ---- terrain height, shared formulation (GLSL string + JS) -----------------
// x,z in world units; returns height above the ground plane (may be negative = water)
export const GLSL_TERRAIN = /* glsl */ `
float terrainH(vec2 p){
  float cont = fbm3(p / 9000.0);
  float mm = smoothstep(0.0, 0.5, fbm2(p / 15000.0 + 100.0));
  float hills = fbm(p / 1100.0 + 5.0) * 95.0 + 55.0;
  float mts = ridged(p / 2800.0) * 1900.0 * mm;
  float h = cont * 160.0 + hills + mts;
  float rv = abs(snoise(p / 4200.0 + 7.0) + fbm2(p / 800.0 + 3.0) * 0.18);
  float river = 1.0 - smoothstep(0.015, 0.06, rv);
  float lowland = 1.0 - smoothstep(160.0, 420.0, h);
  h -= river * lowland * 70.0;
  return h;
}
`
const sm = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
export function terrainH(x, z) {
  const cont = fbm3(x / 9000, z / 9000)
  const mm = sm(fbm2(x / 15000 + 100, z / 15000 + 100), 0, 0.5)
  const hills = fbm(x / 1100 + 5, z / 1100 + 5) * 95 + 55
  const mts = ridged(x / 2800, z / 2800) * 1900 * mm
  let h = cont * 160 + hills + mts
  const rv = Math.abs(snoise(x / 4200 + 7, z / 4200 + 7) + fbm2(x / 800 + 3, z / 800 + 3) * 0.18)
  const river = 1 - sm(rv, 0.015, 0.06)
  const lowland = 1 - sm(h, 160, 420)
  h -= river * lowland * 70
  return h
}

// ---- cloud deck coverage, shared (GLSL string + JS); > 0 means cloud ------
export const GLSL_COVER = /* glsl */ `
float cloudCover(vec2 p){
  return fbm3(p * 0.00013 + 3.0) * 0.75 + fbm3(p * 0.0006 - 11.0) * 0.3 + 0.16;
}
`
export function cloudCover(x, z) {
  return fbm3(x * 0.00013 + 3, z * 0.00013 + 3) * 0.75 + fbm3(x * 0.0006 - 11, z * 0.0006 - 11) * 0.3 + 0.16
}

// ---- misc -----------------------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeNoise(seed) {
  const n = createNoise2D(mulberry32(seed))
  return { n }
}
