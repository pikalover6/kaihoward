import * as THREE from 'three'
import { LIGHT, SUN_DIR, n64Material } from './n64.js'
import { Geo, loft, plate } from './jets.js'
import { mulberry32 } from './noise.js'
import { wrapR } from './constants.js'

// The Frutiger Aero layer: glossy soap bubbles drifting up through the sky, a lens flare off
// the sun, and dolphins. All of it lit per vertex and dithered like everything else.

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3()
const _e = new THREE.Euler()

// ------------------------------------------------------------------ bubbles
const bubbleVert = /* glsl */ `
uniform vec3 uSunDir, uFogColor;
uniform float uFogNear, uFogFar, uTime;
varying vec4 vC;
void main(){
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4(position, 1.0);
  vec3 n = normalize(mat3(m) * normal);
  vec3 V = normalize(cameraPosition - wp.xyz);
  float nv = abs(dot(n, V));
  float fr = pow(1.0 - nv, 2.2);
  // thin-film colours that slide round with the angle
  vec3 irid = 0.55 + 0.45 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + fr * 1.4 + uTime * 0.07 + wp.y * 0.013));
  float spec = pow(max(dot(n, normalize(uSunDir + V)), 0.0), 36.0);
  vec3 col = mix(vec3(0.8, 0.97, 1.0), irid, 0.55) * (0.15 + fr * 1.1) + spec * 1.6;
  float a = clamp(0.08 + fr * 0.95 + spec, 0.0, 1.0);
  vec4 mv = viewMatrix * wp;
  float fog = clamp((-mv.z - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  vC = vec4(col, a * (1.0 - fog));
  gl_Position = projectionMatrix * mv;
}
`
const bubbleFrag = /* glsl */ `
varying vec4 vC;
void main(){ gl_FragColor = vec4(vC.rgb * vC.a, vC.a); }
`

export class Bubbles {
  constructor(scene, n = 120) {
    this.n = n
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uSunDir: LIGHT.uSunDir, uFogColor: LIGHT.uFogColor, uFogNear: LIGHT.uFogNear, uFogFar: LIGHT.uFogFar, uTime: LIGHT.uTime },
      vertexShader: bubbleVert, fragmentShader: bubbleFrag,
      transparent: true, depthWrite: false, premultipliedAlpha: true,
    })
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.mat, n)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 25
    scene.add(this.mesh)
    const rnd = mulberry32(64)
    this.rnd = rnd
    this.list = Array.from({ length: n }, () => ({ p: new THREE.Vector3(), r: 1.5 + rnd() ** 2 * 7, ph: rnd() * 6, rise: 2 + rnd() * 4, placed: false, pop: 0 }))
    this.R = 700
  }

  shift(dx, dz) { for (const b of this.list) { b.p.x -= dx; b.p.z -= dz } }

  place(b, plane, world, anywhere) {
    const R = this.R, rnd = this.rnd
    b.p.x = plane.pos.x + (rnd() * 2 - 1) * R
    b.p.z = plane.pos.z + (rnd() * 2 - 1) * R
    const floor = Math.max(world.ground(b.p.x, b.p.z), world.waterY) + 10
    b.p.y = anywhere ? Math.max(floor, plane.pos.y + (rnd() * 2 - 1) * 250) : Math.max(floor, plane.pos.y - 260 - rnd() * 60)
    b.placed = true
    b.pop = 0
  }

  // returns the number of bubbles the plane popped this frame
  update(dt, t, plane, world) {
    let popped = 0
    for (let i = 0; i < this.n; i++) {
      const b = this.list[i]
      if (!b.placed) this.place(b, plane, world, true)
      b.p.y += b.rise * dt
      b.p.x += Math.sin(t * 0.4 + b.ph) * 2 * dt
      // keep them round the plane: wrap sideways, recycle the ones that drift too high
      const ox = b.p.x, oz = b.p.z
      b.p.x = plane.pos.x + wrapR(b.p.x - plane.pos.x, this.R)
      b.p.z = plane.pos.z + wrapR(b.p.z - plane.pos.z, this.R)
      if (ox !== b.p.x || oz !== b.p.z) b.p.y = Math.max(Math.max(world.ground(b.p.x, b.p.z), world.waterY) + 10, plane.pos.y + (this.rnd() * 2 - 1) * 250)
      if (b.p.y > plane.pos.y + 320) this.place(b, plane, world, false)
      if (b.pop > 0) {
        b.pop -= dt
        if (b.pop <= 0) this.place(b, plane, world, false)
      } else if (b.p.distanceToSquared(plane.pos) < (b.r + 3.2) ** 2) {
        b.pop = 0.001
        popped++
        this.lastPop = b.p.clone()
        this.lastR = b.r
      }
      const wob = 1 + Math.sin(t * 3 + b.ph) * 0.05
      _s.set(b.r * wob, b.r / wob, b.r * wob)
      if (b.pop > 0) _s.setScalar(0.0001)
      _m.compose(b.p, _q.identity(), _s)
      this.mesh.setMatrixAt(i, _m)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    return popped
  }
}

