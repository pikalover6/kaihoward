import * as THREE from 'three'
import { FORWARD, UP, RIGHT, SPAWN_POS, SPAWN_HEADING, CEILING_Y } from './constants.js'

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3()
const _q = new THREE.Quaternion(), _axis = new THREE.Vector3()

export class Flight {
  constructor() {
    this.pos = new THREE.Vector3()
    this.quat = new THREE.Quaternion()
    this.speed = 60
    this.throttle = 0.55
    this.in = { pitch: 0, roll: 0, yaw: 0 }
    this.turnRate = 0          // world yaw rate (rad/s), for trails / camera
    this.rollRate = 0
    this.pitchRate = 0
    this.gLoad = 0
    this.autopilot = null      // when set, {forward(desired), speed} overrides input
    this.locked = false        // control taken by a scripted sequence
    this.respawn()
  }

  respawn() {
    this.pos.copy(SPAWN_POS)
    this.quat.setFromAxisAngle(UP, SPAWN_HEADING)
    this.speed = 60
    this.throttle = 0.55
    this.in.pitch = this.in.roll = this.in.yaw = 0
    this.autopilot = null
    this.locked = false
  }

  forward(out = new THREE.Vector3()) { return out.copy(FORWARD).applyQuaternion(this.quat) }
  up(out = new THREE.Vector3()) { return out.copy(UP).applyQuaternion(this.quat) }
  right(out = new THREE.Vector3()) { return out.copy(RIGHT).applyQuaternion(this.quat) }

  rotateLocal(axis, angle) {
    _axis.copy(axis).applyQuaternion(this.quat)
    _q.setFromAxisAngle(_axis, angle)
    this.quat.premultiply(_q).normalize()
  }
  rotateWorld(axis, angle) {
    _q.setFromAxisAngle(axis, angle)
    this.quat.premultiply(_q).normalize()
  }

  step(dt, input) {
    const sm = 1 - Math.exp(-dt * 6)
    const inp = this.in
    if (!this.locked) {
      inp.pitch += (input.pitch - inp.pitch) * sm
      inp.roll += (input.roll - inp.roll) * sm
      inp.yaw += (input.yaw - inp.yaw) * sm
      this.throttle = THREE.MathUtils.clamp(this.throttle + input.throttle * dt * 0.5, 0, 1)
    }

    this.forward(_f); this.up(_u); this.right(_r)

    let pitchRate = 0, rollRate = 0, yawRate = 0
    if (this.autopilot) {
      const ap = this.autopilot
      // steer toward desired forward with limited angular rate
      const desired = ap.forward
      const dot = THREE.MathUtils.clamp(_f.dot(desired), -1, 1)
      const ang = Math.acos(dot)
      if (ang > 1e-4) {
        _axis.crossVectors(_f, desired).normalize()
        const step = Math.min(ang, ap.maxRate * dt)
        this.rotateWorld(_axis, step)
        // decompose for animation / trails
        const rx = _axis.dot(_r), ry = _axis.dot(_u)
        pitchRate = rx * step / dt
        yawRate = ry * step / dt
      }
      // bank into turns, otherwise keep the up vector near world up (or inverted, whichever is closer)
      this.forward(_f); this.up(_u); this.right(_r)
      const horizTurn = yawRate * (_u.y >= 0 ? 1 : -1)
      const desiredBank = THREE.MathUtils.clamp(-horizTurn * 0.9, -1.1, 1.1)
      const bank = Math.atan2(-_r.y, Math.abs(_u.y) + 1e-6) * Math.sign(_u.y || 1)
      rollRate = (desiredBank - bank) * 4.0
      if (ap.rollLock) rollRate = 0
      this.rotateLocal(FORWARD, rollRate * dt)
      this.turnRate = yawRate
      this.speed += (ap.speed - this.speed) * (1 - Math.exp(-dt * 1.5))
    } else {
      // manual arcade model
      pitchRate = inp.pitch * 1.5
      rollRate = inp.roll * 2.0
      yawRate = inp.yaw * 0.9
      // gentle self-levelling when hands are off
      const level = 1 - Math.abs(inp.roll)
      const sy = _u.y >= 0 ? 1 : -1
      // roll back upright, unless nearly inverted already (then settle inverted)
      const phi = Math.atan2(-_r.y, _u.y)
      const restore = Math.abs(phi) < 2.35 ? -Math.sin(phi) * 2.0 : Math.sin(phi) * 2.0
      rollRate += restore * level * (1 - Math.abs(inp.pitch) * 0.6)
      // slight pitch settle
      pitchRate += -_f.y * sy * 0.35 * (1 - Math.abs(inp.pitch))
      // soft ceiling
      if (this.pos.y > CEILING_Y) pitchRate += -Math.min(1.5, (this.pos.y - CEILING_Y) / 300) * sy

      this.rotateLocal(RIGHT, pitchRate * dt)
      this.rotateLocal(FORWARD, rollRate * dt)
      this.rotateLocal(UP, -yawRate * dt)
      // banked turn: lift's horizontal component turns the plane
      this.forward(_f); this.up(_u)
      const turn = (_f.z * _u.x - _f.x * _u.z) * 1.15
      this.rotateWorld(UP, turn * dt)
      this.turnRate = turn

      // speed: throttle target, gravity along the flight path
      this.forward(_f)
      const target = 38 + 62 * this.throttle
      this.speed += (target - this.speed) * (1 - Math.exp(-dt * 0.55))
      this.speed += -_f.y * 42 * dt
      this.speed = THREE.MathUtils.clamp(this.speed, 26, 150)
    }
    this.pitchRate = pitchRate; this.rollRate = rollRate
    this.gLoad = Math.abs(pitchRate) * this.speed / 60 + Math.abs(this.turnRate) * this.speed / 50

    this.forward(_f)
    this.pos.addScaledVector(_f, this.speed * dt)
  }
}
