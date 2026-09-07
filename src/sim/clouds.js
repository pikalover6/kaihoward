import * as THREE from 'three'
import { GLSL_NOISE, GLSL_SRGB, mulberry32 } from './noise.js'
import { SUN_DIR, CLOUD_Y } from './constants.js'

// ---------------------------------------------------------------- cloud sea
const seaVert = /* glsl */ `
precision highp float;
uniform float uTime;
varying vec3 vWorld;
varying float vFogDepth;
${GLSL_NOISE}
void main(){
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  float h = fbm3(wp.xz * 0.0011 + uTime * 0.003);
  wp.y += h * 36.0;
  vWorld = wp;
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
float height(vec2 p){
  return fbm(p * 0.0011 + uTime * 0.003) + fbm3(p * 0.0075 - uTime * 0.006) * 0.28;
}
void main(){
  vec2 p = vWorld.xz;
  float e = 14.0;
  float n = height(p);
  float nx = height(p + vec2(e, 0.0));
  float nz = height(p + vec2(0.0, e));
  vec3 nrm = normalize(vec3(-(nx - n) * 9.0, 1.0, -(nz - n) * 9.0));
  float diff = clamp(dot(nrm, uSunDir), 0.0, 1.0);
  float cov = n * 0.5 + 0.5;
  vec3 shadow = S(0.60, 0.74, 0.95);
  vec3 lit = S(0.97, 0.98, 1.0);
  vec3 c = mix(shadow, lit, clamp(diff * 0.85 + 0.2 * smoothstep(0.35, 0.85, cov), 0.0, 1.0));
  vec3 gap = S(0.42, 0.62, 0.92);
  c = mix(gap, c, smoothstep(0.3, 0.55, cov));
  float rim = pow(clamp(1.0 - abs(nrm.y), 0.0, 1.0), 2.0);
  c += S(1.0, 1.0, 1.0) * rim * 0.12;
  if (!gl_FrontFacing) {
    c = S(0.60, 0.67, 0.80) * (0.8 + 0.35 * cov);
    c += S(0.75, 0.8, 0.9) * pow(clamp(dot(normalize(vec3(0.0, 1.0, 0.0)), uSunDir), 0.0, 1.0), 4.0) * 0.1;
  }
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  c = mix(c, uFogColor, fogF);
  gl_FragColor = vec4(c, 1.0);
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
  vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
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
  float lit = 0.5 + 0.5 * dot(normalize(vLocal + vec2(0.0001)), normalize(uSunLocal + vec2(0.0001)));
  float t = vLocal.y + 0.5;
  vec3 shadow = S(0.58, 0.71, 0.94);
  vec3 litC = S(0.98, 0.99, 1.0);
  vec3 c = mix(shadow, litC, clamp(lit * 0.55 + t * 0.55, 0.0, 1.0));
  vec3 under = mix(S(0.55, 0.6, 0.72), S(0.72, 0.76, 0.86), t);
  c = mix(c, under, vDark);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  c = mix(c, uFogColor, fogF);
  a *= uOpacity * smoothstep(0.15, 0.7, vDist) * (1.0 - 0.25 * vDark);
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function makePuffAtlas() {
  const size = 512
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')
  const rnd = mulberry32(12)
  ctx.clearRect(0, 0, size, size)
  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      const ox = cx * 256, oy = cy * 256
      const blobs = 14 + Math.floor(rnd() * 8)
      for (let i = 0; i < blobs; i++) {
        const ang = rnd() * Math.PI * 2
        const rad = rnd() * 60
        const x = ox + 128 + Math.cos(ang) * rad
        const y = oy + 138 + Math.sin(ang) * rad * 0.6 - rnd() * 20
        const r = 40 + rnd() * 55
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        const a = 0.28 + rnd() * 0.25
        g.addColorStop(0, `rgba(255,255,255,${a})`)
        g.addColorStop(0.55, `rgba(255,255,255,${a * 0.45})`)
        g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = g
        ctx.fillRect(x - r, y - r, r * 2, r * 2)
      }
      // vignette so nothing touches the cell edge
      const img = ctx.getImageData(ox, oy, 256, 256)
      const d = img.data
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const dx = (x - 128) / 128, dy = (y - 128) / 128
          const rr = Math.sqrt(dx * dx + dy * dy)
          const v = Math.max(0, Math.min(1, (1 - rr) * 2.2))
          const i = (y * 256 + x) * 4
          d[i] = 255; d[i + 1] = 255; d[i + 2] = 255
          d[i + 3] = Math.min(255, d[i + 3] * v * 1.35)
        }
      }
      ctx.putImageData(img, ox, oy)
    }
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
    }))
    this.sea.frustumCulled = false
    this.sea.position.y = CLOUD_Y
    scene.add(this.sea)

    // cirrus veil high above
    const cirGeo = new THREE.PlaneGeometry(50000, 50000, 1, 1)
    cirGeo.rotateX(-Math.PI / 2)
    this.cirrus = new THREE.Mesh(cirGeo, new THREE.ShaderMaterial({
      uniforms: this.seaUniforms,
      vertexShader: seaVert.replace('wp.y += h * 36.0;', ''),
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
    this.buildPuffs()
  }

  buildPuffs() {
    const rnd = mulberry32(77)
    const puffs = [] // {x,y,z,s,rot,v, cluster}
    const clusters = []
    const R = this.wrapR
    // big cumulus clusters sitting on the sea
    for (let c = 0; c < 150; c++) {
      const cx = (rnd() * 2 - 1) * R, cz = (rnd() * 2 - 1) * R
      const n = 5 + Math.floor(rnd() * 9)
      const spread = 90 + rnd() * 220
      const big = 0.7 + rnd() * 0.9
      const members = []
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * spread
        const s = (55 + rnd() * 95) * big
        members.push(puffs.length)
        puffs.push({
          x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r * 0.7,
          y: CLOUD_Y + 38 + s * 0.42 + rnd() * 40 * big,
          s, rot: (rnd() - 0.5) * 0.6, v: Math.floor(rnd() * 4),
        })
      }
      clusters.push({ members, base: cx, bz: cz })
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
        puffs.push({ x: cx + (rnd() - 0.5) * 60, z: cz + (rnd() - 0.5) * 60, y: y + (rnd() - 0.5) * 25, s, rot: (rnd() - 0.5) * 0.8, v: Math.floor(rnd() * 4) })
      }
      clusters.push({ members })
    }
    // grey cloud bases hanging under the sea, seen when diving through
    for (let c = 0; c < 90; c++) {
      const cx = (rnd() * 2 - 1) * R, cz = (rnd() * 2 - 1) * R
      const n = 3 + Math.floor(rnd() * 6)
      const spread = 120 + rnd() * 260
      const members = []
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * spread
        const s = 70 + rnd() * 120
        members.push(puffs.length)
        puffs.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r * 0.7, y: CLOUD_Y - 45 - s * 0.35 - rnd() * 60, s, rot: (rnd() - 0.5) * 0.6, v: Math.floor(rnd() * 4), dark: 1 })
      }
      clusters.push({ members })
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
    for (const a of [this.aPos, this.aScale, this.aRot, this.aVar, this.aDark]) a.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('iPos', this.aPos)
    geo.setAttribute('iScale', this.aScale)
    geo.setAttribute('iRot', this.aRot)
    geo.setAttribute('iVar', this.aVar)
    geo.setAttribute('iDark', this.aDark)
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
      if (mx || mz) for (const i of c.members) { this.puffs[i].x += mx; this.puffs[i].z += mz }
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
      const pa = this.aPos.array, sa = this.aScale.array, ra = this.aRot.array, va = this.aVar.array, da = this.aDark.array
      for (let k = 0; k < N; k++) {
        const p = this.puffs[ord[k]]
        pa[k * 3] = p.x; pa[k * 3 + 1] = p.y; pa[k * 3 + 2] = p.z
        sa[k] = p.s; ra[k] = p.rot; va[k] = p.v; da[k] = p.dark || 0
      }
      this.aPos.needsUpdate = true; this.aScale.needsUpdate = true
      this.aRot.needsUpdate = true; this.aVar.needsUpdate = true; this.aDark.needsUpdate = true
    }
  }
}
