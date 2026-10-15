import { N64Screen, LIGHT } from './n64.js'
import * as THREE from 'three'
import { Sky, hazeFor } from './sky.js'
import { World, SHIFT_SNAP } from './world.js'
import { buildPlane } from './plane.js'
import { Flight, LIGHT as C } from './flight.js'
import { Input } from './input.js'
import { CameraRig } from './cameras.js'
import { Effects } from './effects.js'
import { Tricks } from './tricks.js'
import { Birds } from './birds.js'
import { Combat } from './combat.js'
import { Hud2D } from './hud2d.js'
import { Bubbles, Flare, Dolphins } from './aero.js'
import { SkyAudio } from './audio.js'
import { speedText, TIERS } from './units.js'
import { ORIGIN_SHIFT, LID_Y } from './constants.js'

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3()
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3()
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _qi = new THREE.Quaternion()
const ROCKET_TAIL = new THREE.Vector3(0, -1.05, 1.9)
const NOSE = new THREE.Vector3(0, 0, -3.1)
const SOOT = new THREE.Color('#2b2826')

const SIGNS = ['uh oh', 'help', 'oops', 'bye', 'hmm', 'mom?', 'not again', 'brb', 'gravity?', 'wait', 'nope', 'yikes', 'ok then', 'why']
const BOINGS = ['boing!', 'boink!', 'sproing!', 'bwomp!', 'doink!']
const BONKS = ['bonk!', 'thud!', 'clonk!', 'whump!']
const pick = a => a[Math.floor(Math.random() * a.length)]
const smooth = THREE.MathUtils.smoothstep

// volume-preserving stretch by s along unit axis a
function stretchMatrix(out, a, s) {
  const k = 1 / Math.sqrt(s), d = s - k
  return out.set(
    k + d * a.x * a.x, d * a.x * a.y, d * a.x * a.z, 0,
    d * a.y * a.x, k + d * a.y * a.y, d * a.y * a.z, 0,
    d * a.z * a.x, d * a.z * a.y, k + d * a.z * a.z, 0,
    0, 0, 0, 1,
  )
}

export class Engine {
  constructor(canvas, onState) {
    this.canvas = canvas
    this.onState = onState
    this.state = { mode: 'chase', sound: false, paused: false, title: true }

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer = renderer
    this.screen = new N64Screen(renderer)

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 14000)
    this.scene.add(this.camera)

    this.sky = new Sky()
    this.scene.add(this.sky.mesh)
    this.world = new World(this.scene)
    this.plane = buildPlane()
    this.plane.root.matrixAutoUpdate = false
    this.plane.trailL.maxGap = this.plane.trailR.maxGap = 600
    this.scene.add(this.plane.root, this.plane.trailL.mesh, this.plane.trailR.mesh, this.plane.scarf.mesh, this.plane.sign)
    const M = this.plane.materials
    this.sootMats = [M.red, M.yellow, M.blue, M.white, M.skin, M.wingStar].map(m => ({ m, base: m.uniforms.uTint.value.clone() }))
    this.flight = new Flight()
    this.input = new Input(canvas)
    this.rig = new CameraRig(this.camera)
    this.effects = new Effects(this.scene)
    this.audio = new SkyAudio()
    this.tricks = new Tricks((text, kind) => this.pop(text, this.flight.pos, kind))
    this.birds = new Birds(this.scene)
    this.squawkCool = 0
    this.bubbles = new Bubbles(this.scene)
    this.dolphins = new Dolphins(this.scene)
    this.flare = new Flare(this.camera)
    this.combat = new Combat(this.scene, this.world, this.effects, {
      pop: (text, pos, kind, slot) => this.pop(text, pos, kind, slot),
      radio: (who, text) => this.onRadio && this.onRadio({ who, text }),
      banner: (title, sub) => this.onBanner && this.onBanner({ title, sub }),
      sound: (name, arg) => {
        const fn = this.audio[name]
        if (!fn) return
        fn.call(this.audio, arg && arg.isVector3 ? arg.distanceTo(this.camera.position) : arg)
      },
      shake: k => this.rig.kick(k),
      respawn: () => this.respawn(true),
    })
    this.hud2d = null

