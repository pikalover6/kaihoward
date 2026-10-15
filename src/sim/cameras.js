import * as THREE from 'three'
import { FORWARD, UP } from './constants.js'

const _m = new THREE.Matrix4()
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _h = new THREE.Vector3(), _zero = new THREE.Vector3()
const _ql = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _v4 = new THREE.Vector3()

export const MODES = ['chase', 'cockpit', 'cinematic', 'orbit']

export class CameraRig {
  constructor(camera) {
    this.camera = camera
    this.mode = 'chase'
    this.sq = new THREE.Quaternion()
    this.cur = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 60 }
    this.t = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 60 }
    this.transition = 0
    this.orbit = { yaw: 0.7, pitch: 0.28, dist: 17, idle: 0 }
    this.cine = { anchor: new THREE.Vector3(), look: new THREE.Vector3(), valid: false }
    this.first = true
    this.steady = 1           // 1 while the pilot is flying, 0 while the plane tumbles
    this.shake = 0
    this.lastPos = new THREE.Vector3()
  }

  kick(amount) { this.shake = Math.min(2.5, this.shake + amount) }

  setMode(m) {
    if (m === this.mode) return
    this.mode = m
    this.transition = 0.9
    this.cine.valid = false
    this.orbit.idle = 0
  }
  next() { this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]) }

  shift(dx, dz) {
    this.cur.pos.x -= dx; this.cur.pos.z -= dz
    this.lastPos.x -= dx; this.lastPos.z -= dz
    this.cine.anchor.x -= dx; this.cine.anchor.z -= dz
    this.cine.look.x -= dx; this.cine.look.z -= dz
  }

  lookAt(eye, target, up) {
    _m.lookAt(eye, target, up)
    this.t.quat.setFromRotationMatrix(_m)
    this.t.pos.copy(eye)
  }

  update(dt, flight, input, override) {
    const T = this.t
    const f = flight.forward(_v)
    const speed = flight.speed
    // a camera blending between shots is carried along with the plane, or it'd be left behind at speed
    if (this.transition > 0) this.cur.pos.add(_v2.subVectors(flight.pos, this.lastPos))
    this.lastPos.copy(flight.pos)
    const steady = flight.daze <= 0 && !flight.splat && !flight.oblivious ? 1 : 0
    this.steady += (steady - this.steady) * (1 - Math.exp(-dt * (steady ? 1.5 : 6)))
    const fov = Math.min(88, 58 + 12 * Math.log10(1 + Math.max(0, speed - 60) / 40))
    if (override) {
      this.lookAt(override.pos, override.look, override.up || UP)
      T.fov = override.fov || 55
    } else if (this.mode === 'chase') {
      // follow faster while the pilot is rotating quickly so loops stay framed; a tumbling plane
      // gets a lazy follow instead, so the plane spins on screen rather than the world
      const spin = Math.min(6, Math.hypot(flight.pitchRate, flight.rollRate, flight.turnRate))
      const rate = THREE.MathUtils.lerp(2, 3.2 + spin * 1.1, this.steady)
      // with nobody flying, frame it level from behind the plane's heading, so falls look like falls
      const fw = flight.forward(_v2), pu = flight.up(_v3)
      const h = _h.set(fw.x * (1 - Math.abs(fw.y)) - pu.x * fw.y, 0, fw.z * (1 - Math.abs(fw.y)) - pu.z * fw.y)
      if (h.lengthSq() > 1e-6) _ql.setFromRotationMatrix(_m.lookAt(_zero, h.normalize(), UP))
      _qt.copy(flight.quat).slerp(_ql, 1 - this.steady)
      this.sq.slerp(_qt, 1 - Math.exp(-dt * rate))
      const dist = 13.5 + Math.min(3, 1.5 * Math.log10(1 + speed / 300))
      const off = _v2.set(0, 3.2 + 2.5 * (1 - this.steady), dist).applyQuaternion(this.sq)
      const eye = _v3.copy(flight.pos).add(off)
      // the camera's up is the plane's own up: blending in world-up forced a 180° roll over the top of a loop
      const up = _v2.copy(UP).applyQuaternion(this.sq)
      const look = _v.copy(FORWARD).applyQuaternion(this.sq).multiplyScalar(14 * this.steady).add(flight.pos)
      look.addScaledVector(up, 0.8)
      this.lookAt(eye, look, up)
      T.fov = fov
    } else if (this.mode === 'cockpit') {
      const eye = _v3.set(0, 1.5, 0.15).applyQuaternion(flight.quat).add(flight.pos)
      T.pos.copy(eye)
      T.quat.copy(flight.quat)
      T.fov = 72
    } else if (this.mode === 'cinematic') {
      const c = this.cine
      const d = c.valid ? c.anchor.distanceTo(flight.pos) : 1e9
      const toCam = c.valid ? _v2.copy(c.anchor).sub(flight.pos) : _v2.set(0, 0, 0)
      const app = flight.apparent(_v4), aps = app.length()
      const receding = c.valid && toCam.dot(_v3.copy(app).normalize()) < 0 && d > 140
      // past a few hundred mph the camera crew flies along, so the shot still lasts a moment
      if (c.valid && aps > 300) {
        c.anchor.addScaledVector(app, dt * (1 - 220 / aps))
        c.look.addScaledVector(app, dt * (1 - 220 / aps))
      }
      if (!c.valid || d > 300 || receding) {
        const side = (Math.random() < 0.5 ? -1 : 1) * (22 + Math.random() * 45)
        const r = flight.right(_v2)
        const ahead = speed > 5 ? _v3.copy(flight.vel).normalize() : f
        c.anchor.copy(flight.pos).addScaledVector(ahead, 130 + Math.random() * 90).addScaledVector(r, side)
        c.anchor.y += -12 + Math.random() * 40
        c.look.copy(flight.pos)
        c.valid = true
      }
      c.look.lerp(flight.pos, 1 - Math.exp(-dt * 7))
      this.lookAt(c.anchor, c.look, UP)
      const dd = c.anchor.distanceTo(flight.pos)
      T.fov = THREE.MathUtils.lerp(26, 62, THREE.MathUtils.clamp(1 - dd / 200, 0, 1))
    } else if (this.mode === 'orbit') {
      const o = this.orbit
      if (Math.abs(input.pdx) + Math.abs(input.pdy) > 0) {
        o.yaw -= input.pdx * 0.006; o.pitch = THREE.MathUtils.clamp(o.pitch - input.pdy * 0.005, -1.2, 1.3); o.idle = 0
      } else {
        o.idle += dt
        if (o.idle > 2) o.yaw += dt * 0.12
      }
      o.dist = THREE.MathUtils.clamp(o.dist + input.wheel * 0.02, 7, 45)
      const eye = _v3.set(
        Math.cos(o.pitch) * Math.sin(o.yaw), Math.sin(o.pitch), Math.cos(o.pitch) * Math.cos(o.yaw),
      ).multiplyScalar(o.dist).add(flight.pos)
      this.lookAt(eye, flight.pos, UP)
      T.fov = 50
    }

    // smooth toward target
    let a = 1
    if (this.transition > 0) {
      this.transition -= dt
      const k = 1 - Math.max(0, this.transition) / 0.9
      a = 1 - Math.exp(-dt * THREE.MathUtils.lerp(5, 40, k * k))
    }
    if (override) a = 1 - Math.exp(-dt * (override.rate || 4))
    if (this.first) a = 1
    this.first = false
    const cur = this.cur
    cur.pos.lerp(T.pos, a)
    cur.quat.slerp(T.quat, a)
    cur.fov += (T.fov - cur.fov) * a
    this.camera.position.copy(cur.pos)
    // shake: impacts, plus a rumble that grows with every decade of speed
    const rumble = Math.min(0.25, Math.max(0, Math.log10(speed / 300)) * 0.05)
    this.shake *= Math.exp(-dt * 5)
    const sh = (this.shake + rumble) * (this.mode === 'cockpit' ? 0.3 : 1)
    if (sh > 0.001 && !override) {
      _v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(sh)
      this.camera.position.add(_v2)
    }
    this.camera.quaternion.copy(cur.quat)
    // tall screens get a wider vertical view, so the plane doesn't fill the whole width
    const portrait = this.camera.aspect < 1 ? Math.min(1.5, 1 / Math.sqrt(this.camera.aspect)) : 1
    const shown = Math.min(110, cur.fov * portrait)
    if (Math.abs(this.camera.fov - shown) > 0.01) { this.camera.fov = shown; this.camera.updateProjectionMatrix() }
  }
}
