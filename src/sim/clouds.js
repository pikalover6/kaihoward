import * as THREE from 'three'
import { GLSL_NOISE, GLSL_SRGB, GLSL_COVER, mulberry32, cloudCover, fbm } from './noise.js'
import { SUN_DIR, CLOUD_Y } from './constants.js'

// ---------------------------------------------------------------- cloud sea
const seaVert = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec2 uWorldOffset;
varying vec3 vWorld;
varying float vFogDepth;
${GLSL_NOISE}
${GLSL_COVER}
void main(){
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec2 w = wp.xz + uWorldOffset;
  float cv = cloudCover(w);
  float edge = smoothstep(-0.1, 0.2, cv);
  float h = fbm3(w * 0.0011 + uTime * 0.003);
  wp.y += h * 30.0 * edge - (1.0 - edge) * 25.0;
  vWorld = vec3(w.x, wp.y, w.y);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`
const seaFrag = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uSunDir, uFogColor;
uniform float uFogDensity;
varying vec3 vWorld;
varying float vFogDepth;
${GLSL_NOISE}
${GLSL_SRGB}
${GLSL_COVER}
float height(vec2 p){
  return fbm(p * 0.0011 + uTime * 0.003) + fbm3(p * 0.0075 - uTime * 0.006) * 0.16;
}
void main(){
  vec2 p = vWorld.xz;
  float cv = cloudCover(p);
  float detail = fbm3(p * 0.0025 + 1.0) * 0.5 + snoise(p * 0.012) * 0.06;
  float alpha = smoothstep(-0.2, 0.04, cv + detail * 0.07);
  if (alpha < 0.01) discard;
  float e = 14.0;
  float n = height(p);
  float nx = height(p + vec2(e, 0.0));
  float nz = height(p + vec2(0.0, e));
  vec3 nrm = normalize(vec3(-(nx - n) * 6.5, 1.0, -(nz - n) * 6.5));
  float diff = clamp(dot(nrm, uSunDir), 0.0, 1.0);
  float cov = n * 0.5 + 0.5;
  vec3 shadow = S(0.60, 0.74, 0.95);
  vec3 lit = S(0.97, 0.98, 1.0);
  vec3 c = mix(shadow, lit, clamp(diff * 0.85 + 0.2 * smoothstep(0.35, 0.85, cov), 0.0, 1.0));
  // thin, bluish cloud near the breaks
  c = mix(S(0.72, 0.82, 0.97), c, smoothstep(0.0, 0.5, alpha));
  float rim = pow(clamp(1.0 - abs(nrm.y), 0.0, 1.0), 2.0);
  c += S(1.0, 1.0, 1.0) * rim * 0.12;
  if (!gl_FrontFacing) {
    c = S(0.60, 0.67, 0.80) * (0.8 + 0.35 * cov);
    c += S(0.75, 0.8, 0.9) * pow(clamp(dot(normalize(vec3(0.0, 1.0, 0.0)), uSunDir), 0.0, 1.0), 4.0) * 0.1;
  }
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  c = mix(c, uFogColor, fogF);
  if (any(isnan(c))) c = uFogColor;
  gl_FragColor = vec4(c, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const cirrusFrag = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec3 vWorld;
varying float vFogDepth;
${GLSL_NOISE}
${GLSL_SRGB}
void main(){
  vec2 p = vWorld.xz * vec2(0.00035, 0.0011) + vec2(uTime * 0.002, 0.0);
  float n = fbm(p) + fbm3(p * 3.0 + 3.0) * 0.4;
  float a = smoothstep(0.25, 0.85, n) * 0.4;
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth * 0.4);
  a *= 1.0 - fogF;
  gl_FragColor = vec4(S(1.0, 1.0, 1.0), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

// ---------------------------------------------------------------- puffs
const puffVert = /* glsl */ `
precision highp float;
attribute vec3 iPos;
attribute float iScale;
attribute float iRot;
attribute float iVar;
attribute float iDark;
attribute float iAspect;
uniform vec3 uCamRight, uCamUp;
varying vec2 vUv;
varying vec2 vLocal;
varying float vVar;
varying float vFogDepth;
varying float vDist;
varying float vDark;
void main(){
  vDark = iDark;
  float c = cos(iRot), s = sin(iRot);
  vec2 q = vec2(position.x * iAspect, position.y);
  vec2 p = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  vec3 wp = iPos + (uCamRight * p.x + uCamUp * p.y) * iScale;
  vUv = uv;
  vLocal = position.xy;
  vVar = iVar;
  vDist = distance(iPos, cameraPosition) / iScale;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`
const puffFrag = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform vec2 uSunLocal;
uniform vec3 uCamUp;
uniform vec3 uFogColor;
uniform float uFogDensity, uOpacity;
varying vec2 vUv;
varying vec2 vLocal;
varying float vVar;
varying float vFogDepth;
varying float vDist;
varying float vDark;
${GLSL_SRGB}
void main(){
  vec2 cell = vec2(mod(vVar, 2.0), floor(vVar / 2.0));
  vec2 uv = (vUv + cell) * 0.5;
  float a = texture2D(uMap, uv).a;
  vec2 sl = uSunLocal / max(length(uSunLocal), 0.2);
  float lit = clamp(0.5 + 0.9 * dot(vLocal, sl), 0.0, 1.0);
  // vertical shade gradient fades out when looking down on the puffs from above
  float t = mix(0.85, clamp(vLocal.y + 0.5, 0.0, 1.0), clamp(uCamUp.y, 0.0, 1.0));
  vec3 shadow = S(0.50, 0.64, 0.92);
  vec3 litC = S(0.99, 0.99, 1.0);
  // thick interior is bluer, especially toward the bottom
  float thick = smoothstep(0.2, 0.9, a);
  vec3 c = mix(shadow, litC, clamp(lit * 0.7 + t * 0.5 - 0.15 - thick * (1.0 - t) * 0.35, 0.0, 1.0));
  // silver lining on thin edges facing the sun
  float rim = smoothstep(0.45, 0.05, a) * lit;
  c += S(1.0, 1.0, 1.0) * rim * 0.35;
  vec3 under = mix(S(0.55, 0.6, 0.72), S(0.72, 0.76, 0.86), t);
  c = mix(c, under, vDark);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  c = mix(c, uFogColor, fogF);
  a *= uOpacity * smoothstep(0.15, 0.7, vDist) * (1.0 - 0.25 * vDark);
  if (any(isnan(c)) || isnan(a)) discard;
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function makePuffAtlas() {
  const size = 1024, cell = 512
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')
  const rnd = mulberry32(12)
  ctx.clearRect(0, 0, size, size)
  const shapes = [
    { blobs: 18, sx: 0.32, sy: 0.16, r: [0.14, 0.24] },   // wide cumulus
    { blobs: 10, sx: 0.2, sy: 0.2, r: [0.16, 0.3] },      // round puff
    { blobs: 26, sx: 0.36, sy: 0.12, r: [0.09, 0.2] },    // stretched
    { blobs: 14, sx: 0.26, sy: 0.22, r: [0.1, 0.26] },    // lumpy
  ]
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * cell, oy = Math.floor(k / 2) * cell
    const sh = shapes[k]
    for (let i = 0; i < sh.blobs; i++) {
      const ang = rnd() * Math.PI * 2, rad = Math.sqrt(rnd())
      const x = ox + cell * (0.5 + Math.cos(ang) * rad * sh.sx)
      const y = oy + cell * (0.54 + Math.sin(ang) * rad * sh.sy - rnd() * 0.06)
      const r = cell * (sh.r[0] + rnd() * (sh.r[1] - sh.r[0]))
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      const a = 0.22 + rnd() * 0.2
      g.addColorStop(0, `rgba(255,255,255,${a})`)
      g.addColorStop(0.5, `rgba(255,255,255,${a * 0.5})`)
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    // erode with noise so edges are ragged, and keep everything off the cell border
    const img = ctx.getImageData(ox, oy, cell, cell)
    const d = img.data
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const dx = (x - cell / 2) / (cell / 2), dy = (y - cell / 2) / (cell / 2)
        const rr = Math.sqrt(dx * dx + dy * dy)
        const v = Math.max(0, Math.min(1, (1 - rr) * 2.6))
        const nz = fbm((x + k * 900) / 70, (y + k * 300) / 70) * 0.5 + 0.5
        const nz2 = fbm((x + k * 130) / 22, (y + k * 70) / 22) * 0.5 + 0.5
        const i = (y * cell + x) * 4
        let a = d[i + 3] / 255 * 2.7 * v
        a *= 0.6 + 0.55 * nz + 0.25 * (nz2 - 0.5)
        a = Math.max(0, Math.min(1, (a - 0.1) * 1.2))
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255
        d[i + 3] = Math.round(a * 255)
      }
    }
    ctx.putImageData(img, ox, oy)
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 4
  return tex
}

export class Clouds {
  constructor(scene, fogUniforms) {
    this.scene = scene
    this.fog = fogUniforms
    this.time = 0

    // cloud sea
    const seaSize = 26000, seaSeg = 220
    this.seaStep = seaSize / seaSeg
    this.seaUniforms = {
      uTime: { value: 0 },
      uWorldOffset: { value: new THREE.Vector2(0, 0) },
      uSunDir: { value: SUN_DIR.clone() },
      uFogColor: fogUniforms.color,
      uFogDensity: fogUniforms.density,
    }
    const seaGeo = new THREE.PlaneGeometry(seaSize, seaSize, seaSeg, seaSeg)
    seaGeo.rotateX(-Math.PI / 2)
    this.sea = new THREE.Mesh(seaGeo, new THREE.ShaderMaterial({
      uniforms: this.seaUniforms,
      vertexShader: seaVert,
      fragmentShader: seaFrag,
      side: THREE.DoubleSide,
      transparent: true,
    }))
    this.sea.renderOrder = 2
    this.sea.frustumCulled = false
    this.sea.position.y = CLOUD_Y
    scene.add(this.sea)

    // cirrus veil high above
    const cirGeo = new THREE.PlaneGeometry(50000, 50000, 1, 1)
    cirGeo.rotateX(-Math.PI / 2)
    this.cirrus = new THREE.Mesh(cirGeo, new THREE.ShaderMaterial({
      uniforms: this.seaUniforms,
      vertexShader: seaVert.replace('wp.y += h * 30.0 * edge - (1.0 - edge) * 25.0;', ''),
      fragmentShader: cirrusFrag,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    }))
    this.cirrus.frustumCulled = false
    this.cirrus.position.y = CLOUD_Y + 2600
    this.cirrus.renderOrder = 5
    scene.add(this.cirrus)

    // puffs
    this.wrapR = 3600
    this.origin = { x: 0, z: 0 }
    this.buildPuffs()
  }

  // world-space coverage test (accounts for origin shifting)
  covered(x, z, margin = 0.05) { return cloudCover(x + this.origin.x, z + this.origin.z) > margin }

  // pick a covered spot inside the wrap square around `anchor`
  pickCovered(rnd, anchor, R, margin) {
    for (let t = 0; t < 12; t++) {
      const x = anchor.x + (rnd() * 2 - 1) * R, z = anchor.z + (rnd() * 2 - 1) * R
      if (this.covered(x, z, margin)) return [x, z]
    }
    return [anchor.x + (rnd() * 2 - 1) * R, anchor.z + (rnd() * 2 - 1) * R]
  }

  buildPuffs() {
    const rnd = mulberry32(77)
    this.rnd = rnd
    const puffs = [] // {x,y,z,s,rot,v,asp,dark}
    const clusters = []
    const R = this.wrapR
    const zero = { x: 0, z: 0 }
    // cumulus clusters sitting on the deck
    for (let c = 0; c < 130; c++) {
      const [cx, cz] = this.pickCovered(rnd, zero, R, 0.08)
      const n = 5 + Math.floor(rnd() * 9)
      const spread = 90 + rnd() * 240
      const big = 0.7 + rnd() * 0.9
      const members = []
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * spread
        const s = (55 + rnd() * 95) * big
        members.push(puffs.length)
        puffs.push({
          x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r * 0.7,
          y: CLOUD_Y + 30 + s * 0.36 + rnd() * 30 * big,
          s, rot: (rnd() - 0.5) * 0.5, v: Math.floor(rnd() * 4), asp: 1.1 + rnd() * 0.7,
        })
      }
      clusters.push({ members, deck: true, margin: 0.08 })
    }
    // wandering small puffs at flight altitude
    for (let c = 0; c < 70; c++) {
      const cx = (rnd() * 2 - 1) * R, cz = (rnd() * 2 - 1) * R
      const y = CLOUD_Y + 130 + rnd() * 520
      const n = 1 + Math.floor(rnd() * 4)
      const members = []
      for (let i = 0; i < n; i++) {
        const s = 22 + rnd() * 55
        members.push(puffs.length)
        puffs.push({ x: cx + (rnd() - 0.5) * 60, z: cz + (rnd() - 0.5) * 60, y: y + (rnd() - 0.5) * 25, s, rot: (rnd() - 0.5) * 0.8, v: Math.floor(rnd() * 4), asp: 1.2 + rnd() * 0.8 })
      }
      clusters.push({ members })
    }
    // grey cloud bases hanging under the deck, seen when diving through
    for (let c = 0; c < 80; c++) {
      const [cx, cz] = this.pickCovered(rnd, zero, R, 0.1)
      const n = 3 + Math.floor(rnd() * 6)
      const spread = 120 + rnd() * 260
      const members = []
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * spread
        const s = 70 + rnd() * 120
        members.push(puffs.length)
        puffs.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r * 0.7, y: CLOUD_Y - 30 - s * 0.25 - rnd() * 30, s, rot: (rnd() - 0.5) * 0.6, v: Math.floor(rnd() * 4), asp: 1.4 + rnd() * 0.8, dark: 1 })
      }
      clusters.push({ members, deck: true, margin: 0.1 })
    }
    this.puffs = puffs
    this.clusters = clusters
    const N = puffs.length
    const geo = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    geo.index = quad.index
    geo.attributes.position = quad.attributes.position
    geo.attributes.uv = quad.attributes.uv
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3)
    this.aScale = new THREE.InstancedBufferAttribute(new Float32Array(N), 1)
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(N), 1)
    this.aVar = new THREE.InstancedBufferAttribute(new Float32Array(N), 1)
    this.aDark = new THREE.InstancedBufferAttribute(new Float32Array(N), 1)
    this.aAsp = new THREE.InstancedBufferAttribute(new Float32Array(N), 1)
    for (const a of [this.aPos, this.aScale, this.aRot, this.aVar, this.aDark, this.aAsp]) a.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('iPos', this.aPos)
    geo.setAttribute('iScale', this.aScale)
    geo.setAttribute('iRot', this.aRot)
    geo.setAttribute('iVar', this.aVar)
    geo.setAttribute('iDark', this.aDark)
    geo.setAttribute('iAspect', this.aAsp)
    geo.instanceCount = N
    this.puffUniforms = {
      uMap: { value: makePuffAtlas() },
      uCamRight: { value: new THREE.Vector3(1, 0, 0) },
      uCamUp: { value: new THREE.Vector3(0, 1, 0) },
      uSunLocal: { value: new THREE.Vector2(0.5, 0.8) },
      uFogColor: this.fog.color,
      uFogDensity: this.fog.density,
      uOpacity: { value: 1 },
    }
    this.puffMesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.puffUniforms,
      vertexShader: puffVert,
      fragmentShader: puffFrag,
      transparent: true,
      depthWrite: false,
    }))
    this.puffMesh.frustumCulled = false
    this.puffMesh.renderOrder = 10
    this.scene.add(this.puffMesh)
    this.order = new Int32Array(N)
    this.dist = new Float32Array(N)
    this.sortCounter = 0
  }

  shift(dx, dz) {
    this.origin.x += dx; this.origin.z += dz
    this.seaUniforms.uWorldOffset.value.set(this.origin.x, this.origin.z)
    for (const p of this.puffs) { p.x -= dx; p.z -= dz }
  }

  // fog boost when the camera is inside a puff; returns 0..1
  insideAmount(camPos) {
    let best = 0
    for (const p of this.puffs) {
      const dx = p.x - camPos.x, dy = p.y - camPos.y, dz = p.z - camPos.z
      const d2 = dx * dx + dy * dy + dz * dz
      const r = p.s * 0.42
      if (d2 < r * r) {
        const a = 1 - Math.sqrt(d2) / r
        if (a > best) best = a
      }
    }
    return best
  }

  update(dt, camera, anchor) {
    this.time += dt
    this.seaUniforms.uTime.value = this.time
    // sea and cirrus follow the camera on a grid so vertices don't swim
    const st = this.seaStep
    this.sea.position.x = Math.round(camera.position.x / st) * st
    this.sea.position.z = Math.round(camera.position.z / st) * st
    this.cirrus.position.x = camera.position.x
    this.cirrus.position.z = camera.position.z

    // wrap clusters around the anchor (the plane)
    const R = this.wrapR
    for (const c of this.clusters) {
      const p0 = this.puffs[c.members[0]]
      let mx = 0, mz = 0
      if (p0.x - anchor.x > R) mx = -2 * R
      else if (p0.x - anchor.x < -R) mx = 2 * R
      if (p0.z - anchor.z > R) mz = -2 * R
      else if (p0.z - anchor.z < -R) mz = 2 * R
      if (mx || mz) {
        if (c.deck) {
          // deck clusters must land on cloud, not in a break: re-place relative to the cluster centre
          const [nx, nz] = this.pickCovered(this.rnd, { x: anchor.x, z: anchor.z }, R, c.margin)
          const ox = p0.x + mx, oz = p0.z + mz
          const covered = this.covered(ox, oz, c.margin)
          const tx = covered ? ox : nx, tz = covered ? oz : nz
          for (const i of c.members) { this.puffs[i].x += tx - p0.x; this.puffs[i].z += tz - p0.z }
        } else {
          for (const i of c.members) { this.puffs[i].x += mx; this.puffs[i].z += mz }
        }
      }
    }

    // billboard basis
    const cr = this.puffUniforms.uCamRight.value.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    const cu = this.puffUniforms.uCamUp.value.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    this.puffUniforms.uSunLocal.value.set(SUN_DIR.dot(cr), SUN_DIR.dot(cu))

    // sort back to front every few frames and repack attributes
    if (this.sortCounter++ % 6 === 0) {
      const N = this.puffs.length
      const cp = camera.position
      for (let i = 0; i < N; i++) {
        const p = this.puffs[i]
        const dx = p.x - cp.x, dy = p.y - cp.y, dz = p.z - cp.z
        this.dist[i] = dx * dx + dy * dy + dz * dz
        this.order[i] = i
      }
      const dist = this.dist
      const ord = Array.from(this.order).sort((a, b) => dist[b] - dist[a])
      const pa = this.aPos.array, sa = this.aScale.array, ra = this.aRot.array, va = this.aVar.array, da = this.aDark.array, aa = this.aAsp.array
      for (let k = 0; k < N; k++) {
        const p = this.puffs[ord[k]]
        pa[k * 3] = p.x; pa[k * 3 + 1] = p.y; pa[k * 3 + 2] = p.z
        sa[k] = p.s; ra[k] = p.rot; va[k] = p.v; da[k] = p.dark || 0; aa[k] = p.asp || 1
      }
      this.aPos.needsUpdate = true; this.aScale.needsUpdate = true
      this.aRot.needsUpdate = true; this.aVar.needsUpdate = true; this.aDark.needsUpdate = true; this.aAsp.needsUpdate = true
    }
  }
}