    this.landing = null
    this.fade = 0
    this.time = 0
    this.last = performance.now()
    this.running = true
    this.frame = 0
    this.propAngle = 0
    this.propSpeed = 20
    this.tier = -1
    this.plaid = 0
    this.head = { yaw: 0, pitch: 0 }
    this.signT = 0
    this.lookDownT = 0
    this.coins = 0
    this.bubblesPopped = 0
    this.chain = { n: 0, t: -10 }
    this.smokeT = 0
    this.prev = new THREE.Vector3()

    this.input.on('press', k => this.onKey(k))
    this.input.on('barrel', dir => { if (!this.state.paused && !this.combat.ko) this.flight.barrelRoll(dir) })

    this.resize()
    this._onResize = () => this.resize()
    window.addEventListener('resize', this._onResize)
    this._loop = () => this.loop()
    this.schedule()
    this.emit()
    if (import.meta.env.DEV) { window.__engine = this; window.__THREE = THREE }
  }

  setOverlay(canvas) {
    this.hud2d = canvas ? new Hud2D(canvas) : null
    if (this.hud2d) this.hud2d.resize(window.innerWidth, window.innerHeight)
  }

  emit(partial) {
    if (partial) Object.assign(this.state, partial)
    this.onState && this.onState({ ...this.state })
  }

  onKey(k) {
    if (this.state.title && !['m', 'escape', 'p'].includes(k)) this.emit({ title: false })
    if (k === 'escape' || k === 'p') return this.togglePause()
    if (this.state.paused) return
    if (k === 'v') this.cycleView()
    else if (k === 'm') this.toggleSound()
    else if (k === 'r') this.respawn()
  }

  togglePause(on = !this.state.paused) { this.emit({ paused: on, title: false }) }

  // back home (or, after a knockout, back into the fight right where you were)
  respawn(here = false) {
    if (this.landing) return
    this.landing = { phase: 'fade', t: 0, here, at: this.flight.pos.clone() }
    this.flight.locked = true
  }

  cycleView() {
    this.rig.next()
    this.emit({ mode: this.rig.mode })
  }

  toggleSound() {
    this.audio.toggle()
    this.emit({ sound: this.audio.on })
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight
    this.renderer.setSize(w, h, false)
    this.screen.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    if (this.hud2d) this.hud2d.resize(w, h)
  }

  shiftOrigin() {
    const p = this.flight.pos
    if (Math.abs(p.x) < ORIGIN_SHIFT && Math.abs(p.z) < ORIGIN_SHIFT) return
    // whole steps of the coarsest terrain grid, so nothing on the ground swims
    const dx = Math.round(p.x / SHIFT_SNAP) * SHIFT_SNAP, dz = Math.round(p.z / SHIFT_SNAP) * SHIFT_SNAP
    p.x -= dx; p.z -= dz
    this.prev.x -= dx; this.prev.z -= dz
    this.world.shift(dx, dz)
    this.rig.shift(dx, dz)
    this.effects.shift(dx, dz)
    this.birds.shift(dx, dz)
    this.bubbles.shift(dx, dz)
    this.dolphins.shift(dx, dz)
    this.combat.shift(dx, dz)
    if (this.landing) { this.landing.at.x -= dx; this.landing.at.z -= dz }
    this.plane.trailL.shift(dx, dz); this.plane.trailR.shift(dx, dz); this.plane.scarf.shift(dx, dz)
    this.camera.position.x -= dx; this.camera.position.z -= dz
  }

  updateRespawn(dt) {
    const L = this.landing
    if (!L) return
    L.t += dt
    const fl = this.flight
    if (L.phase === 'fade') {
      this.fade = Math.min(1, L.t / 0.6)
      if (L.t > 0.75) {
        fl.respawn()
        fl.events.length = 0
        if (L.here) {
          // back where you were, a little higher up
          fl.pos.copy(L.at)
          fl.pos.y = Math.max(L.at.y + 60, this.world.ground(fl.pos.x, fl.pos.z) + 150, this.world.waterY + 150)
          fl.pos.y = Math.min(fl.pos.y, LID_Y - 200)
        } else {
          // home is wherever the origin is now; pop out above the ground there
          fl.pos.y = Math.max(fl.pos.y, this.world.ground(fl.pos.x, fl.pos.z) + 150)
        }
        if (this.combat.ko) this.combat.revived()
        this.rig.first = true
        this.rig.sq.copy(fl.quat)
        this.plane.trailL.clear(); this.plane.trailR.clear(); this.plane.scarf.clear()
        this.effects.clear()
        this.plane.sign.visible = false
        this.tier = -1
        this.tricks.reset()
        L.phase = 'fadein'; L.t = 0
      }
    } else {
      this.fade = Math.max(0, 1 - L.t / 1.0)
      if (L.t > 1.0) this.landing = null
    }
  }

  // ------------------------------------------------------------ cartoon consequences
  pop(text, pos, kind = '', slot = 0) {
    if (!this.onPop) return
    const w = window.innerWidth, h = window.innerHeight
    let x = w / 2, y = h * 0.38
    if (pos) {
      _v.copy(pos).project(this.camera)
      if (_v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2) {
        x = THREE.MathUtils.clamp((_v.x + 1) / 2 * w, 90, w - 90)
        y = THREE.MathUtils.clamp((1 - _v.y) / 2 * h, 70, h - 110)
      }
    } else if (kind === 'style' || kind === 'points') {
      // the score breakdown stacks up under the middle of the screen
      y = h * 0.52 + (kind === 'points' ? 0 : 36 + slot * 30)
    }
    this.onPop({ text, x, y, kind })
  }

  local(p, out) { return out.copy(p).applyQuaternion(this.flight.quat).add(this.flight.pos) }

  handleEvents(events) {
    const fl = this.flight, fx = this.effects, A = this.audio
    for (const e of events) {
      if (e.shape && e.shape.owner) this.combat.onFlightEvent(e, fl)
      switch (e.type) {
        case 'barrel':
          this.pop('barrel roll!', fl.pos, 'trick')
          A.whoosh()
          break
        case 'dizzy':
          this.pop('too dizzy!', fl.pos, 'big')
          A.dizzy()
          break
        case 'hang':
          this.plane.writeSign(pick(SIGNS))
          this.signT = 0
          break
        case 'realize':
          A.gulp()
          this.lookDownT = 0.7
          break
        case 'bounce': {
          const k = Math.min(1, e.speed / 200)
          if (e.surface === 'sky') {
            A.bonk()
            this.sky.uniforms.uRipple.value.set(0, 1, 0, this.time)
            fx.splash(e.pos, e.n, { n: 12, speed: 25 + e.speed * 0.2, size: 0.8, grow: 2, life: 0.9, color: '#ffe680', lift: 0.2 })
            this.pop('bonk!', e.pos)
          } else if (e.surface === 'bouncy' || e.surface === 'rubber') {
            A.boing(Math.max(0.6, k))
            this.pop(pick(BOINGS), e.pos, e.surface === 'bouncy' ? 'big' : '')
            fx.rings.spawn(e.pos, e.n, { size: 1, grow: 14 + k * 20, life: 0.5, alpha: 0.7, color: '#ffe680' })
          } else if (e.surface === 'metal') {
            A.boing(Math.max(0.5, k))
            A.bonk(1)
            this.pop(pick(['CLANG!', 'BONK!', 'DOINK!']), e.pos, 'big')
            fx.splash(e.pos, e.n, { n: 8, speed: 30 + e.speed * 0.2, size: 0.8, grow: 2, life: 0.5, color: '#fff4b0', alpha: 1, lift: 0.3 })
          } else {
            A.boing(k * 0.7)
            if (e.speed > 25) A.bonk(0.5)
            const dust = e.surface === 'ground' ? '#c8a874' : e.surface === 'gold' ? '#ffe680' : '#d8d2c8'
            if (e.speed > 14) fx.splash(e.pos, e.n, { n: 6 + Math.round(k * 10), speed: 10 + e.speed * 0.3, size: 1.4 + k * 2, grow: 4 + k * 8, color: dust, alpha: 0.85 })
            if (e.speed > 24) this.pop(pick(e.speed > 60 ? BOINGS : BONKS), e.pos)
          }
          if (e.speed > 30) fx.rings.spawn(e.pos, e.n, { size: 1, grow: 6 + k * 20, life: 0.5, alpha: 0.6 })
          this.rig.kick(Math.min(1.6, e.speed / 90))
          break
        }
        case 'splat':
          A.splat()
          this.rig.kick(2.5)
          fx.splash(e.pos, e.n, { n: 18, speed: 60, size: 3, grow: 12, life: 1.4, color: e.surface === 'sky' ? '#ffe680' : e.surface === 'metal' ? '#d8dde2' : '#c8a874', alpha: 0.9, lift: 0.25 })
          fx.rings.spawn(e.pos, e.n, { size: 2, grow: 40, life: 0.8, alpha: 0.8 })
          if (e.surface === 'sky') this.sky.uniforms.uRipple.value.set(0, 1, 0, this.time)
          this.pop('splat!', e.pos, 'big')
          break
        case 'unsplat':
          A.boing(0.9)
          this.pop('pop!', fl.pos, 'small')
          break
        case 'perforate': {
          const col = e.surface === 'leaves' || e.surface === 'wood' ? '#4fae40' : e.surface === 'rubber' || e.surface === 'bouncy' ? '#ff6b5a' : '#d8d2c8'
          fx.splash(e.pos, _v2.copy(fl.vel).normalize(), { n: 14, speed: 40, size: 2, grow: 6, life: 1, color: col, alpha: 0.95, lift: 0.1 })
          A.bonk(0.8)
          this.pop(pick(['kapow!', 'krak!', 'whoomp!', 'blam!']), e.pos, 'big')
          this.rig.kick(0.8)
          break
        }
        case 'touch':
          if (e.surface === 'cloud') {
            A.poof()
            fx.splash(_v.copy(fl.pos).setY(fl.pos.y - 1.5), _v2.set(0, 1, 0), { n: 9, speed: 12 + e.speed * 0.25, size: 1.8, grow: 3.5, life: 1.2, color: '#ffffff', alpha: 0.9, lift: 0.35, radius: 3.5 })
            if (e.speed > 20) this.pop('poof', fl.pos, 'small')
          } else if (e.surface === 'water') {
            A.splash(Math.min(1, e.speed / 120))
            fx.splash(_v.copy(fl.pos).setY(this.world.waterY), _v2.set(0, 1, 0), { n: 10, speed: 14 + e.speed * 0.4, size: 1.4, grow: 3, life: 0.9, color: '#d8f4ff', alpha: 0.95, lift: 1.2, radius: 2 })
            if (e.speed > 30) this.pop('splash!', fl.pos, 'small')
          } else if (e.surface === 'leaves') {
            A.rustle()
            fx.splash(fl.pos, _v2.set(0, 1, 0), { n: 10, speed: 10 + e.speed * 0.2, size: 1, grow: 1.5, life: 1, color: '#4fae40', alpha: 1, lift: 0.6 })
            this.pop('rustle', fl.pos, 'small')
          }
          break
      }
    }
  }

  // speed rings and coins: anything the plane's path went through this frame
  pickups() {
    const fl = this.flight, a = this.prev, b = fl.pos
    _v4.subVectors(b, a)
    const len2 = _v4.lengthSq()
    for (const ring of this.world.rings) {
      const d0 = _v.subVectors(a, ring.pos).dot(ring.dir), d1 = _v2.subVectors(b, ring.pos).dot(ring.dir)
      if (d0 * d1 > 0 || d0 === d1) continue
      _v3.copy(a).addScaledVector(_v4, d0 / (d0 - d1))
      if (_v3.distanceTo(ring.pos) > ring.R - 0.5) continue
      // through the middle: a shove along the ring, more for every ring in a row
      this.chain.n = this.time - this.chain.t < 5 ? this.chain.n + 1 : 1
      this.chain.t = this.time
      const along = Math.sign(fl.vel.dot(ring.dir)) || 1
      fl.vel.multiplyScalar(1.15).addScaledVector(ring.dir, along * (30 + 8 * this.chain.n))
      ring.flash = 1
      this.audio.ring(this.chain.n)
      this.effects.rings.spawn(ring.pos, ring.dir, { size: 14, grow: 30, life: 0.6, color: '#ffe680', alpha: 0.9 })
      this.pop(this.chain.n > 1 ? `zoom ×${this.chain.n}!` : 'zoom!', ring.pos, 'trick')
    }
    for (const coin of this.world.coins) {
      let t = len2 > 1e-9 ? _v.subVectors(coin.pos, a).dot(_v4) / len2 : 0
      t = THREE.MathUtils.clamp(t, 0, 1)
      if (_v.copy(a).addScaledVector(_v4, t).distanceTo(coin.pos) > 5.5) continue
      this.world.take(coin)
      this.coins++
      this.combat.heal(0.5) // a coin patches you up a bit
      this.audio.coin(this.coins)
      this.effects.splash(coin.pos, _v2.set(0, 1, 0), { n: 6, speed: 18, size: 0.6, grow: 1, life: 0.5, color: '#ffe680', alpha: 1, lift: 0.8 })
      if (this.coins % 10 === 0) this.pop(`${this.coins} coins!`, coin.pos, 'trick')
    }
  }

  // named speeds, the sound barrier, and plaid
  updateTier(dt) {
    const fl = this.flight, sp = fl.speed
    let t = -1
    for (let i = 0; i < TIERS.length; i++) if (sp >= TIERS[i].at) t = i
    if (t > this.tier) {
      if (this.tier < 0 && t >= 0) {
        const dir = _v2.copy(fl.vel).normalize()
        this.effects.rings.spawn(_v.copy(fl.pos).addScaledVector(dir, -4), dir, { size: 3, grow: 70, life: 1.1, alpha: 0.85 })
        this.effects.rings.spawn(_v.copy(fl.pos).addScaledVector(dir, -9), dir, { size: 2, grow: 45, life: 0.9, alpha: 0.6 })
        this.audio.boom()
        this.rig.kick(1.8)
        this.pop('kaboom!', fl.pos, 'big')
        if (this.combat.bandits) this.combat.chatter('fast', null, 20)
      }
      if (this.onTier) this.onTier(TIERS[t].name)
      this.tier = t
    } else if (t < this.tier && sp < TIERS[this.tier].at * 0.8) this.tier = t
    const plaid = sp > C * 1000 ? 1 : 0
    this.plaid += (plaid - this.plaid) * (1 - Math.exp(-dt * 1.5))
    this.sky.uniforms.uPlaid.value = this.plaid
  }

  // the plane's body language
  updatePlane(sdt, dt) {
    const fl = this.flight, P = this.plane, t = this.time
    const sp = fl.speed
    const f = fl.forward(_f), u = fl.up(_u), r = fl.right(_r)

    // rubber: stretched along the momentum (not the nose), squashed along whatever it last hit
    const J = fl.jiggle
    _m.makeRotationFromQuaternion(fl.quat)
    if (sp > 1) _m.premultiply(stretchMatrix(_m2, _v.copy(fl.vel).divideScalar(sp), 1 + Math.min(0.5, 0.075 * Math.log2(1 + sp / 120))))
    if (Math.abs(J.x) > 1e-3) _m.premultiply(stretchMatrix(_m2, J.axis, 1 + J.x))
    _m.setPosition(fl.pos)
    P.root.matrix.copy(_m)
    P.root.matrixWorldNeedsUpdate = true
    P.root.position.copy(fl.pos)
    P.root.quaternion.copy(fl.quat)
    P.body.position.y = Math.sin(t * 1.7) * 0.04
    P.body.rotation.z = Math.sin(t * 1.1) * 0.012
    // blinking while you're invulnerable, sooty after a hit
    P.root.visible = !(this.combat.invuln > 0 && (t * 14) % 2 < 1)
    const soot = this.combat.soot * 0.85
    for (const s of this.sootMats) s.m.uniforms.uTint.value.copy(s.base).lerp(SOOT, soot)

    // prop idles forward, races when boosting, runs backwards when braking
    const target = this.combat.ko ? 4 : fl.throttle < 0 ? -55 : fl.throttle > 0 ? 60 : 22 + Math.min(20, sp * 0.1)
    this.propSpeed += (target - this.propSpeed) * (1 - Math.exp(-sdt * 3))
    this.propAngle += sdt * this.propSpeed
    P.prop.rotation.z = this.propAngle
    P.blur.material.uniforms.uAlpha.value = THREE.MathUtils.clamp((Math.abs(this.propSpeed) - 10) / 50, 0, 0.2)
    P.blur.visible = P.blur.material.uniforms.uAlpha.value > 0.01
    P.pilot.visible = this.rig.mode !== 'cockpit'
    P.scarf.mesh.visible = P.pilot.visible

    // the rocket
    const boosting = fl.push > 0
    P.flame.visible = boosting
    if (boosting) {
      const s = 0.7 + Math.min(1.6, 0.25 * Math.log2(1 + fl.held * 2)) + Math.random() * 0.25
      P.flame.scale.set(0.8 + Math.random() * 0.3, 0.8 + Math.random() * 0.3, s)
      this.smokeT -= sdt
      if (this.smokeT <= 0) {
        this.smokeT = 0.035
        this.effects.puffs.spawn(this.local(ROCKET_TAIL, _v), { vel: _v2.copy(f).multiplyScalar(-10).add(_v3.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(5)), size: 0.8, grow: 3.5, life: 0.9, color: Math.random() < 0.3 ? '#ffd27a' : '#f2f2f2', alpha: 0.85, drag: 3 })
      }
    } else if (fl.push < 0) {
      this.smokeT -= sdt
      if (this.smokeT <= 0) {
        this.smokeT = 0.08
        this.effects.puffs.spawn(this.local(NOSE, _v), { vel: _v2.copy(f).multiplyScalar(12), size: 0.5, grow: 2, life: 0.6, color: '#dfe6ee', alpha: 0.6, drag: 3 })
      }
    }
    // a damaged plane trails a little smoke
    if (sdt > 0 && this.combat.hp < this.combat.maxHp * 0.4 && Math.random() < sdt * 14) {
      this.effects.puffs.spawn(this.local(NOSE, _v), { vel: _v2.copy(fl.vel).multiplyScalar(-0.05).add(_v3.set(0, 4, 0)), size: 0.7, grow: 3, life: 1, color: '#4a4542', alpha: 0.7, drag: 2 })
    }

    // the pilot's head: looks where the plane is really going, at you during a dead stop,
    // down when it realises, and wobbles when dazed
    let yaw = 0, pitch = 0
    const slipLocal = _v.copy(fl.vel).applyQuaternion(_qi.copy(fl.quat).invert())
    if (sp > 5) {
      const back = Math.atan2(-slipLocal.x, -slipLocal.z)
      if (Math.abs(back) > 0.9) yaw = THREE.MathUtils.clamp(back, -2.4, 2.4)
    }
    if (fl.oblivious > 0) { yaw = Math.PI * 0.92; pitch = 0.1 }
    if (this.lookDownT > 0) { this.lookDownT -= dt; yaw = 0; pitch = -0.55 }
    if (fl.daze > 0) { yaw = Math.sin(t * 7) * 0.7; pitch = Math.sin(t * 5.3) * 0.25 }
    const hs = 1 - Math.exp(-dt * (fl.oblivious > 0 ? 5 : 9))
    this.head.yaw += (yaw - this.head.yaw) * hs
    this.head.pitch += (pitch - this.head.pitch) * hs
    P.headGroup.rotation.set(this.head.pitch, this.head.yaw, fl.daze > 0 ? Math.sin(t * 6) * 0.25 : 0, 'YXZ')
    const wide = fl.oblivious > 0 || this.lookDownT > 0 || this.combat.warn === 'missile' ? 1.45 : 1
    for (const eye of P.eyes) eye.userData.pupil.scale.setScalar(THREE.MathUtils.lerp(eye.userData.pupil.scale.x, wide, 0.2))

    // the sign comes up during a dead stop, upright and facing the camera, and drops when it's over
    const S = P.sign
    const camUp = _v3.set(0, 1, 0).applyQuaternion(this.camera.quaternion)
    if (fl.hanging) {
      this.signT += dt
      S.visible = true
      const k = Math.min(1, this.signT / 0.25)
      P.pilot.updateWorldMatrix(true, false)
      P.pilot.getWorldPosition(S.position)
      S.position.addScaledVector(_v4.set(1, 0, 0).applyQuaternion(this.camera.quaternion), 1.2)
        .addScaledVector(_v4.subVectors(this.camera.position, S.position).normalize(), 1.8)
        .addScaledVector(camUp, -2.4 + 2.9 * (1 - (1 - k) ** 3) + Math.sin(this.signT * 9) * 0.03)
      S.quaternion.copy(this.camera.quaternion)
      S.rotateZ(Math.sin(this.signT * 4) * 0.06)
    } else if (S.visible) {
      S.position.addScaledVector(camUp, -dt * 9)
      S.visible = S.position.distanceTo(fl.pos) < 5
    }

    // dizzy stars
    P.stars.visible = fl.daze > 0.15
    if (P.stars.visible) {
      P.stars.children.forEach((st, i) => {
        const a = t * 4 + (i / 5) * Math.PI * 2
        st.position.set(Math.cos(a) * 0.5, Math.sin(t * 6 + i) * 0.06, Math.sin(a) * 0.5)
        st.rotation.set(0, -a, t * 5)
      })
    }

    // wingtip trails: pulling g's, and permanent contrails once it's quick
    const gl = THREE.MathUtils.clamp((fl.gLoad - 1.2) / 2, 0, 1)
    const fast = smooth(sp, 250, 1500)
    const trailA = Math.max((0.04 + gl * 0.9) * Math.min(1, sp / 90), fast * 0.75)
    P.trailL.push(_v.copy(fl.pos).addScaledVector(r, -3.85).addScaledVector(f, 0.6).addScaledVector(u, 0.05), u, trailA, 0.35)
    P.trailR.push(_v.copy(fl.pos).addScaledVector(r, 3.85).addScaledVector(f, 0.6).addScaledVector(u, 0.05), u, trailA, 0.35)
    P.trailL.rebuild(); P.trailR.rebuild()

    // scarf: streams along the relative wind, so it blows forward when you fly backwards
    const wind = _v2.set(0, 0, 0)
    if (sp > 0.5) wind.copy(fl.vel).multiplyScalar(-1 / sp)
    wind.multiplyScalar(smooth(sp, 0.5, 8))
    wind.y -= (1 - smooth(sp, 2, 30)) * fl.aware * 0.8
    wind.addScaledVector(f, -0.15)
    wind.normalize()
    const width = _v3.crossVectors(wind, r)
    if (width.lengthSq() < 0.01) width.copy(u)
    width.normalize()
    const side = _v4.crossVectors(wind, width).normalize()
    const flut = 0.08 + Math.min(0.25, sp / 500)
    const neck = this.scarfNeck || (this.scarfNeck = new THREE.Vector3())
    neck.copy(fl.pos).addScaledVector(u, 1.0).addScaledVector(f, -0.6)
    const sc = this.scarfSide || (this.scarfSide = new THREE.Vector3())
    P.scarf.setSamples(i => {
      const k = i / (P.scarf.n - 1)
      const back = 0.05 + k * 2.6
      const wave = Math.sin(t * 16 - k * 7) * flut * k + Math.sin(t * 9 - k * 4) * flut * 0.5 * k
      const c = _v.copy(neck).addScaledVector(wind, back).addScaledVector(width, wave * 0.6)
        .addScaledVector(side, Math.sin(t * 11 - k * 5) * flut * k * 1.2 + 0.05)
      c.y -= k * k * 0.3 * fl.aware * (1 - smooth(sp, 30, 200))
      return { c: c.clone(), s: sc.copy(width).addScaledVector(side, 0.35).normalize(), a: 1 }
    })
    P.scarf.rebuild()

    // rings that were just flown through flash and spin
    for (const ring of this.world.rings) {
      if (!ring.flash) continue
      ring.flash = Math.max(0, ring.flash - dt * 1.5)
      ring.mesh.rotateZ(dt * 12 * ring.flash)
      ring.mesh.scale.setScalar(1 + ring.flash * 0.25)
    }
  }

  updateHud() {
    if (!this.onHud) return
    const fl = this.flight, sp = fl.speed, K = this.combat
    let status = ''
    if (K.ko) status = 'k.o.'
    else if (fl.splat) status = 'splat'
    else if (fl.daze > 0) status = 'seeing stars'
    else if (fl.hanging) status = '...'
    else if (fl.touching === 'cloud' && sp < 4) status = 'napping on a cloud'
    else if (fl.touching === 'water' && sp < 20) status = 'floating'
    else if (fl.push > 0) status = 'boost!'
    else if (fl.push < 0) status = sp > 5 && fl.vel.dot(fl.forward(_f)) < 0 ? 'reverse' : 'brake'
    else if (sp > 5) {
      const slip = Math.acos(THREE.MathUtils.clamp(fl.forward(_f).dot(_v.copy(fl.vel).divideScalar(sp)), -1, 1))
      status = slip > 2.6 ? 'backwards' : slip > 0.5 ? 'drifting' : ''
    }
    this.onHud({
      speed: sp, text: speedText(sp), status, coins: this.coins, boost: fl.push > 0 ? Math.min(1, fl.held / 6) : 0,
      hp: K.hp, maxHp: K.maxHp, score: K.score, best: K.best, wave: K.wave, bandits: K.bandits, phase: K.phase, warn: K.warn,
      triple: K.tripleT, ducks: K.ducks, shield: K.shieldT, combo: this.time - K.combo.t < 6 ? K.combo.n : 0, kills: K.kills,
    })
  }

  loop() {
    if (!this.running) return
    this.schedule()
    const now = performance.now()
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.frame++
    const inp = this.input.poll()
    if (this.state.title && (inp.pitch || inp.turn || inp.roll || inp.throttle || inp.fire)) this.emit({ title: false })
    if (!this.state.title) this.combat.start()
    // a moment of slow motion when something big goes down
    const sdt = this.state.paused ? 0 : dt * (this.combat.slow > 0 ? 0.35 : 1)
    this.time += sdt

    const fl = this.flight
    if (sdt > 0) {
      this.prev.copy(fl.pos)
      fl.step(sdt, inp, this.world)
      this.handleEvents(fl.events.splice(0))
      this.pickups()
      this.tricks.update(sdt, this.time, fl, this.world)
      this.combat.update(sdt, fl, inp)
    }
    this.updateRespawn(dt)
    this.shiftOrigin()
    this.updateTier(dt)
    this.updatePlane(sdt, dt)

    // camera
    this.rig.update(dt, fl, inp, null)
    const camFloor = Math.max(this.world.ground(this.camera.position.x, this.camera.position.z), this.world.waterY) + 2
    if (this.camera.position.y < camFloor) { this.camera.position.y = camFloor; this.rig.cur.pos.y = camFloor }
    if (this.camera.position.y > LID_Y - 2) { this.camera.position.y = LID_Y - 2; this.rig.cur.pos.y = LID_Y - 2 }
    this.camera.updateMatrixWorld()

    // haze: further away and bluer the higher you are
    const alt = this.camera.position.y
    LIGHT.uFogColor.value.copy(hazeFor(alt))
    LIGHT.uFogNear.value = 500 + Math.max(0, alt) * 0.4
    LIGHT.uFogFar.value = 3000 + Math.max(0, alt) * 1.2

    this.sky.update(this.time, this.camera)
    this.world.update(sdt, this.time, this.camera, fl.pos)
    this.squawkCool -= sdt
    if (this.birds.update(sdt, this.time, fl, this.world) && this.squawkCool <= 0) {
      this.squawkCool = 1.5
      this.audio.squawk()
      this.pop(pick(['squawk!', 'caw!', 'bwak!']), fl.pos, 'small')
    }
    // the Aero layer
    const popped = this.bubbles.update(sdt, this.time, fl, this.world)
    if (popped) {
      this.bubblesPopped += popped
      this.combat.score += 10 * popped
      this.audio.bubblePop()
      const at = this.bubbles.lastPop
      this.effects.splash(at, _v2.set(0, 1, 0), { n: 8, speed: 10 + this.bubbles.lastR * 2, size: 0.5, grow: 1.5, life: 0.45, color: '#dffaff', alpha: 0.9, lift: 0.2, radius: this.bubbles.lastR * 0.6 })
      if (this.bubblesPopped % 10 === 0) this.pop(`${this.bubblesPopped} bubbles!`, at, 'small')
    }
    this.dolphins.update(sdt, fl, this.world)
    for (const p of this.dolphins.events) this.effects.splash(p, _v2.set(0, 1, 0), { n: 7, speed: 8, size: 1, grow: 2, life: 0.8, color: '#e8fbff', alpha: 0.95, lift: 1.4, radius: 0.8 })
    this.flare.update(dt, this.world)
    this.effects.update(sdt, this.camera, fl)
    const K = this.combat
    this.audio.update({
      speed: fl.speed, push: fl.push, held: fl.held, dt: sdt,
      falling: !fl.throttle && !fl.splat && fl.airborne && fl.aware > 0.5 && fl.vel.y < -40 && fl.liftForce < 20,
      jet: K.nearestJet, warn: this.state.paused ? '' : K.warn, intensity: K.phase === 'fight' ? 1 : 0,
    })
    this.updateHud()

    this.screen.render(this.scene, this.camera)
    if (this.hud2d) this.hud2d.draw(this.camera, fl, K, this.time, !this.state.title && !this.state.paused)
    if (this.onFade) this.onFade(this.fade)
  }

  schedule() {
    // in dev, keep simulating when the tab is hidden (browser automation / background testing)
    if (import.meta.env.DEV && document.hidden) this.workerTick(this._loop)
    else requestAnimationFrame(this._loop)
  }

  workerTick(fn) {
    if (!this.ticker) {
      const src = 'setInterval(() => postMessage(0), 50)'
      this.ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
      this.ticker.onmessage = () => { const f = this.tickFn; this.tickFn = null; if (f) f() }
    }
    this.tickFn = fn
  }

  dispose() {
    this.running = false
    if (this.ticker) this.ticker.terminate()
    window.removeEventListener('resize', this._onResize)
    this.input.dispose()
    this.audio.dispose()
    this.renderer.dispose()
  }
}
