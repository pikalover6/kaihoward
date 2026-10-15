import * as THREE from 'three'
import { FORWARD, UP, RIGHT, SPAWN_POS, SPAWN_HEADING, LID_Y, CLOUD_Y } from './constants.js'

/*
  Toon aeronautics
  ================
  The plane is not an aircraft, it's a cartoon. There's no aerodynamics in here;
  it obeys a handful of laws instead, and everything it does falls out of them.

  1. INERTIA IS SACRED. The plane carries a momentum vector that has nothing to do
     with where it's pointing. There is no drag, and nothing ever swings the nose
     into the wind, so a plane will happily coast backwards, sideways or upside
     down forever. Spin is momentum too.

  2. THE ENGINE IS INTENTION. While it runs, the plane wants to travel where its
     nose points at the speed on the dial. The prop pushes along the nose and the
     wings grip the air across it, and their authority scales with the speeds
     involved, so the engine feels the same at 60 mph as at a zillion. It cancels
     gravity too, because it doesn't believe in it. Cut it and the plane has no
     opinions left: it's a brick with momentum.

  3. THE DIAL HAS NO TOP. Holding the throttle multiplies the target speed, faster
     the longer you hold it. It stops at zero (hover) on the way down, and below
     zero is reverse.

  4. GRAVITY HAS TO BE NOTICED. Gravity only pulls as hard as the plane is aware of
     it. Awareness drops to zero when the situation changes suddenly (the engine
     dies, or the plane comes to a dead stop in midair) and comes back after a
     beat, once the pilot has had a look down.

  5. EVERYTHING IS RUBBER. The ground and the sky are solid and the plane bounces
     off them like a ball. Off-centre hits set it spinning, hard hits daze the
     pilot (a dazed pilot has no intention, see 2), and a hit harder than the
     rubber can store splats it flat for a moment.

  6. CLOUDS HOLD UP THE IDLE. A cloud catches anything that isn't trying to get
     through it, softly, like a pillow. A plane with its engine running goes
     straight through, and so does one falling too fast for the fluff.

  7. THE SKY HAS A LID. See 5.

  8. THE SCENERY HAS A TOP SPEED. Like the looping background in a cartoon chase,
     the world can only scroll past so fast. Momentum is still real (the dial, the
     impacts and the speedometer all know you're doing a zillion mph), but past
     the scenery's top speed the plane only gets as far as the background can
     keep up with.
*/

export const G = 28                 // gravity, u/s² (a unit is about a metre; cartoons fall fast)
export const MACH = 343
export const LIGHT = 299792458

export const TOON = {
  // 2 · intention
  floor: 90,          // the engine never has less authority than it has at this speed
  thrust: 0.42,       // forward push authority, as a fraction of the speed scale, per second
  reverse: 2.6,       // backward push (brakes, reverse): props pull hard the other way
  gainUp: 1.1,        // how eagerly the engine chases a higher speed…
  gainDown: 2.6,      // …and sheds an excess one
  grip: 3.2,          // sideways grip authority, as a fraction of the dial speed, per second
  gripRate: 10,       // how quickly the grip cancels sideways motion, 1/s
  spool: 0.55,        // seconds for the engine to catch after starting, or after a daze
  // 3 · the dial
  cruise: 62,         // dial speed with the lever at 1
  leverMin: -1.4, leverMax: 46,
  leverRate: 0.45, leverAccel: 0.42, // the lever moves faster the longer you hold it
  // 4 · awareness
  cutBeat: 0.7,       // how long a plane carries on after its engine dies, before noticing
  hangBeat: 1.25,     // how long a dead stop in midair lasts
  realize: 0.12,      // how quickly gravity comes back once noticed
  still: 6,           // what counts as a dead stop, u/s
  // 5 · rubber
  bounce: 0.62,       // restitution
  scrub: 0.45,        // sliding speed lost per unit of impact speed
  spinKick: 0.5,      // how much of an off-centre hit becomes spin
  rebound: 2.6,       // how hard a nose-first hit flips the nose back out, 1/s
  impact: 8,          // approach speed at which a touch becomes a hit
  splat: 600,         // approach speed beyond which the rubber gives up
  splatTime: 0.85,
  unsplat: 150,       // the most a splat can give back
  dazePerHit: 1 / 220, dazeFrom: 30, dazeMax: 1.8,
  inertia: new THREE.Vector3(5, 7, 4), // pitch, yaw, roll
  // 6 · clouds
  fluff: 12,          // how deep into a cloud you can sink before you're through it
  // 8 · scenery
  scenery: 4000,      // u/s, horizontally and vertically
  // the pilot's hands
  pitchRate: 1.6, rollRate: 2.4, yawRate: 1.5,
  alphaOn: 14, alphaOff: 7, spinDrag: 0.3,
  rollTrim: 1.6, pitchTrim: 0.55, bankTurn: 1.25,
}

