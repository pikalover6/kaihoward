import * as THREE from 'three'
import { mulberry32 } from './noise.js'

// The look: everything lit per vertex (Gouraud), small blurry textures, linear fog,
// rendered at a few hundred pixels tall into a 16-bit frame buffer with an ordered dither.
// Colours are authored and blended in display space, the way the hardware did it.

THREE.ColorManagement.enabled = false

export const SUN_DIR = new THREE.Vector3(0.45, 0.75, -0.48).normalize()

// shared by every N64 material
export const LIGHT = {
  uSunDir: { value: SUN_DIR.clone() },
  uSunCol: { value: new THREE.Color(0.62, 0.58, 0.5) },
  uAmbTop: { value: new THREE.Color(0.55, 0.62, 0.78) },
  uAmbBot: { value: new THREE.Color(0.42, 0.38, 0.36) },
  uFogColor: { value: new THREE.Color('#a8d8ff') },
  uFogNear: { value: 500 },
  uFogFar: { value: 3000 },
  uTime: { value: 0 },
}

export const LIGHTING_GLSL = /* glsl */ `
uniform vec3 uSunDir, uSunCol, uAmbTop, uAmbBot, uFogColor;
uniform float uFogNear, uFogFar, uTime;
vec3 n64Light(vec3 n){
  return mix(uAmbBot, uAmbTop, n.y * 0.5 + 0.5) + uSunCol * max(dot(n, uSunDir), 0.0);
}
float n64Fog(float depth){ return clamp((depth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0); }
`

const vert = /* glsl */ `
${LIGHTING_GLSL}
uniform vec3 uTint;
uniform float uEmissive;
uniform vec2 uUvScale, uUvScroll;
varying vec3 vLight, vCol;
varying vec2 vUv;
varying float vFog;
void main(){
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = m * instanceMatrix;
  #endif
  vec4 wp = m * vec4(position, 1.0);
  vec3 n = normalize(mat3(m) * normal);
  vLight = mix(n64Light(n), vec3(1.0), uEmissive);
  vCol = uTint;
  #ifdef USE_COLOR
  vCol *= color;
  #endif
  #ifdef USE_INSTANCING_COLOR
  vCol *= instanceColor;
  #endif
  vUv = uv * uUvScale + uUvScroll * uTime;
  vec4 mv = viewMatrix * wp;
  vFog = n64Fog(-mv.z);
  gl_Position = projectionMatrix * mv;
}
`
const frag = /* glsl */ `
uniform vec3 uFogColor;
uniform sampler2D map;
uniform float uHasMap, uAlpha, uFogAmount;
varying vec3 vLight, vCol;
varying vec2 vUv;
varying float vFog;
void main(){
  vec4 tex = uHasMap > 0.5 ? texture2D(map, vUv) : vec4(1.0);
  if (tex.a < 0.5) discard;
  vec3 c = vCol * tex.rgb * vLight;
  c = mix(c, uFogColor, vFog * uFogAmount);
  gl_FragColor = vec4(c, uAlpha);
}
`

// one material for (nearly) everything
export function n64Material({
  map = null, color = '#ffffff', vertexColors = false, emissive = 0, side = THREE.FrontSide,
  uvScale = [1, 1], uvScroll = [0, 0], alpha = 1, fog = 1, depthWrite = true,
} = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...LIGHT,
      map: { value: map },
      uHasMap: { value: map ? 1 : 0 },
      uTint: { value: new THREE.Color(color) },
      uEmissive: { value: emissive },
      uUvScale: { value: new THREE.Vector2(...uvScale) },
      uUvScroll: { value: new THREE.Vector2(...uvScroll) },
      uAlpha: { value: alpha },
      uFogAmount: { value: fog },
    },
    vertexShader: vert,
    fragmentShader: frag,
    vertexColors,
    side,
    transparent: alpha < 1,
    depthWrite,
  })
}

// --------------------------------------------------------------- textures
// small, few colours, a bit of noise: the stuff cartridge textures were made of

