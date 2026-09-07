import * as THREE from 'three'
import { Ribbon } from './ribbon.js'

function lathe(profile, segs = 40) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y))
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p.x, p.y, 0)), false, 'catmullrom', 0.5)
  const sampled = curve.getPoints(48).map(p => new THREE.Vector2(Math.max(0, p.x), p.y))
  const g = new THREE.LatheGeometry(sampled, segs)
  g.rotateX(-Math.PI / 2) // +Y (nose) -> -Z
  return g
}

function wingShape(sign, span, rootChord, tipChord, sweep) {
  const s = new THREE.Shape()
  const le = rootChord / 2, te = -rootChord / 2
  s.moveTo(0, le)
  s.lineTo(sign * span * 0.72, le - sweep * 0.72)
  s.quadraticCurveTo(sign * span * 0.98, le - sweep * 0.9, sign * span, (le - sweep) - tipChord / 2 + tipChord * 0.05)
  s.quadraticCurveTo(sign * span * 0.98, te + tipChord * 0.05 - sweep * 0.9, sign * span * 0.72, te - sweep * 0.5)
  s.lineTo(0, te)
  s.closePath()
  return s
}

function extrudeFlat(shape, thick, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thick, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 12,
  })
  g.translate(0, 0, -thick / 2)
  return g
}

