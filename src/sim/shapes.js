import * as THREE from 'three'

// What things are made of. Springs and dampers are per hull point; bounce is the
// restitution of a hard hit. Solid things get hit; soft things only push back.
export const MAT = {
  ground: { name: 'ground', k: 240, c: 16, drag: 30, mu: 0.6, bounce: 0.62, solid: true },
  stone: { name: 'stone', k: 240, c: 16, drag: 30, mu: 0.6, bounce: 0.62, solid: true },
  wood: { name: 'wood', k: 240, c: 16, drag: 30, mu: 0.6, bounce: 0.55, solid: true },
  gold: { name: 'gold', k: 240, c: 16, drag: 20, mu: 0.4, bounce: 0.8, solid: true },
  rubber: { name: 'rubber', k: 200, c: 6, drag: 10, mu: 0.4, bounce: 0.95, solid: true },
  bouncy: { name: 'bouncy', k: 200, c: 4, drag: 8, mu: 0.3, bounce: 1.18, solid: true }, // gives back more than it gets
  sky: { name: 'sky', k: 240, c: 16, drag: 30, mu: 0.6, bounce: 0.62, solid: true },
  water: { name: 'water', k: 70, c: 5, drag: 0.12, mu: 0.6, solid: false },
  leaves: { name: 'leaves', k: 18, c: 4, drag: 1.5, mu: 2, solid: false },
  cloud: { name: 'cloud', k: 14, c: 2.6, drag: 0.25, mu: 0.4, solid: false, idle: true }, // only catches the idle
  metal: { name: 'metal', k: 240, c: 16, drag: 20, mu: 0.3, bounce: 0.7, solid: true }, // other people's aircraft
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _qb = new THREE.Quaternion()

// Signed-distance colliders (negative inside). sdf(p, n) writes the outward normal into n.
class Shape {
  constructor(mat) { this.mat = mat; this.c = new THREE.Vector3(); this.bound = 0 }
  shift(dx, dz) { this.c.x -= dx; this.c.z -= dz }
}

export class Sphere extends Shape {
  constructor(c, r, mat) { super(mat); this.c.copy(c); this.r = r; this.bound = r }
  sdf(p, n) {
    n.subVectors(p, this.c)
    const d = n.length()
    if (d > 1e-6) n.divideScalar(d); else n.set(0, 1, 0)
    return d - this.r
  }
}

export class Ellipsoid extends Shape {
  constructor(c, rx, ry, rz, mat) { super(mat); this.c.copy(c); this.rad = new THREE.Vector3(rx, ry, rz); this.bound = Math.max(rx, ry, rz) }
  sdf(p, n) {
    const R = this.rad
    const x = (p.x - this.c.x) / R.x, y = (p.y - this.c.y) / R.y, z = (p.z - this.c.z) / R.z
    const k = Math.sqrt(x * x + y * y + z * z)
    n.set(x / R.x, y / R.y, z / R.z)
    if (n.lengthSq() > 1e-12) n.normalize(); else n.set(0, 1, 0)
    return (k - 1) * Math.min(R.x, R.y, R.z)
  }
}

// upright cylinder standing on c, height h
export class Cylinder extends Shape {
  constructor(c, r, h, mat) { super(mat); this.c.copy(c); this.r = r; this.h = h; this.bound = Math.hypot(r, h) }
  sdf(p, n) {
    const dx = p.x - this.c.x, dz = p.z - this.c.z, rr = Math.hypot(dx, dz)
    const side = rr - this.r, top = p.y - (this.c.y + this.h), bottom = this.c.y - p.y
    if (side > top && side > bottom) { if (rr > 1e-6) n.set(dx / rr, 0, dz / rr); else n.set(1, 0, 0); return side }
    if (top > bottom) { n.set(0, 1, 0); return top }
    n.set(0, -1, 0)
    return bottom
  }
}

// box centred on c, half extents e, turned by yaw about the vertical
export class Box extends Shape {
  constructor(c, ex, ey, ez, yaw, mat) {
    super(mat); this.c.copy(c); this.e = new THREE.Vector3(ex, ey, ez); this.yaw = yaw
    this.cs = Math.cos(yaw); this.sn = Math.sin(yaw); this.bound = Math.hypot(ex, ey, ez)
  }
  sdf(p, n) {
    const dx = p.x - this.c.x, dy = p.y - this.c.y, dz = p.z - this.c.z
    const lx = dx * this.cs - dz * this.sn, lz = dx * this.sn + dz * this.cs
    const qx = Math.abs(lx) - this.e.x, qy = Math.abs(dy) - this.e.y, qz = Math.abs(lz) - this.e.z
    let ax = 0, ay = 0, az = 0, d
    if (qx > qy && qx > qz) { ax = Math.sign(lx); d = qx } else if (qy > qz) { ay = Math.sign(dy); d = qy } else { az = Math.sign(lz); d = qz }
    if (qx > 0 || qy > 0 || qz > 0) d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
    // back to world: inverse of the yaw
    n.set(ax * this.cs + az * this.sn, ay, -ax * this.sn + az * this.cs)
    return d
  }
}

// a ring: solid rim, open middle. axis is the direction you fly through it
export class Torus extends Shape {
  constructor(c, axis, R, r, mat) {
    super(mat); this.c.copy(c); this.axis = axis.clone().normalize(); this.R = R; this.r = r; this.bound = R + r
    this.q = new THREE.Quaternion().setFromUnitVectors(this.axis, new THREE.Vector3(0, 1, 0))
    this.qi = this.q.clone().invert()
  }
  sdf(p, n) {
    const l = _p.subVectors(p, this.c).applyQuaternion(this.q)
    const rr = Math.hypot(l.x, l.z)
    const qx = rr - this.R, qy = l.y
    const d = Math.hypot(qx, qy)
    const ux = rr > 1e-6 ? l.x / rr : 1, uz = rr > 1e-6 ? l.z / rr : 0
    if (d > 1e-6) n.set(ux * qx / d, qy / d, uz * qx / d); else n.set(0, 1, 0)
    n.applyQuaternion(_q.copy(this.qi))
    return d - this.r
  }
}

// an ellipsoid that flies about: centre c, turned by q, moving at vel. owner is whoever it belongs to
export class Body extends Shape {
  constructor(rx, ry, rz, mat, owner) {
    super(mat); this.rad = new THREE.Vector3(rx, ry, rz); this.bound = Math.max(rx, ry, rz)
    this.q = new THREE.Quaternion(); this.vel = new THREE.Vector3(); this.owner = owner
  }
  sdf(p, n) {
    const R = this.rad
    const l = _p.subVectors(p, this.c).applyQuaternion(_qb.copy(this.q).invert())
    const x = l.x / R.x, y = l.y / R.y, z = l.z / R.z
    const k = Math.sqrt(x * x + y * y + z * z)
    n.set(x / R.x, y / R.y, z / R.z)
    if (n.lengthSq() > 1e-12) n.normalize(); else n.set(0, 1, 0)
    n.applyQuaternion(this.q)
    return (k - 1) * Math.min(R.x, R.y, R.z)
  }
}