function canvasTex(size, draw, { repeat = true, alpha = false } = {}) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const c = cv.getContext('2d')
  draw(c, size)
  if (!alpha) {
    // no partial alpha anywhere
    const img = c.getImageData(0, 0, size, size)
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255
    c.putImageData(img, 0, 0)
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.NoColorSpace
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.anisotropy = 1
  return t
}

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
function speckle(c, size, base, spots, seed, density = 0.35) {
  const rnd = mulberry32(seed)
  c.fillStyle = base
  c.fillRect(0, 0, size, size)
  const img = c.getImageData(0, 0, size, size)
  const pal = spots.map(hex)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (rnd() > density) continue
    const p = pal[Math.floor(rnd() * pal.length)]
    const i = (y * size + x) * 4
    img.data[i] = p[0]; img.data[i + 1] = p[1]; img.data[i + 2] = p[2]
  }
  c.putImageData(img, 0, 0)
}

let cache = null
export function textures() {
  if (cache) return cache
  const T = {}
  T.grass = canvasTex(32, (c, s) => {
    speckle(c, s, '#59b33a', ['#4a9c2f', '#6ec447', '#3f8a28', '#7fd155'], 11, 0.5)
    // little tufts
    const rnd = mulberry32(5)
    c.fillStyle = '#86dc5c'
    for (let i = 0; i < 14; i++) { const x = Math.floor(rnd() * s), y = Math.floor(rnd() * s); c.fillRect(x, y, 1, 2) }
  })
  T.sand = canvasTex(32, (c, s) => speckle(c, s, '#ecd99a', ['#dcc684', '#f5e6b0', '#cfb877'], 12, 0.4))
  T.rock = canvasTex(32, (c, s) => {
    speckle(c, s, '#8c8579', ['#7a7368', '#9d968a', '#6b645b', '#a8a195'], 13, 0.55)
    c.strokeStyle = '#5c564e'; c.lineWidth = 1
    const rnd = mulberry32(3)
    for (let i = 0; i < 5; i++) { c.beginPath(); let x = rnd() * s, y = rnd() * s; c.moveTo(x, y); for (let k = 0; k < 3; k++) { x += (rnd() - 0.5) * 12; y += rnd() * 8; c.lineTo(x, y) } c.stroke() }
  })
  T.snow = canvasTex(32, (c, s) => speckle(c, s, '#f4f8ff', ['#dde8f7', '#ffffff', '#cfdcf0'], 14, 0.35))
  T.dirt = canvasTex(32, (c, s) => speckle(c, s, '#a07448', ['#8a613a', '#b5865a', '#7a5332'], 15, 0.5))
  T.water = canvasTex(64, (c, s) => {
    speckle(c, s, '#2f7fd8', ['#2a72c4', '#3a8ae0', '#2d78cf'], 16, 0.5)
    c.strokeStyle = '#8cc8ff'; c.lineWidth = 1
    const rnd = mulberry32(8)
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(rnd() * s), y = Math.floor(rnd() * s), w = 4 + Math.floor(rnd() * 8)
      c.beginPath(); c.moveTo(x, y + 0.5); c.quadraticCurveTo(x + w / 2, y - 1.5, x + w, y + 0.5); c.stroke()
    }
  })
  T.checker = canvasTex(16, (c, s) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { c.fillStyle = (x + y) % 2 ? '#ffffff' : '#e8382f'; c.fillRect(x * s / 2, y * s / 2, s / 2, s / 2) }
  })
  T.stripes = canvasTex(16, (c, s) => { for (let y = 0; y < 4; y++) { c.fillStyle = y % 2 ? '#ffffff' : '#e8382f'; c.fillRect(0, y * s / 4, s, s / 4) } })
  T.wood = canvasTex(32, (c, s) => {
    speckle(c, s, '#a8743f', ['#9a6834', '#b98249'], 17, 0.3)
    c.fillStyle = '#7d5128'
    for (let y = 0; y < s; y += 8) c.fillRect(0, y, s, 1)
  })
  T.brick = canvasTex(32, (c, s) => {
    c.fillStyle = '#d9d2c3'; c.fillRect(0, 0, s, s)
    for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) {
      c.fillStyle = (row + col) % 3 ? '#c8bfae' : '#b8ae9c'
      c.fillRect(((col + (row % 2) * 0.5) * s / 3) % s + 1, row * 8 + 1, s / 3 - 2, 6)
    }
  })
  T.dots = canvasTex(32, (c, s) => {
    c.fillStyle = '#e8382f'; c.fillRect(0, 0, s, s)
    c.fillStyle = '#ffffff'
    for (const [x, y, r] of [[8, 8, 5], [24, 20, 6], [6, 26, 3], [22, 4, 3]]) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill() }
  })
  T.leaves = canvasTex(32, (c, s) => {
    speckle(c, s, '#3f9a35', ['#338a2c', '#4fae40', '#2c7a26', '#5fbd4a'], 18, 0.6)
  })
  T.bark = canvasTex(16, (c, s) => { speckle(c, s, '#7a5232', ['#6a4428', '#8a6040'], 19, 0.5); c.fillStyle = '#5a3a20'; for (let x = 2; x < s; x += 5) c.fillRect(x, 0, 1, s) })
  T.gold = canvasTex(16, (c, s) => {
    const g = c.createLinearGradient(0, 0, 0, s)
    g.addColorStop(0, '#fff3a0'); g.addColorStop(0.45, '#ffd23a'); g.addColorStop(1, '#d48a10')
    c.fillStyle = g; c.fillRect(0, 0, s, s)
  })
  T.metal = canvasTex(16, (c, s) => speckle(c, s, '#c9d2dc', ['#b6c0cc', '#dde4ec'], 20, 0.4))
  T.coin = canvasTex(32, (c, s) => {
    c.fillStyle = '#e09a12'; c.fillRect(0, 0, s, s)
    c.fillStyle = '#ffd23a'; c.beginPath(); c.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2); c.fill()
    c.fillStyle = '#fff3a0'; c.beginPath(); c.arc(s / 2 - 3, s / 2 - 3, s * 0.2, 0, Math.PI * 2); c.fill()
    c.fillStyle = '#c47a08'; c.fillRect(s / 2 - 2, s * 0.26, 4, s * 0.48)
  }, { repeat: false })
  T.fabric = canvasTex(32, (c, s) => {
    const cols = ['#ff5a5a', '#ffd23a', '#3fa9ff', '#ffffff']
    for (let i = 0; i < 8; i++) { c.fillStyle = cols[i % cols.length]; c.fillRect(i * s / 8, 0, s / 8, s) }
  })
  cache = T
  return T
}

