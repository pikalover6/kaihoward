import * as THREE from 'three'
import { Jet, TYPES, jetKit, duckGeo, chuteGeo, GRAV } from './jets.js'
import { n64Material, textures } from './n64.js'
import { MACH, LIGHT as C } from './flight.js'
import { LID_Y } from './constants.js'

/*
  The war
  =======
  The Newtonian Air Force sends real jets in waves. They obey the real rules
  (jets.js); you obey yours (flight.js). Everything here is the bookkeeping: who
  shot what, what it hit, and how stylishly.

  Your guns throw glossy little orbs that inherit your momentum, like everything
  else does (law 1), and are a bit optimistic about where the target is going.
  Their guns throw tracers, and their missiles fly proportional navigation. Roll
  flat out and anything that hits you comes back the way it came (law 10), which
  makes their missiles yours.

  Kills score more for doing something no real aircraft can: flying backwards,
  hanging in midair, going supersonic on a propeller.
*/

const MAX_HP = 8
const PLAYER_R = 3.6
const ORB_SPEED = 1100, TRACER_SPEED = 950
const clamp = THREE.MathUtils.clamp
const pick = a => a[Math.floor(Math.random() * a.length)]
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3()
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _q = new THREE.Quaternion()
const _m = new THREE.Matrix4(), _app = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1)
const Z = new THREE.Vector3(0, 0, -1)

const NUMBERS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN']

// what they say on the radio
const LINES = {
  intro: [
    ['CONTROL', 'Unidentified aircraft, this is Newtonian Air Command. You are in violation of the First Law of Motion.'],
    ['CONTROL', 'Surrender your momentum and prepare to be acted upon by an external force.'],
  ],
  wave: [
    'Weapons free. It\'s just a prop plane.', 'Tally one bandit. It\'s... red?', 'Engaging. Is it smiling at me?',
    'Bandit in sight. Control, it has a scarf.', 'Visual on the target. It\'s a cartoon, sir.', 'Going in. Keep it by the book.',
  ],
  overshoot: ['Overshoot! Overshoot!', 'It just STOPPED. In midair!', 'Where\'d it go?!', 'That is NOT allowed!', 'Bandit stopped dead, I\'m going through!'],
  tooClose: ['Too close, pulling off!', 'Breaking off, it\'s right there!'],
  break: ['Breaking! It\'s on my six!', 'Defending! Flares, flares!', 'Get it off me!', 'It\'s shooting... bubbles?'],
  terrain: ['Pull up! Pull up!', 'Terrain, terrain!', 'Too low, too low!'],
  fox2: ['Fox two!', 'Fox two, fox two!', 'Missile away!', 'Fox two. Physics, baby.'],
  lost: ['Lost it in the clouds!', 'Missile\'s gone stupid!', 'No tone, no tone!'],
  deflect: ['It... batted my missile.', 'Was that a barrel roll?!', 'My missile came BACK.', 'That\'s not how missiles work!'],
  backwards: ['Bandit is flying backwards. Repeat, BACKWARDS.', 'Control, the target is ignoring inertia.', 'It\'s facing us and moving away. HOW.'],
  fast: ['It\'s accelerating. Exponentially.', 'Bandit went supersonic. On a propeller.', 'Can\'t keep up, it\'s off the charts!'],
  hit: ['Guns, guns, guns!', 'Hits! It\'s smoking... and smiling.', 'Got a piece of it!'],
  ouch: ['I\'m hit!', 'Taking damage!', 'It hit me with a... sparkle?', 'Mayday!'],
  ejected: ['Eject, eject!', 'I had a pension!', 'Tell my mother I believed in physics.', 'Punching out!', 'This never happened in the simulator!'],
  splash: ['Splash one... wait, that\'s us.', '{down} is down!', 'We lost {down}!', '{down}, do you read? {down}?'],
  ko: ['Splash the toy! ...wait, it\'s still waving.', 'Target down. Paperwork incoming.', 'Got it! ...it bounced.'],
  rammed: ['It RAMMED me!', 'Collision! It was made of RUBBER!'],
  splatted: ['There\'s a plane on my canopy!', 'Get it off my windscreen!', 'It\'s stuck to me! It\'s STUCK TO ME!'],
  boss: [
    ['THE SECOND LAW', 'Entropy always increases. Prepare to be... disordered.'],
    ['CONTROL', 'All units, the Second Law is on station. Nothing escapes it.'],
  ],
  bossDown: [['THE SECOND LAW', 'Impossible... I\'m... reversible...'], ['CONTROL', 'The Second Law has been... repealed.']],
  clear: ['Control, we\'re... we\'re out of jets.', 'All flights down. Requesting new physics.', 'Send more aircraft. Bigger ones.'],
  lull: ['Is it... gone?', 'Regrouping.', 'Control, request permission to believe in cartoons.'],
}

