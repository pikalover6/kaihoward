import * as THREE from 'three'
import { FORWARD, UP, RIGHT, SPAWN_POS, SPAWN_HEADING, LID_Y } from './constants.js'
import { MAT } from './shapes.js'

/*
  Toon aeronautics, second edition
  ================================
  The plane is a cartoon, not an aircraft. It obeys a handful of laws, and
  everything it does (banked turns, stalls, drifting, flying backwards, falling
  tail first) falls out of them. Nothing is scripted for a particular trick.

  1. INERTIA IS SACRED. Momentum is a vector that has nothing to do with where the
     nose points. Nothing in the sky ever slows you down, and turning the plane
     around doesn't turn your path around.

  2. THE AIR PUSHES SIDEWAYS, NEVER BACK. The wings and the tail fin are flat
     plates. The air pushes on them in proportion to how far they're tilted into
     it, but only ever across your path, never against it: it can bend your path,
     it can't slow you down. It can only push so hard, so the faster you go the
     less it can bend you, and at a zillion mph it can't bend you at all. A flat
     plate doesn't care which edge leads, so a plane flies backwards as well as
     forwards.

  3. THE PROP PUSHES WHERE YOU POINT. Boost shoves you along the nose, brake
     shoves you the other way. The shove is in proportion to how fast you're
     already going and grows the longer you hold it, so there's no top speed, and
     getting back down from a zillion mph takes as long as getting there.

  4. PLANES LIKE TO FACE THEIR PATH. The tail swings the nose into the wind,
     forwards or backwards, whichever is nearer. Gently: the pilot can always
     out-muscle it.

  5. GRAVITY HAS TO BE NOTICED. Something that comes to a dead stop in midair
     stays put for a beat, until it has had a look down.

  6. EVERYTHING IS RUBBER. Solid things bounce you like a ball, and spin you if
     they hit you off-centre. Hard hits daze the pilot, and a hit harder than the
     rubber can take splats you flat (which is also the only way to lose a zillion
     mph in a hurry). Some things are rubberier than others.

  7. SOFT THINGS PUSH BACK. Water holds up everything and is sticky. Clouds only
     hold up the idle: anything boosting goes straight through.

  8. THE SKY HAS A LID. See 6.

  9. THE SCENERY HAS A TOP SPEED. Like the looping background in a cartoon chase,
     the world only scrolls past so fast. Momentum is still real (the speedometer
     knows you're doing a zillion mph), but past the scenery's top speed you only
     get as far as the background can keep up with, and the background is just a
     painting going by: you ride up and over its hills, and you go straight
     through anything standing on it, leaving a hole the shape of a plane. Dive
     into it hard enough, though, and it'll still splat you.
*/

export const G = 28 // u/s² (a unit is about a metre; cartoons fall fast)
export const MACH = 343
export const LIGHT = 299792458

export const TOON = {
  // 2 · the air
  wing: 0.15, fin: 0.08, liftCap: 140,
  // 3 · the prop
  boost: 0.7, boostGrow: 0.25, floor: 40,
  // 4 · weathervane
  vane: 5, vaneSpeed: 40, aeroDamp: 4,
  // 5 · awareness
  hangBeat: 1.25, realize: 0.12, still: 6,
  // 6 · rubber
  scrub: 0.45, spinKick: 0.5, rebound: 2.6, impact: 8,
  splat: 600, splatTime: 0.85, unsplat: 150,
  dazePerHit: 1 / 220, dazeFrom: 30, dazeMax: 1.8,
  inertia: new THREE.Vector3(5, 7, 4), // pitch, yaw, roll
  // 9 · scenery
  scenery: 1500,
  // the pilot's hands
  pitchRate: 2.0, turnRate: 1.5, rollRate: 3.2, turnBank: 0.9, alpha: 16,
  rollTrim: 2.2, pitchTrim: 3, trimRate: 0.8, barrelRate: 9,
}