export function buildPlane(fogUniforms) {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  const gloss = (color, extra = {}) => new THREE.MeshPhysicalMaterial({
    color, roughness: 0.32, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.15, ...extra,
  })
  const M = {
    cream: gloss('#fff6e6'),
    coral: gloss('#ff6b6b'),
    teal: gloss('#4fd1c5'),
    dark: gloss('#2b3446', { roughness: 0.5, clearcoat: 0.4 }),
    tire: new THREE.MeshStandardMaterial({ color: '#2a2e38', roughness: 0.9 }),
    skin: gloss('#f6d5b3', { clearcoat: 0.2, roughness: 0.6 }),
    leather: gloss('#7a4a2b', { clearcoat: 0.6, roughness: 0.5 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: '#bfe6ff', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.45, clearcoat: 1, side: THREE.DoubleSide,
    }),
    white: gloss('#ffffff'),
  }

  // fuselage: plump capsule, nose at -Z
  const fuselage = new THREE.Mesh(lathe([
    [0.16, -2.75], [0.26, -2.2], [0.46, -1.3], [0.68, -0.45], [0.8, 0.25], [0.8, 0.95], [0.72, 1.6], [0.58, 2.1], [0.42, 2.34], [0.0, 2.42],
  ]), M.cream)
  body.add(fuselage)

  // belly stripe + cowl ring
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.79, 0.07, 12, 48), M.teal)
  stripe.position.z = -0.55
  body.add(stripe)
  const cowl = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.15, 14, 40), M.coral)
  cowl.position.z = -2.32
  body.add(cowl)
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 20), M.white)
  spinner.rotation.x = -Math.PI / 2
  spinner.position.z = -2.62
  body.add(spinner)

  // propeller
  const prop = new THREE.Group()
  prop.position.z = -2.5
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.95, 4, 10), M.dark)
    blade.scale.set(1, 1, 0.35)
    blade.position.y = 0.62
    blade.rotation.y = 0.55
    const tip = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.16, 4, 10), M.coral)
    tip.scale.copy(blade.scale)
    tip.position.y = 1.02
    tip.rotation.y = 0.55
    const arm = new THREE.Group()
    arm.add(blade, tip)
    arm.rotation.z = (i / 3) * Math.PI * 2
    prop.add(arm)
  }
  const blur = new THREE.Mesh(new THREE.CircleGeometry(1.12, 40), new THREE.MeshBasicMaterial({
    color: '#dfe6f0', transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide,
  }))
  blur.position.z = -2.5
  body.add(prop, blur)

  // wings (low, slight dihedral)
  const dihedral = 0.1
  for (const sign of [1, -1]) {
    const w = new THREE.Mesh(extrudeFlat(wingShape(sign, 3.2, 1.55, 1.0, 0.3), 0.16, 0.07), M.cream)
    w.rotation.x = -Math.PI / 2 // shape XY -> XZ; shape +y -> -z (forward)
    w.rotation.z = sign * dihedral
    w.position.set(sign * 0.25, -0.18, -0.6)
    body.add(w)
    // wingtip in coral
    const tip = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.55, 4, 10), M.coral)
    tip.rotation.x = Math.PI / 2
    tip.position.set(sign * 3.45 * Math.cos(dihedral), -0.18 + 3.45 * Math.sin(dihedral), -0.8)
    body.add(tip)
  }

  // tail: horizontal stabilisers + rounded fin
  for (const sign of [1, -1]) {
    const h = new THREE.Mesh(extrudeFlat(wingShape(sign, 1.25, 0.62, 0.45, 0.16), 0.09, 0.04), M.cream)
    h.rotation.x = -Math.PI / 2
    h.position.set(sign * 0.12, 0.2, 2.05)
    body.add(h)
  }
  const finShape = new THREE.Shape()
  finShape.moveTo(-0.35, 0.2)
  finShape.lineTo(0.55, 0.2)
  finShape.quadraticCurveTo(0.7, 0.9, 0.5, 1.3)
  finShape.quadraticCurveTo(0.38, 1.5, 0.1, 1.42)
  finShape.quadraticCurveTo(-0.15, 1.0, -0.35, 0.2)
  const fin = new THREE.Mesh(extrudeFlat(finShape, 0.1, 0.04), M.coral)
  fin.rotation.y = -Math.PI / 2 // shape x -> +z
  fin.position.set(0, 0.05, 1.95)
  body.add(fin)

  // open cockpit with a windscreen and a little pilot
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 24), M.dark)
  hole.scale.set(1, 1, 1.35)
  hole.position.set(0, 0.74, 0.25)
  body.add(hole)
  const screen = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 12, 0, Math.PI, 0, Math.PI * 0.42), M.glass)
  screen.scale.set(1, 0.85, 1)
  screen.rotation.y = Math.PI
  screen.position.set(0, 0.72, -0.22)
  body.add(screen)
  const pilot = new THREE.Group()
  pilot.position.set(0, 0.95, 0.35)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 16), M.skin)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.255, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), M.leather)
  cap.position.y = 0.02
  const goggles = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 10, 30), M.dark)
  goggles.rotation.x = Math.PI / 2
  goggles.position.y = 0.11
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), M.leather)
  torso.scale.set(1.1, 0.9, 0.8)
  torso.position.y = -0.35
  pilot.add(head, cap, goggles, torso)
  body.add(pilot)

  // landing gear with wheel pants
  for (const sign of [1, -1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 10), M.dark)
    strut.position.set(sign * 0.72, -0.72, -0.85)
    strut.rotation.z = sign * 0.35
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 20), M.tire)
    wheel.rotation.z = Math.PI / 2
    wheel.position.set(sign * 0.9, -1.02, -0.85)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.25, 14), M.white)
    hub.rotation.z = Math.PI / 2
    hub.position.copy(wheel.position)
    const pant = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), M.coral)
    pant.scale.set(0.85, 1, 1.45)
    pant.position.set(sign * 0.9, -0.94, -0.85)
    body.add(strut, wheel, hub, pant)
  }
  const tailWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 14), M.tire)
  tailWheel.rotation.z = Math.PI / 2
  tailWheel.position.set(0, -0.35, 2.35)
  body.add(tailWheel)

  // exhaust stubs + pitot
  const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 8), M.dark)
  ex.rotation.x = Math.PI / 2
  ex.position.set(0.55, -0.35, -1.55)
  body.add(ex)

  root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false } })

  // trails
  const trailL = new Ribbon(70, 0.22, '#ffffff', 0.55, fogUniforms)
  const trailR = new Ribbon(70, 0.22, '#ffffff', 0.55, fogUniforms)
  const scarf = new Ribbon(16, 0.15, '#e63946', 1.0, fogUniforms)
  scarf.mesh.renderOrder = 15

  return { root, body, prop, blur, pilot, trailL, trailR, scarf, materials: M }
}