// ------------------------------------------------------------------ streaks of light: your orbs and their tracers
const streakVert = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iDir;
attribute vec4 iCol;
uniform float uWidth;
varying vec2 vP;
varying vec4 vCol;
void main(){
  vP = position.xy;
  vCol = iCol;
  vec3 wp = iPos - iDir * position.y;
  vec3 toCam = normalize(cameraPosition - wp);
  vec3 side = cross(normalize(iDir + vec3(1e-5)), toCam);
  if (dot(side, side) < 1e-6) side = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  wp += normalize(side) * position.x * uWidth;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`
const streakFrag = /* glsl */ `
varying vec2 vP;
varying vec4 vCol;
void main(){
  float across = 1.0 - abs(vP.x) * 2.0;
  float a = smoothstep(0.0, 0.6, across) * (1.0 - vP.y * 0.75) * vCol.a;
  vec3 c = mix(vCol.rgb, vec3(1.0), smoothstep(0.55, 0.95, across) * (1.0 - vP.y));
  gl_FragColor = vec4(c * a, a);
}
`
class Streaks {
  constructor(scene, n, width, renderOrder = 26) {
    this.n = n
    this.list = []
    const quad = new THREE.PlaneGeometry(1, 1)
    quad.translate(0, 0.5, 0)
    const geo = new THREE.InstancedBufferGeometry()
    geo.index = quad.index
    geo.attributes.position = quad.attributes.position
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3)
    this.iDir = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3)
    this.iCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4)
    for (const a of [this.iPos, this.iDir, this.iCol]) a.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('iPos', this.iPos); geo.setAttribute('iDir', this.iDir); geo.setAttribute('iCol', this.iCol)
    geo.instanceCount = 0
    this.geo = geo
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { uWidth: { value: width } }, vertexShader: streakVert, fragmentShader: streakFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }))
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = renderOrder
    scene.add(this.mesh)
  }
  add(b) { if (this.list.length >= this.n) this.list.shift(); this.list.push(b); return b }
  shift(dx, dz) { for (const b of this.list) { b.p.x -= dx; b.p.z -= dz; b.prev.x -= dx; b.prev.z -= dz } }
  draw() {
    const L = this.list, P = this.iPos.array, D = this.iDir.array, Cc = this.iCol.array
    for (let i = 0; i < L.length; i++) {
      const b = L[i], sp = b.v.length() || 1, len = b.len * Math.min(1, b.age * 30 + 0.2)
      P[i * 3] = b.p.x; P[i * 3 + 1] = b.p.y; P[i * 3 + 2] = b.p.z
      D[i * 3] = b.v.x / sp * len; D[i * 3 + 1] = b.v.y / sp * len; D[i * 3 + 2] = b.v.z / sp * len
      Cc[i * 4] = b.col.r; Cc[i * 4 + 1] = b.col.g; Cc[i * 4 + 2] = b.col.b; Cc[i * 4 + 3] = Math.min(1, (b.life - b.age) * 4)
    }
    this.geo.instanceCount = L.length
    this.iPos.needsUpdate = this.iDir.needsUpdate = this.iCol.needsUpdate = true
  }
}

// segment a→b against an ellipsoid body (centre c, rotation q, radii R): fraction along, or -1
const _l0 = new THREE.Vector3(), _l1 = new THREE.Vector3(), _qi = new THREE.Quaternion()
function segEllipsoid(a, b, body, pad = 0) {
  _qi.copy(body.q).invert()
  const R = body.rad
  _l0.subVectors(a, body.c).applyQuaternion(_qi); _l1.subVectors(b, body.c).applyQuaternion(_qi)
  _l0.set(_l0.x / (R.x + pad), _l0.y / (R.y + pad), _l0.z / (R.z + pad))
  _l1.set(_l1.x / (R.x + pad), _l1.y / (R.y + pad), _l1.z / (R.z + pad))
  return segSphere(_l0, _l1, _c.set(0, 0, 0), 1)
}
function segSphere(a, b, c, r) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
  const fx = a.x - c.x, fy = a.y - c.y, fz = a.z - c.z
  const A = dx * dx + dy * dy + dz * dz, B = 2 * (fx * dx + fy * dy + fz * dz), Cq = fx * fx + fy * fy + fz * fz - r * r
  if (Cq <= 0) return 0
  if (A < 1e-9) return -1
  const disc = B * B - 4 * A * Cq
  if (disc < 0) return -1
  const t = (-B - Math.sqrt(disc)) / (2 * A)
  return t >= 0 && t <= 1 ? t : -1
}

// ------------------------------------------------------------------ the war office
export class Combat {
  constructor(scene, world, effects, hooks) {
    this.scene = scene
    this.world = world
    this.fx = effects
    this.hooks = hooks
    this.kit = jetKit()
    const T = textures()

    this.jets = []
    this.orbsShot = new Streaks(scene, 220, 2.2)
    this.tracers = new Streaks(scene, 320, 1.1)
    this.missiles = []
    this.flares = []
    this.chutes = []
    this.debris = []
    this.pickups = []

    this.missileMat = n64Material({ vertexColors: true, spec: 0.5, shine: 16 })
    this.duckGeo = duckGeo()
    this.duckMat = n64Material({ vertexColors: true, spec: 0.9, shine: 18, rim: 0.3 })
    this.chuteGeo = chuteGeo()
    this.chuteMat = n64Material({ vertexColors: true, side: THREE.DoubleSide })
    this.debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.25, 1.6), n64Material({ color: '#7d858d' }), 160)
    this.debrisMesh.frustumCulled = false
    this.debrisMesh.count = 0
    scene.add(this.debrisMesh)

    // power-ups: glossy glass bubbles with something inside
    this.orbGeo = new THREE.IcosahedronGeometry(5, 2)
    this.orbIcons = { heart: T.iconHeart, triple: T.iconTriple, ducks: T.iconDuck, bubble: T.iconBubble }
    this.orbTints = { heart: '#ffb3d1', triple: '#9ff0ff', ducks: '#fff0a0', bubble: '#b0e8ff' }
    // your bubble shield
    this.shieldMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(6.4, 2), n64Material({ color: '#9fe8ff', alpha: 0.28, spec: 1.6, shine: 24, rim: 1.1, depthWrite: false, side: THREE.DoubleSide }))
    this.shieldMesh.visible = false
    this.shieldMesh.renderOrder = 28
    scene.add(this.shieldMesh)

    this.reset()
  }

  reset() {
    for (const j of this.jets) this.removeJet(j)
    this.jets = []
    for (const m of this.missiles) this.scene.remove(m.mesh)
    this.missiles = []
    for (const c of this.chutes) this.scene.remove(c.mesh)
    this.chutes = []
    for (const p of this.pickups) this.scene.remove(p.group)
    this.pickups = []
    this.orbsShot.list.length = 0
    this.tracers.list.length = 0
    this.flares = []
    this.debris = []
    this.hp = MAX_HP
    this.score = 0
    this.kills = 0
    this.wave = 0
    this.phase = 'idle'
    this.phaseT = 0
    this.combo = { n: 0, t: -99 }
    this.tripleT = 0; this.ducks = 0; this.shieldT = 0; this.shieldHits = 0
    this.invuln = 0
    this.ko = null
    this.soot = 0
    this.hurt = 0
    this.fireT = 0; this.gunSide = 1; this.duckCool = 0
    this.lock = null
    this.warn = ''
    this.radioQ = []
    this.radioT = 0
    this.radioCool = {}
    this.introSaid = false
    this.pickupT = 6
    this.slow = 0
    this.time = 0
    this.best = 0
    try { this.best = +localStorage.getItem('kh64-best') || 0 } catch { /* private mode */ }
  }

  start() { if (this.phase === 'idle') { this.phase = 'calm'; this.phaseT = 0 } }

  // ---------------------------------------------------------------- radio
  say(who, text, key, gap = 6) {
    if (key) {
      if (this.time - (this.radioCool[key] ?? -99) < gap) return
      this.radioCool[key] = this.time
    }
    if (this.radioQ.length > 2) return
    this.radioQ.push({ who, text })
  }
  chatter(kind, jet, gap) {
    const arr = LINES[kind]
    if (!arr) return
    const speaker = jet || this.jets.find(j => j.alive)
    if (!speaker && kind !== 'clear') return
    this.say(speaker ? speaker.callsign : 'CONTROL', pick(arr).replaceAll('{down}', jet ? jet.callsign : ''), kind, gap)
  }

  // ---------------------------------------------------------------- waves
  composition(n) {
    if (n === 1) return ['inertia', 'inertia']
    if (n === 2) return ['inertia', 'inertia', 'inertia']
    if (n === 3) return ['momentum', 'inertia', 'inertia']
    if (n === 4) return ['momentum', 'momentum', 'inertia', 'inertia']
    if (n % 5 === 0) return ['law', ...Array(Math.min(4, n / 5 + 1)).fill('inertia')]
    const count = Math.min(7, 2 + Math.floor(n / 2))
    const pool = n >= 6 ? ['inertia', 'momentum', 'entropy', 'entropy'] : ['inertia', 'momentum']
    return Array.from({ length: count }, () => pick(pool))
  }
  get skill() { return Math.min(1, 0.25 + this.wave * 0.08) }

  spawnWave(fl) {
    this.wave++
    const types = this.composition(this.wave)
    const app = fl.apparent(_app)
    const heading = app.lengthSq() > 100 ? Math.atan2(app.x, app.z) : Math.atan2(fl.forward(_f).x, fl.forward(_f).z)
    const bearing = heading + (Math.random() - 0.5) * 2.2
    const dist = 2700 + Math.random() * 500
    const base = _a.set(fl.pos.x + Math.sin(bearing) * dist, 0, fl.pos.z + Math.cos(bearing) * dist)
    const counts = {}
    types.forEach((type, i) => {
      counts[type] = (counts[type] || 0) + 1
      const side = i % 2 ? 1 : -1, rank = Math.ceil(i / 2)
      const dir = _b.set(fl.pos.x - base.x, 0, fl.pos.z - base.z).normalize()
      const lat = _c.set(-dir.z, 0, dir.x)
      const p = _d.copy(base).addScaledVector(lat, side * rank * 60).addScaledVector(dir, -rank * 40)
      // high enough to clear whatever's between them and you
      let floor = this.world.waterY
      for (let k = 0; k <= 12; k++) {
        const t = k / 12
        floor = Math.max(floor, this.world.ground(p.x + (fl.pos.x - p.x) * t, p.z + (fl.pos.z - p.z) * t))
      }
      p.y = clamp(fl.pos.y + 200 + (type === 'law' ? 300 : 0), floor + 300, LID_Y - 800)
      const name = TYPES[type].boss ? TYPES[type].name : `${TYPES[type].name} ${counts[type]}`
      const jet = new Jet(type, this.scene, name)
      jet.place(p, _b.copy(fl.pos).sub(p).setY(0).normalize(), type === 'law' ? 170 : 330)
      jet.arm(type === 'inertia' ? (this.wave >= 4 ? 1 : 0) : TYPES[type].missiles)
      jet.ai.side = Math.random() < 0.5 ? -1 : 1
      this.jets.push(jet)
      this.world.movers.push(jet.body)
    })
    const boss = types.includes('law')
    const names = [...new Set(types)].map(t => TYPES[t].name).join(' + ')
    this.hooks.banner(`WAVE ${this.wave}`, boss ? 'the second law is coming' : `incoming: ${names.toLowerCase()}`)
    if (boss) for (const [who, text] of LINES.boss) this.say(who, text)
    else this.chatter('wave', this.jets[this.jets.length - types.length])
    this.hooks.sound('alarm')
  }

  removeJet(j) {
    j.remove()
    const i = this.world.movers.indexOf(j.body)
    if (i >= 0) this.world.movers.splice(i, 1)
  }

  // ---------------------------------------------------------------- hitting things
  damageJet(jet, dmg, how, fl, at) {
    if (!jet.alive) return
    jet.hp -= dmg
    jet.flash = 1
    jet.lastHit = how
    if (at) this.fx.splash(at, _a.set(0, 1, 0), { n: 3, speed: 20, size: 0.8, grow: 2, life: 0.35, color: '#fff4b0', alpha: 1, lift: 0.5 })
    if (jet.hp <= 0) this.kill(jet, how, fl)
    else if (Math.random() < 0.08) this.chatter('ouch', jet, 5)
  }

  kill(jet, how, fl) {
    jet.alive = false
    jet.down = { t: 0, how, spin: new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.5, (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 3)) }
    const i = this.world.movers.indexOf(jet.body)
    if (i >= 0) this.world.movers.splice(i, 1)
    this.explode(jet.pos, jet.spec.boss ? 3 : 1.4, jet.vel)
    // the pilot gets out
    for (let k = 0; k < (jet.spec.boss ? 2 : 1); k++) this.eject(jet)

    // score, with style
    const S = jet.spec
    const styles = []
    if (how === 'perforate') styles.push(['perforated!', 3])
    if (how === 'ram') styles.push(['rammed!', 3])
    if (how === 'splat') styles.push(['splatted!', 3])
    if (how === 'returned') styles.push(['return to sender!', 3])
    if (how === 'terrain') styles.push(['made \'em crash!', 2])
    if (how === 'duck') styles.push(['quack attack!', 1.5])
    if (fl) {
      const sp = fl.speed, f = fl.forward(_f)
      if (sp > 25 && f.dot(_a.copy(fl.vel).divideScalar(sp)) < -0.5) styles.push(['backwards!', 2])
      if (fl.up(_u).y < -0.5) styles.push(['upside down!', 1.5])
      if (fl.hanging || fl.oblivious > 0) styles.push(['mid-air pause!', 3])
      if (sp > C * 1000) styles.push(['ludicrous speed!', 4])
      else if (sp > MACH) styles.push(['supersonic prop!', 2])
      if (fl.daze > 0 && how !== 'ram') styles.push(['dizzy shot!', 2])
      if (how !== 'terrain' && jet.pos.distanceTo(fl.pos) < 70) styles.push(['point blank!', 1.5])
    }
    this.combo.n = this.time - this.combo.t < 6 ? this.combo.n + 1 : 1
    this.combo.t = this.time
    if (this.combo.n > 1) styles.push([`${this.combo.n} in a row!`, 1 + 0.5 * (this.combo.n - 1)])
    if (how === 'crash') {
      // nobody saw it happen
      this.chatter('terrain', jet, 1)
      return
    }
    let mult = 1
    for (const [, m] of styles) mult *= m
    const pts = Math.round(S.score * mult / 10) * 10
    this.score += pts
    this.kills++
    const nth = this.combo.n
    this.hooks.pop(S.boss ? 'BOSS DOWN!' : `SPLASH ${NUMBERS[Math.min(nth, 10) - 1]}!`, jet.pos, 'trick')
    styles.forEach(([name, m], k) => setTimeout(() => this.hooks.pop(`${name} ×${m}`, null, 'style', k), 120 + k * 140))
    setTimeout(() => this.hooks.pop(`+${pts.toLocaleString()}`, null, 'points'), 80)
    this.hooks.sound('explode', jet.pos)
    this.hooks.shake(jet.spec.boss ? 2.5 : 1.2)
    this.slow = Math.max(this.slow, jet.spec.boss ? 0.9 : 0.22)
    if (S.boss) for (const [who, text] of LINES.bossDown) this.say(who, text)
    else {
      const wing = this.jets.find(j => j.alive)
      if (wing) this.say(wing.callsign, pick(LINES.splash).replaceAll('{down}', jet.callsign), 'splash', 2)
      this.say(jet.callsign, pick(LINES.ejected), 'ejected', 3)
    }
    // sometimes they leave something behind
    if (Math.random() < (S.boss ? 1 : 0.3)) this.spawnPickup(jet.pos.clone().setY(jet.pos.y + 20), this.hp < 4 ? 'heart' : null)
  }

  explode(at, size = 1, vel = null) {
    const fx = this.fx, pos = at.clone() // callers may hand us a scratch vector
    if (vel) vel = vel.clone()
    for (let i = 0; i < 10 * size; i++) {
      const v = _a.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(20 + Math.random() * 40 * size)
      if (vel) v.addScaledVector(vel, 0.25)
      fx.puffs.spawn(_b.copy(pos).addScaledVector(v, 0.05), { vel: v, size: 3 * size, grow: 8 * size, life: 0.55 + Math.random() * 0.4, color: pick(['#fff3b0', '#ffc24a', '#ff8a2a', '#ff5a1a']), alpha: 1, drag: 3 })
    }
    for (let i = 0; i < 8 * size; i++) {
      const v = _a.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize().multiplyScalar(10 + Math.random() * 18 * size)
      if (vel) v.addScaledVector(vel, 0.2)
      fx.puffs.spawn(pos, { vel: v, size: 4 * size, grow: 12 * size, life: 1.6 + Math.random() * 1.2, color: pick(['#4a4440', '#5e5650', '#3a3532']), alpha: 0.85, drag: 1.6 })
    }
    fx.rings.spawn(pos, _a.set(0, 1, 0), { size: 2, grow: 50 * size, life: 0.6, color: '#fff1c0', alpha: 0.8 })
    for (let i = 0; i < 10 * size && this.debris.length < 160; i++) {
      const v = _a.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(20 + Math.random() * 50)
      if (vel) v.addScaledVector(vel, 0.5)
      this.debris.push({ p: pos.clone(), v: v.clone(), r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), w: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, 0), s: 0.5 + Math.random() * 1.2, age: 0 })
    }
  }

  eject(jet) {
    const mesh = new THREE.Mesh(this.chuteGeo, this.chuteMat)
    mesh.scale.setScalar(0.01)
    this.scene.add(mesh)
    const v = jet.vel.clone().multiplyScalar(0.3).add(jet.up(_u).multiplyScalar(45))
    this.chutes.push({ mesh, p: jet.pos.clone().addScaledVector(jet.up(_u), 2), v, age: 0, sway: Math.random() * 6 })
  }

  // a missile (theirs) or a rubber duck (yours)
  launch(kind, pos, vel, target, owner) {
    const mesh = new THREE.Mesh(kind === 'duck' ? this.duckGeo : this.kit.missile, kind === 'duck' ? this.duckMat : this.missileMat)
    mesh.scale.setScalar(kind === 'duck' ? 1.3 : 1.6)
    this.scene.add(mesh)
    const m = { kind, mesh, p: pos.clone(), v: vel.clone(), age: 0, target, owner, lost: false, smokeT: 0, mine: kind === 'duck' }
    this.missiles.push(m)
    return m
  }

  // something of theirs hits you
  hurtPlayer(dmg, fl, from, knock = 0) {
    if (this.ko || this.invuln > 0) return false
    if (this.shieldT > 0) {
      this.shieldHits--
      if (this.shieldHits <= 0) { this.shieldT = 0; this.hooks.pop('pop!', fl.pos, 'small'); this.hooks.sound('bubblePop') } else this.hooks.sound('ping')
      return false
    }
    this.hp = Math.max(0, this.hp - dmg)
    this.hurt = Math.min(1, this.hurt + dmg * 0.4 + 0.2)
    this.soot = Math.min(1, this.soot + dmg * 0.25)
    this.hooks.sound('hit', dmg)
    if (knock && from) fl.knock(_a.subVectors(fl.pos, from).normalize().multiplyScalar(knock), knock * 0.12, Math.min(1.2, knock / 60))
    if (this.hp <= 0) this.knockOut(fl)
    return true
  }

  knockOut(fl) {
    this.ko = { t: 0 }
    this.soot = 1
    fl.locked = true
    fl.knock(_a.set(0, 30, 0), 14, 3)
    this.explode(fl.pos, 0.8)
    this.hooks.pop('K.O.!', fl.pos, 'big')
    this.hooks.sound('ko')
    this.chatter('ko', null, 1)
    this.combo.n = 0
  }

  heal(n) { if (!this.ko) this.hp = Math.min(MAX_HP, this.hp + n) }

  // law 10: whatever hits a spinning plane comes back
  shielding(fl) { return fl.shielding }

  // ---------------------------------------------------------------- power-ups
  spawnPickup(pos, kind) {
    kind = kind || pick(this.hp < 5 ? ['heart', 'heart', 'triple', 'ducks', 'bubble'] : ['heart', 'triple', 'ducks', 'ducks', 'bubble', 'triple'])
    const group = new THREE.Group()
    const glass = new THREE.Mesh(this.orbGeo, n64Material({ color: this.orbTints[kind], alpha: 0.4, spec: 1.8, shine: 20, rim: 1.2, depthWrite: false }))
    glass.renderOrder = 27
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.orbIcons[kind], transparent: true, depthWrite: false, fog: false }))
    icon.scale.setScalar(6)
    icon.renderOrder = 26
    group.add(icon, glass)
    group.position.copy(pos)
    this.scene.add(group)
    this.pickups.push({ kind, group, p: pos.clone(), age: 0, phase: Math.random() * 6 })
  }

  collect(pk, fl) {
    const k = pk.kind
    if (k === 'heart') { this.hp = MAX_HP; this.soot = 0; this.hooks.pop('full power!', fl.pos, 'trick') }
    if (k === 'triple') { this.tripleT = 18; this.hooks.pop('triple orbs!', fl.pos, 'trick') }
    if (k === 'ducks') { this.ducks += 6; this.hooks.pop('rubber ducks ×6!', fl.pos, 'trick') }
    if (k === 'bubble') { this.shieldT = 22; this.shieldHits = 6; this.hooks.pop('bubble shield!', fl.pos, 'trick') }
    this.hooks.sound('powerup')
    this.fx.splash(pk.p, _a.set(0, 1, 0), { n: 12, speed: 30, size: 1.2, grow: 3, life: 0.7, color: '#bff4ff', alpha: 1, lift: 0.3 })
    this.fx.rings.spawn(pk.p, _a.subVectors(fl.pos, pk.p).normalize(), { size: 5, grow: 26, life: 0.5, color: '#bff4ff', alpha: 0.9 })
  }

  // ---------------------------------------------------------------- physics events from flight.js
  onFlightEvent(e, fl) {
    const jet = e.shape && e.shape.owner
    if (!jet || !(jet instanceof Jet)) return
    if (e.type === 'bounce') {
      this.damageJet(jet, e.speed * 0.15, 'ram', fl)
      if (e.speed > 60) this.hurtPlayer(0.5, fl)
      if (jet.alive) this.chatter('rammed', jet, 8)
    } else if (e.type === 'splat') {
      this.damageJet(jet, 60, 'splat', fl)
      this.chatter('splatted', jet, 4)
    } else if (e.type === 'perforate') {
      this.damageJet(jet, 9999, 'perforate', fl)
    }
  }

  // ---------------------------------------------------------------- every frame
  update(dt, fl, input) {
    this.time += dt
    if (this.slow > 0) this.slow = Math.max(0, this.slow - dt / 0.35)
    this.hurt = Math.max(0, this.hurt - dt * 1.5)
    this.soot = Math.max(0, this.soot - dt * (this.ko ? 0 : 0.05))
    this.invuln = Math.max(0, this.invuln - dt)
    this.tripleT = Math.max(0, this.tripleT - dt)
    this.shieldT = Math.max(0, this.shieldT - dt)
    const app = fl.apparent(_app).clone()
    const target = { pos: fl.pos, vel: app, fwd: fl.forward(new THREE.Vector3()), ko: !!this.ko || this.phase === 'idle' }

    this.director(dt, fl)
    this.updateJets(dt, fl, target)
    this.playerGuns(dt, fl, input, app)
    this.updateShots(dt, fl)
    this.updateMissiles(dt, fl, app)
    this.updateLeftovers(dt)
    this.updatePickups(dt, fl)
    this.updateKO(dt, fl)

    // the bubble shield sits round the plane
    this.shieldMesh.visible = this.shieldT > 0 && !this.ko
    if (this.shieldMesh.visible) {
      this.shieldMesh.position.copy(fl.pos)
      this.shieldMesh.rotation.y += dt * 0.6
      this.shieldMesh.scale.setScalar(1 + Math.sin(this.time * 5) * 0.03 + (this.shieldT < 3 ? Math.sin(this.time * 30) * 0.05 : 0))
    }

    // warnings: someone has a lock, or something is coming
    let warn = ''
    for (const j of this.jets) if (j.alive && j.ai.locking) warn = 'lock'
    for (const m of this.missiles) if (!m.mine && !m.lost && m.p.distanceTo(fl.pos) < 3000) warn = 'missile'
    this.warn = this.ko ? '' : warn

    // the radio
    this.radioT -= dt
    if (this.radioT <= 0 && this.radioQ.length) {
      const msg = this.radioQ.shift()
      this.hooks.radio(msg.who, msg.text)
      this.hooks.sound('radio')
      this.radioT = 1.2 + msg.text.length * 0.045
    }
  }

  director(dt, fl) {
    this.phaseT += dt
    if (this.phase === 'calm') {
      if (this.phaseT > 3 && !this.introSaid) { this.introSaid = true; for (const [who, text] of LINES.intro) this.say(who, text) }
      if (this.phaseT > 12) { this.phase = 'fight'; this.phaseT = 0; this.spawnWave(fl) }
    } else if (this.phase === 'fight') {
      if (!this.jets.some(j => j.alive)) { this.phase = 'clear'; this.phaseT = 0; this.cleared = false }
    } else if (this.phase === 'clear') {
      // let the last kill's fanfare finish first
      if (this.phaseT > 1.6 && !this.cleared) {
        this.cleared = true
        const bonus = 250 * this.wave
        this.score += bonus
        this.heal(2)
        this.hooks.banner('WAVE CLEAR', `+${bonus.toLocaleString()} bonus · power +2`)
        this.hooks.sound('clear')
        this.say('CONTROL', pick(LINES.clear))
      }
      if (this.phaseT > 10) { this.phase = 'fight'; this.phaseT = 0; this.spawnWave(fl) }
    }
    if (this.score > this.best) { this.best = this.score; try { localStorage.setItem('kh64-best', String(this.best)) } catch { /* ignore */ } }
    // something to pick up every so often, out ahead
    this.pickupT -= dt
    if (this.pickupT <= 0 && this.phase !== 'idle') {
      this.pickupT = 11 + Math.random() * 6
      const near = this.pickups.filter(p => p.p.distanceTo(fl.pos) < 2500).length
      if (near < 3) {
        const app = fl.apparent(_a)
        const dir = app.lengthSq() > 400 ? app.setY(0).normalize() : fl.forward(_b).setY(0).normalize()
        const lat = _c.set(-dir.z, 0, dir.x)
        const d = 450 + Math.random() * 350
        const p = _d.copy(fl.pos).addScaledVector(dir, d).addScaledVector(lat, (Math.random() - 0.5) * 300)
        p.y = Math.max(fl.pos.y + (Math.random() - 0.4) * 80, Math.max(this.world.ground(p.x, p.z), this.world.waterY) + 25)
        this.spawnPickup(p.clone())
      }
    }
  }

  updateJets(dt, fl, target) {
    const ctx = {
      target, world: this.world, jets: this.jets, skill: this.skill, rnd: Math.random,
      missilesOut: this.missiles.filter(m => !m.mine && !m.lost).length, missileCap: Math.min(4, 1 + Math.floor(this.wave / 3)),
      flare: jet => {
        const v = jet.vel.clone().multiplyScalar(0.4).add(_a.set((Math.random() - 0.5) * 30, -20, (Math.random() - 0.5) * 30))
        this.flares.push({ p: jet.pos.clone(), v, age: 0, flare: true })
      },
    }
    let nearest = Infinity, closing = 0
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i]
      j.age += dt
      if (j.alive) {
        const dist = j.think(dt, ctx)
        const steps = dt > 1 / 50 ? 2 : 1
        for (let k = 0; k < steps; k++) j.fly(dt / steps)
        j.syncBody()
        if (dist < nearest) { nearest = dist; closing = -_a.subVectors(j.vel, target.vel).dot(_b.subVectors(j.pos, fl.pos).normalize()) }
        // radio
        if (j.radio) { this.chatter(j.radio, j, j.radio === 'terrain' ? 4 : 7); j.radio = null }
        // guns
        if (j.ai.fireGun) {
          j.gunAcc = (j.gunAcc || 0) + dt * 16
          while (j.gunAcc >= 1) {
            j.gunAcc--
            const f = j.forward(_f)
            const muzzle = _a.copy(j.pos).addScaledVector(f, 7).addScaledVector(j.right(_r), j.type === 'momentum' ? 1.2 : 0.9)
            const spread = 0.006 + (1 - this.skill) * 0.008
            const dir = _b.subVectors(j.ai.aim, muzzle).normalize().add(_c.set((Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2)).normalize()
            this.tracers.add({ p: muzzle.clone(), prev: muzzle.clone(), v: dir.multiplyScalar(TRACER_SPEED).add(j.vel).clone(), age: 0, life: 1.3, len: 26, col: new THREE.Color('#ffd25a'), owner: j, mine: false })
          }
          if (!j.gunSound || this.time - j.gunSound > 0.5) { j.gunSound = this.time; this.hooks.sound('enemyGun', j.pos) }
          if (Math.random() < dt * 0.6) this.chatter('hit', j, 9)
        }
        if (j.ai.launch && j.missiles > 0) {
          const salvo = j.spec.boss ? 4 : 1
          for (let k = 0; k < salvo && j.missiles > 0; k++) {
            const from = j.release(new THREE.Vector3())
            const v = j.vel.clone().add(j.up(_u).multiplyScalar(-8)).add(_a.set((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30).multiplyScalar(salvo > 1 ? 1 : 0))
            this.launch('missile', from, v, null, j)
          }
          this.hooks.sound('launch', j.pos)
          this.chatter('fox2', j, 3)
        }
        // into the scenery
        let crashed = j.pos.y < Math.max(this.world.ground(j.pos.x, j.pos.z), this.world.waterY) + 1.5
        if (!crashed && (this.frameN = (this.frameN || 0) + 1) % 3 === 0) {
          const near = this.world.near(j.pos, 4, this.nearBuf || (this.nearBuf = []))
          for (let n = 0; n < near; n++) {
            const s = this.nearBuf[n]
            if (s !== j.body && s.mat.solid && !s.owner && s.sdf(j.pos, _c) < 0) { crashed = true; break }
          }
        }
        if (crashed) {
          const credited = j.pos.distanceTo(fl.pos) < 2500
          this.kill(j, credited ? 'terrain' : 'crash', credited ? fl : null)
          j.down.t = 99 // straight to the fireball
        }
        // left far behind (you went ludicrous): they come back round from ahead
        if (j.alive && j.pos.distanceTo(fl.pos) > 7000) {
          const app = fl.apparent(_a)
          const dir = app.lengthSq() > 100 ? app.normalize() : fl.forward(_b)
          const p = _c.copy(fl.pos).addScaledVector(dir, 3200)
          p.y = Math.max(p.y, Math.max(this.world.ground(p.x, p.z), this.world.waterY) + 300)
          j.place(p, _d.copy(dir).negate().setY(0).normalize(), 330)
          j.ai.mode = 'enter'
          for (const t of j.trails) t.clear()
          this.chatter('fast', j, 12)
        }
      } else {
        // going down
        const D = j.down
        D.t += dt
        j.fall(dt)
        j.smokeT -= dt
        if (j.smokeT <= 0) {
          j.smokeT = 0.03
          this.fx.puffs.spawn(j.pos, { vel: _a.copy(j.vel).multiplyScalar(-0.1), size: 2.5, grow: 9, life: 2.2, color: Math.random() < 0.35 ? '#ff9a3a' : '#3d3734', alpha: 0.9, drag: 1 })
        }
        const gy = Math.max(this.world.ground(j.pos.x, j.pos.z), this.world.waterY)
        if (j.pos.y < gy + 2 || D.t > 14) {
          if (D.t < 90) {
            const wet = this.world.ground(j.pos.x, j.pos.z) < this.world.waterY
            this.explode(_a.set(j.pos.x, gy + 3, j.pos.z), j.spec.boss ? 3.5 : 2)
            if (wet) this.fx.splash(_a.set(j.pos.x, gy, j.pos.z), _b.set(0, 1, 0), { n: 18, speed: 50, size: 4, grow: 10, life: 1.8, color: '#e8f8ff', alpha: 0.95, lift: 2 })
            this.hooks.sound('explode', j.pos)
          }
          this.removeJet(j)
          this.jets.splice(i, 1)
          continue
        }
      }
      j.update(dt, this.time)
    }
    this.nearestJet = { dist: nearest, closing }
  }

  playerGuns(dt, fl, input, app) {
    this.fireT -= dt
    this.duckCool -= dt
    const f = fl.forward(_f)
    // the target nearest the nose, with lead
    let best = null, bestScore = Infinity, bestAng = 0, bestDist = 0
    for (const j of this.jets) {
      if (!j.alive) continue
      const d = j.pos.distanceTo(fl.pos)
      if (d > 1800) continue
      const lead = _a.copy(j.pos).addScaledVector(_b.subVectors(j.vel, app), d / ORB_SPEED)
      const ang = Math.acos(clamp(f.dot(_c.subVectors(lead, fl.pos).normalize()), -1, 1))
      if (ang > 0.26) continue
      const score = ang + d / 6000
      if (score < bestScore) { bestScore = score; best = j; bestAng = ang; bestDist = d }
    }
    this.lock = best ? { jet: best, ang: bestAng, dist: bestDist } : null
    if (this.ko || fl.splat || this.phase === 'idle') return
    const auto = best && bestAng < 0.1 && bestDist < 1300
    this.firing = input.fire || auto
    if (this.firing && this.fireT <= 0) {
      this.fireT = 1 / 11
      this.gunSide = -this.gunSide
      const u = fl.up(_u), r = fl.right(_r)
      const muzzle = _d.copy(fl.pos).addScaledVector(r, 2.3 * this.gunSide).addScaledVector(f, -0.6).addScaledVector(u, 0.05)
      const shots = this.tripleT > 0 ? [-0.07, 0, 0.07] : [0]
      for (const a of shots) {
        const dir = _a.copy(f).applyAxisAngle(u, a)
        this.orbsShot.add({ p: muzzle.clone(), prev: muzzle.clone(), v: dir.multiplyScalar(ORB_SPEED).add(app).clone(), age: 0, life: 1.4, len: 5, col: new THREE.Color(this.tripleT > 0 ? '#6ff7ff' : '#4fd8ff'), mine: true, target: best, dmg: 1 })
      }
      this.fx.puffs.spawn(muzzle, { vel: _b.copy(app).addScaledVector(f, 20), size: 0.9, grow: 1.5, life: 0.12, color: '#c8f6ff', alpha: 1, drag: 4 })
      this.hooks.sound('pew')
    }
    // rubber ducks go off by themselves at whatever's locked
    if (this.ducks > 0 && best && bestAng < 0.35 && this.duckCool <= 0) {
      this.duckCool = 0.4
      this.ducks--
      const p = _a.copy(fl.pos).addScaledVector(fl.up(_u), -1.4)
      this.launch('duck', p, _b.copy(app).addScaledVector(f, 120).addScaledVector(fl.up(_u), -10), best, 'player')
      this.hooks.sound('quack')
    }
  }

  updateShots(dt, fl) {
    const S = this.orbsShot
    for (let i = S.list.length - 1; i >= 0; i--) {
      const b = S.list[i]
      b.age += dt
      if (b.age > b.life) { S.list.splice(i, 1); continue }
      // optimistic orbs: bend gently toward where the target will be
      if (b.target && b.target.alive && b.age > 0.04) {
        const d = b.p.distanceTo(b.target.pos)
        const lead = _a.copy(b.target.pos).addScaledVector(b.target.vel, d / ORB_SPEED * 0.7)
        const want = lead.sub(b.p).normalize()
        const sp = b.v.length(), cur = _b.copy(b.v).divideScalar(sp)
        const ang = Math.acos(clamp(cur.dot(want), -1, 1))
        if (ang < 0.35 && ang > 1e-4) b.v.copy(cur.lerp(want, Math.min(1, 1.6 * dt / ang)).normalize().multiplyScalar(sp))
      }
      b.prev.copy(b.p)
      b.p.addScaledVector(b.v, dt)
      let hit = false
      for (const j of this.jets) {
        if (!j.alive || b.p.distanceToSquared(j.pos) > (j.body.bound + b.v.length() * dt + 4) ** 2) continue
        if (segEllipsoid(b.prev, b.p, j.body, 0.6) >= 0) {
          this.damageJet(j, b.dmg, b.returned ? 'returned' : 'gun', fl, b.p)
          this.hooks.sound('hitJet', j.pos)
          hit = true
          break
        }
      }
      if (!hit && b.p.y < this.world.ground(b.p.x, b.p.z)) { hit = true; this.fx.puffs.spawn(b.p, { size: 1, grow: 3, life: 0.4, color: '#c8f6ff', alpha: 0.9 }) }
      if (hit) S.list.splice(i, 1)
    }
    S.draw()

    const T = this.tracers
    for (let i = T.list.length - 1; i >= 0; i--) {
      const b = T.list[i]
      b.age += dt
      if (b.age > b.life) { T.list.splice(i, 1); continue }
      b.prev.copy(b.p)
      b.p.addScaledVector(b.v, dt)
      if (!this.ko && segSphere(b.prev, b.p, fl.pos, PLAYER_R + (this.shieldT > 0 ? 2.8 : 0)) >= 0) {
        if (fl.shielding) {
          // law 10: it goes back the way it came, and it's yours now
          const n = _a.subVectors(b.p, fl.pos).normalize()
          b.v.reflect(n).multiplyScalar(1.1)
          b.p.copy(fl.pos).addScaledVector(n, PLAYER_R + 1)
          T.list.splice(i, 1)
          this.orbsShot.add({ p: b.p.clone(), prev: b.p.clone(), v: b.v.clone(), age: 0, life: 1.2, len: 6, col: new THREE.Color('#ffe680'), mine: true, returned: true, target: b.owner && b.owner.alive ? b.owner : null, dmg: 1.5 })
          this.hooks.sound('ping')
          if (Math.random() < 0.25) this.hooks.pop('ping!', fl.pos, 'small')
          continue
        }
        if (this.hurtPlayer(0.28, fl)) this.fx.splash(b.p, _a.copy(b.v).normalize().negate(), { n: 3, speed: 12, size: 0.8, grow: 2, life: 0.4, color: '#3a3a3a', alpha: 0.9, lift: 0.3 })
        T.list.splice(i, 1)
        continue
      }
      if (b.p.y < this.world.ground(b.p.x, b.p.z) || b.p.y < this.world.waterY) T.list.splice(i, 1)
    }
    T.draw()
  }

  updateMissiles(dt, fl, app) {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i]
      m.age += dt
      const duck = m.kind === 'duck'
      // who it's after
      let tp = null, tv = null
      if (m.mine) {
        if (m.target && (m.target.flare ? m.target.age > 2.4 : !m.target.alive)) m.target = this.jets.find(j => j.alive && j.pos.distanceTo(m.p) < 1800) || null
        // flares are very interesting to a duck
        for (const fr of this.flares) {
          if (m.target === fr || fr.age > 1.6) continue
          const d = fr.p.distanceTo(m.p)
          if (d < 500 && m.target && m.target.pos && d < m.target.pos.distanceTo(m.p) && Math.random() < dt * 1.5) { m.target = fr; break }
        }
        if (m.target) { tp = m.target.pos || m.target.p; tv = m.target.vel || m.target.v }
      } else if (!m.lost) {
        tp = fl.pos; tv = app
        // lost in a cloud, or looking the wrong way
        const toT = _a.subVectors(tp, m.p).normalize()
        const look = _b.copy(m.v).normalize()
        if (fl.touching === 'cloud' || look.dot(toT) < 0.2 || this.ko) {
          m.lost = true
          this.chatter('lost', m.owner && m.owner.alive ? m.owner : null, 6)
        }
      }
      // motor and guidance
      const sp = m.v.length()
      const burn = m.age < (duck ? 3.5 : 2.2)
      const along = _c.copy(m.v).divideScalar(Math.max(1, sp))
      if (burn) m.v.addScaledVector(along, (duck ? 260 : 380) * dt)
      else m.v.multiplyScalar(Math.exp(-0.12 * dt))
      if (m.v.length() > (duck ? 700 : 900)) m.v.setLength(duck ? 700 : 900)
      m.v.y -= (m.lost ? GRAV : 0) * dt
      if (tp) {
        const rel = _a.subVectors(tp, m.p), relV = _b.subVectors(tv, m.v)
        const r2 = Math.max(1, rel.lengthSq())
        const omega = _d.crossVectors(rel, relV).divideScalar(r2)
        const acc = omega.cross(m.v).multiplyScalar(duck ? 4 : 3.4)
        // a little pure pursuit too, so it doesn't dither when it's lined up
        acc.addScaledVector(_b.copy(rel).normalize().sub(along), sp * 0.6)
        const maxA = duck ? 320 : 280
        if (acc.length() > maxA) acc.setLength(maxA)
        m.v.addScaledVector(acc, dt)
      }
      const prev = _f.copy(m.p)
      m.p.addScaledVector(m.v, dt)
      m.mesh.position.copy(m.p)
      m.mesh.quaternion.setFromUnitVectors(Z, _a.copy(m.v).normalize())
      if (duck) m.mesh.rotateZ(Math.sin(m.age * 14) * 0.3)
      // trail
      m.smokeT -= dt
      if (m.smokeT <= 0 && (burn || duck)) {
        m.smokeT = duck ? 0.04 : 0.025
        this.fx.puffs.spawn(m.p, duck
          ? { vel: _a.copy(m.v).multiplyScalar(-0.05), size: 0.8, grow: 2.5, life: 0.8, color: pick(['#bff4ff', '#ffffff', '#9fe8ff']), alpha: 0.8, drag: 2 }
          : { vel: _a.copy(m.v).multiplyScalar(-0.05), size: 1.1, grow: 5, life: 2.4, color: '#e9eef2', alpha: 0.75, drag: 1.2 })
      }
      // what it meets
      let boom = false, victim = null
      if (m.mine) {
        for (const j of this.jets) {
          if (!j.alive) continue
          const d = segEllipsoid(prev, m.p, j.body, duck ? 5 : 8) // proximity fuse
          if (d >= 0) { boom = true; victim = j; break }
        }
        if (m.target && m.target.flare && m.p.distanceTo(m.target.p) < 6) boom = true
      } else if (!this.ko && segSphere(prev, m.p, fl.pos, PLAYER_R + 4 + (this.shieldT > 0 ? 3 : 0)) >= 0) {
        if (fl.shielding) {
          // law 10, and now it's yours
          const owner = m.owner && m.owner.alive ? m.owner : this.jets.find(j => j.alive)
          m.mine = true
          m.target = owner || null
          m.lost = false
          m.age = 0 // and a fresh motor to get it home
          // batted straight back at whoever sent it (or the way it came, if nobody's left)
          const sp = Math.max(450, m.v.length())
          if (owner) m.v.subVectors(_a.copy(owner.pos).addScaledVector(owner.vel, owner.pos.distanceTo(fl.pos) / sp), fl.pos).setLength(sp)
          else m.v.negate()
          m.p.copy(fl.pos).addScaledVector(_a.copy(m.v).normalize(), PLAYER_R + 6)
          m.returned = true
          this.hooks.pop('deflected!', fl.pos, 'big')
          this.hooks.sound('deflect')
          this.chatter('deflect', owner, 4)
          continue
        }
        boom = true
        this.hurtPlayer(3, fl, m.p, 70)
      }
      const gy = Math.max(this.world.ground(m.p.x, m.p.z), this.world.waterY)
      if (m.p.y < gy) boom = true
      if (m.age > (duck ? 8 : 10)) boom = true
      if (boom) {
        if (victim) this.damageJet(victim, duck ? 11 : 14, m.returned ? 'returned' : duck ? 'duck' : 'missile', fl, m.p)
        this.explode(m.p, duck ? 0.5 : 0.7, null)
        if (duck) { this.fx.splash(m.p, _a.set(0, 1, 0), { n: 8, speed: 30, size: 1, grow: 2, life: 0.6, color: '#ffd21f', alpha: 1, lift: 0.4 }); this.hooks.sound('quack') }
        this.hooks.sound('explodeSmall', m.p)
        this.scene.remove(m.mesh)
        this.missiles.splice(i, 1)
      }
    }
  }

  updateLeftovers(dt) {
    // flares: hot, bright, falling
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const fr = this.flares[i]
      fr.age += dt
      fr.v.y -= GRAV * dt
      fr.v.multiplyScalar(Math.exp(-1.2 * dt))
      fr.p.addScaledVector(fr.v, dt)
      if (fr.age > 2.4) { this.flares.splice(i, 1); continue }
      this.fx.puffs.spawn(fr.p, { size: 1.6, grow: 0.5, life: 0.12, color: '#fff7d0', alpha: 1, drag: 0 })
      if (Math.random() < 0.5) this.fx.puffs.spawn(fr.p, { size: 0.8, grow: 3, life: 1, color: '#d8d8d8', alpha: 0.6, drag: 1 })
    }
    // ejected pilots, drifting down with a small sense of injustice
    for (let i = this.chutes.length - 1; i >= 0; i--) {
      const c = this.chutes[i]
      c.age += dt
      const open = c.age > 0.9
      if (open) {
        c.v.multiplyScalar(Math.exp(-3 * dt))
        c.v.y += (-6 - c.v.y) * (1 - Math.exp(-2 * dt))
      } else c.v.y -= GRAV * dt
      c.p.addScaledVector(c.v, dt)
      c.mesh.position.copy(c.p)
      c.mesh.scale.setScalar(open ? Math.min(1.2, (c.age - 0.9) * 3 + 0.2) : 0.25)
      c.mesh.rotation.set(Math.sin(c.age * 1.3 + c.sway) * 0.12, c.age * 0.2, Math.cos(c.age * 1.1 + c.sway) * 0.12)
      if (c.p.y < Math.max(this.world.ground(c.p.x, c.p.z), this.world.waterY) || c.age > 40) { this.scene.remove(c.mesh); this.chutes.splice(i, 1) }
    }
    // bits of aircraft
    const D = this.debris
    for (let i = D.length - 1; i >= 0; i--) {
      const d = D[i]
      d.age += dt
      d.v.y -= GRAV * 2 * dt
      d.p.addScaledVector(d.v, dt)
      d.r.x += d.w.x * dt; d.r.y += d.w.y * dt
      if (d.age > 5 || d.p.y < Math.max(this.world.ground(d.p.x, d.p.z), this.world.waterY)) D.splice(i, 1)
    }
    for (let i = 0; i < D.length; i++) {
      const d = D[i]
      _m.compose(d.p, _q.setFromEuler(d.r), _s.setScalar(d.s))
      this.debrisMesh.setMatrixAt(i, _m)
    }
    this.debrisMesh.count = D.length
    this.debrisMesh.instanceMatrix.needsUpdate = true
  }

  updatePickups(dt, fl) {
    const a = this.prevPos || (this.prevPos = fl.pos.clone())
    const seg = _a.subVectors(fl.pos, a), len2 = seg.lengthSq()
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i]
      pk.age += dt
      pk.group.position.set(pk.p.x, pk.p.y + Math.sin(this.time * 1.6 + pk.phase) * 1.5, pk.p.z)
      pk.group.children[1].rotation.y += dt * 0.8
      pk.group.children[0].material.rotation = Math.sin(this.time * 2 + pk.phase) * 0.15
      let t = len2 > 1e-9 ? _b.subVectors(pk.group.position, a).dot(seg) / len2 : 0
      t = clamp(t, 0, 1)
      const near = _c.copy(a).addScaledVector(seg, t).distanceTo(pk.group.position) < 9
      if ((near && !this.ko) || pk.age > 60 || pk.p.distanceTo(fl.pos) > 5000) {
        if (near) this.collect(pk, fl)
        this.scene.remove(pk.group)
        pk.group.children[0].material.dispose(); pk.group.children[1].material.dispose()
        this.pickups.splice(i, 1)
      }
    }
    this.prevPos.copy(fl.pos)
  }

  updateKO(dt, fl) {
    if (!this.ko) return
    this.ko.t += dt
    if (Math.random() < dt * 20) this.fx.puffs.spawn(fl.pos, { vel: _a.set(0, 6, 0), size: 1.4, grow: 5, life: 1.2, color: '#3a3532', alpha: 0.8, drag: 1 })
    // ask to be put back together (again, if a respawn was already under way and missed us)
    if (this.ko.t > (this.ko.next ?? 2.4)) { this.ko.next = this.ko.t + 3; this.hooks.respawn() }
  }

  // the engine has put you back together
  revived() {
    this.ko = null
    this.hp = MAX_HP
    this.invuln = 3
    this.soot = 0.4
    this.prevPos = null
  }

  shift(dx, dz) {
    for (const j of this.jets) j.shift(dx, dz)
    this.orbsShot.shift(dx, dz)
    this.tracers.shift(dx, dz)
    for (const m of this.missiles) { m.p.x -= dx; m.p.z -= dz }
    for (const f of this.flares) { f.p.x -= dx; f.p.z -= dz }
    for (const c of this.chutes) { c.p.x -= dx; c.p.z -= dz }
    for (const d of this.debris) { d.p.x -= dx; d.p.z -= dz }
    for (const p of this.pickups) { p.p.x -= dx; p.p.z -= dz }
    if (this.prevPos) { this.prevPos.x -= dx; this.prevPos.z -= dz }
  }

  // for the HUD
  get maxHp() { return MAX_HP }
  get bandits() { return this.jets.filter(j => j.alive).length }
}

