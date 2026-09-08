import * as THREE from 'three'
import { mulberry32, GLSL_SRGB } from './noise.js'
import { CLOUD_Y, SUN_DIR, UP } from './constants.js'

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion()
const _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1.5, 1.5, 1.5)
const _c = new THREE.Color()

// ------------------------------------------------------------------ birds
const birdVert = /* glsl */ `
attribute float aSide;
attribute float aPhase;
attribute float aFreq;
uniform float uTime;
varying float vShade;
varying float vFogDepth;
void main(){
  vec3 p = position;
  float flap = sin(uTime * aFreq + aPhase) * 0.95;
  if (aSide != 0.0) {
    float w = abs(p.x);
    p.y += w * (sin(flap) * 0.8 + 0.18) + w * w * 0.3 * max(flap, 0.0);
    p.x *= cos(flap * 0.6);
  }
  vShade = 0.5 + 0.5 * cos(flap);
  vec4 wp = instanceMatrix * vec4(p, 1.0);
  wp = modelMatrix * wp;
  vec4 mv = viewMatrix * wp;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`
const birdFrag = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
varying float vShade;
varying float vFogDepth;
${GLSL_SRGB}
void main(){
  vec3 c = mix(S(0.13, 0.16, 0.26), S(0.9, 0.93, 1.0), vShade * 0.22);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  c = mix(c, uFogColor, fogF);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
function birdGeometry() {
  // body: small diamond, wings: two quads from the body outward (+x right, -x left), forward = -z
  const pos = [], side = []
  const tri = (a, b, c, s) => { pos.push(...a, ...b, ...c); side.push(s, s, s) }
  tri([0, -0.05, -0.9], [0.16, 0, 0.2], [-0.16, 0, 0.2], 0)
  tri([0, -0.05, -0.9], [0, 0.16, 0.05], [0.16, 0, 0.2], 0)
  tri([0, -0.05, -0.9], [-0.16, 0, 0.2], [0, 0.16, 0.05], 0)
  tri([-0.16, 0, 0.2], [0.16, 0, 0.2], [0, 0.16, 0.05], 0)
  tri([0, 0.05, 0.75], [-0.16, 0, 0.2], [0.16, 0, 0.2], 0)
  tri([0, 0.05, 0.75], [0.16, 0, 0.2], [0, 0.16, 0.05], 0)
  tri([0, 0.05, 0.75], [0, 0.16, 0.05], [-0.16, 0, 0.2], 0)
  for (const s of [1, -1]) {
    const x = s
    tri([0.1 * s, 0, -0.3], [1.3 * x, 0, -0.05], [0.1 * s, 0, 0.25], s)
    tri([1.3 * x, 0, -0.05], [1.65 * x, 0, 0.35], [0.1 * s, 0, 0.25], s)
    // underside (double)
    tri([0.1 * s, 0, 0.25], [1.3 * x, 0, -0.05], [0.1 * s, 0, -0.3], s)
    tri([0.1 * s, 0, 0.25], [1.65 * x, 0, 0.35], [1.3 * x, 0, -0.05], s)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1))
  return g
}