// points on the hull that can touch things (plane frame: x right, y up, nose at -z)
const HULL = [
  [0, 0, -3.1], [0, 0.7, -2.5], [0, -0.7, -2.5], // spinner, cowl
  [3.8, 0.25, -0.6], [-3.8, 0.25, -0.6], // wingtips
  [1.0, -1.45, -1.0], [-1.0, -1.45, -1.0], [0, -0.95, 0.2], // wheels, belly
  [0, 1.5, 0.4], [0, 1.65, 2.7], // pilot's head, fin
  [1.5, 0.25, 2.6], [-1.5, 0.25, 2.6], [0, -0.55, 2.7], [0, 0.15, 2.85], // tailplane, tail wheel, tail
].map(p => new THREE.Vector3(...p))

const clamp = THREE.MathUtils.clamp
const DOWN = new THREE.Vector3(0, -1, 0)

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _a = new THREE.Vector3()
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _axis = new THREE.Vector3()
const _acc = new THREE.Vector3(), _tq = new THREE.Vector3(), _tgt = new THREE.Vector3(), _w = new THREE.Vector3()
const _ww = new THREE.Vector3(), _vb = new THREE.Vector3(), _L = new THREE.Vector3(), _F = new THREE.Vector3()
const _vh = new THREE.Vector3(), _vt = new THREE.Vector3(), _tmp = new THREE.Vector3(), _gn = new THREE.Vector3()
const _rp = new THREE.Vector3(), _p = new THREE.Vector3(), _vp = new THREE.Vector3(), _n = new THREE.Vector3(), _J = new THREE.Vector3()

// contacts found this substep
const MAXC = 64
const contacts = Array.from({ length: MAXC }, () => ({ r: new THREE.Vector3(), p: new THREE.Vector3(), n: new THREE.Vector3(), d: 0, mat: null }))
const found = { n: 0, deepest: 0, deepN: null }
function addContact(r, P, d, n, mat) {
  if (d <= 0 || found.n >= MAXC) return
  const c = contacts[found.n++]
  c.r.copy(r); c.p.copy(P); c.n.copy(n); c.d = d; c.mat = mat
  if (mat.solid && d > found.deepest) { found.deepest = d; found.deepN = c.n }
}

export class Flight {
  constructor() {
    this.pos = new THREE.Vector3()
    this.vel = new THREE.Vector3()
    this.quat = new THREE.Quaternion()
    this.omega = new THREE.Vector3() // body-frame spin: x pitch (nose up), y yaw (nose left), z roll (left wing down)
    this.in = { pitch: 0, turn: 0, roll: 0 }
    this.jiggle = { x: 0, v: 0, axis: new THREE.Vector3(0, 1, 0) } // the rubber, wobbling (visual)
    this.events = []
    this.near = []
    this.locked = false
    this.respawn()
  }

  respawn() {
    this.pos.copy(SPAWN_POS)
    this.quat.setFromAxisAngle(UP, SPAWN_HEADING)
    this.vel.copy(FORWARD).applyQuaternion(this.quat).multiplyScalar(62)
    this.omega.set(0, 0, 0)
    this.in.pitch = this.in.turn = this.in.roll = 0
    this.throttle = 0; this.held = 0; this.push = 0
    this.barrel = 0; this.trim = 0
    this.aware = 1; this.oblivious = 0; this.hanging = false; this.stillLatch = false
    this.daze = 0; this.splat = null; this.hitCool = 0
    this.airTime = 1; this.touching = null; this.liftForce = 0
    this.jiggle.x = 0; this.jiggle.v = 0
    this.speed = this.vel.length()
    this.pitchRate = this.rollRate = this.turnRate = this.gLoad = 0
    this.locked = false
  }

  get airborne() { return this.airTime > 0.3 }
  get boosting() { return this.throttle > 0 && this.daze <= 0 }

  forward(out = new THREE.Vector3()) { return out.copy(FORWARD).applyQuaternion(this.quat) }
  up(out = new THREE.Vector3()) { return out.copy(UP).applyQuaternion(this.quat) }
  right(out = new THREE.Vector3()) { return out.copy(RIGHT).applyQuaternion(this.quat) }