// what the hull can touch: per-contact-point spring, damper and friction
const GROUND = { name: 'ground', k: 240, c: 16, drag: 30, mu: 0.6 }
const SKY = { name: 'sky', k: 240, c: 16, drag: 30, mu: 0.6 }
const CLOUD = { name: 'cloud', k: 14, c: 2.6, drag: 0.9, mu: 2 }

// points on the hull that can touch things (plane frame: x right, y up, nose at -z)
const HULL = [
  [0, 0, -2.88], [0, 0.62, -2.3], [0, -0.62, -2.3], // spinner, cowl
  [3.45, 0.35, -0.45], [-3.45, 0.35, -0.45], // wingtips
  [0.9, -1.32, -0.85], [-0.9, -1.32, -0.85], [0, -0.85, 0.1], // wheels, belly
  [0, 1.22, 0.35], [0, 1.5, 2.3], // pilot's head, fin
  [1.35, 0.22, 2.3], [-1.35, 0.22, 2.3], [0, -0.48, 2.35], [0, 0.1, 2.42], // tailplane, tail wheel, tail
].map(p => new THREE.Vector3(...p))

const DOWN = new THREE.Vector3(0, -1, 0)
const clamp = THREE.MathUtils.clamp
const SINH1 = Math.sinh(1)
export const dialFor = lever => TOON.cruise * Math.sinh(lever) / SINH1
export const leverFor = speed => Math.asinh(speed * SINH1 / TOON.cruise)

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3()
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _axis = new THREE.Vector3()
const _acc = new THREE.Vector3(), _tq = new THREE.Vector3(), _tgt = new THREE.Vector3(), _w = new THREE.Vector3()
const _ww = new THREE.Vector3(), _rp = new THREE.Vector3(), _p = new THREE.Vector3(), _vp = new THREE.Vector3()
const _F = new THREE.Vector3(), _vt = new THREE.Vector3(), _tmp = new THREE.Vector3(), _gn = new THREE.Vector3()
const _vperp = new THREE.Vector3(), _grip = new THREE.Vector3(), _J = new THREE.Vector3(), _aim = new THREE.Vector3()
const hit = { vn: 0, n: new THREE.Vector3(), r: new THREE.Vector3(), p: new THREE.Vector3(), depth: 0, dn: new THREE.Vector3(), surface: null }

export class Flight {
  constructor() {
    this.pos = new THREE.Vector3()
    this.vel = new THREE.Vector3()
    this.quat = new THREE.Quaternion()
    this.omega = new THREE.Vector3()  // body-frame spin: x pitch (nose up), y yaw (nose left), z roll (left wing down)
    this.in = { pitch: 0, roll: 0, yaw: 0 }
    this.jiggle = { x: 0, v: 0, axis: new THREE.Vector3(0, 1, 0) } // the rubber, wobbling (visual)
    this.events = []
    this.autopilot = null   // when set, {forward(desired), speed, maxRate} flies the plane
    this.locked = false     // control taken by a scripted sequence
    this.respawn()
  }

  respawn() {
    this.pos.copy(SPAWN_POS)
    this.quat.setFromAxisAngle(UP, SPAWN_HEADING)
    this.lever = 1
    this.vel.copy(FORWARD).applyQuaternion(this.quat).multiplyScalar(this.dial)
    this.omega.set(0, 0, 0)
    this.in.pitch = this.in.roll = this.in.yaw = 0
    this.held = 0; this.heldDir = 0; this.detent = false
    this.engine = true; this.spool = 1; this.intent = 1
    this.push = 0; this.gripForce = 0
    this.aware = 1; this.oblivious = 0; this.hanging = false; this.stillLatch = false
    this.daze = 0; this.splat = null; this.hitCool = 0
    this.airTime = 1; this.touching = null
    this.jiggle.x = 0; this.jiggle.v = 0
    this.speed = this.vel.length()
    this.pitchRate = this.rollRate = this.turnRate = this.gLoad = 0
    this.autopilot = null
    this.leverBeforeAp = undefined
    this.locked = false
  }

