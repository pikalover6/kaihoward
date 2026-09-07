import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { makeNoise } from './noise.js'
import { GROUND_Y } from './constants.js'

const TILE = 1500, SEG = 40, RADIUS = 3
const sm = THREE.MathUtils.smoothstep

export class Terrain {
  constructor(scene) {
    this.scene = scene
    this.noise = makeNoise(4242)
    this.origin = { x: 0, z: 0 }
    this.tiles = new Map()
    this.group = new THREE.Group()
    this.group.visible = false
    this.active = false
    scene.add(this.group)
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 })
    this.treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 })
    const cone = new THREE.ConeGeometry(7, 26, 6)
    cone.translate(0, 18, 0)
    const cone2 = new THREE.ConeGeometry(5, 18, 6)
    cone2.translate(0, 28, 0)
    const trunk = new THREE.CylinderGeometry(1.4, 1.8, 8, 5)
    trunk.translate(0, 4, 0)
    const cols = []
    for (const [g, c] of [[cone, [0.18, 0.42, 0.22]], [cone2, [0.22, 0.5, 0.26]], [trunk, [0.35, 0.24, 0.15]]]) {
      const n = g.attributes.position.count
      const arr = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) { arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2] }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
      cols.push(g)
    }
    this.treeGeo = mergeGeometries(cols.map(g => g.toNonIndexed()), false)
    this.pending = []
    this.c = new THREE.Color()
  }

  // height above GROUND_Y at world coords
  h(x, z) {
    const N = this.noise
    const cont = N.fbm(x / 9000, z / 9000, 3)
    const mm = sm(N.fbm(x / 15000 + 100, z / 15000 + 100, 2), 0.0, 0.5)
    const hills = N.fbm(x / 1100 + 5, z / 1100 + 5, 4) * 95 + 55
    const mts = N.ridged(x / 2800, z / 2800, 4) * 1900 * mm
    let h = cont * 160 + hills + mts
    const rv = Math.abs(N.n(x / 4200 + 7, z / 4200 + 7) + N.fbm(x / 800 + 3, z / 800 + 3, 2) * 0.18)
    const river = 1 - sm(rv, 0.015, 0.06)
    const lowland = 1 - sm(h, 160, 420)
    h -= river * lowland * 70
    return h
  }

  heightAt(lx, lz) {
    if (!this.active) return GROUND_Y - 1e6
    const h = this.h(lx + this.origin.x, lz + this.origin.z)
    return GROUND_Y + Math.max(h, 0)
  }

  shift(dx, dz) {
    this.origin.x += dx; this.origin.z += dz
    for (const t of this.tiles.values()) { t.mesh.position.x -= dx; t.mesh.position.z -= dz; if (t.trees) { t.trees.position.x -= dx; t.trees.position.z -= dz } }
  }

  color(h, slope, x, z, out) {
    const N = this.noise
    const var1 = N.n(x / 300, z / 300) * 0.5 + 0.5
    if (h < 0.5) {
      const d = sm(-h, 0, 40)
      out.setRGB(0.22 - d * 0.1, 0.55 - d * 0.15, 0.85 - d * 0.1)
      return
    }
    if (h < 8) { out.setRGB(0.85, 0.8, 0.62); return }
    const forest = sm(N.fbm(x / 1400 + 20, z / 1400 + 20, 3) + var1 * 0.25, 0.05, 0.3) * (1 - sm(h, 700, 950))
    const grass = this.c.setRGB(0.5 + var1 * 0.12, 0.72 - var1 * 0.08, 0.32)
    const dark = new THREE.Color(0.2, 0.45, 0.24)
    out.copy(grass).lerp(dark, forest)
    const rock = sm(slope, 0.5, 0.9) + sm(h, 800, 1300) * 0.6
    out.lerp(new THREE.Color(0.48, 0.46, 0.46), Math.min(1, rock))
    const snow = sm(h, 1150 + var1 * 200, 1400 + var1 * 200) * (1 - sm(slope, 0.9, 1.6))
    out.lerp(new THREE.Color(0.96, 0.97, 1.0), snow)
  }

  buildTile(tx, tz) {
    const geo = new THREE.PlaneGeometry(TILE, TILE, SEG, SEG)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    const n = SEG + 1
    const hs = new Float32Array((n + 2) * (n + 2))
    const wx0 = tx * TILE - TILE / 2, wz0 = tz * TILE - TILE / 2
    const step = TILE / SEG
    for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) hs[(j + 1) * (n + 2) + (i + 1)] = this.h(wx0 + i * step, wz0 + j * step)
    const colors = new Float32Array(pos.count * 3)
    const col = new THREE.Color()
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i
        const h = hs[(j + 1) * (n + 2) + (i + 1)]
        const hx = hs[(j + 1) * (n + 2) + (i + 2)] - hs[(j + 1) * (n + 2) + i]
        const hz = hs[(j + 2) * (n + 2) + (i + 1)] - hs[j * (n + 2) + (i + 1)]
        const slope = Math.sqrt(hx * hx + hz * hz) / (2 * step)
        pos.setY(k, Math.max(h, 0))
        this.color(h, slope, wx0 + i * step, wz0 + j * step, col)
        colors[k * 3] = col.r; colors[k * 3 + 1] = col.g; colors[k * 3 + 2] = col.b
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, this.mat)
    mesh.position.set(tx * TILE - this.origin.x, GROUND_Y, tz * TILE - this.origin.z)
    this.group.add(mesh)

    // trees on forested, gentle land
    const N = this.noise
    const cand = []
    const m = new THREE.Matrix4()
    const tcol = new THREE.Color()
    const sp = 42
    for (let j = 0; j < TILE / sp; j++) {
      for (let i = 0; i < TILE / sp; i++) {
        const jx = N.n(i * 3.1 + tx * 77, j * 2.7 + tz * 91) * sp * 0.45
        const jz = N.n(i * 1.9 + tx * 13, j * 3.3 + tz * 37) * sp * 0.45
        const x = wx0 + i * sp + sp / 2 + jx, z = wz0 + j * sp + sp / 2 + jz
        const h = this.h(x, z)
        if (h < 12 || h > 900) continue
        const forest = N.fbm(x / 1400 + 20, z / 1400 + 20, 3) + (N.n(x / 300, z / 300) * 0.5 + 0.5) * 0.25
        if (forest < 0.15) continue
        if (N.n(x / 40, z / 40) < -0.2) continue
        const hx = this.h(x + 20, z) - this.h(x - 20, z), hz = this.h(x, z + 20) - this.h(x, z - 20)
        if (Math.sqrt(hx * hx + hz * hz) / 40 > 0.7) continue
        cand.push([x - wx0 - TILE / 2, h, z - wz0 - TILE / 2, 0.7 + (N.n(x / 7, z / 7) * 0.5 + 0.5) * 0.7])
        if (cand.length >= 900) break
      }
    }
    let trees = null
    if (cand.length) {
      trees = new THREE.InstancedMesh(this.treeGeo, this.treeMat, cand.length)
      for (let i = 0; i < cand.length; i++) {
        const [x, y, z, s] = cand[i]
        m.makeRotationY(i * 1.7).setPosition(x, y - 1, z)
        m.scale(new THREE.Vector3(s, s, s))
        trees.setMatrixAt(i, m)
        tcol.setRGB(0.9 + Math.sin(i) * 0.1, 1.0, 0.9 + Math.cos(i * 1.3) * 0.1)
        trees.setColorAt(i, tcol)
      }
      trees.position.copy(mesh.position)
      this.group.add(trees)
    }
    return { mesh, trees, tx, tz }
  }

  disposeTile(t) {
    this.group.remove(t.mesh)
    t.mesh.geometry.dispose()
    if (t.trees) { this.group.remove(t.trees); t.trees.dispose() }
  }

  update(planePos) {
    const want = planePos.y < GROUND_Y + 7500
    if (!want) {
      if (this.active) { for (const t of this.tiles.values()) this.disposeTile(t); this.tiles.clear(); this.group.visible = false; this.active = false }
      return
    }
    this.active = true
    this.group.visible = true
    const wx = planePos.x + this.origin.x, wz = planePos.z + this.origin.z
    const cx = Math.round(wx / TILE), cz = Math.round(wz / TILE)
    const keep = new Set()
    let built = 0
    // nearest first
    const order = []
    for (let dz = -RADIUS; dz <= RADIUS; dz++) for (let dx = -RADIUS; dx <= RADIUS; dx++) order.push([dx, dz])
    order.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]))
    for (const [dx, dz] of order) {
      const tx = cx + dx, tz = cz + dz
      const key = tx + ',' + tz
      keep.add(key)
      if (!this.tiles.has(key) && built < 1) {
        this.tiles.set(key, this.buildTile(tx, tz))
        built++
      }
    }
    for (const [key, t] of this.tiles) if (!keep.has(key)) { this.disposeTile(t); this.tiles.delete(key) }
  }
}
