import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GLSL_NOISE, GLSL_SRGB, GLSL_TERRAIN, terrainH, snoise, fbm3 } from './noise.js'
import { GROUND_Y, SUN_DIR } from './constants.js'

// Terrain is a set of nested clipmap levels: uniform grids of increasing spacing,
// each with a hole where the finer level sits. Heights come from the vertex
// shader (noise identical to the JS port) so the world is endless and costs no CPU.

const LEVELS = 5, CELLS = 64, BASE = 12, HOLE0 = 18, HOLE1 = 46 // hole = 28 cells, finer level spans 32

const vert = /* glsl */ `
precision highp float;
attribute float aSkirt;
uniform float uSpacing, uDrop, uGroundY;
uniform vec2 uLevelOrigin, uWorldOffset;
varying vec3 vWorld;
varying float vH, vFogDepth;
${GLSL_NOISE}
${GLSL_TERRAIN}
void main(){
  vec2 local = position.xz * uSpacing + uLevelOrigin;
  vec2 w = local + uWorldOffset;
  float h = terrainH(w);
  float y = uGroundY + max(h, 0.0) - uDrop - aSkirt * uSpacing * 6.0;
  vWorld = vec3(w.x, max(h, 0.0), w.y);
  vH = h;
  vec4 mv = viewMatrix * vec4(local.x, y, local.y, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`
