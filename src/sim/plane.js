import * as THREE from 'three'
import { Ribbon } from './ribbon.js'
import { n64Material } from './n64.js'

// A chunky little cartoon plane, low-poly and primary-coloured, with a rocket strapped to
// its belly for the boost (it's that kind of plane). Nose at -Z, up +Y.

function lathe(profile, segs) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y))
  const g = new THREE.LatheGeometry(pts, segs)
  g.rotateX(-Math.PI / 2) // +Y (nose) -> -Z
  return g
}

function decal(draw, size = 32) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  draw(cv.getContext('2d'), size)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.NoColorSpace
  t.magFilter = THREE.LinearFilter
  return t
}

export function buildPlane() {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  const M = {
    red: n64Material({ color: '#e8382f' }),
    yellow: n64Material({ color: '#ffd23a' }),
    blue: n64Material({ color: '#2f8fe8' }),
    white: n64Material({ color: '#ffffff' }),
    dark: n64Material({ color: '#2a2e3a' }),
    skin: n64Material({ color: '#f6c9a0' }),
    leather: n64Material({ color: '#8a5530' }),
    glass: n64Material({ color: '#bfe8ff', emissive: 0.3 }),
    flame: n64Material({ color: '#ffe066', emissive: 1 }),
    flame2: n64Material({ color: '#ff7a1a', emissive: 1 }),
  }
  const star = decal((c, s) => {
    c.fillStyle = '#ffd23a'; c.fillRect(0, 0, s, s)
    c.fillStyle = '#2f8fe8'; c.beginPath(); c.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2); c.fill()
    c.fillStyle = '#ffffff'; c.beginPath()
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? s * 0.13 : s * 0.32
      c.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r)
    }
    c.fill()
  })
  M.wingStar = n64Material({ map: star })

  // fuselage: fat and short, 8 sides so it reads as low-poly
  body.add(new THREE.Mesh(lathe([
    [0.0, -2.75], [0.55, -2.6], [0.82, -2.0], [0.95, -0.8], [0.92, 0.6], [0.68, 1.8], [0.35, 2.7], [0.0, 2.9],
  ], 8), M.red))
  // cowl and spinner
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.9, 0.6, 8).rotateX(Math.PI / 2), M.blue)
  cowl.position.z = -2.45
  body.add(cowl)
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 8).rotateX(-Math.PI / 2), M.white)
  spinner.position.z = -3.0
  body.add(spinner)

  // propeller: two fat blades
  const prop = new THREE.Group()
  prop.position.z = -2.85
  for (let i = 0; i < 2; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.25, 0.08), M.dark)
    blade.position.y = 0.68
    blade.rotation.y = 0.5
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.09), M.yellow)
    tip.position.y = 1.28
    tip.rotation.y = 0.5
    const arm = new THREE.Group()
    arm.add(blade, tip)
    arm.rotation.z = i * Math.PI
    prop.add(arm)
  }
  const blur = new THREE.Mesh(new THREE.CircleGeometry(1.35, 12), n64Material({ color: '#e8eef8', alpha: 0.0, depthWrite: false, side: THREE.DoubleSide, fog: 1 }))
  blur.position.z = -2.86
  body.add(prop, blur)

  // wings: thick slabs with a star on top, slight dihedral
  for (const sign of [1, -1]) {
    const w = new THREE.Group()
    const slab = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.3, 1.6), [M.yellow, M.yellow, M.wingStar, M.yellow, M.yellow, M.yellow])
    slab.position.x = sign * 1.85
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.34, 1.6), M.red)
    tip.position.x = sign * 3.62
    w.add(slab, tip)
    w.position.set(0, -0.25, -0.6)
    w.rotation.z = sign * 0.09
    body.add(w)
  }
  // tail: tailplane and a blue fin with a white stripe
  const tailplane = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.18, 0.9), M.yellow)
  tailplane.position.set(0, 0.2, 2.45)
  body.add(tailplane)
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.4, 1.05), M.blue)
  fin.position.set(0, 0.95, 2.45)
  fin.rotation.x = -0.25
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 1.07), M.white)
  stripe.position.set(0, 1.25, 2.38)
  stripe.rotation.x = -0.25
  body.add(fin, stripe)

  // landing gear
  for (const sign of [1, -1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.75, 0.14), M.dark)
    strut.position.set(sign * 0.75, -0.95, -1.0)
    strut.rotation.z = sign * 0.3
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 8).rotateZ(Math.PI / 2), M.dark)
    wheel.position.set(sign * 1.0, -1.2, -1.0)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.34, 6).rotateZ(Math.PI / 2), M.white)
    hub.position.copy(wheel.position)
    body.add(strut, wheel, hub)
  }

  // the rocket: strapped to the belly, lit while boosting
  const rocket = new THREE.Group()
  rocket.position.set(0, -1.05, 0.3)
  rocket.add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 2.4, 8).rotateX(Math.PI / 2), M.white))
  const rnose = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.6, 8).rotateX(-Math.PI / 2), M.red)
  rnose.position.z = -1.5
  rocket.add(rnose)
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.5), M.red)
    const a = (i / 3) * Math.PI * 2
    f.position.set(Math.sin(a) * 0.4, Math.cos(a) * 0.4, 1.0)
    f.rotation.z = -a
    rocket.add(f)
  }
  for (const s of [-0.5, 0.5]) {
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.06, 4, 8), M.dark)
    strap.position.z = s
    rocket.add(strap)
  }
  const flame = new THREE.Group()
  const f1 = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.0, 7).rotateX(Math.PI / 2), M.flame2)
  f1.position.z = 1.0
  const f2 = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.2, 6).rotateX(Math.PI / 2), M.flame)
  f2.position.z = 0.6
  flame.add(f1, f2)
  flame.position.z = 1.2
  flame.visible = false
  rocket.add(flame)
  body.add(rocket)

  // open cockpit, windscreen, and the pilot
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 8), M.dark)
  hole.scale.set(1, 1, 1.35)
  hole.position.set(0, 0.86, 0.3)
  body.add(hole)
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.42, 0.06), M.glass)
  screen.position.set(0, 1.05, -0.3)
  screen.rotation.x = -0.35
  body.add(screen)

  const pilot = new THREE.Group()
  pilot.position.set(0, 1.1, 0.42)
  const headGroup = new THREE.Group()
  headGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), M.skin))
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), M.leather)
  cap.position.y = 0.03
  headGroup.add(cap)
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.2), M.leather)
    ear.position.set(s * 0.34, -0.06, 0.02)
    headGroup.add(ear)
  }
  // goggles pushed up on the cap
  for (const s of [-1, 1]) {
    const g = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.04, 4, 8), M.dark)
    g.position.set(s * 0.13, 0.24, -0.27)
    g.rotation.x = -0.6
    headGroup.add(g)
  }
  const eyes = []
  for (const s of [-1, 1]) {
    const eye = new THREE.Group()
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), M.white)
    white.scale.set(1, 1.3, 0.6)
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), M.dark)
    pupil.position.z = -0.05
    eye.add(white, pupil)
    eye.position.set(s * 0.12, 0.02, -0.29)
    eye.userData.pupil = pupil
    headGroup.add(eye)
    eyes.push(eye)
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 4), M.skin)
  nose.position.set(0, -0.08, -0.34)
  headGroup.add(nose)
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 5), M.leather)
  torso.scale.set(1.1, 0.85, 0.85)
  torso.position.y = -0.45
  pilot.add(headGroup, torso)
  body.add(pilot)

  // the sign the pilot holds up when things stop making sense (lives in the scene, faces the camera)
  const signCanvas = document.createElement('canvas')
  signCanvas.width = 128; signCanvas.height = 64
  const signTex = new THREE.CanvasTexture(signCanvas)
  signTex.colorSpace = THREE.NoColorSpace
  const sign = new THREE.Group()
  const stick = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), M.leather)
  stick.position.y = 0.5
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.6, 0.05), n64Material({ color: '#b07d48' }))
  board.position.y = 1.15
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 0.54), n64Material({ map: signTex, emissive: 1, fog: 0 }))
  face.position.set(0, 1.15, 0.03)
  sign.add(stick, board, face)
  sign.scale.setScalar(1.6)
  sign.visible = false
  const writeSign = text => {
    const c = signCanvas.getContext('2d')
    c.fillStyle = '#f3dfb8'; c.fillRect(0, 0, 128, 64)
    c.strokeStyle = '#8a5a33'; c.lineWidth = 4; c.strokeRect(3, 3, 122, 58)
    c.fillStyle = '#3a2416'
    c.textAlign = 'center'; c.textBaseline = 'middle'
    let size = 30
    do { c.font = `${size}px "Lilita One", system-ui, sans-serif`; size -= 2 } while (c.measureText(text).width > 110 && size > 12)
    c.fillText(text, 64, 34)
    signTex.needsUpdate = true
  }

  // dizzy stars
  const stars = new THREE.Group()
  const starShape = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.07 : 0.17
    if (i === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.05, bevelEnabled: false })
  const starMat = n64Material({ color: '#ffd84a', emissive: 1 })
  for (let i = 0; i < 5; i++) stars.add(new THREE.Mesh(starGeo, starMat))
  stars.position.y = 0.55
  stars.visible = false
  pilot.add(stars)

  // trails
  const trailL = new Ribbon(70, 0.28, '#ffffff', 0.6)
  const trailR = new Ribbon(70, 0.28, '#ffffff', 0.6)
  const scarf = new Ribbon(16, 0.2, '#ff3b3b', 1.0)
  scarf.mesh.renderOrder = 15

  return { root, body, prop, blur, pilot, headGroup, eyes, sign, writeSign, stars, flame, rocket, trailL, trailR, scarf, materials: M }
}
