import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GLSL_NOISE, GLSL_TERRAIN, terrainH, snoise, fbm3, mulberry32 } from './noise.js'
import { LIGHTING_GLSL, LIGHT, n64Material, textures } from './n64.js'
import { MAT, Sphere, Ellipsoid, Cylinder, Box, Torus } from './shapes.js'

// The playground: endless islands, cut into cells that fill themselves with clouds, trees,
// landmarks, speed rings and coins as you get near. Everything solid is a collider.

const LEVELS = 5, CELLS = 64, BASE = 16, HOLE0 = 16, HOLE1 = 48
export const SHIFT_SNAP = BASE * Math.pow(2, LEVELS) // origin shifts keep every grid on the same world lattice
const CELL = 1200, CELL_R = 2, CHUNK = 300, CHUNK_R = 7

// ------------------------------------------------------------------ terrain
const terrVert = /* glsl */ `
precision highp float;
attribute float aSkirt;
uniform float uSpacing, uDrop;
uniform vec2 uLevelOrigin, uWorldOffset;
${LIGHTING_GLSL}
${GLSL_NOISE}
${GLSL_TERRAIN}
varying vec3 vLight;
varying vec4 vW;
varying vec2 vUv;
varying float vFog, vTone;
void main(){
  vec2 local = position.xz * uSpacing + uLevelOrigin;
  vec2 w = local + uWorldOffset;
  float e = uSpacing;
  float h = terrainH(w), hx = terrainH(w + vec2(e, 0.0)), hz = terrainH(w + vec2(0.0, e));
  vec3 n = normalize(vec3(h - hx, e, h - hz));
  float slope = 1.0 - n.y;
  float sand = 1.0 - smoothstep(3.0, 8.0, h);
  float snow = smoothstep(600.0, 680.0, h + snoise(w / 180.0) * 50.0) * (1.0 - smoothstep(0.3, 0.5, slope));
  float rock = max(smoothstep(0.22, 0.36, slope), smoothstep(800.0, 950.0, h)) * (1.0 - snow) * (1.0 - sand * 0.7);
  float grass = max(0.0, 1.0 - sand - rock - snow);
  vW = vec4(grass, sand, rock, snow) / max(grass + sand + rock + snow, 1e-3);
  vTone = snoise(w / 520.0) * 0.5 + 0.5;
  vLight = n64Light(n);
  vUv = w / 40.0;
  vec4 mv = viewMatrix * vec4(local.x, h - uDrop - aSkirt * uSpacing * 4.0, local.y, 1.0);
  vFog = n64Fog(-mv.z);
  gl_Position = projectionMatrix * mv;
}
`
const terrFrag = /* glsl */ `
uniform vec3 uFogColor;
uniform sampler2D tGrass, tSand, tRock, tSnow;
varying vec3 vLight;
varying vec4 vW;
varying vec2 vUv;
varying float vFog, vTone;
void main(){
  vec3 grass = texture2D(tGrass, vUv).rgb * mix(vec3(0.85, 1.0, 0.8), vec3(1.1, 1.05, 0.85), vTone);
  vec3 c = grass * vW.x + texture2D(tSand, vUv).rgb * vW.y + texture2D(tRock, vUv * 0.7).rgb * vW.z + texture2D(tSnow, vUv).rgb * vW.w;
  c *= vLight;
  gl_FragColor = vec4(mix(c, uFogColor, vFog), 1.0);
}
`

function levelGeometry(withHole) {
  const n = CELLS + 1
  const pos = [], skirt = [], idx = []
  const vid = (i, j) => j * n + i
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { pos.push(i, 0, j); skirt.push(0) }
  const inHole = (i, j) => withHole && i >= HOLE0 && i < HOLE1 && j >= HOLE0 && j < HOLE1
  for (let j = 0; j < CELLS; j++) {
    for (let i = 0; i < CELLS; i++) {
      if (inHole(i, j)) continue
      const a = vid(i, j), b = vid(i + 1, j), c = vid(i, j + 1), d = vid(i + 1, j + 1)
      if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d)
      else idx.push(a, c, d, a, d, b)
    }
  }
  const stitch = ring => {
    const base = pos.length / 3
    for (const v of ring) { pos.push(pos[v * 3], 0, pos[v * 3 + 2]); skirt.push(1) }
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length], a2 = base + k, b2 = base + ((k + 1) % ring.length)
      idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2)
    }
  }
  const loop = (lo, hi) => {
    const r = []
    for (let i = lo; i < hi; i++) r.push(vid(i, lo))
    for (let j = lo; j < hi; j++) r.push(vid(hi, j))
    for (let i = hi; i > lo; i--) r.push(vid(i, hi))
    for (let j = hi; j > lo; j--) r.push(vid(lo, j))
    return r
  }
  stitch(loop(0, CELLS))
  if (withHole) stitch(loop(HOLE0, HOLE1))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aSkirt', new THREE.Float32BufferAttribute(skirt, 1))
  g.setIndex(idx)
  return g
}