// ------------------------------------------------------------------ lens flare
// a row of glassy shapes from the sun through the middle of the screen
function flareTex(kind) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const c = cv.getContext('2d')
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32)
  if (kind === 'glow') {
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,250,220,0.9)'); g.addColorStop(0.45, 'rgba(255,240,200,0.25)'); g.addColorStop(1, 'rgba(255,240,200,0)')
    c.fillStyle = g; c.fillRect(0, 0, 64, 64)
    c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1.5
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + 0.3; c.beginPath(); c.moveTo(32, 32); c.lineTo(32 + Math.cos(a) * 31, 32 + Math.sin(a) * 31); c.stroke() }
  } else if (kind === 'ring') {
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.72, 'rgba(255,255,255,0)'); g.addColorStop(0.85, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = g; c.fillRect(0, 0, 64, 64)
  } else {
    c.fillStyle = 'rgba(255,255,255,0.55)'
    c.beginPath()
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; c[i ? 'lineTo' : 'moveTo'](32 + Math.cos(a) * 28, 32 + Math.sin(a) * 28) }
    c.closePath(); c.fill()
    c.fillStyle = 'rgba(255,255,255,0.35)'
    c.beginPath(); c.arc(26, 24, 9, 0, Math.PI * 2); c.fill()
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.NoColorSpace
  return t
}

export class Flare {
  constructor(camera) {
    this.camera = camera
    const tex = { glow: flareTex('glow'), ring: flareTex('ring'), hex: flareTex('hex') }
    const geo = new THREE.PlaneGeometry(1, 1)
    this.parts = [
      [0, 0.32, 'glow', '#fff6dc'], [0.32, 0.07, 'hex', '#9ff0ff'], [0.55, 0.045, 'hex', '#b6ff9f'], [0.8, 0.14, 'ring', '#ff9fe6'],
      [1.15, 0.05, 'hex', '#fff09f'], [1.35, 0.09, 'hex', '#7fd8ff'], [1.7, 0.22, 'ring', '#9ff0ff'], [2.0, 0.06, 'hex', '#d6b0ff'],
    ].map(([t, size, kind, col]) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex[kind], color: col, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
      m.renderOrder = 1000
      m.frustumCulled = false
      camera.add(m)
      return { m, t, size }
    })
    this.vis = 0
  }

  update(dt, world) {
    const cam = this.camera
    _v.copy(SUN_DIR).multiplyScalar(1000).add(cam.position).project(cam)
    let target = _v.z < 1 && Math.abs(_v.x) < 1.3 && Math.abs(_v.y) < 1.3 ? 1 : 0
    // hidden behind a hill?
    if (target) {
      for (let k = 1; k <= 6; k++) {
        const d = k * k * 90
        _w.copy(SUN_DIR).multiplyScalar(d).add(cam.position)
        if (_w.y < world.ground(_w.x, _w.z)) { target = 0; break }
      }
    }
    const edge = Math.max(Math.abs(_v.x), Math.abs(_v.y))
    target *= 1 - THREE.MathUtils.smoothstep(edge, 0.85, 1.3)
    this.vis += (target - this.vis) * (1 - Math.exp(-dt * 8))
    const th = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), asp = cam.aspect
    const sx = _v.x, sy = _v.y
    for (const P of this.parts) {
      P.m.visible = this.vis > 0.02
      if (!P.m.visible) continue
      const k = 1 - P.t
      P.m.position.set(sx * k * th * asp, sy * k * th, -1)
      P.m.scale.setScalar(P.size * th * 2 * (P.t === 0 ? 1 : 0.8 + 0.4 * (1 - edge)))
      P.m.material.opacity = this.vis * (P.t === 0 ? 0.9 : 0.55)
    }
  }
}