  // law 9: how fast the plane actually gets anywhere (heading kept; horizontal and vertical capped separately)
  apparent(out = new THREE.Vector3()) {
    const cap = TOON.scenery, v = this.vel
    const hs = Math.hypot(v.x, v.z), k = hs > cap ? cap / hs : 1
    return out.set(v.x * k, clamp(v.y, -cap, cap), v.z * k)
  }

  emit(type, data) { this.events.push({ type, ...data }) }

  // a quick full roll; the physics doesn't care, the pilot does it with the stick
  barrelRoll(dir) {
    if (this.barrel || this.daze > 0 || this.splat) return
    this.barrel = dir * Math.PI * 2
    this.emit('barrel', { dir })
  }

  // law 5: a dead stop in midair. Nothing happens for a moment.
  hang() {
    this.vel.set(0, 0, 0)
    this.oblivious = TOON.hangBeat
    this.aware = 0
    this.hanging = true
    this.stillLatch = true
    this.emit('hang')
  }

  step(dt, input, world) {
    if (!this.locked) {
      const sm = 1 - Math.exp(-dt * 12)
      this.in.pitch += (input.pitch - this.in.pitch) * sm
      this.in.turn += (input.turn - this.in.turn) * sm
      this.in.roll += (input.roll - this.in.roll) * sm
      const t = Math.sign(input.throttle)
      if (t !== this.throttle) { this.held = 0; this.throttle = t } else if (t) this.held += dt
    } else {
      this.in.pitch = this.in.turn = this.in.roll = 0
      this.throttle = 0; this.held = 0
    }

    const n = Math.min(16, Math.max(1, Math.ceil(dt * 240)))
    const h = dt / n
    let lift = 0
    for (let i = 0; i < n; i++) { this.substep(h, world); lift += this.liftForce }

    this.speed = this.vel.length()
    this.pitchRate = this.omega.x
    this.rollRate = -this.omega.z
    this.turnRate = _ww.copy(this.omega).applyQuaternion(this.quat).y
    this.gLoad = lift / n / G
    if (this.airTime > 0.3) this.touching = null
  }

  substep(h, world) {
    const T = TOON
    if (this.hitCool > 0) this.hitCool -= h
    if (this.splat) {
      this.splat.t -= h
      if (this.splat.t > 0) return
      this.unsplat()
    }
    if (this.daze > 0) this.daze = Math.max(0, this.daze - h)

    // law 5: awareness
    if (this.oblivious > 0) {
      this.oblivious -= h
      this.aware = 0
      if (this.oblivious <= 0) { this.oblivious = 0; this.hanging = false; this.emit('realize') }
    } else this.aware = Math.min(1, this.aware + h / T.realize)
    const sp = this.vel.length()
    if (sp > T.still * 4) this.stillLatch = false
    if (!this.throttle && this.airTime > 1 && !this.oblivious && this.aware >= 1 && !this.stillLatch && sp < T.still) this.hang()

    this.control(h)
    this.aero(h)

    // forces: gravity and the prop change your speed; the air only bends it
    const g = G * this.aware
    const acc = _acc.set(0, -g, 0)
    this.thrust(acc)
    this.vel.addScaledVector(acc, h)
    this.lift(h)

    this.pos.addScaledVector(this.apparent(_tmp), h)
    const step = _tmp.length() * h
    const w = this.omega.length()
    if (w > 1e-9) {
      _q.setFromAxisAngle(_axis.copy(this.omega).divideScalar(w), w * h)
      this.quat.multiply(_q).normalize()
    }

    this.touch(world, h, 8 + step)

    const J = this.jiggle
    J.v += (-260 * J.x - 7 * J.v) * h
    J.x = clamp(J.x + J.v * h, -0.6, 0.6)
    this.airTime += h
  }