// ------------------------------------------------------------------ bubbles
const bubbleVert = /* glsl */ `
attribute float aPhase;
varying vec3 vN, vV;
varying float vPhase;
void main(){
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(instanceMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vPhase = aPhase;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
const bubbleFrag = /* glsl */ `
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vN, vV;
varying float vPhase;
void main(){
  float nv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float fres = pow(1.0 - nv, 2.5);
  float h = nv * 1.6 + vPhase + uTime * 0.08;
  vec3 iri = 0.5 + 0.5 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67)));
  vec3 r = reflect(-normalize(vV), normalize(vN));
  float spec = pow(max(dot(r, uSunDir), 0.0), 90.0);
  vec3 c = iri * fres * 0.9 + vec3(1.0) * spec * 1.2 + vec3(0.6, 0.85, 1.0) * fres * 0.3;
  float a = fres * 0.85 + spec + 0.03;
  gl_FragColor = vec4(c * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

// ------------------------------------------------------------------ sparkles
const sparkVert = /* glsl */ `
attribute float aPhase;
uniform float uTime;
varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 0.5 + 0.5 * sin(uTime * 2.5 + aPhase * 12.0);
  vA = tw * tw;
  gl_PointSize = min(14.0, (2.0 + 5.0 * tw) * 160.0 / max(-mv.z, 1.0));
  gl_Position = projectionMatrix * mv;
}
`
const sparkFrag = /* glsl */ `
varying float vA;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  float cross = exp(-abs(p.x) * 30.0) * exp(-abs(p.y) * 6.0) + exp(-abs(p.y) * 30.0) * exp(-abs(p.x) * 6.0);
  float a = (smoothstep(0.5, 0.0, d) * 0.5 + cross * 0.6) * vA;
  gl_FragColor = vec4(vec3(0.85, 0.95, 1.0) * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function balloonEnvelope() {
  const prof = []
  const shape = [[0.16, 0], [0.34, 0.12], [0.62, 0.42], [0.86, 0.85], [1.0, 1.35], [0.98, 1.85], [0.8, 2.3], [0.5, 2.62], [0.0, 2.75]]
  for (const [r, y] of shape) prof.push(new THREE.Vector3(r, y, 0))
  const curve = new THREE.CatmullRomCurve3(prof, false, 'catmullrom', 0.5)
  const pts = curve.getPoints(30).map(p => new THREE.Vector2(Math.max(0, p.x), p.y))
  return new THREE.LatheGeometry(pts, 32)
}

function balloonTexture(colA, colB, colC) {
  const w = 512, h = 256
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const ctx = cv.getContext('2d')
  const gores = 12
  for (let i = 0; i < gores; i++) {
    ctx.fillStyle = i % 2 ? colA : colB
    ctx.fillRect(Math.floor(i * w / gores), 0, Math.ceil(w / gores), h)
  }
  // band near the bottom (v is measured from the bottom of the profile)
  ctx.fillStyle = colC
  ctx.fillRect(0, Math.floor(h * (1 - 0.27)), w, Math.floor(h * 0.07))
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

const PALETTES = [
  ['#ff6b6b', '#fff5e6', '#4fd1c5'], ['#4fb8ff', '#ffffff', '#ffd166'], ['#ffd166', '#ff8fab', '#ffffff'],
  ['#b28dff', '#fff5e6', '#ff6b6b'], ['#4fd1c5', '#ffffff', '#ff6b6b'], ['#ff8fab', '#ffffff', '#4fb8ff'],
]

export class Life {
  constructor(scene, fog) {
    this.scene = scene
    this.fog = fog
    const rnd = mulberry32(9)
    this.rnd = rnd

    // birds
    this.flocks = []
    let total = 0
    for (let f = 0; f < 5; f++) {
      const n = 7 + Math.floor(rnd() * 8)
      this.flocks.push({
        pos: new THREE.Vector3((rnd() - 0.5) * 1600, CLOUD_Y + 120 + rnd() * 350, (rnd() - 0.5) * 1600),
        heading: rnd() * Math.PI * 2, n, start: total, phase: rnd() * 10, speed: 20 + rnd() * 8, turn: (rnd() - 0.5) * 0.4,
      })
      total += n
    }
    const bg = birdGeometry()
    const phases = new Float32Array(total), freqs = new Float32Array(total)
    for (let i = 0; i < total; i++) { phases[i] = rnd() * 6.28; freqs[i] = 7 + rnd() * 4 }
    bg.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1))
    bg.setAttribute('aFreq', new THREE.InstancedBufferAttribute(freqs, 1))
    this.birdUniforms = { uTime: { value: 0 }, uFogColor: fog.color, uFogDensity: fog.density }
    this.birds = new THREE.InstancedMesh(bg, new THREE.ShaderMaterial({
      uniforms: this.birdUniforms, vertexShader: birdVert, fragmentShader: birdFrag, side: THREE.DoubleSide,
    }), total)
    this.birds.frustumCulled = false
    scene.add(this.birds)

    // balloons
    this.balloons = []
    const basketGeo = new THREE.BoxGeometry(0.5, 0.36, 0.5)
    const basketMat = new THREE.MeshStandardMaterial({ color: '#8a5a33', roughness: 0.9 })
    const ropeMat = new THREE.MeshStandardMaterial({ color: '#4a3a2a' })
    for (let i = 0; i < 9; i++) {
      const pal = PALETTES[i % PALETTES.length]
      const g = new THREE.Group()
      const env = new THREE.Mesh(balloonEnvelope(), new THREE.MeshPhysicalMaterial({
        map: balloonTexture(...pal), roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2,
      }))
      env.position.y = 1.1
      const basket = new THREE.Mesh(basketGeo, basketMat)
      basket.position.y = 0.0
      g.add(env, basket)
      for (let k = 0; k < 4; k++) {
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 4), ropeMat)
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4
        rope.position.set(Math.cos(a) * 0.22, 0.65, Math.sin(a) * 0.22)
        rope.rotation.z = Math.cos(a) * -0.12
        rope.rotation.x = Math.sin(a) * 0.12
        g.add(rope)
      }
      const s = 11 + rnd() * 10
      g.scale.setScalar(s)
      const b = {
        g, s, pos: new THREE.Vector3((rnd() - 0.5) * 4200, CLOUD_Y + 70 + rnd() * 700, (rnd() - 0.5) * 4200),
        phase: rnd() * 10, drift: new THREE.Vector3(1.6 + rnd(), 0, 0.5 + rnd() * 0.8),
      }
      this.balloons.push(b)
      scene.add(g)
    }
    this.balloonR = 2400

    // bubbles
    const NB = 70
    this.bubbleCount = NB
    const bgeo = new THREE.SphereGeometry(1, 16, 12)
    const bph = new Float32Array(NB)
    for (let i = 0; i < NB; i++) bph[i] = rnd()
    bgeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(bph, 1))
    this.bubbleUniforms = { uSunDir: { value: SUN_DIR.clone() }, uTime: { value: 0 } }
    this.bubbles = new THREE.InstancedMesh(bgeo, new THREE.ShaderMaterial({
      uniforms: this.bubbleUniforms, vertexShader: bubbleVert, fragmentShader: bubbleFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }), NB)
    this.bubbles.frustumCulled = false
    this.bubbles.renderOrder = 25
    this.bub = []
    for (let i = 0; i < NB; i++) this.bub.push({ p: new THREE.Vector3(), s: 0.5 + rnd() * 1.3, ph: rnd() * 10, pop: 0 })
    this.bubbleBox = new THREE.Vector3(170, 90, 170)
    this.bubblesInit = false
    scene.add(this.bubbles)

    // sparkles
    const NS = 500
    const sp = new Float32Array(NS * 3), sph = new Float32Array(NS)
    for (let i = 0; i < NS; i++) { sp[i * 3] = (rnd() - 0.5) * 400; sp[i * 3 + 1] = (rnd() - 0.5) * 240; sp[i * 3 + 2] = (rnd() - 0.5) * 400; sph[i] = rnd() }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3))
    sg.setAttribute('aPhase', new THREE.BufferAttribute(sph, 1))
    this.sparkUniforms = { uTime: { value: 0 } }
    this.sparks = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: this.sparkUniforms, vertexShader: sparkVert, fragmentShader: sparkFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    this.sparks.frustumCulled = false
    this.sparkBox = new THREE.Vector3(200, 120, 200)
    scene.add(this.sparks)
  }

  shift(dx, dz) {
    for (const f of this.flocks) { f.pos.x -= dx; f.pos.z -= dz }
    for (const b of this.balloons) { b.pos.x -= dx; b.pos.z -= dz }
    for (const b of this.bub) { b.p.x -= dx; b.p.z -= dz }
    const p = this.sparks.geometry.attributes.position.array
    for (let i = 0; i < p.length; i += 3) { p[i] -= dx; p[i + 2] -= dz }
    this.sparks.geometry.attributes.position.needsUpdate = true
  }

  wrap(v, center, R) {
    if (v.x - center.x > R) v.x -= 2 * R; else if (v.x - center.x < -R) v.x += 2 * R
    if (v.z - center.z > R) v.z -= 2 * R; else if (v.z - center.z < -R) v.z += 2 * R
  }

  update(dt, t, flight, camera, audio) {
    const anchor = flight.pos
    this.birdUniforms.uTime.value = t
    this.bubbleUniforms.uTime.value = t
    this.sparkUniforms.uTime.value = t

    // birds
    for (const f of this.flocks) {
      f.heading += (Math.sin(t * 0.13 + f.phase) * 0.25 + f.turn) * dt
      const dir = _dir.set(-Math.sin(f.heading), 0, -Math.cos(f.heading))
      f.pos.addScaledVector(dir, f.speed * dt)
      f.pos.y += Math.sin(t * 0.3 + f.phase) * 2 * dt
      const yTarget = THREE.MathUtils.clamp(f.pos.y, anchor.y - 260, anchor.y + 200)
      f.pos.y += (yTarget - f.pos.y) * dt * 0.05
      this.wrap(f.pos, anchor, 1300)
      const right = _right.set(dir.z, 0, -dir.x)
      _q.setFromAxisAngle(UP, f.heading)
      for (let i = 0; i < f.n; i++) {
        const k = Math.ceil(i / 2), side = i % 2 ? -1 : 1
        const back = k * 2.6 + Math.sin(t * 1.1 + i) * 0.4
        const lat = side * k * 2.1 + Math.sin(t * 0.9 + i * 2) * 0.3
        const up = Math.sin(t * 0.7 + i * 1.7) * 0.6
        const p = _p.copy(f.pos).addScaledVector(dir, -back).addScaledVector(right, lat)
        p.y += up
        _m.compose(p, _q, _s)
        this.birds.setMatrixAt(f.start + i, _m)
      }
    }
    this.birds.instanceMatrix.needsUpdate = true

    // balloons
    for (const b of this.balloons) {
      b.pos.addScaledVector(b.drift, dt)
      this.wrap(b.pos, anchor, this.balloonR)
      b.g.position.copy(b.pos)
      b.g.position.y += Math.sin(t * 0.35 + b.phase) * 4
      b.g.rotation.y = t * 0.05 + b.phase
      b.g.rotation.z = Math.sin(t * 0.4 + b.phase) * 0.02
    }

    // bubbles
    const B = this.bubbleBox
    const rnd = this.rnd
    if (!this.bubblesInit) {
      this.bubblesInit = true
      for (const b of this.bub) b.p.set(anchor.x + (rnd() - 0.5) * 2 * B.x, anchor.y + (rnd() - 0.5) * 2 * B.y, anchor.z + (rnd() - 0.5) * 2 * B.z)
    }
    const f = flight.forward(_v2)
    for (let i = 0; i < this.bub.length; i++) {
      const b = this.bub[i]
      b.p.y += dt * 0.8
      b.p.x += Math.sin(t * 0.6 + b.ph) * dt * 0.8
      b.p.z += Math.cos(t * 0.5 + b.ph) * dt * 0.8
      let respawn = false
      if (b.p.x - anchor.x > B.x || b.p.x - anchor.x < -B.x || b.p.z - anchor.z > B.z || b.p.z - anchor.z < -B.z || b.p.y - anchor.y > B.y || b.p.y - anchor.y < -B.y) respawn = true
      if (b.pop > 0) { b.pop -= dt; if (b.pop <= 0) respawn = true }
      else if (b.p.distanceToSquared(anchor) < (b.s + 3.2) * (b.s + 3.2)) { b.pop = 0.18; audio && audio.pop() }
      if (respawn) {
        b.pop = 0
        // spawn somewhere ahead of the plane
        b.p.copy(anchor).addScaledVector(f, 60 + rnd() * 100)
        b.p.x += (rnd() - 0.5) * 140; b.p.y += (rnd() - 0.5) * 70; b.p.z += (rnd() - 0.5) * 140
      }
      const s = b.pop > 0 ? b.s * (1 + (0.18 - b.pop) * 6) : b.s * (1 + 0.04 * Math.sin(t * 3 + b.ph))
      _m.makeScale(s, s, s).setPosition(b.p)
      this.bubbles.setMatrixAt(i, _m)
    }
    this.bubbles.instanceMatrix.needsUpdate = true
    this.bubbles.material.opacity = 1

    // sparkles drift and wrap around the camera
    const sp = this.sparks.geometry.attributes.position.array
    const S = this.sparkBox, c = camera.position
    for (let i = 0; i < sp.length; i += 3) {
      sp[i + 1] += dt * 1.5
      if (sp[i] - c.x > S.x) sp[i] -= 2 * S.x; else if (sp[i] - c.x < -S.x) sp[i] += 2 * S.x
      if (sp[i + 2] - c.z > S.z) sp[i + 2] -= 2 * S.z; else if (sp[i + 2] - c.z < -S.z) sp[i + 2] += 2 * S.z
      if (sp[i + 1] - c.y > S.y) sp[i + 1] -= 2 * S.y; else if (sp[i + 1] - c.y < -S.y) sp[i + 1] += 2 * S.y
    }
    this.sparks.geometry.attributes.position.needsUpdate = true
  }
}
