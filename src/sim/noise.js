import { createNoise2D } from 'simplex-noise'

// GLSL: 2D simplex noise (Ashima / McEwan) + fbm, shared by several shaders.
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
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
`

// Colours in shaders are written as sRGB and converted to linear.
export const GLSL_SRGB = /* glsl */ `
vec3 S(float r, float g, float b){ return pow(vec3(r, g, b), vec3(2.2)); }
`

// ---- JS side --------------------------------------------------------------

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
  const fbm = (x, y, oct = 4, lac = 2.03, gain = 0.5) => {
    let a = 0.5, s = 0, fx = x, fy = y
    for (let i = 0; i < oct; i++) {
      s += a * n(fx, fy)
      fx = fx * lac + 17.1
      fy = fy * lac + 9.7
      a *= gain
    }
    return s
  }
  const ridged = (x, y, oct = 3) => {
    let a = 0.5, s = 0, fx = x, fy = y, w = 1
    for (let i = 0; i < oct; i++) {
      let v = 1 - Math.abs(n(fx, fy))
      v = v * v * w
      w = Math.min(1, v * 2)
      s += a * v
      fx = fx * 2.1 + 3.7
      fy = fy * 2.1 + 1.3
      a *= 0.5
    }
    return s
  }
  return { n, fbm, ridged }
}