  get dial() { return dialFor(this.lever) }
  get airborne() { return this.airTime > 0.3 }

  // law 8: how fast the plane actually gets anywhere (heading kept; horizontal and vertical capped separately)
  apparent(out = new THREE.Vector3()) {
    const cap = TOON.scenery, v = this.vel
    const hs = Math.hypot(v.x, v.z), k = hs > cap ? cap / hs : 1
    return out.set(v.x * k, clamp(v.y, -cap, cap), v.z * k)
  }

  forward(out = new THREE.Vector3()) { return out.copy(FORWARD).applyQuaternion(this.quat) }
  up(out = new THREE.Vector3()) { return out.copy(UP).applyQuaternion(this.quat) }
  right(out = new THREE.Vector3()) { return out.copy(RIGHT).applyQuaternion(this.quat) }

  emit(type, data) { this.events.push({ type, ...data }) }

  setEngine(on) {
    if (on === this.engine) return
    this.engine = on
    if (on) {
      this.spool = 0
      // the engine coming back is a change of plan, not a surprise
      if (this.oblivious > 0) { this.oblivious = 0; this.hanging = false }
      this.emit('engineOn')
    } else {
      this.emit('engineOff')
      if (!this.airborne || this.splat) return
      if (this.vel.length() < TOON.still) this.hang()
      else { this.oblivious = TOON.cutBeat; this.aware = 0; this.emit('oblivious') }
    }
  }