// ------------------------------------------------------------------ water
const waterVert = /* glsl */ `
varying vec3 vWorld;
varying float vDepth;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`
const waterFrag = /* glsl */ `
precision highp float;
${LIGHTING_GLSL}
${GLSL_NOISE}
${GLSL_TERRAIN}
uniform sampler2D tWater;
uniform vec2 uWorldOffset;
varying vec3 vWorld;
varying float vDepth;
void main(){
  vec2 w = vWorld.xz + uWorldOffset;
  float bed = terrainH(w);
  if (bed > 1.5) discard;
  float depth = -bed;
  vec3 c = texture2D(tWater, w / 60.0 + vec2(uTime * 0.02, uTime * 0.013)).rgb;
  c = mix(c, texture2D(tWater, w / 37.0 - vec2(uTime * 0.017, -uTime * 0.01)).rgb, 0.5);
  c = mix(vec3(0.3, 0.9, 0.86), c, smoothstep(0.0, 14.0, depth));
  float foam = step(depth, 2.2 + sin(uTime * 2.0 + w.x * 0.05 + w.y * 0.04) * 0.8);
  c = mix(c, vec3(0.95, 1.0, 1.0), foam);
  c *= n64Light(vec3(0.0, 1.0, 0.0)) * 1.05;
  // glossy: the sun's reflection, broken up into glitter
  vec3 V = normalize(cameraPosition - vWorld);
  float glint = pow(max(dot(reflect(-V, vec3(0.0, 1.0, 0.0)), normalize(uSunDir)), 0.0), 22.0);
  float sparkle = step(0.55, snoise(w / 2.5 + vec2(uTime * 0.9, -uTime * 0.7))) * glint;
  c += vec3(1.0, 1.0, 0.95) * (glint * 0.3 + sparkle * 0.9) * (1.0 - foam);
  gl_FragColor = vec4(mix(c, uFogColor, n64Fog(vDepth)), 1.0);
}
`

// ------------------------------------------------------------------ props
const v3 = (x, y, z) => new THREE.Vector3(x, y, z)

function colorize(g, color) {
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return g
}
// shade a blob light on top, bluish underneath, like a vertex-painted cloud
function cloudColors(g) {
  const p = g.attributes.position, n = p.count, a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const t = THREE.MathUtils.clamp(p.getY(i) * 0.5 + 0.55, 0, 1)
    a[i * 3] = 0.78 + 0.22 * t; a[i * 3 + 1] = 0.84 + 0.16 * t; a[i * 3 + 2] = 0.98 + 0.02 * t
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return g
}
const flat = g => { const ng = g.toNonIndexed(); ng.computeVertexNormals(); return ng }
const uvless = g => { g.deleteAttribute('uv'); return g }

function buildKit() {
  const T = textures()
  const K = {}
  K.mat = {
    vc: n64Material({ vertexColors: true }),
    cloud: n64Material({ vertexColors: true, emissive: 0.62 }),
    leaves: n64Material({ map: T.leaves, vertexColors: true, uvScale: [2, 2] }),
    bark: n64Material({ map: T.bark, uvScale: [1, 2] }),
    brick: n64Material({ map: T.brick, uvScale: [3, 4] }),
    roof: n64Material({ color: '#e0433a' }),
    wood: n64Material({ map: T.wood, uvScale: [1, 1] }),
    stripes: n64Material({ map: T.stripes, uvScale: [1, 4] }),
    metal: n64Material({ map: T.metal }),
    lamp: n64Material({ color: '#fff3a0', emissive: 1 }),
    cream: n64Material({ color: '#f3e6c8' }),
    dots: n64Material({ map: T.dots, uvScale: [3, 2] }),
    rock: n64Material({ map: T.rock, uvScale: [2, 2] }),
    grass: n64Material({ map: T.grass, uvScale: [4, 4] }),
    dirt: n64Material({ map: T.dirt, uvScale: [3, 3] }),
    gold: n64Material({ map: T.gold, emissive: 0.45 }),
    coin: n64Material({ map: T.coin, emissive: 0.55 }),
    duck: n64Material({ color: '#ffd23a' }),
    beak: n64Material({ color: '#ff8a1a' }),
    black: n64Material({ color: '#1a1a22' }),
    white: n64Material({ color: '#ffffff' }),
    fabric: n64Material({ map: T.fabric, uvScale: [2, 1] }),
    checker: n64Material({ map: T.checker, uvScale: [6, 3] }),
    basket: n64Material({ map: T.wood, color: '#c08a50' }),
  }
  // trees: a lollipop and a pine, each one geometry with painted vertex colours
  const trunk = colorize(uvless(new THREE.CylinderGeometry(1.2, 1.8, 10, 6).translate(0, 5, 0)), '#7a5232')
  const ball = colorize(uvless(new THREE.IcosahedronGeometry(7, 0).translate(0, 15, 0)), '#3f9e35')
  K.tree = mergeGeometries([flat(trunk), flat(ball)])
  const cone1 = colorize(uvless(new THREE.ConeGeometry(7, 14, 7).translate(0, 13, 0)), '#2f7d3a')
  const cone2 = colorize(uvless(new THREE.ConeGeometry(5, 11, 7).translate(0, 21, 0)), '#3a8f45')
  K.pine = mergeGeometries([flat(trunk.clone()), flat(cone1), flat(cone2)])
  K.blob = cloudColors(new THREE.IcosahedronGeometry(1, 1))
  K.ring = new THREE.TorusGeometry(14, 2.2, 6, 20)
  K.coin = new THREE.CylinderGeometry(3.6, 3.6, 1.4, 12).rotateX(Math.PI / 2)
  return K
}

