import * as THREE from 'three'
import { UP } from './constants.js'

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3()
const _ray = new THREE.Raycaster()
const _ndc = new THREE.Vector2()

export class DrawMode {
  constructor(scene, camera, flight, fogUniforms) {
    this.scene = scene
    this.camera = camera
    this.flight = flight
    this.active = false
    this.state = 'off' // idle | drawing | following
    this.points = []
    this.path = null
    this.idx = 0
    this.plane = new THREE.Plane()
    this.side = new THREE.Vector3(1, 0, 0)
    this.camPos = new THREE.Vector3()
    this.camLook = new THREE.Vector3()
    this.frozen = false
    this.mat = new THREE.MeshBasicMaterial({
      color: '#dff6ff', transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    })
    this.mesh = null
    this.prevMode = null
    this.followT = 0
    this.doneT = 0
    this.fogUniforms = fogUniforms
    this.rebuildCounter = 0
  }

  enter() {
    this.active = true
    this.state = 'idle'
    this.frozen = false
    this.points = []
    const f = this.flight.forward(_v)
    const fh = _v2.set(f.x, 0, f.z).normalize()
    // view from the plane's right side
    this.side.set(-fh.z, 0, fh.x)
    this.fwdH = fh.clone()
  }

  exit() {
    this.active = false
    this.state = 'off'
    this.clearMesh()
    if (this.flight.autopilot && !this.flight.locked) this.flight.autopilot = null
    this.path = null
  }

  clearMesh() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null }
  }

  shift(dx, dz) {
    for (const p of this.points) { p.x -= dx; p.z -= dz }
    if (this.path) for (const p of this.path) { p.x -= dx; p.z -= dz }
    this.camPos.x -= dx; this.camPos.z -= dz
    this.camLook.x -= dx; this.camLook.z -= dz
    this.plane.constant += this.plane.normal.x * dx + this.plane.normal.z * dz
    if (this.path) this.rebuildMesh(this.path.slice(this.idx))
  }

  unproject(e, out) {
    _ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
    _ray.setFromCamera(_ndc, this.camera)
    return _ray.ray.intersectPlane(this.plane, out)
  }

  pointerDown(e) {
    if (!this.active || this.state !== 'idle') return
    // freeze the camera and define the drawing surface through the aircraft
    this.frozen = true
    this.camPos.copy(this.camera.position)
    const n = _v.copy(this.camera.position).sub(this.flight.pos).normalize()
    this.plane.setFromNormalAndCoplanarPoint(n, this.flight.pos)
    this.points = []
    const p = this.unproject(e, new THREE.Vector3())
    if (p) this.points.push(p)
    this.state = 'drawing'
  }

  pointerMove(e) {
    if (!this.active || this.state !== 'drawing') return
    const p = this.unproject(e, new THREE.Vector3())
    if (!p) return
    const last = this.points[this.points.length - 1]
    if (!last || last.distanceTo(p) > 1.2) {
      this.points.push(p)
      if (this.rebuildCounter++ % 2 === 0) this.rebuildMesh(this.points)
    }
  }

  pointerUp() {
    if (!this.active || this.state !== 'drawing') return
    if (this.points.length < 4) { this.state = 'idle'; this.frozen = false; this.clearMesh(); return }
    // build the path from the aircraft to the drawing
    const pts = [this.flight.pos.clone()]
    const f = this.flight.forward(_v)
    pts.push(this.flight.pos.clone().addScaledVector(f, 4))
    for (const p of this.points) pts.push(p)
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
    const len = curve.getLength()
    this.path = curve.getSpacedPoints(Math.max(8, Math.floor(len / 1.5)))
    this.idx = 0
    this.state = 'following'
    this.followT = 0
    this.flight.autopilot = { forward: f.clone(), maxRate: 3.4, speed: 50 }
    // camera framing for the whole path
    const box = new THREE.Box3().setFromPoints(this.path)
    const c = box.getCenter(new THREE.Vector3())
    let r = 0
    for (const p of this.path) r = Math.max(r, p.distanceTo(c))
    this.frame = { c, r }
    this.rebuildMesh(this.path)
  }

  rebuildMesh(pts) {
    this.clearMesh()
    if (pts.length < 2) return
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
    const geo = new THREE.TubeGeometry(curve, Math.min(400, pts.length * 2), 0.45, 7, false)
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.renderOrder = 30
    this.scene.add(this.mesh)
  }

  update(sdt, dt) {
    if (!this.active) return
    const fl = this.flight
    if (this.state === 'following') {
      this.followT += dt
      const path = this.path
      const last = path.length - 1
      // advance the closest index monotonically
      let best = this.idx, bd = Infinity
      for (let i = this.idx; i <= Math.min(last, this.idx + 25); i++) {
        const d = path[i].distanceToSquared(fl.pos)
        if (d < bd) { bd = d; best = i }
      }
      this.idx = best
      const look = Math.round(THREE.MathUtils.clamp(fl.speed * 0.36, 9, 22) / 1.5)
      const target = path[Math.min(last, this.idx + look)]
      const dir = _v.copy(target).sub(fl.pos)
      if (dir.lengthSq() > 1e-4) fl.autopilot.forward.copy(dir.normalize())
      if (this.rebuildCounter++ % 4 === 0) this.rebuildMesh(path.slice(Math.max(0, this.idx - 1)))
      const endDist = path[last].distanceTo(fl.pos)
      if ((this.idx >= last - 1 && endDist < 12) || endDist < 4 || this.followT > 90) {
        this.doneT = 0
        this.state = 'done'
        this.clearMesh()
        fl.autopilot = null
      }
    } else if (this.state === 'done') {
      this.doneT += dt
      if (this.doneT > 0.8) this.exit()
    }
  }

  cameraTarget() {
    const fl = this.flight
    if (this.state === 'following' || this.state === 'done') {
      const { c, r } = this.frame
      const pos = _v.copy(c).addScaledVector(this.side, r * 1.55 + 40).addScaledVector(UP, r * 0.22 + 8)
      const look = _v2.copy(c).lerp(fl.pos, this.state === 'done' ? 0.85 : 0.3)
      return { pos: pos.clone(), look: look.clone(), fov: 52, rate: 2.5 }
    }
    if (this.frozen) {
      return { pos: this.camPos.clone(), look: this.camLook.clone(), fov: 55, rate: 6 }
    }
    // idle: tracking side view
    const pos = _v.copy(fl.pos).addScaledVector(this.side, 95).addScaledVector(UP, 20).addScaledVector(this.fwdH, 12)
    const look = _v2.copy(fl.pos).addScaledVector(this.fwdH, 12)
    this.camLook.copy(look)
    return { pos: pos.clone(), look: look.clone(), fov: 55, rate: 4 }
  }
}
