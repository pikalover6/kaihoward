import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { Sky, fogColorFor, fogDensityFor } from './sky.js'
import { Clouds } from './clouds.js'
import { buildPlane } from './plane.js'
import { Flight, LIGHT } from './flight.js'
import { Input } from './input.js'
import { CameraRig } from './cameras.js'
import { DrawMode } from './drawpath.js'
import { Terrain, GLSL_NOISE as TN, GLSL_TERRAIN as TT, terrainH as th } from './terrain.js'
import { Life } from './life.js'
import { Effects } from './effects.js'
import { SkyAudio } from './audio.js'
import { speedText, TIERS } from './units.js'
import { SUN_DIR, CLOUD_Y, ORIGIN_SHIFT } from './constants.js'

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3()
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3()
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _qi = new THREE.Quaternion()
const ZERO_INPUT = { pitch: 0, roll: 0, yaw: 0, throttle: 0, pdx: 0, pdy: 0, wheel: 0 }
const EXHAUST = new THREE.Vector3(0.55, -0.35, -1.55)

const SIGNS = ['uh oh', 'help', 'oops', 'bye', 'hmm', 'mom?', 'not again', 'brb', 'gravity?', 'wait', 'nope', 'yikes', 'ok then', 'why']
const BOINGS = ['boing!', 'boink!', 'sproing!', 'bwomp!', 'doink!']
const pick = a => a[Math.floor(Math.random() * a.length)]
const smooth = THREE.MathUtils.smoothstep