// --------------------------------------------------------------- the screen
// the scene goes into a small target; this pass blows it up with hard pixels and a 4x4 Bayer
// dither down to 5 bits a channel, which is what an N64 frame buffer looked like
const postVert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`
const postFrag = /* glsl */ `
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uDither;
varying vec2 vUv;
float bayer(vec2 p){
  // 4x4 ordered dither, 0..1
  vec2 q = mod(p, 4.0);
  float a = mod(q.x, 2.0), b = mod(q.y, 2.0);
  float c = floor(q.x / 2.0), d = floor(q.y / 2.0);
  float v = (a * 2.0 + abs(a - b)) * 4.0 + (c * 2.0 + abs(c - d));
  return (v + 0.5) / 16.0;
}
void main(){
  vec2 px = floor(vUv * uRes);
  vec3 c = texture2D(tScene, (px + 0.5) / uRes).rgb;
  c = floor(c * 31.0 + mix(0.5, bayer(px), uDither)) / 31.0;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`

export class N64Screen {
  constructor(renderer) {
    this.renderer = renderer
    this.target = new THREE.WebGLRenderTarget(320, 240, { depthBuffer: true })
    this.target.texture.magFilter = THREE.NearestFilter
    this.target.texture.minFilter = THREE.NearestFilter
    this.target.texture.generateMipmaps = false
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.target.texture }, uRes: { value: new THREE.Vector2(320, 240) }, uDither: { value: 1 } },
      vertexShader: postVert, fragmentShader: postFrag, depthTest: false, depthWrite: false,
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat)
    this.quad.frustumCulled = false
    this.scene = new THREE.Scene()
    this.scene.add(this.quad)
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  }

  // the frame buffer is about a third of the window, give or take
  setSize(w, h) {
    const tall = Math.round(THREE.MathUtils.clamp(h / 3, 180, 320))
    const wide = Math.max(1, Math.round(tall * w / h))
    this.target.setSize(wide, tall)
    this.mat.uniforms.uRes.value.set(wide, tall)
  }

  render(scene, camera) {
    const r = this.renderer
    r.setRenderTarget(this.target)
    r.render(scene, camera)
    r.setRenderTarget(null)
    r.render(this.scene, this.cam)
  }
}