const MONUMENT = { x: -230, y: 162, z: -640, yaw: 0.35 }

// stable random numbers per cell
const cellRand = (cx, cz, salt = 0) => mulberry32(((cx * 73856093) ^ (cz * 19349663) ^ (salt * 83492791)) >>> 0)

export class World {
  constructor(scene) {
    this.scene = scene
    this.origin = { x: 0, z: 0 }
    this.waterY = 0
    this.group = new THREE.Group()
    scene.add(this.group)
    this.kit = buildKit()
    const T = textures()

    // terrain
    this.uniforms = { ...LIGHT, uWorldOffset: { value: new THREE.Vector2() }, tGrass: { value: T.grass }, tSand: { value: T.sand }, tRock: { value: T.rock }, tSnow: { value: T.snow } }
    const full = levelGeometry(false), ring = levelGeometry(true)
    this.levels = []
    for (let k = 0; k < LEVELS; k++) {
      const spacing = BASE * Math.pow(2, k)
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, uSpacing: { value: spacing }, uDrop: { value: k === 0 ? 0 : spacing * 0.15 }, uLevelOrigin: { value: new THREE.Vector2() } },
        vertexShader: terrVert, fragmentShader: terrFrag,
      })
      const mesh = new THREE.Mesh(k === 0 ? full : ring, mat)
      mesh.frustumCulled = false
      this.group.add(mesh)
      this.levels.push({ spacing, origin: mat.uniforms.uLevelOrigin.value })
    }

    // water
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000, 1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: { ...LIGHT, tWater: { value: T.water }, uWorldOffset: this.uniforms.uWorldOffset },
      vertexShader: waterVert, fragmentShader: waterFrag,
    }))
    this.water.frustumCulled = false
    this.water.renderOrder = 1
    this.group.add(this.water)

    this.cells = new Map()
    this.chunks = new Map()
    this.rings = new Set()
    this.coins = new Set()
    this.spinners = new Set()
    this.movers = [] // shapes that fly about on their own (other aircraft)
    this.taken = new Set() // coins already collected, by id
    this.hcache = new Map()
  }

  // --------------------------------------------------------------- physics queries
  // heights on the finest terrain grid, interpolated over exactly the triangles that are drawn
  H(wx, wz) {
    const key = wx * 1e6 + wz
    let h = this.hcache.get(key)
    if (h === undefined) {
      h = terrainH(wx, wz)
      if (this.hcache.size > 4096) this.hcache.clear()
      this.hcache.set(key, h)
    }
    return h
  }

  ground(x, z, n) {
    const S = BASE
    const wx = x + this.origin.x, wz = z + this.origin.z
    const ix = Math.floor(wx / S), iz = Math.floor(wz / S)
    const fx = wx / S - ix, fz = wz / S - iz
    const x0 = ix * S, z0 = iz * S
    const ha = this.H(x0, z0), hb = this.H(x0 + S, z0), hc = this.H(x0, z0 + S), hd = this.H(x0 + S, z0 + S)
    let h, dx, dz
    if ((((ix + iz) % 2) + 2) % 2 === 0) {
      if (fx + fz < 1) { dx = hb - ha; dz = hc - ha; h = ha + dx * fx + dz * fz }
      else { dx = hd - hc; dz = hd - hb; h = hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz) }
    } else if (fx > fz) { dx = hb - ha; dz = hd - hb; h = ha + dx * fx + dz * fz }
    else { dz = hc - ha; dx = hd - hc; h = ha + dz * fz + dx * fx }
    if (n) n.set(-dx, S, -dz).normalize()
    return h
  }

  groundNormal(x, z, out) { this.ground(x, z, out); return out }

  // every collider whose bounds reach within r of pos
  near(pos, r, out) {
    out.length = 0
    const wx = pos.x + this.origin.x, wz = pos.z + this.origin.z
    const scan = (map, size, pad) => {
      const x0 = Math.floor((wx - r - pad) / size), x1 = Math.floor((wx + r + pad) / size)
      const z0 = Math.floor((wz - r - pad) / size), z1 = Math.floor((wz + r + pad) / size)
      for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
        const c = map.get(cx + ',' + cz)
        if (!c) continue
        for (const s of c.shapes) {
          const dx = s.c.x - pos.x, dy = s.c.y - pos.y, dz = s.c.z - pos.z, rr = r + s.bound
          if (dx * dx + dy * dy + dz * dz < rr * rr) out.push(s)
        }
      }
    }
    scan(this.cells, CELL, 220)
    scan(this.chunks, CHUNK, 20)
    for (const s of this.movers) {
      const dx = s.c.x - pos.x, dy = s.c.y - pos.y, dz = s.c.z - pos.z, rr = r + s.bound
      if (dx * dx + dy * dy + dz * dz < rr * rr) out.push(s)
    }
    return out.length
  }

  // --------------------------------------------------------------- upkeep
  shift(dx, dz) {
    this.origin.x += dx; this.origin.z += dz
    this.uniforms.uWorldOffset.value.set(this.origin.x, this.origin.z)
    for (const map of [this.cells, this.chunks]) for (const c of map.values()) {
      c.group.position.x -= dx; c.group.position.z -= dz
      for (const s of c.shapes) s.shift(dx, dz)
      for (const r of c.rings || []) { r.pos.x -= dx; r.pos.z -= dz }
      for (const k of c.coins || []) { k.pos.x -= dx; k.pos.z -= dz }
    }
  }

  update(dt, t, camera, anchor) {
    LIGHT.uTime.value = t
    const cx = camera.position.x, cz = camera.position.z
    for (const L of this.levels) {
      const snap = L.spacing * 2, half = CELLS * L.spacing / 2
      L.origin.set(Math.round((cx - half) / snap) * snap, Math.round((cz - half) / snap) * snap)
    }
    this.water.position.set(Math.round(cx / 64) * 64, this.waterY, Math.round(cz / 64) * 64)
    this.stream(this.cells, CELL, CELL_R, anchor, (x, z) => this.buildCell(x, z), 1)
    this.stream(this.chunks, CHUNK, CHUNK_R, anchor, (x, z) => this.buildChunk(x, z), 2)
    for (const s of this.spinners) s.update(dt, t)
  }

  stream(map, size, R, anchor, build, perFrame) {
    const wx = anchor.x + this.origin.x, wz = anchor.z + this.origin.z
    const ccx = Math.floor(wx / size), ccz = Math.floor(wz / size)
    const want = new Set()
    const order = []
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dz * dz <= R * R + 1) order.push([dx, dz])
    order.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]))
    let built = 0
    for (const [dx, dz] of order) {
      const key = (ccx + dx) + ',' + (ccz + dz)
      want.add(key)
      if (!map.has(key) && built < perFrame) { map.set(key, build(ccx + dx, ccz + dz)); built++ }
    }
    for (const [key, c] of map) if (!want.has(key)) { this.drop(c); map.delete(key) }
  }

  drop(c) {
    this.group.remove(c.group)
    for (const r of c.rings || []) this.rings.delete(r)
    for (const k of c.coins || []) this.coins.delete(k)
    for (const s of c.spinners || []) this.spinners.delete(s)
    c.group.traverse(o => { if (o.isInstancedMesh) o.dispose() })
  }

  // local position of a world-space point
  at(wx, y, wz) { return new THREE.Vector3(wx - this.origin.x, y, wz - this.origin.z) }

  // --------------------------------------------------------------- trees
  buildChunk(cx, cz) {
    const g = new THREE.Group(), shapes = []
    const S = CHUNK, wx0 = cx * S, wz0 = cz * S
    const rnd = cellRand(cx, cz, 7)
    const spots = { tree: [], pine: [] }
    for (let i = 0; i < 26; i++) {
      const x = wx0 + rnd() * S, z = wz0 + rnd() * S
      const forest = fbm3(x / 1600 + 20, z / 1600 + 20) + snoise(x / 260, z / 260) * 0.35
      if (forest < 0.12) continue
      const h = terrainH(x, z)
      if (h < 8 || h > 640) continue
      const slope = Math.abs(terrainH(x + 12, z) - h) + Math.abs(terrainH(x, z + 12) - h)
      if (slope > 7) continue
      const s = 0.8 + rnd() * 0.7
      ;(h > 260 || rnd() < 0.3 ? spots.pine : spots.tree).push([x, h, z, s, rnd() * 6.28])
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color()
    for (const kind of ['tree', 'pine']) {
      const list = spots[kind]
      if (!list.length) continue
      const mesh = new THREE.InstancedMesh(this.kit[kind], this.kit.mat.vc, list.length)
      list.forEach(([x, h, z, s, r], i) => {
        q.setFromAxisAngle(v3(0, 1, 0), r)
        m.compose(v3(x - wx0, h - 1, z - wz0), q, v3(s, s * (0.9 + (r % 1) * 0.3), s))
        mesh.setMatrixAt(i, m)
        col.setRGB(0.85 + (r % 0.3), 0.95 + (r % 0.1), 0.8 + (r % 0.25))
        mesh.setColorAt(i, col)
        const top = kind === 'tree' ? 15 : 17
        shapes.push(new Sphere(this.at(x, h - 1 + top * s, z), 7 * s, MAT.leaves))
        shapes.push(new Cylinder(this.at(x, h - 2, z), 1.6 * s, 10 * s, MAT.wood))
      })
      g.add(mesh)
    }
    g.position.set(wx0 - this.origin.x, 0, wz0 - this.origin.z)
    this.group.add(g)
    return { group: g, shapes }
  }

  // --------------------------------------------------------------- cells
  buildCell(cx, cz) {
    const c = { group: new THREE.Group(), shapes: [], rings: [], coins: [], spinners: [] }
    const rnd = cellRand(cx, cz)
    const wx0 = cx * CELL, wz0 = cz * CELL
    // pick a spot in the cell that suits a landmark
    const spot = (test, tries = 14) => {
      for (let i = 0; i < tries; i++) {
        const x = wx0 + 150 + rnd() * (CELL - 300), z = wz0 + 150 + rnd() * (CELL - 300)
        const h = terrainH(x, z)
        if (test(h, x, z)) return [x, h, z]
      }
      return null
    }
    const flatish = (x, z, h, r) => Math.abs(terrainH(x + r, z) - h) + Math.abs(terrainH(x - r, z) - h) + Math.abs(terrainH(x, z + r) - h) + Math.abs(terrainH(x, z - r) - h) < r * 0.9

    // clouds, to land on (or bounce off)
    const nClouds = 2 + Math.floor(rnd() * 4)
    for (let i = 0; i < nClouds; i++) {
      const x = wx0 + rnd() * CELL, z = wz0 + rnd() * CELL
      const base = Math.max(terrainH(x, z) + 120, 260 + rnd() * 520)
      this.cloud(c, x, base, z, 30 + rnd() * 50, rnd)
    }

    // one landmark, if the cell has somewhere for it
    const pick = rnd()
    if (pick < 0.16) { const s = spot((h, x, z) => h > 10 && h < 500 && flatish(x, z, h, 20)); if (s) this.windmill(c, ...s, rnd) }
    else if (pick < 0.28) { const s = spot(h => h > 2 && h < 14, 30); if (s) this.lighthouse(c, ...s) }
    else if (pick < 0.44) { const s = spot((h, x, z) => h > 6 && h < 500 && flatish(x, z, h, 30)); if (s) this.mushrooms(c, ...s, rnd) }
    else if (pick < 0.56) { const s = spot((h, x, z) => h > 6 && h < 600 && flatish(x, z, h, 40)); if (s) this.arch(c, ...s, rnd) }
    else if (pick < 0.66) { const s = spot(h => h < -15, 30); if (s) this.duck(c, s[0], s[2], rnd) }
    else if (pick < 0.76) { const s = spot(h => h > 4 && h < 400); if (s) this.beachball(c, ...s) }
    else if (pick < 0.86) this.island(c, wx0 + 300 + rnd() * 600, wz0 + 300 + rnd() * 600, rnd)
    else this.balloon(c, wx0 + rnd() * CELL, wz0 + rnd() * CELL, rnd)

    // the big floating initials, out over the bay you start above
    if (Math.floor(MONUMENT.x / CELL) === cx && Math.floor(MONUMENT.z / CELL) === cz) this.monument(c)

    // something to fly through, and something to collect
    if (rnd() < 0.55) this.ringCourse(c, cx, cz, rnd)
    if (rnd() < 0.7) this.coinArc(c, cx, cz, rnd)

    this.group.add(c.group)
    for (const s of c.spinners) this.spinners.add(s)
    return c
  }

  add(c, mesh, wx, y, wz) {
    mesh.position.copy(this.at(wx, y, wz))
    c.group.add(mesh)
    return mesh
  }

  cloud(c, x, y, z, size, rnd) {
    const K = this.kit
    const geos = []
    const n = 3 + Math.floor(rnd() * 4)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(), r = i === 0 ? 0 : size * (0.5 + rnd() * 0.5)
      const bx = Math.cos(a) * r, bz = Math.sin(a) * r * 0.7, s = size * (i === 0 ? 1 : 0.55 + rnd() * 0.35)
      const g = K.blob.clone().scale(s, s * 0.62, s).translate(bx, s * 0.1, bz)
      geos.push(g)
      c.shapes.push(new Ellipsoid(this.at(x + bx, y + s * 0.1, z + bz), s * 0.95, s * 0.6, s * 0.95, MAT.cloud))
    }
    this.add(c, new THREE.Mesh(mergeGeometries(geos), K.mat.cloud), x, y, z)
  }

  windmill(c, x, h, z, rnd) {
    const M = this.kit.mat, g = new THREE.Group()
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(9, 13, 46, 8), M.brick).translateY(23))
    g.add(new THREE.Mesh(new THREE.ConeGeometry(12, 14, 8), M.roof).translateY(53))
    const hub = new THREE.Group()
    hub.position.set(0, 44, -12)
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group()
      arm.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 26, 0.8), M.wood).translateY(14))
      arm.add(new THREE.Mesh(new THREE.BoxGeometry(6, 18, 0.4), M.white).translateY(17).translateX(3.6))
      arm.rotation.z = (i / 4) * Math.PI * 2
      hub.add(arm)
    }
    g.add(hub)
    g.rotation.y = rnd() * Math.PI * 2
    this.add(c, g, x, h - 2, z)
    c.shapes.push(new Cylinder(this.at(x, h - 2, z), 12, 60, MAT.stone))
    c.spinners.push({ update: dt => { hub.rotation.z += dt * 0.9 } })
  }

  lighthouse(c, x, h, z) {
    const M = this.kit.mat, g = new THREE.Group()
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(7, 10, 70, 10), M.stripes).translateY(35))
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(8.5, 8.5, 2, 10), M.metal).translateY(71))
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 8, 8), M.lamp)
    lamp.position.y = 76
    g.add(lamp)
    g.add(new THREE.Mesh(new THREE.ConeGeometry(7, 7, 10), M.roof).translateY(83))
    const beam = new THREE.Mesh(new THREE.BoxGeometry(60, 1.5, 1.5), M.lamp)
    beam.position.set(0, 76, 0)
    g.add(beam)
    this.add(c, g, x, h - 1, z)
    c.shapes.push(new Cylinder(this.at(x, h - 1, z), 10, 87, MAT.stone))
    c.spinners.push({ update: dt => { beam.rotation.y += dt * 1.6 } })
  }

  mushrooms(c, x, h, z, rnd) {
    const M = this.kit.mat
    const n = 3 + Math.floor(rnd() * 3)
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = i ? 30 + rnd() * 50 : 0
      const mx = x + Math.cos(a) * r, mz = z + Math.sin(a) * r, gh = terrainH(mx, mz)
      const s = 0.6 + rnd() * 0.8, stalk = 26 * s, capR = 22 * s
      const g = new THREE.Group()
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(4 * s, 6 * s, stalk, 8), M.cream).translateY(stalk / 2))
      const cap = new THREE.Mesh(new THREE.SphereGeometry(capR, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.dots)
      cap.scale.y = 0.7
      cap.position.y = stalk
      g.add(cap)
      this.add(c, g, mx, gh - 1, mz)
      // the cap is the trampoline
      c.shapes.push(new Ellipsoid(this.at(mx, gh - 1 + stalk, mz), capR, capR * 0.7, capR, MAT.bouncy))
      c.shapes.push(new Cylinder(this.at(mx, gh - 3, mz), 5 * s, stalk, MAT.wood))
    }
  }

  arch(c, x, h, z, rnd) {
    const M = this.kit.mat, g = new THREE.Group()
    const yaw = rnd() * Math.PI, span = 34, hgt = 60
    for (const s of [-1, 1]) g.add(new THREE.Mesh(new THREE.BoxGeometry(12, hgt, 12), M.rock).translateX(s * span).translateY(hgt / 2))
    g.add(new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 12, 12, 14), M.rock).translateY(hgt + 4))
    g.add(new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 14, 2, 16), M.grass).translateY(hgt + 11))
    g.rotation.y = yaw
    this.add(c, g, x, h - 4, z)
    const cs = Math.cos(yaw), sn = Math.sin(yaw)
    for (const s of [-1, 1]) c.shapes.push(new Box(this.at(x + cs * s * span, h - 4 + hgt / 2, z - sn * s * span), 6, hgt / 2, 6, yaw, MAT.stone))
    c.shapes.push(new Box(this.at(x, h - 4 + hgt + 5, z), span + 6, 7, 7, yaw, MAT.stone))
  }

  duck(c, x, z, rnd) {
    const M = this.kit.mat, g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.SphereGeometry(20, 12, 8), M.duck)
    body.scale.set(1, 0.7, 1.35)
    g.add(body)
    const head = new THREE.Mesh(new THREE.SphereGeometry(11, 10, 8), M.duck)
    head.position.set(0, 20, -16)
    g.add(head)
    g.add(new THREE.Mesh(new THREE.ConeGeometry(4, 10, 6).rotateX(-Math.PI / 2), M.beak).translateY(18).translateZ(-29))
    for (const s of [-1, 1]) g.add(new THREE.Mesh(new THREE.SphereGeometry(2, 6, 4), M.black).translateX(s * 5).translateY(23).translateZ(-25))
    g.add(new THREE.Mesh(new THREE.ConeGeometry(6, 12, 6).rotateX(Math.PI / 2 + 0.6), M.duck).translateY(8).translateZ(28))
    g.rotation.y = rnd() * Math.PI * 2
    this.add(c, g, x, 2, z)
    const sph = [new Sphere(this.at(x, 2, z), 22, MAT.rubber), new Sphere(this.at(x, 22, z), 12, MAT.rubber)]
    c.shapes.push(...sph)
    const y0 = g.position.y, t0 = rnd() * 6
    c.spinners.push({ update: (dt, t) => { g.position.y = y0 + Math.sin(t * 1.3 + t0) * 1.2; g.rotation.z = Math.sin(t * 0.9 + t0) * 0.05 } })
  }

  beachball(c, x, h, z) {
    const r = 16
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), this.kit.mat.fabric)
    this.add(c, m, x, h + r - 2, z)
    c.shapes.push(new Sphere(this.at(x, h + r - 2, z), r, MAT.rubber))
    c.spinners.push({ update: dt => { m.rotation.y += dt * 0.3 } })
  }

  island(c, x, z, rnd) {
    const M = this.kit.mat, g = new THREE.Group()
    const y = Math.max(terrainH(x, z) + 160, 220 + rnd() * 300), r = 40 + rnd() * 30
    g.add(new THREE.Mesh(new THREE.ConeGeometry(r, r * 1.4, 8).rotateX(Math.PI), M.dirt).translateY(-r * 0.7))
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, 5, 8), M.grass).translateY(1.5))
    const tree = new THREE.Mesh(this.kit.tree, M.vc)
    tree.position.set(r * 0.3, 3, 0)
    g.add(tree)
    this.add(c, g, x, y, z)
    c.shapes.push(new Cylinder(this.at(x, y - 1, z), r, 5, MAT.ground))
    c.shapes.push(new Sphere(this.at(x, y - r * 0.6, z), r * 0.65, MAT.stone))
    c.shapes.push(new Sphere(this.at(x + r * 0.3, y + 18, z), 7, MAT.leaves))
    const t0 = rnd() * 6
    c.spinners.push({ update: (dt, t) => { g.position.y = y + Math.sin(t * 0.5 + t0) * 2 } })
  }

  balloon(c, x, z, rnd) {
    const M = this.kit.mat, g = new THREE.Group()
    const y = Math.max(terrainH(x, z) + 120, 200 + rnd() * 350)
    const env = new THREE.Mesh(new THREE.SphereGeometry(18, 12, 8), M.fabric)
    env.scale.y = 1.15
    env.position.y = 26
    g.add(env)
    g.add(new THREE.Mesh(new THREE.BoxGeometry(6, 5, 6), M.basket))
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 10, 0.4), M.black).translateX(Math.cos(a) * 3).translateZ(Math.sin(a) * 3).translateY(7))
    }
    this.add(c, g, x, y, z)
    const sph = new Sphere(this.at(x, y + 26, z), 19, MAT.rubber)
    c.shapes.push(sph, new Box(this.at(x, y, z), 3, 2.5, 3, 0, MAT.wood))
    const t0 = rnd() * 6
    c.spinners.push({ update: (dt, t) => { g.position.y = y + Math.sin(t * 0.4 + t0) * 4; g.rotation.y += dt * 0.1 } })
  }

  ringCourse(c, cx, cz, rnd) {
    const K = this.kit
    let x = cx * CELL + 200 + rnd() * 800, z = cz * CELL + 200 + rnd() * 800
    let heading = rnd() * Math.PI * 2, y = Math.max(terrainH(x, z) + 70, 90 + rnd() * 250), climb = (rnd() - 0.5) * 0.4
    const n = 5 + Math.floor(rnd() * 4)
    for (let i = 0; i < n; i++) {
      const dir = v3(Math.sin(heading), climb * 0.3, -Math.cos(heading)).normalize()
      const g = terrainH(x, z)
      y = Math.max(y, g + 45)
      const mesh = new THREE.Mesh(K.ring, K.mat.gold)
      mesh.quaternion.setFromUnitVectors(v3(0, 0, 1), dir)
      this.add(c, mesh, x, y, z)
      const pos = this.at(x, y, z)
      const torus = new Torus(pos, dir, 14, 2.2, MAT.gold)
      c.shapes.push(torus)
      const ring = { pos, dir: dir.clone(), mesh, hit: false, R: 14 }
      c.rings.push(ring)
      this.rings.add(ring)
      const step = 150 + rnd() * 60
      heading += (rnd() - 0.5) * 0.5
      climb = THREE.MathUtils.clamp(climb + (rnd() - 0.5) * 0.3, -0.5, 0.5)
      x += Math.sin(heading) * step; z -= Math.cos(heading) * step; y += climb * step * 0.3
    }
  }

  coinArc(c, cx, cz, rnd) {
    const K = this.kit
    const wx0 = cx * CELL, wz0 = cz * CELL
    const x0 = wx0 + 150 + rnd() * 900, z0 = wz0 + 150 + rnd() * 900, heading = rnd() * Math.PI * 2
    const n = 8 + Math.floor(rnd() * 6), y0 = Math.max(terrainH(x0, z0) + 30, 40 + rnd() * 260), lift = 30 + rnd() * 50
    const list = []
    for (let i = 0; i < n; i++) {
      const id = `${cx},${cz},${i}`
      if (this.taken.has(id)) continue
      const k = i / (n - 1)
      const x = x0 + Math.sin(heading) * i * 18, z = z0 - Math.cos(heading) * i * 18
      const y = Math.max(y0 + Math.sin(k * Math.PI) * lift, terrainH(x, z) + 8)
      list.push({ id, wx: x, y, wz: z })
    }
    if (!list.length) return
    const mesh = new THREE.InstancedMesh(K.coin, K.mat.coin, list.length)
    mesh.frustumCulled = false
    c.group.add(mesh)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = v3(1, 1, 1), hidden = v3(0, 0, 0)
    list.forEach((k, i) => {
      // pos follows origin shifts (for pickup); lpos stays put inside the cell's group (for drawing)
      const coin = { id: k.id, pos: this.at(k.wx, k.y, k.wz), lpos: this.at(k.wx, k.y, k.wz), mesh, i, taken: false }
      c.coins.push(coin)
      this.coins.add(coin)
    })
    c.spinners.push({
      update: (dt, t) => {
        for (const coin of c.coins) {
          if (coin.mesh !== mesh) continue
          q.setFromAxisAngle(v3(0, 1, 0), t * 3 + coin.i * 0.4)
          m.compose(coin.lpos, q, coin.taken ? hidden : s)
          mesh.setMatrixAt(coin.i, m)
        }
        mesh.instanceMatrix.needsUpdate = true
      },
    })
  }

  // K and H, chunky and bobbing, facing the way you start out flying
  monument(c) {
    const g = new THREE.Group()
    const { x, y, z, yaw } = MONUMENT
    const red = n64Material({ color: '#ff4a3a', emissive: 0.3 }), blue = n64Material({ color: '#3f9bff', emissive: 0.3 }), edge = n64Material({ color: '#ffd23a', emissive: 0.4 })
    const bar = (mat, w, h, px, py, rot = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 12), mat)
      m.position.set(px, py, 0)
      m.rotation.z = rot
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 2, h + 2, 8), edge)
      trim.position.copy(m.position); trim.rotation.z = rot
      g.add(m, trim)
    }
    // K
    bar(red, 12, 60, -48, 0)
    bar(red, 12, 38, -28, 14, -0.75)
    bar(red, 12, 38, -28, -14, 0.75)
    // H
    bar(blue, 12, 60, 14, 0)
    bar(blue, 12, 60, 50, 0)
    bar(blue, 30, 11, 32, 0)
    g.rotation.y = yaw
    this.add(c, g, x, y, z)
    const cs = Math.cos(yaw), sn = Math.sin(yaw)
    const at = (lx, ly) => this.at(x + lx * cs, y + ly, z - lx * sn)
    for (const lx of [-48, 14, 50]) c.shapes.push(new Box(at(lx, 0), 7, 31, 7, yaw, MAT.rubber))
    c.shapes.push(new Box(at(32, 0), 16, 6.5, 7, yaw, MAT.rubber))
    for (let i = 0; i < 4; i++) {
      const k = (i + 0.5) / 4
      c.shapes.push(new Sphere(at(-42 + 26 * k, 2 + 26 * k), 7, MAT.rubber), new Sphere(at(-42 + 26 * k, -2 - 26 * k), 7, MAT.rubber))
    }
    const y0 = g.position.y
    c.spinners.push({ update: (dt, t) => { g.position.y = y0 + Math.sin(t * 0.7) * 3; g.rotation.z = Math.sin(t * 0.5) * 0.03 } })
  }

  take(coin) {
    coin.taken = true
    this.taken.add(coin.id)
    this.coins.delete(coin)
  }
}
