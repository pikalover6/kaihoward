import * as THREE from 'three'
import { n64Material } from './n64.js'
import { mulberry32, terrainH } from './noise.js'
import { wrapR } from './constants.js'

// Flocks of gulls that circle about until you buzz them, then scatter.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1)
const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _e = new THREE.Euler()
const FLOCKS = 6, PER = 8, R = 1600

function gullParts() {
  const body = new THREE.ConeGeometry(0.45, 2.2, 5).rotateX(-Math.PI / 2)
  body.scale(1, 0.8, 1)
  const wing = new THREE.BufferGeometry()
  // a bent gull wing, root at the origin, reaching out along +x
  wing.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, -0.4, 1.6, 0.35, -0.2, 0, 0, 0.5,
    1.6, 0.35, -0.2, 1.6, 0.35, 0.4, 0, 0, 0.5,
    1.6, 0.35, -0.2, 3.0, -0.2, 0.2, 1.6, 0.35, 0.4,
  ], 3))
  wing.computeVertexNormals()
  const left = wing.clone().scale(-1, 1, 1)
  left.index = null
  // flip winding for the mirrored side
  const p = left.attributes.position.array
  for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t }
  left.computeVertexNormals()
  return { body, wingR: wing, wingL: left }
}

export class Birds {
  constructor(scene) {
    const G = gullParts()
    const n = FLOCKS * PER
    const white = n64Material({ color: '#f4f6fa', side: THREE.DoubleSide }), grey = n64Material({ color: '#9aa6b8', side: THREE.DoubleSide })
    this.body = new THREE.InstancedMesh(G.body, white, n)
    this.wingL = new THREE.InstancedMesh(G.wingL, grey, n)
    this.wingR = new THREE.InstancedMesh(G.wingR, grey, n)
    for (const m of [this.body, this.wingL, this.wingR]) { m.frustumCulled = false; scene.add(m) }
    const rnd = mulberry32(42)
    this.rnd = rnd
    this.flocks = []
    this.birds = []
    for (let f = 0; f < FLOCKS; f++) {
      const flock = { c: new THREE.Vector3((rnd() - 0.5) * 2 * R, 0, (rnd() - 0.5) * 2 * R), r: 30 + rnd() * 40, alt: 60 + rnd() * 220, spin: (rnd() < 0.5 ? -1 : 1) * (0.25 + rnd() * 0.2), placed: false }
      this.flocks.push(flock)
      for (let i = 0; i < PER; i++) {
        this.birds.push({ flock, a: (i / PER) * Math.PI * 2 + rnd() * 0.4, dr: (rnd() - 0.5) * 14, dy: (rnd() - 0.5) * 10, phase: rnd() * 6, p: new THREE.Vector3(), v: new THREE.Vector3(), scared: 0 })
      }
    }
  }

  shift(dx, dz) {
    for (const f of this.flocks) { f.c.x -= dx; f.c.z -= dz }
    for (const b of this.birds) { b.p.x -= dx; b.p.z -= dz }
  }

  // returns true if a flock got scattered this frame (for the squawk)
  update(dt, t, plane, world) {
    let squawk = false
    for (const f of this.flocks) {
      const ox = f.c.x, oz = f.c.z
      f.c.x = plane.pos.x + wrapR(f.c.x - plane.pos.x, R)
      f.c.z = plane.pos.z + wrapR(f.c.z - plane.pos.z, R)
      if (!f.placed || ox !== f.c.x || oz !== f.c.z) {
        f.c.y = Math.max(terrainH(f.c.x + world.origin.x, f.c.z + world.origin.z), world.waterY) + f.alt
        f.placed = true
        for (const b of this.birds) if (b.flock === f) b.reset = true
      }
    }
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i], f = b.flock
      b.a += f.spin * dt
      const home = _p.set(f.c.x + Math.cos(b.a) * (f.r + b.dr), f.c.y + b.dy + Math.sin(t * 0.7 + b.phase) * 3, f.c.z + Math.sin(b.a) * (f.r + b.dr))
      if (b.reset) { b.p.copy(home); b.v.set(0, 0, 0); b.reset = false; b.scared = 0 }
      const near = b.p.distanceTo(plane.pos)
      if (near < 35 && b.scared <= 0 && plane.speed > 5) {
        b.scared = 4 + this.rnd() * 2
        b.v.subVectors(b.p, plane.pos).normalize().multiplyScalar(30).add(_v.set(0, 18, 0))
        squawk = true
      }
      if (b.scared > 0) {
        b.scared -= dt
        b.v.y -= 2 * dt
        b.p.addScaledVector(b.v, dt)
        if (b.scared <= 0) b.v.set(0, 0, 0)
      } else {
        // drift back home
        const k = 1 - Math.exp(-dt * 1.2)
        _v.subVectors(home, b.p).multiplyScalar(k)
        b.p.add(_v)
      }
      // face along the circle (or away, when fleeing)
      const heading = b.scared > 0 ? Math.atan2(-b.v.x, -b.v.z) : -b.a + (f.spin > 0 ? Math.PI : 0)
      _q.setFromEuler(_e.set(0, heading, Math.sin(t * 0.6 + b.phase) * 0.2 - f.spin * 0.6))
      _m.compose(b.p, _q, _s)
      this.body.setMatrixAt(i, _m)
      const flap = Math.sin(t * (b.scared > 0 ? 16 : 6) + b.phase) * (b.scared > 0 ? 0.9 : 0.5)
      _m.compose(b.p, _q2.copy(_q).multiply(_q2.setFromEuler(_e.set(0, 0, flap))), _s)
      this.wingR.setMatrixAt(i, _m)
      _m.compose(b.p, _q2.copy(_q).multiply(_q2.setFromEuler(_e.set(0, 0, -flap))), _s)
      this.wingL.setMatrixAt(i, _m)
    }
    this.body.instanceMatrix.needsUpdate = this.wingL.instanceMatrix.needsUpdate = this.wingR.instanceMatrix.needsUpdate = true
    return squawk
  }
}