// volume-preserving stretch by s along unit axis a, as a 4x4
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
    this.state = { mode: 'chase', draw: 'off', sound: false, landing: false, engine: true }

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 0.95
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer = renderer

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 60000)
    this.scene.add(this.camera)

    // fog (uniforms shared with custom shaders)
    this.fogUniforms = { color: { value: fogColorFor(200) }, density: { value: fogDensityFor(200) } }
    this.scene.fog = new THREE.FogExp2(this.fogUniforms.color.value.getHex(), this.fogUniforms.density.value)
    this.scene.fog.color = this.fogUniforms.color.value

    // lights
    this.hemi = new THREE.HemisphereLight('#bfe3ff', '#ffffff', 1.0)
    this.sun = new THREE.DirectionalLight('#fff4e2', 2.4)
    this.sun.position.copy(SUN_DIR).multiplyScalar(100)
    this.sunTarget = new THREE.Object3D()
    this.scene.add(this.hemi, this.sun, this.sunTarget)
    this.sun.target = this.sunTarget

    // systems
    this.sky = new Sky()
    this.scene.add(this.sky.mesh)
    this.clouds = new Clouds(this.scene, this.fogUniforms)
    this.plane = buildPlane(this.fogUniforms)
    this.plane.root.matrixAutoUpdate = false
    this.plane.trailL.maxGap = this.plane.trailR.maxGap = 600
    this.scene.add(this.plane.root, this.plane.trailL.mesh, this.plane.trailR.mesh, this.plane.scarf.mesh)
    this.scene.add(this.plane.sign) // held up by the pilot, but always upright and facing the camera
    this.flight = new Flight()
    this.input = new Input(canvas)
    this.rig = new CameraRig(this.camera)
    this.draw = new DrawMode(this.scene, this.camera, this.flight, this.fogUniforms)
    this.terrain = new Terrain(this.scene, this.fogUniforms)
    this.life = new Life(this.scene, this.fogUniforms)
    this.effects = new Effects(this.scene)
    this.audio = new SkyAudio()

    // what the physics can bump into
    this.world = {
      ground: (x, z) => this.terrain.heightAt(x, z),
      groundNormal: (x, z, out) => {
        const e = 4, t = this.terrain
        return out.set(t.heightAt(x - e, z) - t.heightAt(x + e, z), 2 * e, t.heightAt(x, z - e) - t.heightAt(x, z + e)).normalize()
      },
      deck: (x, z) => this.clouds.deckTop(x, z),
    }

    // environment map from the sky
    this.pmrem = new THREE.PMREMGenerator(renderer)
    this.envScene = new THREE.Scene()
    this.envSky = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), this.sky.material)
    this.envScene.add(this.envSky)
    this.envAlt = -1e9
    this.envT = 0
    this.refreshEnv(200)

    // post
    // the composer draws to its own target, so the canvas's antialias flag does nothing for the scene;
    // a multisampled target keeps thin things (balloon ropes, wingtip trails) from breaking into dashes
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }))
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.5, 0.96)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    this.useBloom = !this.input.isTouch

    this.landing = null
    this.fade = 0
    this.timeScale = 1
    this.time = 0
    this.last = performance.now()
    this.running = true
    this.frame = 0
    this.propAngle = 0
    this.propSpeed = 40
    this.tier = -1
    this.plaid = 0
    this.head = { yaw: 0, pitch: 0 }
    this.signT = 0
    this.lookDownT = 0
    this.hud = null

    this.input.on('press', k => this.onKey(k))
    this.input.on('pointerdown', e => this.draw.pointerDown(e))
    this.input.on('pointermove', e => this.draw.pointerMove(e))
    this.input.on('pointerup', e => this.draw.pointerUp(e))

    this.resize()
    this._onResize = () => this.resize()
    window.addEventListener('resize', this._onResize)
    this._loop = () => this.loop()
    this.schedule()
    this.emit()
    if (import.meta.env.DEV) { window.__engine = this; window.__THREE = THREE; window.__glsl = { TN, TT, th } }
  }

  emit(partial) {
    if (partial) Object.assign(this.state, partial)
    this.onState && this.onState({ ...this.state })
  }

  onKey(k) {
    if (k === 'v') this.cycleView()
    else if (k === 'f') this.toggleDraw()
    else if (k === 'm') this.toggleSound()
    else if (k === 'r') this.respawn()
    else if (k === ' ' || k === 'x') this.toggleEngine()
    else if (k === 'escape') { if (this.draw.active) this.toggleDraw() }
  }

  respawn() {
    if (this.landing) return
    if (this.draw.active) { this.draw.exit(); this.timeScale = 1; this.emit({ draw: 'off' }) }
    this.landing = { phase: 'fade', t: 0 }
    this.flight.locked = true
  }

  toggleEngine() {
    if (this.landing || this.flight.autopilot) return
    this.flight.setEngine(!this.flight.engine)
  }

  cycleView() {
    if (this.draw.active) return
    this.rig.next()
    this.emit({ mode: this.rig.mode })
  }

  toggleDraw() {
    if (this.landing) return
    if (this.draw.active) { this.draw.exit(); this.timeScale = 1 }
    else this.draw.enter()
    this.emit({ draw: this.draw.active ? this.draw.state : 'off' })
  }

  toggleSound() {
    this.audio.toggle()
    this.emit({ sound: this.audio.on })
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  refreshEnv(alt) {
    this.sky.uniforms.uAlt.value = alt
    this.sky.uniforms.uFogColor.value.copy(fogColorFor(alt))
    this.sky.uniforms.uBelow.value = THREE.MathUtils.smoothstep(-(alt - CLOUD_Y), 60, 300)
    this.sky.uniforms.uCeil.value = Math.max(0, CLOUD_Y - alt)
    this.sky.uniforms.uFogDensity.value = fogDensityFor(alt)
    const old = this.scene.environment
    this.scene.environment = this.pmrem.fromScene(this.envScene, 0.04).texture
    if (old) old.dispose()
    this.envAlt = alt
    this.envT = 0
  }

  shiftOrigin() {
    const p = this.flight.pos
    if (Math.abs(p.x) < ORIGIN_SHIFT && Math.abs(p.z) < ORIGIN_SHIFT) return
    const dx = Math.round(p.x), dz = Math.round(p.z)
    p.x -= dx; p.z -= dz
    this.clouds.shift(dx, dz)
    this.rig.shift(dx, dz)
    this.draw.shift(dx, dz)
    this.terrain.shift(dx, dz)
    this.life.shift(dx, dz)
    this.effects.shift(dx, dz)
    this.plane.trailL.shift(dx, dz); this.plane.trailR.shift(dx, dz); this.plane.scarf.shift(dx, dz)
    this.camera.position.x -= dx; this.camera.position.z -= dz
  }

  // fade out, respawn above the clouds, fade in
  updateRespawn(dt) {
    const L = this.landing
    if (!L) return
    L.t += dt
    const fl = this.flight
    if (L.phase === 'fade') {
      this.fade = Math.min(1, L.t / 0.7)
      if (L.t > 0.9) {
        fl.respawn()
        fl.events.length = 0
        this.rig.first = true
        this.rig.sq.copy(fl.quat)
        this.plane.trailL.clear(); this.plane.trailR.clear(); this.plane.scarf.clear()
        this.effects.clear()
        this.plane.sign.visible = false
        this.tier = -1
        L.phase = 'fadein'; L.t = 0
      }
    } else {
      this.fade = Math.max(0, 1 - L.t / 1.2)
      if (L.t > 1.2) this.landing = null
    }
  }

  // ------------------------------------------------------------ cartoon consequences
  pop(text, pos, kind = '') {
    if (!this.onPop) return
    const w = window.innerWidth, h = window.innerHeight
    let x = w / 2, y = h * 0.4
    if (pos) {
      _v.copy(pos).project(this.camera)
      if (_v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2) {
        x = THREE.MathUtils.clamp((_v.x + 1) / 2 * w, 80, w - 80)
        y = THREE.MathUtils.clamp((1 - _v.y) / 2 * h, 60, h - 90)
      }
    }
    this.onPop({ text, x, y, kind })
  }

  exhaust(out) { return out.copy(EXHAUST).applyQuaternion(this.flight.quat).add(this.flight.pos) }

  handleEvents(events) {
    const fl = this.flight, fx = this.effects, A = this.audio
    for (const e of events) {
      switch (e.type) {
        case 'engineOff': {
          A.sputter()
          for (let i = 0; i < 4; i++) {
            fx.puffs.spawn(this.exhaust(_v), {
              vel: _v2.copy(fl.vel).multiplyScalar(0.6).add(_v3.set(Math.random() - 0.5, 0.6, Math.random() - 0.5).multiplyScalar(4)),
              size: 0.4 + i * 0.18, grow: 2, life: 1.3, color: '#5a5e6a', alpha: 0.7, drag: 1.2,
            })
          }
          this.pop('sputter', this.exhaust(_v), 'small')
          break
        }
        case 'engineOn':
          A.cough()
          for (let i = 0; i < 2; i++) fx.puffs.spawn(this.exhaust(_v), { vel: _v2.copy(fl.vel).multiplyScalar(0.6), size: 0.7, grow: 2, life: 1, color: '#8d919c', alpha: 0.8 })
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
          } else {
            A.boing(k)
            if (e.speed > 14) fx.splash(e.pos, e.n, { n: 6 + Math.round(k * 10), speed: 10 + e.speed * 0.3, size: 1.4 + k * 2, grow: 4 + k * 8, color: '#c8b48c', alpha: 0.8 })
            if (e.speed > 24) this.pop(pick(BOINGS), e.pos)
          }
          if (e.speed > 30) fx.rings.spawn(e.pos, e.n, { size: 1, grow: 6 + k * 20, life: 0.5, alpha: 0.6 })
          this.rig.kick(Math.min(1.6, e.speed / 90))
          break
        }
        case 'splat':
          A.splat()
          this.rig.kick(2.5)
          fx.splash(e.pos, e.n, { n: 18, speed: 60, size: 3, grow: 12, life: 1.4, color: e.surface === 'sky' ? '#ffe680' : '#c8b48c', alpha: 0.9, lift: 0.25 })
          fx.rings.spawn(e.pos, e.n, { size: 2, grow: 40, life: 0.8, alpha: 0.8 })
          if (e.surface === 'sky') this.sky.uniforms.uRipple.value.set(0, 1, 0, this.time)
          this.pop('splat!', e.pos, 'big')
          break
        case 'unsplat':
          A.boing(0.9)
          this.pop('pop!', fl.pos, 'small')
          break
        case 'cloud':
          A.poof()
          fx.splash(_v.copy(fl.pos).setY(fl.pos.y - 1.5), _v2.set(0, 1, 0), { n: 9, speed: 12 + e.speed * 0.25, size: 1.6, grow: 3.5, life: 1.2, color: '#ffffff', alpha: 0.85, lift: 0.35, radius: 3.5 })
          if (e.speed > 20) this.pop('poof', fl.pos, 'small')
          break
      }
    }
  }

  // named speeds, the sound barrier, and plaid
  updateTier(dt) {
    const fl = this.flight, sp = fl.speed
    let t = -1
    for (let i = 0; i < TIERS.length; i++) if (sp >= TIERS[i].at) t = i
    if (t > this.tier) {
      if (this.tier < 0 && t >= 0) {
        // the sound barrier, broken: a vapour ring and a boom
        const dir = _v2.copy(fl.vel).normalize()
        this.effects.rings.spawn(_v.copy(fl.pos).addScaledVector(dir, -4), dir, { size: 3, grow: 70, life: 1.1, alpha: 0.85 })
        this.effects.rings.spawn(_v.copy(fl.pos).addScaledVector(dir, -9), dir, { size: 2, grow: 45, life: 0.9, alpha: 0.6 })
        this.audio.boom()
        this.rig.kick(1.8)
        this.pop('kaboom!', fl.pos, 'big')
      }
      if (this.onTier) this.onTier(TIERS[t].name)
      this.tier = t
    } else if (t < this.tier && sp < TIERS[this.tier].at * 0.8) this.tier = t
    const plaid = sp > LIGHT * 1000 ? 1 : 0
    this.plaid += (plaid - this.plaid) * (1 - Math.exp(-dt * 1.5))
    this.sky.uniforms.uPlaid.value = this.plaid
  }

  // the plane's body language
  updatePlane(sdt, dt) {
    const fl = this.flight, P = this.plane, t = this.time
    const sp = fl.speed
    const f = fl.forward(_f), u = fl.up(_u), r = fl.right(_r)

    // rubber: stretched along the momentum (not the nose) with every decade of speed,
    // squashed along whatever it last hit
    const J = fl.jiggle
    _m.makeRotationFromQuaternion(fl.quat)
    if (sp > 1) {
      const s = 1 + Math.min(0.5, 0.075 * Math.log2(1 + sp / 120))
      _m.premultiply(stretchMatrix(_m2, _v.copy(fl.vel).divideScalar(sp), s))
    }
    if (Math.abs(J.x) > 1e-3) _m.premultiply(stretchMatrix(_m2, J.axis, 1 + J.x))
    _m.setPosition(fl.pos)
    P.root.matrix.copy(_m)
    P.root.matrixWorldNeedsUpdate = true
    P.root.position.copy(fl.pos)
    P.root.quaternion.copy(fl.quat)

    // idle bob while flying; a shudder while the engine catches
    const catching = fl.engine && fl.spool < 1 ? 1 - fl.spool : 0
    P.body.position.set((Math.random() - 0.5) * 0.08 * catching, Math.sin(t * 1.7) * 0.04 * fl.intent + (Math.random() - 0.5) * 0.06 * catching, 0)
    P.body.rotation.z = Math.sin(t * 1.1) * 0.01 * fl.intent

    // prop: follows the push, spins backwards in reverse, coughs into life, stops dead when cut
    let target = 0
    if (fl.engine) {
      const effort = Math.min(1, Math.abs(fl.push) / 60)
      target = (fl.push < -1 ? -1 : 1) * (14 + 32 * effort + 9 * Math.log10(1 + sp / 60)) * (0.3 + 0.7 * fl.spool)
      if (catching) target *= 0.5 + 0.5 * Math.sin(t * 37)
    }
    this.propSpeed += (target - this.propSpeed) * (1 - Math.exp(-sdt * (fl.engine ? 3 : 1.2)))
    if (!fl.engine && Math.abs(this.propSpeed) < 2.5) this.propSpeed = 0
    this.propAngle += sdt * this.propSpeed
    P.prop.rotation.z = this.propAngle
    P.blur.material.opacity = THREE.MathUtils.clamp((Math.abs(this.propSpeed) - 8) / 30, 0, 0.18)
    P.pilot.visible = this.rig.mode !== 'cockpit'
    P.scarf.mesh.visible = P.pilot.visible

    // the pilot's head: looks where the plane is really going, at you when nothing is happening,
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
    const wide = fl.oblivious > 0 || this.lookDownT > 0 ? 1.45 : 1
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
      S.position.addScaledVector(_v4.set(1, 0, 0).applyQuaternion(this.camera.quaternion), 1.1)
        .addScaledVector(_v4.subVectors(this.camera.position, S.position).normalize(), 1.6)
        .addScaledVector(camUp, -2.4 + 2.9 * (1 - (1 - k) ** 3) + Math.sin(this.signT * 9) * 0.03)
      S.quaternion.copy(this.camera.quaternion)
      S.rotateZ(Math.sin(this.signT * 4) * 0.06)
    } else if (S.visible) {
      this.signT = -1
      S.position.addScaledVector(camUp, -dt * 9)
      S.visible = S.position.distanceTo(fl.pos) < 4
    }

    // dizzy stars
    P.stars.visible = fl.daze > 0.15
    if (P.stars.visible) {
      P.stars.children.forEach((st, i) => {
        const a = t * 4 + (i / 5) * Math.PI * 2
        st.position.set(Math.cos(a) * 0.36, Math.sin(t * 6 + i) * 0.05, Math.sin(a) * 0.36)
        st.rotation.set(0, -a, t * 5)
      })
    }

    // trails: g-loading, and permanent contrails once it's fast
    const gl = THREE.MathUtils.clamp((fl.gLoad - 0.9) / 1.6, 0, 1)
    const fast = smooth(sp, 250, 1500)
    const trailA = Math.max((0.06 + gl * 0.9) * (0.5 + 0.5 * Math.min(1, sp / 90)), fast * 0.7)
    const tipL = _v.copy(fl.pos).addScaledVector(r, -3.55).addScaledVector(f, 0.4).addScaledVector(u, 0.15)
    P.trailL.push(tipL, u, trailA, 0.35)
    const tipR = _v.copy(fl.pos).addScaledVector(r, 3.55).addScaledVector(f, 0.4).addScaledVector(u, 0.15)
    P.trailR.push(tipR, u, trailA, 0.35)
    P.trailL.rebuild(); P.trailR.rebuild()

    // scarf: streams along the relative wind, so it blows forward when you fly backwards
    // and straight up when you fall; at a dead stop it just floats
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
    const flut = 0.06 + Math.min(0.22, sp / 500)
    const neck = this.scarfNeck || (this.scarfNeck = new THREE.Vector3())
    neck.copy(fl.pos).addScaledVector(u, 0.86).addScaledVector(f, -0.05)
    const sc = this.scarfSide || (this.scarfSide = new THREE.Vector3())
    P.scarf.setSamples(i => {
      const k = i / (P.scarf.n - 1)
      const back = 0.05 + k * 2.4
      const wave = Math.sin(t * 16 - k * 7) * flut * k + Math.sin(t * 9 - k * 4) * flut * 0.5 * k
      const c = _v.copy(neck).addScaledVector(wind, back).addScaledVector(width, wave * 0.6)
        .addScaledVector(side, Math.sin(t * 11 - k * 5) * flut * k * 1.2 + 0.05)
      c.y -= k * k * 0.3 * fl.aware * (1 - smooth(sp, 30, 200))
      return { c: c.clone(), s: sc.copy(width).addScaledVector(side, 0.35).normalize(), a: 1 }
    })
    P.scarf.rebuild()
  }

  updateHud() {
    if (!this.onHud) return
    const fl = this.flight
    let status
    if (fl.splat) status = 'splat'
    else if (fl.daze > 0) status = 'seeing stars'
    else if (!fl.engine) status = fl.touching === 'cloud' && fl.speed < 4 ? 'napping on a cloud' : 'engine off'
    else if (fl.spool < 1) status = 'starting…'
    else if (Math.abs(fl.lever) < 0.02) status = 'hovering'
    else if (fl.lever < 0) status = 'reverse'
    else status = 'engine on'
    const dial = fl.dial
    const showDial = fl.engine && !fl.autopilot && Math.abs(dial) > 1 && Math.abs(Math.abs(dial) - fl.speed) > Math.max(6, Math.abs(dial) * 0.12)
    this.onHud({
      speed: fl.speed,
      text: speedText(fl.speed),
      dial: showDial ? speedText(Math.abs(dial)) : null,
      status,
      engine: fl.engine,
    })
  }

  loop() {
    if (!this.running) return
    this.schedule()
    const now = performance.now()
    let dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.frame++
    const inp = this.input.poll()

    // draw mode owns the time scale while drawing
    if (this.draw.active) this.timeScale = this.draw.state === 'drawing' ? 0.07 : 1
    const sdt = dt * this.timeScale
    this.time += sdt

    const fl = this.flight
    fl.step(sdt, this.draw.active && this.draw.state !== 'idle' ? ZERO_INPUT : inp, this.world)
    this.draw.update(sdt, dt)
    if (this.draw.state !== this.lastDrawState) {
      this.lastDrawState = this.draw.state
      if (!this.draw.active) this.timeScale = 1
      this.emit({ draw: this.draw.active ? this.draw.state : 'off' })
    }
    if (fl.engine !== this.state.engine) this.emit({ engine: fl.engine })
    this.handleEvents(fl.events.splice(0))
    this.updateRespawn(dt)
    this.shiftOrigin()
    this.updateTier(dt)
    this.updatePlane(sdt, dt)

    // camera
    const override = this.draw.active ? this.draw.cameraTarget() : null
    this.rig.update(dt, fl, inp, override)
    const camFloor = this.terrain.heightAt(this.camera.position.x, this.camera.position.z) + 2.5
    if (this.camera.position.y < camFloor) { this.camera.position.y = camFloor; this.rig.cur.pos.y = camFloor }
    this.camera.updateMatrixWorld()

    // atmosphere by altitude
    const alt = this.camera.position.y
    const inside = this.clouds.insideAmount(this.camera.position)
    this.fogUniforms.color.value.copy(fogColorFor(alt))
    this.fogUniforms.density.value = fogDensityFor(alt) + inside * 0.012
    this.scene.fog.density = this.fogUniforms.density.value
    const below = THREE.MathUtils.smoothstep(-(alt - CLOUD_Y), 40, 260)
    const nearGround = THREE.MathUtils.smoothstep(-(alt - CLOUD_Y), 1800, 3200)
    this.sun.intensity = THREE.MathUtils.lerp(2.4, 0.9, below) * (1 - inside * 0.5)
    this.sun.color.set('#fff4e2').lerp(new THREE.Color('#dfe8f4'), below)
    this.hemi.intensity = THREE.MathUtils.lerp(1.0, 0.55, below) + inside * 0.6
    this.hemi.color.set('#bfe3ff').lerp(new THREE.Color('#9fb1c9'), below)
    this.hemi.groundColor.set('#ffffff').lerp(new THREE.Color('#8f9c96'), below).lerp(new THREE.Color('#8fa57f'), nearGround)
    this.sunTarget.position.copy(this.camera.position)
    this.sun.position.copy(this.camera.position).addScaledVector(SUN_DIR, 100)
    // the env map is expensive, so even a plane ping-ponging between ground and sky only refreshes it now and then
    this.envT += dt
    const envStale = Math.abs(alt - this.envAlt) > 350 || (alt < CLOUD_Y) !== (this.envAlt < CLOUD_Y) || Math.abs(this.plaid - (this.envPlaid ?? 0)) > 0.2
    if (envStale && this.envT > 0.5) { this.envPlaid = this.plaid; this.refreshEnv(alt) }

    // terrain has its own haze so the ground seen through cloud breaks is always distant and soft
    const tu = this.terrain.uniforms
    // the terrain fades into exactly the sky's haze colour so its outer edge is never visible
    tu.uFogColor.value.copy(this.fogUniforms.color.value)
    tu.uFogDensity.value = Math.max(this.fogUniforms.density.value, 0.00029)
    tu.uSunI.value = THREE.MathUtils.lerp(0.95, 0.5, below)
    tu.uAmb.value = THREE.MathUtils.lerp(1.0, 0.95, below)
    tu.uSkyCol.value.copy(this.hemi.color)
    tu.uGroundCol.value.copy(this.hemi.groundColor)

    // systems
    this.sky.update(this.time, this.camera, alt)
    this.clouds.update(sdt, this.camera, fl.pos)
    this.terrain.update(fl.pos, this.camera, this.time)
    this.life.update(sdt, this.time, fl, this.camera, this.audio)
    this.effects.update(sdt, this.camera, fl)
    this.audio.update({
      speed: fl.speed, push: fl.push, spool: fl.spool, engine: fl.engine, inside, dt: sdt,
      falling: fl.intent < 0.5 && !fl.splat && fl.airborne && fl.aware > 0.5 && fl.vel.y < -30,
    })
    this.updateHud()

    if (this.useBloom) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
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