  // law 4: a dead stop in midair. Nothing happens for a moment.
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
      const sm = 1 - Math.exp(-dt * 10)
      this.in.pitch += (input.pitch - this.in.pitch) * sm
      this.in.roll += (input.roll - this.in.roll) * sm
      this.in.yaw += (input.yaw - this.in.yaw) * sm
      this.moveLever(dt, Math.sign(input.throttle))
    } else {
      this.in.pitch = this.in.roll = this.in.yaw = 0
    }

    if (!this.autopilot && this.leverBeforeAp !== undefined) { this.lever = this.leverBeforeAp; this.leverBeforeAp = undefined }
    const n = Math.min(16, Math.max(1, Math.ceil(dt * 240)))
    const h = dt / n
    let grip = 0
    for (let i = 0; i < n; i++) { this.substep(h, world); grip += this.gripForce }

    this.speed = this.vel.length()
    this.pitchRate = this.omega.x
    this.rollRate = -this.omega.z
    this.turnRate = _ww.copy(this.omega).applyQuaternion(this.quat).y
    this.gLoad = grip / n / G
    if (this.airTime > 0.3) this.touching = null
  }

  // law 3: the lever multiplies the dial, faster the longer it's held. It parks at zero on the way down.
  moveLever(dt, dir) {
    const T = TOON
    if (!dir) { this.held = 0; this.heldDir = 0; this.detent = false; return }
    if (dir !== this.heldDir) { this.held = 0; this.heldDir = dir }
    if (this.detent) return
    this.held += dt
    const before = this.lever
    this.lever = clamp(this.lever + dir * (T.leverRate + T.leverAccel * this.held) * dt, T.leverMin, T.leverMax)
    if (before > 0 && this.lever <= 0) { this.lever = 0; this.detent = true }
    if (before < 0 && this.lever >= 0) { this.lever = 0; this.detent = true }
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

    // the engine catches over a moment; a dazed pilot has no intention at all
    if (!this.engine || this.daze > 0) this.spool = 0
    else this.spool = Math.min(1, this.spool + h / T.spool)
    this.intent = this.spool * this.spool * (3 - 2 * this.spool)

    // law 4: awareness
    if (this.oblivious > 0) {
      this.oblivious -= h
      this.aware = 0
      if (this.oblivious <= 0) {
        this.oblivious = 0
        this.hanging = false
        if (this.intent < 0.5) this.emit('realize')
      }
    } else this.aware = Math.min(1, this.aware + h / T.realize)
    const sp = this.vel.length()
    if (sp > T.still * 4) this.stillLatch = false
    if (this.intent < 0.05 && this.airTime > 1 && !this.oblivious && this.aware >= 1 && !this.stillLatch && sp < T.still) this.hang()

    this.control(h)

    // gravity and intention, then move
    const g = G * this.aware
    const acc = _acc.set(0, -g, 0)
    this.push = 0; this.gripForce = 0
    if (this.intent > 0) this.intention(g, acc)
    this.vel.addScaledVector(acc, h)
    this.pos.addScaledVector(this.apparent(_tmp), h) // law 8
    const w = this.omega.length()
    if (w > 1e-9) {
      _q.setFromAxisAngle(_axis.copy(this.omega).divideScalar(w), w * h)
      this.quat.multiply(_q).normalize()
    }

    // then deal with whatever we ran into: hard hits first, then the soft springs that hold things up
    const reach = 7 + _tmp.length() * h
    this.impacts(world, reach)
    if (this.splat) return
    const torque = _tq.set(0, 0, 0)
    acc.set(0, 0, 0)
    this.contacts(world, acc, torque, reach)
    this.vel.addScaledVector(acc, h)
    _w.copy(torque).applyQuaternion(_qi.copy(this.quat).invert())
    this.omega.x += _w.x / T.inertia.x * h
    this.omega.y += _w.y / T.inertia.y * h
    this.omega.z += _w.z / T.inertia.z * h

    const J = this.jiggle
    J.v += (-260 * J.x - 7 * J.v) * h
    J.x = clamp(J.x + J.v * h, -0.6, 0.6)
    this.airTime += h
  }

  // law 2: steer the momentum toward (nose × dial)
  intention(g, acc) {
    const T = TOON
    // with hands off the stick, the engine aims at exactly the square attitude the nose is settling
    // into; otherwise at a zillion mph a millionth of a degree of pitch is a thousand mph of climb
    let f = this.forward(_f)
    if (!this.autopilot && Math.abs(this.in.pitch) < 0.05) {
      if (Math.abs(f.y) < 0.05) f = _aim.set(f.x, 0, f.z).normalize()
      else if (f.y > 0.9986) f = _aim.set(0, 1, 0)
    }
    const S = this.dial
    const vpar = this.vel.dot(f)
    const gpar = -g * f.y // gravity's pull along the nose, which the engine cancels
    const A = Math.max(Math.abs(S), Math.abs(vpar), T.floor)
    let push = (S - vpar) * (S > vpar ? T.gainUp : T.gainDown) - gpar
    push = clamp(push, -T.reverse * A, T.thrust * A)
    // grip: cancel sideways motion, and the sideways part of gravity
    _vperp.copy(this.vel).addScaledVector(f, -vpar)
    _grip.copy(_vperp).multiplyScalar(-T.gripRate)
    _grip.y += g; _grip.addScaledVector(f, -g * f.y)
    const maxGrip = T.grip * Math.max(Math.abs(S), T.floor)
    const gl = _grip.length()
    if (gl > maxGrip) _grip.multiplyScalar(maxGrip / gl)
    acc.addScaledVector(f, push * this.intent).addScaledVector(_grip, this.intent)
    this.push = push * this.intent
    this.gripForce = Math.min(gl, maxGrip) * this.intent
  }

  // the pilot: target spin rates from the stick, tracked with limited torque
  control(h) {
    const T = TOON, inp = this.in, w = this.omega
    const tgt = _tgt.set(inp.pitch * T.pitchRate, -inp.yaw * T.yawRate, -inp.roll * T.rollRate)
    let alpha = this.intent > 0.5 ? T.alphaOn : T.alphaOff
    if (this.autopilot) {
      this.autopilotTarget(tgt)
      alpha = 40
    } else if (this.intent > 0) {
      // an engine with intentions also has opinions about attitude
      const k = this.intent
      const f = this.forward(_f), u = this.up(_u), r = this.right(_r)
      const horiz = 1 - f.y * f.y
      const phi = Math.atan2(-r.y, u.y)           // bank, right wing down = +
      const theta = Math.asin(clamp(f.y, -1, 1))  // pitch, nose up = +
      // settle into the nearest square attitude: upright, on a wingtip or upside down…
      const a = Math.abs(phi)
      const phiT = a < 0.96 ? 0 : a < 2.18 ? Math.sign(phi) * Math.PI / 2 : Math.sign(phi) * Math.PI
      tgt.z -= clamp((phiT - phi) * 3, -T.rollTrim, T.rollTrim) * horiz * (1 - Math.abs(inp.roll)) * k
      // …level, or straight up like a rocket (dives always pull out)
      const thT = theta < 1.08 ? 0 : Math.PI / 2
      tgt.x += clamp((thT - theta) * 2, -T.pitchTrim, T.pitchTrim) * Math.cos(phi) * (1 - Math.abs(inp.pitch)) * k
      // a banked plane wants to turn toward its wing's lift; none on a wingtip, none upside down
      const turn = -T.bankTurn * 2 * Math.sin(phi) * Math.abs(Math.cos(phi)) * horiz * k
      tgt.add(_w.set(0, turn, 0).applyQuaternion(_qi.copy(this.quat).invert()))
    }
    if (this.daze > 0 && !this.autopilot) alpha = 0
    const s = alpha * h
    w.x += clamp(tgt.x - w.x, -s, s)
    w.y += clamp(tgt.y - w.y, -s, s)
    w.z += clamp(tgt.z - w.z, -s, s)
    w.multiplyScalar(1 - T.spinDrag * h)
  }

  // draw mode: steer the nose toward ap.forward, bank into the turns, set the dial
  autopilotTarget(tgt) {
    const ap = this.autopilot
    if (!this.engine) this.setEngine(true)
    if (this.leverBeforeAp === undefined) this.leverBeforeAp = this.lever
    this.lever = leverFor(ap.speed)
    const f = this.forward(_f)
    const dot = clamp(f.dot(ap.forward), -1, 1)
    const ang = Math.acos(dot)
    _w.set(0, 0, 0)
    if (ang > 1e-4) _w.crossVectors(f, ap.forward).normalize().multiplyScalar(Math.min(ang * 6, ap.maxRate))
    tgt.copy(_w.applyQuaternion(_qi.copy(this.quat).invert()))
    const u = this.up(_u), r = this.right(_r)
    const horizTurn = tgt.y * (u.y >= 0 ? 1 : -1)
    const desiredBank = clamp(-horizTurn * 0.9, -1.1, 1.1)
    const bank = Math.atan2(-r.y, Math.abs(u.y) + 1e-6) * Math.sign(u.y || 1)
    if (!ap.rollLock) tgt.z = -(desiredBank - bank) * 4
  }

  // law 5/6: springs at every hull point that's inside something
  contacts(world, acc, torque, reach) {
    const T = TOON, pos = this.pos
    const gy = world.ground(pos.x, pos.z)
    const nearGround = pos.y - gy < reach
    const nearLid = LID_Y - pos.y < reach
    // law 6: clouds only catch the idle, and only from above
    let deck = -Infinity
    if (this.intent < 0.5 && pos.y > CLOUD_Y - 45 && pos.y < CLOUD_Y + 80) deck = world.deck(pos.x, pos.z)
    const nearDeck = pos.y - deck < 7 && pos.y - deck > -T.fluff
    if (!nearGround && !nearLid && !nearDeck) return
    if (nearGround) world.groundNormal(pos.x, pos.z, _gn)
    _ww.copy(this.omega).applyQuaternion(this.quat)
    for (const pb of HULL) {
      const r = _rp.copy(pb).applyQuaternion(this.quat)
      const P = _p.copy(pos).add(r)
      const vp = _vp.crossVectors(_ww, r).add(this.vel)
      if (nearGround) { const d = world.ground(P.x, P.z) - P.y; if (d > 0) this.spring(r, vp, _gn, d, GROUND, acc, torque) }
      if (nearLid) { const d = P.y - LID_Y; if (d > 0) this.spring(r, vp, DOWN, d, SKY, acc, torque) }
      if (nearDeck) { const d = deck - P.y; if (d > 0) this.spring(r, vp, UP, d, CLOUD, acc, torque) }
    }
  }

  spring(r, vp, n, d, S, acc, torque) {
    const vn = vp.dot(n)
    const fn = Math.max(0, S.k * d - S.c * vn)
    _F.copy(n).multiplyScalar(fn)
    _vt.copy(vp).addScaledVector(n, -vn)
    const vt = _vt.length()
    if (vt > 1e-6) _F.addScaledVector(_vt, -Math.min(S.drag * vt, S.mu * fn) / vt)
    acc.add(_F)
    torque.add(_tmp.crossVectors(r, _F))
    if (S === CLOUD && this.touching !== 'cloud' && this.airTime > 0.3) this.emit('cloud', { pos: this.pos.clone(), speed: -vn })
    this.airTime = 0
    this.touching = S.name
  }

  // law 5: hits on solid things bounce the plane like a ball and spin it like a stick
  impacts(world, reach) {
    const T = TOON
    const pos = this.pos
    const nearGround = pos.y - world.ground(pos.x, pos.z) < reach
    const nearLid = LID_Y - pos.y < reach
    if (!nearGround && !nearLid) return
    if (nearGround) world.groundNormal(pos.x, pos.z, _gn)
    _ww.copy(this.omega).applyQuaternion(this.quat)
    hit.vn = 0; hit.surface = null; hit.depth = 0
    for (const pb of HULL) {
      const r = _rp.copy(pb).applyQuaternion(this.quat)
      const P = _p.copy(pos).add(r)
      const vp = _vp.crossVectors(_ww, r).add(this.vel)
      if (nearGround) this.probe(r, P, vp, _gn, world.ground(P.x, P.z) - P.y, 'ground')
      if (nearLid) this.probe(r, P, vp, DOWN, P.y - LID_Y, 'sky')
    }
    if (hit.depth > 0.4) { pos.addScaledVector(hit.dn, hit.depth - 0.25); hit.depth = 0.25 } // never get buried
    const speed = -hit.vn
    if (!hit.surface || speed < T.impact || this.hitCool > 0) return
    if (speed > T.splat) return this.doSplat(speed)

    const n = hit.n
    const vnCom = this.vel.dot(n)
    const J = _J.set(0, 0, 0)
    if (vnCom < 0) {
      const dv = -(1 + T.bounce) * vnCom
      this.vel.addScaledVector(n, dv)
      J.addScaledVector(n, dv)
    }
    _vt.copy(this.vel).addScaledVector(n, -this.vel.dot(n))
    const vt = _vt.length()
    if (vt > 1e-6) {
      const scrub = Math.min(vt, T.scrub * speed)
      this.vel.addScaledVector(_vt, -scrub / vt)
      J.addScaledVector(_vt, -scrub / vt)
    }
    // spin from where it was hit
    _w.crossVectors(hit.r, J).applyQuaternion(_qi.copy(this.quat).invert())
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

    const daze = clamp((speed - T.dazeFrom) * T.dazePerHit, 0, 1) * T.dazeMax
    if (daze > this.daze) this.daze = daze
    this.hitCool = 0.08
    this.kick(n, speed)
    this.emit('bounce', { pos: hit.p.clone(), n: n.clone(), speed, surface: hit.surface, daze })
  }

  // the deepest point, and the point slamming in hardest
  probe(r, P, vp, n, d, surface) {
    if (d <= 0) return
    if (d > hit.depth) { hit.depth = d; hit.dn.copy(n) }
    const vn = vp.dot(n)
    if (vn < hit.vn) { hit.vn = vn; hit.n.copy(n); hit.r.copy(r); hit.p.copy(P); hit.surface = surface }
  }

  kick(n, speed) {
    this.jiggle.axis.copy(n)
    this.jiggle.v = -Math.min(speed, 260) * 0.03
  }

  doSplat(speed) {
    const T = TOON
    this.splat = { t: T.splatTime, n: hit.n.clone(), speed, surface: hit.surface }
    this.pos.addScaledVector(hit.dn, hit.depth)
    this.vel.set(0, 0, 0)
    this.omega.set(0, 0, 0)
    this.daze = T.splatTime + 1.2
    this.lever = Math.min(this.lever, 1) // and the needle is knocked back to cruise
    this.jiggle.axis.copy(hit.n)
    this.jiggle.x = -0.6; this.jiggle.v = 0
    this.emit('splat', { pos: hit.p.clone(), n: hit.n.clone(), speed, surface: hit.surface })
  }

  unsplat() {
    const T = TOON, s = this.splat
    this.splat = null
    this.vel.copy(s.n).multiplyScalar(Math.min(T.bounce * s.speed, T.unsplat))
    this.omega.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 9)
    this.jiggle.v = 6
    this.hitCool = 0.3
    this.emit('unsplat', { n: s.n.clone() })
  }
}
