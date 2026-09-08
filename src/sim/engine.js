import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { Sky, fogColorFor, fogDensityFor } from './sky.js'
import { Clouds } from './clouds.js'
import { buildPlane } from './plane.js'
import { Flight } from './flight.js'
import { Input } from './input.js'
import { CameraRig } from './cameras.js'
import { DrawMode } from './drawpath.js'
import { Terrain, GLSL_NOISE as TN, GLSL_TERRAIN as TT, terrainH as th } from './terrain.js'
import { Life } from './life.js'
import { SkyAudio } from './audio.js'
import { SUN_DIR, CLOUD_Y, GROUND_Y, ORIGIN_SHIFT, UP } from './constants.js'

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3()
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3()

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
    this.scene.add(this.plane.root, this.plane.trailL.mesh, this.plane.trailR.mesh, this.plane.scarf.mesh)
    this.flight = new Flight()
    this.input = new Input(canvas)
    this.rig = new CameraRig(this.camera)
    this.draw = new DrawMode(this.scene, this.camera, this.flight, this.fogUniforms)
    this.terrain = new Terrain(this.scene, this.fogUniforms)
    this.life = new Life(this.scene, this.fogUniforms)
    this.audio = new SkyAudio()

    // environment map from the sky
    this.pmrem = new THREE.PMREMGenerator(renderer)
    this.envScene = new THREE.Scene()
    this.envSky = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), this.sky.material)
    this.envScene.add(this.envSky)
    this.envAlt = -1e9
    this.refreshEnv(200)

    // post
    this.composer = new EffectComposer(renderer)
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
    this.wingSpin = 0
    this.propAngle = 0

    this.input.on('press', k => this.onKey(k))
    this.input.on('pointerdown', e => this.draw.pointerDown(e))
    this.input.on('pointermove', e => this.draw.pointerMove(e))
    this.input.on('pointerup', e => this.draw.pointerUp(e))

    this.resize()
    this._onResize = () => this.resize()
    window.addEventListener('resize', this._onResize)
    this._loop = () => this.loop()
    requestAnimationFrame(this._loop)
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
    else if (k === ' ') { if (!this.flight.locked && !this.flight.autopilot) this.flight.startBarrelRoll(this.input.has('a', 'arrowleft') ? -1 : 1) }
    else if (k === 'x') this.toggleEngine()
    else if (k === 'r') this.respawn()
    else if (k === 'escape') { if (this.draw.active) this.toggleDraw() }
  }

  toggleEngine() {
    if (this.flight.locked) return
    this.flight.engine = !this.flight.engine
    this.emit({ engine: this.flight.engine })
  }

  respawn() {
    if (this.landing) return
    if (this.draw.active) { this.draw.exit(); this.timeScale = 1; this.emit({ draw: 'off' }) }
    this.landing = { phase: 'fade', t: 0 }
    this.flight.locked = true
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
    this.plane.trailL.shift(dx, dz); this.plane.trailR.shift(dx, dz); this.plane.scarf.shift(dx, dz)
    this.camera.position.x -= dx; this.camera.position.z -= dz
  }

  // you can't crash: the ground gently pushes the nose up and holds the plane above it
  updateFloor(dt) {
    const fl = this.flight
    const g = this.terrain.heightAt(fl.pos.x, fl.pos.z)
    const agl = fl.pos.y - g
    if (agl > 60) return
    const f = fl.forward(_v)
    const sy = fl.up(_v2).y >= 0 ? 1 : -1
    const push = THREE.MathUtils.clamp(1 - agl / 60, 0, 1)
    if (f.y < 0.05) fl.rotateLocal(new THREE.Vector3(1, 0, 0), (0.05 - f.y) * push * 3.5 * sy * dt)
    if (agl < 5) { fl.pos.y = g + 5; if (fl.speed < 30 && fl.engine) fl.speed = 30 }
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
        this.rig.first = true
        this.rig.sq.copy(fl.quat)
        this.plane.trailL.clear(); this.plane.trailR.clear(); this.plane.scarf.clear()
        L.phase = 'fadein'; L.t = 0
        this.emit({ engine: true })
      }
    } else {
      this.fade = Math.max(0, 1 - L.t / 1.2)
      if (L.t > 1.2) this.landing = null
    }
  }

  loop() {
    if (!this.running) return
    // in dev, keep simulating when the tab is hidden (browser automation / background testing)
    if (import.meta.env.DEV && document.hidden) this.workerTick(this._loop)
    else requestAnimationFrame(this._loop)
    const now = performance.now()
    let dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.frame++
    const inp = this.input.poll()
    if (this.input.isTouch && !this.flight.locked) this.flight.throttle = 0.6

    // draw mode owns the time scale while drawing
    if (this.draw.active) this.timeScale = this.draw.state === 'drawing' ? 0.07 : 1
    const sdt = dt * this.timeScale
    this.time += sdt

    const fl = this.flight
    fl.step(sdt, this.draw.active && this.draw.state !== 'idle' ? { pitch: 0, roll: 0, yaw: 0, throttle: 0, pdx: 0, pdy: 0, wheel: 0 } : inp)
    this.draw.update(sdt, dt)
    if (this.draw.state !== this.lastDrawState) {
      this.lastDrawState = this.draw.state
      if (!this.draw.active) this.timeScale = 1
      this.emit({ draw: this.draw.active ? this.draw.state : 'off' })
    }
    this.updateFloor(sdt)
    this.updateRespawn(dt)
    this.shiftOrigin()

    // plane visuals
    const P = this.plane
    P.root.position.copy(fl.pos)
    P.root.quaternion.copy(fl.quat)
    // little bob and prop
    P.body.position.y = Math.sin(this.time * 1.7) * 0.04
    P.body.rotation.z = Math.sin(this.time * 1.1) * 0.01
    this.propSpeed = this.propSpeed ?? 40
    const propTarget = fl.engine ? 18 + fl.throttle * 30 + fl.speed * 0.15 : fl.speed * 0.03
    this.propSpeed += (propTarget - this.propSpeed) * (1 - Math.exp(-sdt * 1.5))
    this.propAngle += sdt * this.propSpeed
    P.prop.rotation.z = this.propAngle
    P.blur.material.opacity = THREE.MathUtils.clamp((this.propSpeed - 8) / 30, 0, 0.18)
    P.pilot.visible = this.rig.mode !== 'cockpit'
    P.scarf.mesh.visible = P.pilot.visible
    // trails
    const r = fl.right(_r), f = fl.forward(_f), u = fl.up(_u)
    const gl = THREE.MathUtils.clamp((fl.gLoad - 0.9) / 1.6, 0, 1)
    const trailA = (0.06 + gl * 0.9) * (0.5 + 0.5 * Math.min(1, fl.speed / 90))
    const tipL = _v.copy(fl.pos).addScaledVector(r, -3.55).addScaledVector(f, 0.4).addScaledVector(u, 0.15)
    P.trailL.push(tipL, u, trailA, 0.35)
    const tipR = _v.copy(fl.pos).addScaledVector(r, 3.55).addScaledVector(f, 0.4).addScaledVector(u, 0.15)
    P.trailR.push(tipR, u, trailA, 0.35)
    P.trailL.rebuild(); P.trailR.rebuild()
    // scarf: lives in the plane's frame, flutters with speed
    const sc = this.scarfSide || (this.scarfSide = new THREE.Vector3())
    const flut = 0.06 + Math.min(0.22, fl.speed / 500)
    P.scarf.setSamples(i => {
      const k = i / (P.scarf.n - 1)
      const back = -0.05 + k * 2.4
      const wave = Math.sin(this.time * 16 - k * 7) * flut * k + Math.sin(this.time * 9 - k * 4) * flut * 0.5 * k
      const c = _v.copy(fl.pos).addScaledVector(u, 0.86 + wave * 0.6 - k * k * 0.35).addScaledVector(f, -back)
        .addScaledVector(r, Math.sin(this.time * 11 - k * 5) * flut * k * 1.2 + 0.05)
      return { c: c.clone(), s: sc.copy(u).addScaledVector(r, 0.35).normalize(), a: 1 }
    })
    P.scarf.rebuild()

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
    if (Math.abs(alt - this.envAlt) > 350 || (alt < CLOUD_Y) !== (this.envAlt < CLOUD_Y)) this.refreshEnv(alt)

    // terrain has its own haze so the ground seen through cloud breaks is always distant and soft
    const tu = this.terrain.uniforms
    tu.uFogColor.value.copy(fogColorFor(Math.min(alt, CLOUD_Y - 400)))
    tu.uFogDensity.value = Math.max(this.fogUniforms.density.value, 0.00036)
    tu.uSunI.value = THREE.MathUtils.lerp(0.95, 0.5, below)
    tu.uAmb.value = THREE.MathUtils.lerp(1.0, 0.95, below)
    tu.uSkyCol.value.copy(this.hemi.color)
    tu.uGroundCol.value.copy(this.hemi.groundColor)

    // systems
    this.sky.update(this.time, this.camera, alt)
    this.clouds.update(sdt, this.camera, fl.pos)
    this.terrain.update(fl.pos, this.camera, this.time)
    this.life.update(sdt, this.time, fl, this.camera, this.audio)
    this.audio.update(fl.engine ? fl.speed : 0, fl.engine ? fl.throttle : 0, inside, fl.engine ? 0 : 1, fl.speed)

    if (this.useBloom) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
    if (this.onFade) this.onFade(this.fade)
  }

  workerTick(fn) {
    if (!this.ticker) {
      const src = 'setInterval(() => postMessage(0), 16)'
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