// ------------------------------------------------------------------ dolphins
function dolphinGeo() {
  const g = new Geo()
  const back = new THREE.Color('#4f7fa6'), belly = new THREE.Color('#e6f2f8')
  const paint = n => belly.clone().lerp(back, THREE.MathUtils.smoothstep(n.y, -0.5, 0.1))
  loft(g, [[-1.9, 0, 0, -0.05], [-1.6, 0.1, 0.09, -0.05], [-1.35, 0.2, 0.2, 0.0], [-0.9, 0.36, 0.38, 0.05], [0, 0.42, 0.45, 0.05], [0.9, 0.28, 0.3, 0.02], [1.6, 0.12, 0.12, 0], [1.9, 0.06, 0.06, 0]], { paint, N: 10, e: 1 })
  plate(g, [[-0.1, 0.4], [0.5, 0.95], [0.7, 0.95], [0.6, 0.35]], 0.05, (u, v, o) => new THREE.Vector3(o, v, u), back)
  for (const s of [1, -1]) {
    plate(g, [[0, 1.75], [0.7, 2.15], [0.6, 2.3], [0, 1.95]], 0.05, (u, v, o) => new THREE.Vector3(s * u, o, v), back)
    plate(g, [[0.25, -0.7], [0.75, -0.2], [0.65, -0.1], [0.25, -0.4]], 0.05, (u, v, o) => new THREE.Vector3(s * u, -0.3 + o - u * 0.3, v), back)
  }
  return g.build()
}

export class Dolphins {
  constructor(scene, n = 6) {
    this.n = n
    this.mesh = new THREE.InstancedMesh(dolphinGeo(), n64Material({ vertexColors: true, spec: 0.9, shine: 20, rim: 0.2 }), n)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    scene.add(this.mesh)
    this.pod = null
    this.wait = 3
    this.events = []
  }

  shift(dx, dz) { if (this.pod) { this.pod.c.x -= dx; this.pod.c.z -= dz } }

  update(dt, plane, world) {
    this.events.length = 0
    if (!this.pod) {
      this.wait -= dt
      this.mesh.count = 0
      if (this.wait > 0) return
      this.wait = 1.5
      // somewhere ahead over deep enough water, near enough to see
      const f = plane.forward(_v).setY(0)
      if (f.lengthSq() < 1e-4) f.set(0, 0, -1)
      f.normalize()
      const a = (Math.random() - 0.5) * 1.2
      const d = 120 + Math.random() * 220
      const cx = plane.pos.x + (f.x * Math.cos(a) - f.z * Math.sin(a)) * d, cz = plane.pos.z + (f.z * Math.cos(a) + f.x * Math.sin(a)) * d
      if (world.ground(cx, cz) > world.waterY - 4 || plane.pos.y - world.waterY > 500) return
      const heading = Math.random() * Math.PI * 2
      const k = 3 + Math.floor(Math.random() * Math.min(3, this.n - 2))
      this.pod = { c: new THREE.Vector3(cx, world.waterY, cz), heading, age: 0, life: 9 + Math.random() * 4, members: Array.from({ length: k }, (_, i) => ({ off: (i - (k - 1) / 2) * 5 + Math.random() * 2, lag: Math.random() * 0.5 + (i % 2) * 0.25, back: Math.random() * 5 })) }
    }
    const P = this.pod
    P.age += dt
    const period = 2.1, air = 1.0
    const dir = _v.set(Math.sin(P.heading), 0, Math.cos(P.heading))
    const side = _w.set(dir.z, 0, -dir.x)
    let count = 0
    P.c.addScaledVector(dir, 14 * dt)
    P.members.forEach(m => {
      const tt = P.age - m.lag
      if (tt < 0) return
      const ph = (tt % period) / air
      const jumping = ph < 1
      const prevPh = ((tt - dt) % period) / air
      if (jumping && prevPh >= 1) this.events.push(new THREE.Vector3().copy(P.c).addScaledVector(side, m.off))
      if (!jumping) return
      // an arc out of the water and back in, nose following the arc
      const along = (ph - 0.5) * 16
      const y = P.c.y + Math.sin(ph * Math.PI) * 7 - 1
      const p = new THREE.Vector3().copy(P.c).addScaledVector(side, m.off).addScaledVector(dir, along - m.back)
      p.y = y
      const pitch = Math.cos(ph * Math.PI) * 0.9
      _q.setFromEuler(_e.set(pitch, P.heading + Math.PI, 0, 'YXZ'))
      _m.compose(p, _q, _s.setScalar(1.3))
      this.mesh.setMatrixAt(count++, _m)
      if (ph > 0.97 && ph - dt / air <= 0.97) this.events.push(p.clone().setY(P.c.y))
    })
    this.mesh.count = count
    this.mesh.instanceMatrix.needsUpdate = true
    if (P.age > P.life || P.c.distanceTo(plane.pos) > 900) { this.pod = null; this.wait = 6 + Math.random() * 6 }
  }
}