  // law 3
  thrust(acc) {
    const T = TOON
    this.push = 0
    if (!this.throttle || this.daze > 0) return
    // hands off the stick near level (or straight up), the prop pushes exactly level (or up);
    // otherwise at a zillion mph a millionth of a degree of pitch is a thousand mph of climb
    let f = this.forward(_f)
    if (Math.abs(this.in.pitch) < 0.05) {
      if (Math.abs(f.y) < 0.05) f = _a.set(f.x, 0, f.z).normalize()
      else if (f.y > 0.9986) f = _a.set(0, 1, 0)
    }
    const k = T.boost + T.boostGrow * this.held
    this.push = this.throttle * k * Math.max(this.vel.length(), T.floor)
    acc.addScaledVector(f, this.push)
  }

  // law 2: flat plates, pushed square-on, with the part that would slow you thrown away
  lift(h) {
    const T = TOON, v = this.vel
    const sp = v.length()
    this.liftForce = 0
    if (sp < 1e-3) return
    _vh.copy(v).divideScalar(sp)
    _L.set(0, 0, 0)
    for (let i = 0; i < 2; i++) {
      const n = i === 0 ? this.up(_u) : this.right(_r)
      const C = i === 0 ? T.wing : T.fin
      _F.copy(n).multiplyScalar(-C * v.dot(n) * sp)
      _F.addScaledVector(_vh, -_F.dot(_vh))
      _L.add(_F)
    }
    const m = _L.length()
    if (m > T.liftCap) _L.multiplyScalar(T.liftCap / m)
    this.liftForce = Math.min(m, T.liftCap)
    // bend the path without changing the speed
    v.addScaledVector(_L, h).setLength(sp)
  }

  // law 4: the tail swings the nose into the wind (or tail into it), and moving air damps spin
  aero(h) {
    const T = TOON, v = this.vel
    const sp = v.length()
    if (sp < 0.5) return
    const q = Math.min(1, (sp * sp) / (T.vaneSpeed * T.vaneSpeed))
    const vb = _vb.copy(v).applyQuaternion(_qi.copy(this.quat).invert())
    const s = 1 / (sp * sp)
    const w = this.omega
    // sin 2α: zero nose-first and tail-first, so both are stable. The trim tab moves the zero so the
    // nose rides a little above the path, whichever way up the plane is
    if (!this.splat) {
      const u = this.up(_u), r = this.right(_r)
      const phi = Math.atan2(-r.y, u.y)
      const ap = Math.atan2(-vb.y, -vb.z), ay = Math.atan2(vb.x, -vb.z)
      w.x -= T.vane * Math.sin(2 * (ap - this.trim * Math.cos(phi))) * (vb.y * vb.y + vb.z * vb.z) * s * q * h
      w.y -= T.vane * Math.sin(2 * (ay - this.trim * Math.sin(phi))) * (vb.x * vb.x + vb.z * vb.z) * s * q * h
    }
    const d = Math.exp(-T.aeroDamp * q * h)
    w.x *= d; w.y *= d
    w.z *= Math.exp(-T.aeroDamp * 0.4 * q * h)
  }