const frag = /* glsl */ `
precision highp float;
uniform vec3 uSunDir, uFogColor, uSkyCol, uGroundCol;
uniform float uFogDensity, uSunI, uAmb, uTime;
varying vec3 vWorld;
varying float vH, vFogDepth;
${GLSL_NOISE}
${GLSL_SRGB}
void main(){
  vec3 dx = dFdx(vWorld), dz = dFdy(vWorld);
  vec3 cr = cross(dz, dx);
  float crl = length(cr);
  vec3 n = crl > 1e-9 ? cr / crl : vec3(0.0, 1.0, 0.0);
  if (n.y < 0.0) n = -n;
  float slope = length(n.xz) / max(n.y, 1e-3);
  vec2 p = vWorld.xz;
  float var1 = snoise(p / 300.0) * 0.5 + 0.5;
  float h = vH;
  vec3 c;
  float water = 0.0;
  if (h < 0.5) {
    float d = smoothstep(0.0, 40.0, -h);
    c = S(0.22 - d * 0.1, 0.55 - d * 0.15, 0.85 - d * 0.1);
    n = vec3(0.0, 1.0, 0.0);
    water = 1.0;
  } else if (h < 8.0) {
    c = S(0.85, 0.8, 0.62);
  } else {
    float forest = smoothstep(0.05, 0.3, fbm3(p / 1400.0 + 20.0) + var1 * 0.25) * (1.0 - smoothstep(700.0, 950.0, h));
    vec3 grass = S(0.5 + var1 * 0.12, 0.72 - var1 * 0.08, 0.32);
    c = mix(grass, S(0.2, 0.45, 0.24), forest);
    float rock = min(1.0, smoothstep(0.5, 0.9, slope) + smoothstep(800.0, 1300.0, h) * 0.6);
    c = mix(c, S(0.48, 0.46, 0.46), rock);
    float snow = smoothstep(1150.0 + var1 * 200.0, 1400.0 + var1 * 200.0, h) * (1.0 - smoothstep(0.9, 1.6, slope));
    c = mix(c, S(0.96, 0.97, 1.0), snow);
  }
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 amb = mix(uGroundCol, uSkyCol, n.y * 0.5 + 0.5) * uAmb * 0.9;
  vec3 col = c * (amb + uSunI * diff * S(1.0, 0.96, 0.9));
  if (water > 0.5) {
    vec3 v = normalize(cameraPosition - vec3(vWorld.x, vWorld.y, vWorld.z));
    float sp = pow(max(dot(reflect(-v, n), uSunDir), 0.0), 80.0);
    float glint = snoise(p * 0.08 + uTime * 0.3) * snoise(p * 0.05 - uTime * 0.2);
    col += vec3(1.0) * (sp * 0.6 + max(glint, 0.0) * 0.12) * uSunI;
  }
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  col = mix(col, uFogColor, fogF);
  // never let a NaN reach the bloom pass (it would smear into a bright square)
  if (any(isnan(col)) || any(isinf(col))) col = uFogColor;
  gl_FragColor = vec4(clamp(col, 0.0, 8.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
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
  // outer skirt: duplicate the boundary ring, dropped down, and stitch
  const ring = []
  for (let i = 0; i < CELLS; i++) ring.push(vid(i, 0))
  for (let j = 0; j < CELLS; j++) ring.push(vid(CELLS, j))
  for (let i = CELLS; i > 0; i--) ring.push(vid(i, CELLS))
  for (let j = CELLS; j > 0; j--) ring.push(vid(0, j))
  const base = pos.length / 3
  for (const v of ring) { pos.push(pos[v * 3], 0, pos[v * 3 + 2]); skirt.push(1) }
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length]
    const a2 = base + k, b2 = base + ((k + 1) % ring.length)
    idx.push(a, a2, b, b, a2, b2)
    idx.push(a, b, a2, b, b2, a2)
  }
  if (withHole) {
    // inner skirt around the hole
    const inner = []
    for (let i = HOLE0; i < HOLE1; i++) inner.push(vid(i, HOLE0))
    for (let j = HOLE0; j < HOLE1; j++) inner.push(vid(HOLE1, j))
    for (let i = HOLE1; i > HOLE0; i--) inner.push(vid(i, HOLE1))
    for (let j = HOLE1; j > HOLE0; j--) inner.push(vid(HOLE0, j))
    const b0 = pos.length / 3
    for (const v of inner) { pos.push(pos[v * 3], 0, pos[v * 3 + 2]); skirt.push(1) }
    for (let k = 0; k < inner.length; k++) {
      const a = inner[k], b = inner[(k + 1) % inner.length]
      const a2 = b0 + k, b2 = b0 + ((k + 1) % inner.length)
      idx.push(a, a2, b, b, a2, b2)
      idx.push(a, b, a2, b, b2, a2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aSkirt', new THREE.Float32BufferAttribute(skirt, 1))
  g.setIndex(idx)
  return g
}

export { GLSL_NOISE, GLSL_TERRAIN, terrainH }

export class Terrain {
  constructor(scene, fogUniforms) {
    this.scene = scene
    this.origin = { x: 0, z: 0 }
    this.group = new THREE.Group()
    scene.add(this.group)
    this.active = true
    this.uniforms = {
      uWorldOffset: { value: new THREE.Vector2(0, 0) },
      uGroundY: { value: GROUND_Y },
      uSunDir: { value: SUN_DIR.clone() },
      uFogColor: { value: new THREE.Color('#8fa3bf') },
      uFogDensity: { value: 0.0003 },
      uSkyCol: { value: new THREE.Color('#bfd5ea') },
      uGroundCol: { value: new THREE.Color('#8a9a8a') },
      uSunI: { value: 1.0 },
      uAmb: { value: 0.55 },
      uTime: { value: 0 },
    }
    this.fog = fogUniforms
    const full = levelGeometry(false), ring = levelGeometry(true)
    this.levels = []
    for (let k = 0; k < LEVELS; k++) {
      const spacing = BASE * Math.pow(2, k)
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          ...this.uniforms,
          uSpacing: { value: spacing },
          uDrop: { value: k === 0 ? 0 : spacing * 0.3 },
          uLevelOrigin: { value: new THREE.Vector2(0, 0) },
        },
        vertexShader: vert,
        fragmentShader: frag,
      })
      const mesh = new THREE.Mesh(k === 0 ? full : ring, mat)
      mesh.frustumCulled = false
      this.group.add(mesh)
      this.levels.push({ mesh, spacing, origin: mat.uniforms.uLevelOrigin.value })
    }

    // trees
    this.treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 })
    const cone = new THREE.ConeGeometry(7, 26, 6); cone.translate(0, 18, 0)
    const cone2 = new THREE.ConeGeometry(5, 18, 6); cone2.translate(0, 28, 0)
    const trunk = new THREE.CylinderGeometry(1.4, 1.8, 8, 5); trunk.translate(0, 4, 0)
    const parts = []
    for (const [g, c] of [[cone, [0.18, 0.42, 0.22]], [cone2, [0.22, 0.5, 0.26]], [trunk, [0.35, 0.24, 0.15]]]) {
      const cnt = g.attributes.position.count, arr = new Float32Array(cnt * 3)
      for (let i = 0; i < cnt; i++) { arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2] }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
      parts.push(g.toNonIndexed())
    }
    this.treeGeo = mergeGeometries(parts, false)
    this.chunks = new Map()
    this.CHUNK = 600
    this.TREE_R = 3
  }

  heightAt(lx, lz) {
    return GROUND_Y + Math.max(terrainH(lx + this.origin.x, lz + this.origin.z), 0)
  }

  shift(dx, dz) {
    this.origin.x += dx; this.origin.z += dz
    this.uniforms.uWorldOffset.value.set(this.origin.x, this.origin.z)
    for (const c of this.chunks.values()) { c.position.x -= dx; c.position.z -= dz }
  }

  buildChunk(cx, cz) {
    const S = this.CHUNK, wx0 = cx * S, wz0 = cz * S
    const cand = []
    const sp = 42
    for (let j = 0; j < S / sp; j++) {
      for (let i = 0; i < S / sp; i++) {
        const jx = snoise(i * 3.1 + cx * 77, j * 2.7 + cz * 91) * sp * 0.45
        const jz = snoise(i * 1.9 + cx * 13, j * 3.3 + cz * 37) * sp * 0.45
        const x = wx0 + i * sp + sp / 2 + jx, z = wz0 + j * sp + sp / 2 + jz
        const h = terrainH(x, z)
        if (h < 12 || h > 900) continue
        const forest = fbm3(x / 1400 + 20, z / 1400 + 20) + (snoise(x / 300, z / 300) * 0.5 + 0.5) * 0.25
        if (forest < 0.18) continue
        if (snoise(x / 40, z / 40) < -0.2) continue
        const hx = terrainH(x + 20, z) - terrainH(x - 20, z), hz = terrainH(x, z + 20) - terrainH(x, z - 20)
        if (Math.sqrt(hx * hx + hz * hz) / 40 > 0.7) continue
        cand.push([x - wx0, h, z - wz0, 0.7 + (snoise(x / 7, z / 7) * 0.5 + 0.5) * 0.7])
      }
    }
    const g = new THREE.Group()
    if (cand.length) {
      const trees = new THREE.InstancedMesh(this.treeGeo, this.treeMat, cand.length)
      const m = new THREE.Matrix4(), col = new THREE.Color(), sv = new THREE.Vector3()
      for (let i = 0; i < cand.length; i++) {
        const [x, y, z, s] = cand[i]
        m.makeRotationY(i * 1.7).setPosition(x, y - 1, z)
        m.scale(sv.set(s, s, s))
        trees.setMatrixAt(i, m)
        col.setRGB(0.9 + Math.sin(i) * 0.1, 1.0, 0.9 + Math.cos(i * 1.3) * 0.1)
        trees.setColorAt(i, col)
      }
      g.add(trees)
    }
    g.position.set(wx0 - this.origin.x, GROUND_Y, wz0 - this.origin.z)
    this.group.add(g)
    return g
  }

  update(planePos, camera, t) {
    this.uniforms.uTime.value = t
    // clipmap levels follow the camera, snapped to twice their spacing so vertices never swim
    const cx = camera.position.x, cz = camera.position.z
    for (const L of this.levels) {
      const snap = L.spacing * 2
      const half = CELLS * L.spacing / 2
      L.origin.set(Math.round((cx - half) / snap) * snap, Math.round((cz - half) / snap) * snap)
    }
    // trees near the ground only
    const near = planePos.y < GROUND_Y + 2600
    if (!near) {
      if (this.chunks.size) { for (const c of this.chunks.values()) this.disposeChunk(c); this.chunks.clear() }
      return
    }
    const S = this.CHUNK
    const wx = planePos.x + this.origin.x, wz = planePos.z + this.origin.z
    const ccx = Math.round(wx / S), ccz = Math.round(wz / S)
    const keep = new Set()
    let built = 0
    const R = this.TREE_R
    const order = []
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) order.push([dx, dz])
    order.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]))
    for (const [dx, dz] of order) {
      const key = (ccx + dx) + ',' + (ccz + dz)
      keep.add(key)
      if (!this.chunks.has(key) && built < 1) { this.chunks.set(key, this.buildChunk(ccx + dx, ccz + dz)); built++ }
    }
    for (const [key, c] of this.chunks) if (!keep.has(key)) { this.disposeChunk(c); this.chunks.delete(key) }
  }

  disposeChunk(g) {
    this.group.remove(g)
    g.traverse(o => { if (o.isInstancedMesh) o.dispose() })
  }
}
