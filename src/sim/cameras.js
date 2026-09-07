import * as THREE from 'three'
import { FORWARD, UP } from './constants.js'

const _m = new THREE.Matrix4()
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3()

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
  }

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
    if (override) {
      this.lookAt(override.pos, override.look, override.up || UP)
      T.fov = override.fov || 55
    } else if (this.mode === 'chase') {
      this.sq.slerp(flight.quat, 1 - Math.exp(-dt * 3.2))
      const off = _v2.set(0, 2.7, 11.5).applyQuaternion(this.sq)
      const eye = _v3.copy(flight.pos).add(off)
      const up = _v2.copy(UP).applyQuaternion(this.sq).multiplyScalar(0.55).add(UP).normalize()
      const look = _v.copy(FORWARD).applyQuaternion(this.sq).multiplyScalar(14).add(flight.pos)
      look.y += 0.8
      this.lookAt(eye, look, up)
      T.fov = 58 + (flight.speed - 60) * 0.09
    } else if (this.mode === 'cockpit') {
      const eye = _v3.set(0, 1.28, 0.05).applyQuaternion(flight.quat).add(flight.pos)
      T.pos.copy(eye)
      T.quat.copy(flight.quat)
      T.fov = 72
    } else if (this.mode === 'cinematic') {
      const c = this.cine
      const d = c.valid ? c.anchor.distanceTo(flight.pos) : 1e9
      const toCam = c.valid ? _v2.copy(c.anchor).sub(flight.pos) : _v2.set(0, 0, 0)
      const receding = c.valid && toCam.dot(f) < 0 && d > 140
      if (!c.valid || d > 300 || receding) {
        const side = (Math.random() < 0.5 ? -1 : 1) * (22 + Math.random() * 45)
        const r = flight.right(_v2)
        c.anchor.copy(flight.pos).addScaledVector(f, 130 + Math.random() * 90).addScaledVector(r, side)
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
    let rate = 30
    if (this.transition > 0) { this.transition -= dt; rate = 5 }
    if (override) rate = override.rate || 4
    const a = this.first ? 1 : 1 - Math.exp(-dt * rate)
    this.first = false
    const cur = this.cur
    cur.pos.lerp(T.pos, a)
    cur.quat.slerp(T.quat, a)
    cur.fov += (T.fov - cur.fov) * a
    this.camera.position.copy(cur.pos)
    this.camera.quaternion.copy(cur.quat)
    if (Math.abs(this.camera.fov - cur.fov) > 0.01) { this.camera.fov = cur.fov; this.camera.updateProjectionMatrix() }
  }
}