  // the pilot: stick inputs are spin rates; hands off, the pilot settles the plane and lets the air do the rest
  control(h) {
    const T = TOON, inp = this.in, w = this.omega
    if (this.daze > 0 || this.splat) return
    const s = T.alpha * h
    const f = this.forward(_f), u = this.up(_u), r = this.right(_r)
    const horiz = 1 - f.y * f.y
    const inv = u.y < 0 ? -1 : 1

    // turning swings the nose round the vertical (or what passes for it); the pitch stick sets the
    // pitch rate. Hands off, the pilot lets go and the air does the rest (law 4)
    const turn = inp.turn, kt = Math.abs(turn), kp = Math.abs(inp.pitch)
    _w.set(0, 0, 0)
    if (kt > 0.01) {
      const vert = THREE.MathUtils.smoothstep(Math.abs(u.y), 0.1, 0.35) // on a wingtip, "the vertical" is the plane's own up
      _axis.copy(UP).multiplyScalar(inv * vert).addScaledVector(u, 1 - vert).normalize()
      _w.copy(_axis).multiplyScalar(-turn * T.turnRate).applyQuaternion(_qi.copy(this.quat).invert())
    }
    const kx = Math.max(kp, kt)
    w.x += clamp(_w.x + inp.pitch * T.pitchRate - w.x, -s, s) * kx
    w.y += clamp(_w.y - w.y, -s, s) * kt
    // hands off, the pilot keeps the path level by easing the trim tab (which moves where the tail
    // settles the nose, law 4) and a light hand on the stick; flying backwards it all works the other way
    // round. Point the nose near straight up and it goes up like a rocket
    const theta = Math.asin(clamp(f.y, -1, 1))
    const phi = Math.atan2(-r.y, u.y) // bank, right wing down = +
    const sp = this.vel.length()
    let err
    if (theta > 1.08) err = Math.PI / 2 - theta
    else {
      const along = Math.sign(sp > 1 ? this.vel.dot(f) : 1) || 1
      const gamma = sp > 1 ? Math.asin(clamp(this.vel.y / sp, -1, 1)) : 0
      const fast = THREE.MathUtils.smoothstep(sp, 15, 40)
      err = -gamma * along * fast - theta * (1 - fast)
      // the tab only fine-tunes level flight; in a big climb or dive it stays put (no winding up)
      if (kp < 0.05) this.trim = clamp(this.trim + err * T.trimRate * fast * h * (1 - THREE.MathUtils.smoothstep(Math.abs(gamma), 0.06, 0.15)), -0.35, 0.35)
    }
    // the hand on the stick works about the true horizontal, so it's the same upright, inverted or on a wingtip
    if (_axis.crossVectors(f, UP).lengthSq() > 1e-6) {
      _axis.normalize().multiplyScalar(clamp(err * T.pitchTrim, -T.pitchTrim, T.pitchTrim) * (1 - kp) * h)
      _axis.applyQuaternion(_qi.copy(this.quat).invert())
      w.x += _axis.x; w.y += _axis.y
    }
    // at speed the pilot holds a near-level (or near-vertical) nose exactly there: at a zillion mph the
    // air bends your path toward wherever the nose points, and a millionth of a degree is a dive
    const lock = THREE.MathUtils.smoothstep(sp, 250, 600) * (1 - kp) * (1 - kt)
    if (lock > 0) {
      let corr = 0
      if (Math.abs(f.y) < 0.05) corr = -Math.asin(f.y)
      else if (f.y > 0.9986) corr = Math.acos(clamp(f.y, -1, 1))
      if (corr && _axis.crossVectors(f, UP).lengthSq() > 1e-12) {
        _q.setFromAxisAngle(_axis.normalize(), corr * Math.min(1, 20 * lock * h))
        this.quat.premultiply(_q).normalize()
        w.x *= 1 - lock
        this.trim *= 1 - Math.min(1, lock * 4 * h)
      }
    }

    // roll: a barrel roll if one is under way, else the roll keys, else bank into the turn and settle
    // into whichever of upright, on a wingtip or upside down is nearest
    let rollRate
    if (this.barrel) {
      const step = Math.sign(this.barrel) * Math.min(Math.abs(this.barrel), T.barrelRate * h)
      this.barrel -= step
      if (Math.abs(this.barrel) < 1e-4) this.barrel = 0
      w.z = -step / h
      return
    }
    if (Math.abs(inp.roll) > 0.05) rollRate = inp.roll * T.rollRate
    else {
      const a = Math.abs(phi)
      let base = a < 0.96 ? 0 : a < 2.18 ? Math.sign(phi) * Math.PI / 2 : Math.sign(phi) * Math.PI
      if (Math.abs(turn) > 0.05) base = a < Math.PI / 2 ? 0 : Math.sign(phi) * Math.PI // turning: upright or upside down
      const target = Math.abs(base) === Math.PI / 2 ? base : base + turn * T.turnBank
      const err = ((target - phi + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
      rollRate = clamp(err * 3, -T.rollTrim, T.rollTrim) * horiz
    }
    w.z += clamp(-rollRate - w.z, -s, s)
  }

  // laws 6–8: everything the hull is touching
  touch(world, h, reach) {
    const T = TOON, pos = this.pos
    // law 9: faster than the scenery, it's only a painting. Ride over it unless you dive into it
    const painted = this.vel.length() > T.scenery && this.vel.y > -T.scenery
    if (painted) return this.skim(world)
    const gy = world.ground(pos.x, pos.z)
    const nearGround = pos.y - gy < reach
    const wy = world.waterY
    const nearWater = pos.y - wy < reach && gy < wy + reach
    const nearLid = LID_Y - pos.y < reach
    const near = world.near ? world.near(pos, reach + 6, this.near) : 0
    if (!nearGround && !nearWater && !nearLid && !near) return
    if (nearGround) world.groundNormal(pos.x, pos.z, _gn)
    const idle = !this.boosting
    _ww.copy(this.omega).applyQuaternion(this.quat)
    found.n = 0; found.deepest = 0; found.deepN = null
    for (const pb of HULL) {
      const r = _rp.copy(pb).applyQuaternion(this.quat)
      const P = _p.copy(pos).add(r)
      let ground = -Infinity
      if (nearGround || nearWater) ground = world.ground(P.x, P.z)
      if (nearGround) addContact(r, P, ground - P.y, _gn, MAT.ground)
      if (nearWater && ground < wy) addContact(r, P, wy - P.y, UP, MAT.water)
      if (nearLid) addContact(r, P, P.y - LID_Y, DOWN, MAT.sky)
      for (let i = 0; i < near; i++) {
        const s = this.near[i]
        if (s.mat.idle && !idle) continue
        const d = -s.sdf(P, _n)
        if (d > 0) addContact(r, P, d, _n, s.mat)
      }
    }
    const nc = found.n
    if (!nc) return
    // never get buried
    const deepest = found.deepest
    if (deepest > 0.4) {
      pos.addScaledVector(found.deepN, deepest - 0.25)
      for (let i = 0; i < nc; i++) if (contacts[i].mat.solid) contacts[i].d = Math.max(0, contacts[i].d - (deepest - 0.25))
    }
    this.impact(nc)
    if (this.splat) return
    // springs: soft things, and solid things you're resting on
    const acc = _acc.set(0, 0, 0), torque = _tq.set(0, 0, 0)
    for (let i = 0; i < nc; i++) {
      const c = contacts[i]
      const vp = _vp.crossVectors(_ww, c.r).add(this.vel)
      const vn = vp.dot(c.n)
      const S = c.mat
      const fn = Math.max(0, S.k * c.d - S.c * vn)
      _F.copy(c.n).multiplyScalar(fn)
      _vt.copy(vp).addScaledVector(c.n, -vn)
      const vt = _vt.length()
      if (vt > 1e-6) _F.addScaledVector(_vt, -Math.min(S.drag * vt, S.mu * fn) / vt)
      acc.add(_F)
      torque.add(_tmp.crossVectors(c.r, _F))
      if (this.touching !== S.name && this.airTime > 0.3) this.emit('touch', { surface: S.name, pos: c.p.clone(), speed: -vn })
      this.airTime = 0
      this.touching = S.name
    }
    this.vel.addScaledVector(acc, h)
    _w.copy(torque).applyQuaternion(_qi.copy(this.quat).invert())
    this.omega.x += _w.x / T.inertia.x * h
    this.omega.y += _w.y / T.inertia.y * h
    this.omega.z += _w.z / T.inertia.z * h
  }

  skim(world) {
    const pos = this.pos
    const floor = Math.max(world.ground(pos.x, pos.z), world.waterY) + 7
    if (pos.y < floor) {
      pos.y = floor
      if (this.vel.y < 0) this.vel.y = 0
    }
    const n = world.near ? world.near(pos, 4, this.near) : 0
    for (let i = 0; i < n; i++) {
      const s = this.near[i]
      if (s.mat.solid && !s.holed && s.sdf(pos, _n) < 0) {
        s.holed = true
        this.emit('perforate', { pos: pos.clone(), surface: s.mat.name })
      }
    }
    if (pos.y > LID_Y - 6) { pos.y = LID_Y - 6; if (this.vel.y > 0) this.vel.y = 0 }
  }

  // law 6: the hardest-hitting solid contact bounces the plane like a ball and spins it like a stick
  impact(nc) {
    const T = TOON
    let worst = null, wvn = -T.impact
    for (let i = 0; i < nc; i++) {
      const c = contacts[i]
      if (!c.mat.solid) continue
      const vn = _vp.crossVectors(_ww, c.r).add(this.vel).dot(c.n)
      if (vn < wvn) { wvn = vn; worst = c }
    }
    if (!worst || this.hitCool > 0) return
    const speed = -wvn, n = worst.n, mat = worst.mat
    if (speed > T.splat) return this.doSplat(worst, speed)

    const vnCom = this.vel.dot(n)
    const J = _J.set(0, 0, 0)
    if (vnCom < 0) {
      // rubberier things give back more; nothing gives back more than a few hundred
      const out = Math.min(-vnCom * mat.bounce, Math.max(-vnCom, 400))
      const dv = out - vnCom
      this.vel.addScaledVector(n, dv)
      J.addScaledVector(n, dv)
    }
    _vt.copy(this.vel).addScaledVector(n, -this.vel.dot(n))
    const vt = _vt.length()
    if (vt > 1e-6) {
      const scrub = Math.min(vt, T.scrub * mat.mu * speed)
      this.vel.addScaledVector(_vt, -scrub / vt)
      J.addScaledVector(_vt, -scrub / vt)
    }
    // spin from where it was hit
    _w.crossVectors(worst.r, J).applyQuaternion(_qi.copy(this.quat).invert())
    this.omega.x += _w.x / T.inertia.x * T.spinKick
    this.omega.y += _w.y / T.inertia.y * T.spinKick
    this.omega.z += _w.z / T.inertia.z * T.spinKick
    // something that flew into a wall nose first comes off it nose first
    const f = this.forward(_f)
    const into = -f.dot(n)
    if (into > 0.3 && this.vel.lengthSq() > 1) {
      _tmp.copy(this.vel).normalize()
      const ang = Math.acos(clamp(f.dot(_tmp), -1, 1))
      _axis.crossVectors(f, _tmp)
      if (_axis.lengthSq() < 1e-6) this.right(_axis)
      _axis.normalize().applyQuaternion(_qi.copy(this.quat).invert())
      this.omega.addScaledVector(_axis, ang * T.rebound * Math.min(1, (into - 0.3) * 2))
    }
    const daze = clamp((speed - T.dazeFrom) * T.dazePerHit, 0, 1) * T.dazeMax * (mat.bounce > 1 ? 0.3 : 1)
    if (daze > this.daze) this.daze = daze
    if (daze > 0) this.barrel = 0
    this.hitCool = 0.08
    this.jiggle.axis.copy(n)
    this.jiggle.v = -Math.min(speed, 260) * 0.03
    this.emit('bounce', { pos: worst.p.clone(), n: n.clone(), speed, surface: mat.name, daze })
  }

  doSplat(c, speed) {
    const T = TOON
    this.splat = { t: T.splatTime, n: c.n.clone(), speed, surface: c.mat.name }
    this.pos.addScaledVector(c.n, c.d)
    this.vel.set(0, 0, 0)
    this.omega.set(0, 0, 0)
    this.daze = T.splatTime + 1.2
    this.barrel = 0
    this.held = 0
    this.jiggle.axis.copy(c.n)
    this.jiggle.x = -0.6; this.jiggle.v = 0
    this.emit('splat', { pos: c.p.clone(), n: c.n.clone(), speed, surface: c.mat.name })
  }

  unsplat() {
    const T = TOON, s = this.splat
    this.splat = null
    this.vel.copy(s.n).multiplyScalar(Math.min(0.62 * s.speed, T.unsplat))
    this.omega.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 9)
    this.jiggle.v = 6
    this.hitCool = 0.3
    this.emit('unsplat', { n: s.n.clone() })
  }
}
