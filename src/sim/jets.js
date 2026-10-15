import * as THREE from 'three'
import { n64Material, textures } from './n64.js'
import { Body, MAT } from './shapes.js'
import { Ribbon } from './ribbon.js'
import { LID_Y } from './constants.js'

/*
  The Newtonian Air Force
  =======================
  Real aircraft, flying by the real rules, sent to arrest a cartoon for breaking them.

  Their wings make lift in proportion to angle of attack and airspeed squared, and
  stall past a critical angle. Lift costs drag, so hard turns bleed speed. Engines
  push along the nose; afterburners push harder. Gravity is 9.81 and they believe
  in it. Their airframes break past so many g, so the flight computer won't pull
  more. To turn they roll the lift where they want to go and pull.

  So they can't stop, can't turn on the spot, can't fly backwards, and the faster
  they go the wider they turn. None of which is true of you.
*/

export const GRAV = 9.81

// per type: airframe numbers (units are metres and seconds) and character
export const TYPES = {
  inertia: {
    name: 'INERTIA', hp: 14, score: 100, hit: [5.4, 1.8, 7.6],
    thrust: 34, ab: 66, cd0: 2.6e-4, ki: 0.0085, cl: 0.0095, cy: 0.012, maxAcc: 120, alphaMax: 0.32,
    roll: 4.2, pitchMax: 0.9, corner: 230, missiles: 0, gunCone: 0.11,
  },
  momentum: {
    name: 'MOMENTUM', hp: 22, score: 150, hit: [6.8, 2.0, 9.6],
    thrust: 36, ab: 70, cd0: 2.5e-4, ki: 0.008, cl: 0.009, cy: 0.012, maxAcc: 110, alphaMax: 0.3,
    roll: 3.5, pitchMax: 0.8, corner: 240, missiles: 2, gunCone: 0.11,
  },
  entropy: {
    name: 'ENTROPY', hp: 18, score: 200, hit: [6.8, 1.8, 9.6],
    thrust: 40, ab: 76, cd0: 2.3e-4, ki: 0.0075, cl: 0.0105, cy: 0.012, maxAcc: 135, alphaMax: 0.36,
    roll: 4.8, pitchMax: 1.0, corner: 240, missiles: 3, gunCone: 0.12,
  },
  law: {
    name: 'THE SECOND LAW', hp: 170, score: 2500, hit: [25, 2.6, 11], boss: true,
    thrust: 26, ab: 26, cd0: 6e-4, ki: 0.01, cl: 0.008, cy: 0.01, maxAcc: 26, alphaMax: 0.25,
    roll: 0.9, pitchMax: 0.25, corner: 150, missiles: 999, gunCone: 0,
  },
}

const clamp = THREE.MathUtils.clamp
const UP = new THREE.Vector3(0, 1, 0)
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3()
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _vh = new THREE.Vector3()
const _vb = new THREE.Vector3(), _acc = new THREE.Vector3(), _L = new THREE.Vector3(), _perp = new THREE.Vector3()
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _p = new THREE.Vector3(), _w = new THREE.Vector3(), _e = new THREE.Euler()
const C = h => new THREE.Color(h)

// ------------------------------------------------------------------ geometry helpers
// non-indexed triangles with colour, normal and uv; faces are turned to point along a hint
export class Geo {
  constructor() { this.p = []; this.n = []; this.c = []; this.uv = [] }
  tri(a, b, c, col, uvs, out, ns) {
    const fn = _c.crossVectors(_a.subVectors(b, a), _b.subVectors(c, a))
    if (out && fn.dot(out) < 0) {
      ;[b, c] = [c, b]
      if (uvs) uvs = [uvs[0], uvs[2], uvs[1]]
      if (ns) ns = [ns[0], ns[2], ns[1]]
      if (Array.isArray(col)) col = [col[0], col[2], col[1]]
      fn.negate()
    }
    fn.normalize()
    const vs = [a, b, c]
    for (let i = 0; i < 3; i++) {
      const v = vs[i], nn = ns ? ns[i] : fn, cc = Array.isArray(col) ? col[i] : col, u = uvs ? uvs[i] : [0, 0]
      this.p.push(v.x, v.y, v.z); this.n.push(nn.x, nn.y, nn.z); this.c.push(cc.r, cc.g, cc.b); this.uv.push(u[0], u[1])
    }
  }
  build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.computeBoundingSphere()
    return g
  }
}

const sgnPow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e)

// loft a body through cross-sections [z, halfWidth, halfHeight, yCentre]; e < 1 is boxier.
// colour comes from paint(normal) so tops and bottoms can differ
export function loft(geo, sections, { N = 10, e = 0.85, x = 0, paint, uvK = 0.18, rot = Math.PI / 2, capEnd = null, capStart = null }) {
  const rings = sections.map(([z, w, h, y], i) => {
    const prev = sections[Math.max(0, i - 1)], next = sections[Math.min(sections.length - 1, i + 1)]
    const dz = next[0] - prev[0] || 1
    const slope = ((next[1] + next[2]) - (prev[1] + prev[2])) / (2 * dz)
    const pts = [], nrm = []
    for (let j = 0; j <= N; j++) {
      const th = rot + (j / N) * Math.PI * 2
      const cs = Math.cos(th), sn = Math.sin(th)
      pts.push(new THREE.Vector3(x + w * sgnPow(cs, e), y + h * sgnPow(sn, e), z))
      const nx = sgnPow(cs, 2 - e) / Math.max(w, 0.05), ny = sgnPow(sn, 2 - e) / Math.max(h, 0.05)
      const l = Math.hypot(nx, ny) || 1
      nrm.push(new THREE.Vector3(nx / l, ny / l, -slope).normalize())
    }
    return { pts, nrm, z, y, x }
  })
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i], B = rings[i + 1]
    for (let j = 0; j < N; j++) {
      const a = A.pts[j], b = A.pts[j + 1], c = B.pts[j + 1], d = B.pts[j]
      const na = A.nrm[j], nb = A.nrm[j + 1], nc = B.nrm[j + 1], nd = B.nrm[j]
      const ua = [j / N * 4 * uvK * 6, A.z * uvK], ub = [(j + 1) / N * 4 * uvK * 6, A.z * uvK]
      const uc = [(j + 1) / N * 4 * uvK * 6, B.z * uvK], ud = [j / N * 4 * uvK * 6, B.z * uvK]
      const out = _d.copy(na).add(nc)
      const ca = paint(na), cb = paint(nb), cc = paint(nc), cd = paint(nd)
      if (a.distanceToSquared(b) > 1e-8) geo.tri(a, b, c, [ca, cb, cc], [ua, ub, uc], out.clone(), [na, nb, nc])
      if (c.distanceToSquared(d) > 1e-8) geo.tri(a, c, d, [ca, cc, cd], [ua, uc, ud], out.clone(), [na, nc, nd])
    }
  }
  const cap = (R, col, dir) => {
    const ctr = new THREE.Vector3(R.x, R.y, R.z), n = new THREE.Vector3(0, 0, dir)
    for (let j = 0; j < N; j++) geo.tri(ctr, R.pts[j], R.pts[j + 1], col, null, n)
  }
  if (capStart) cap(rings[0], capStart, -1)
  if (capEnd) cap(rings[rings.length - 1], capEnd, 1)
}

// a flat panel with thickness: outline pts [[u, v]...] in its own plane; place(u, v, o) puts a point in 3D
export function plate(geo, pts, t, place, col, uvK = 0.2) {
  const contour = pts.map(([u, v]) => new THREE.Vector2(u, v))
  const faces = THREE.ShapeUtils.triangulateShape(contour, [])
  const P = (u, v, o) => place(u, v, o)
  const nrm = _p.subVectors(P(0, 0, 1), P(0, 0, 0)).normalize().clone()
  for (const [i, j, k] of faces) {
    for (const s of [1, -1]) {
      const [a, b, c] = [pts[i], pts[j], pts[k]]
      geo.tri(P(a[0], a[1], s * t / 2), P(b[0], b[1], s * t / 2), P(c[0], c[1], s * t / 2), col,
        [[a[0] * uvK, a[1] * uvK], [b[0] * uvK, b[1] * uvK], [c[0] * uvK, c[1] * uvK]], nrm.clone().multiplyScalar(s))
    }
  }
  let cu = 0, cv = 0
  for (const [u, v] of pts) { cu += u / pts.length; cv += v / pts.length }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    const mid = P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0), ctr = P(cu, cv, 0)
    const out = mid.clone().sub(ctr)
    const A0 = P(a[0], a[1], t / 2), B0 = P(b[0], b[1], t / 2), B1 = P(b[0], b[1], -t / 2), A1 = P(a[0], a[1], -t / 2)
    const uvs = [[0, 0], [0.1, 0], [0.1, 0.02]]
    geo.tri(A0, B0, B1, col, uvs, out)
    geo.tri(A0, B1, A1, col, uvs, out)
  }
}

// wing in the x–z plane (right side; mirrored for the left), with dihedral (negative: anhedral)
const wingPlace = (side, y0, dihedral = 0, x0 = 0) => (u, v, o) => new THREE.Vector3(side * (x0 + u), y0 + o + u * Math.tan(dihedral), v)
// fin in the z–y plane at x0, canted outward
const finPlace = (x0, y0, cant = 0) => (u, v, o) => new THREE.Vector3(x0 + o * Math.cos(cant) + v * Math.sin(cant), y0 + v * Math.cos(cant) - o * Math.sin(cant), u)

function decalQuad(geo, cx, cy, cz, size, uv0, uv1, normal, tangent) {
  const n = normal.clone().normalize(), tx = tangent.clone().normalize(), ty = new THREE.Vector3().crossVectors(n, tx)
  const c = new THREE.Vector3(cx, cy, cz).addScaledVector(n, 0.02)
  const corner = (sx, sy) => c.clone().addScaledVector(tx, sx * size).addScaledVector(ty, sy * size)
  const white = C('#ffffff')
  // uv0 is the image's bottom-left, uv1 its top-right (canvas textures are flipped, so v runs up)
  const [u0, v0] = uv0, [u1, v1] = uv1
  geo.tri(corner(-1, -1), corner(1, -1), corner(1, 1), white, [[u0, v0], [u1, v0], [u1, v1]], n)
  geo.tri(corner(-1, -1), corner(1, 1), corner(-1, 1), white, [[u0, v0], [u1, v1], [u0, v1]], n)
}

// ------------------------------------------------------------------ the airframes
// where things are on the decal sheet (bottom-left, top-right; v runs up)
const ROUNDEL = [[0, 0.5], [0.5, 1]], STENCIL = [[0.5, 0.5], [1, 1]]
const GREY = { top: C('#8a939c'), bot: C('#b8bfc6'), nose: C('#6e757d') }
const counter = (top, bot) => n => bot.clone().lerp(top, THREE.MathUtils.smoothstep(n.y, -0.45, 0.25))

function airframe(type) {
  const body = new Geo(), dark = new Geo(), glass = new Geo(), decal = new Geo()
  const nozzles = [], rails = [], tips = [], hardpoints = []
  const darkCol = C('#3d3f44'), hole = C('#121316')
  const pilots = []

  if (type === 'inertia') {
    const paint = counter(GREY.top, GREY.bot)
    loft(body, [[-7.6, 0, 0, 0.15], [-6.8, 0.32, 0.32, 0.15], [-5.6, 0.58, 0.58, 0.2], [-4.2, 0.74, 0.72, 0.28], [-2.6, 0.86, 0.8, 0.28],
      [-1.0, 1.0, 0.86, 0.18], [1.5, 1.06, 0.82, 0.12], [4.0, 0.95, 0.76, 0.12], [6.2, 0.68, 0.62, 0.12], [7.2, 0.58, 0.56, 0.12]], { paint })
    // radome
    loft(dark, [[-7.6, 0, 0, 0.15], [-6.8, 0.33, 0.33, 0.15], [-6.3, 0.46, 0.46, 0.17]], { paint: () => GREY.nose })
    // chin intake
    loft(body, [[-2.8, 0.66, 0.5, -0.82], [-1.2, 0.66, 0.5, -0.82], [1.5, 0.52, 0.42, -0.7], [3.2, 0.2, 0.2, -0.5]], { paint, e: 0.6, capStart: hole })
    // wings with strakes, tailplanes, fin, ventral fins
    const wing = [[0.85, -3.6], [1.3, -1.4], [4.9, 1.8], [4.9, 2.7], [0.85, 3.3]]
    for (const s of [1, -1]) plate(body, wing, 0.18, wingPlace(s, 0.05), GREY.top)
    for (const s of [1, -1]) plate(body, [[0.6, 4.6], [3.1, 6.5], [3.1, 7.3], [0.6, 7.1]], 0.12, wingPlace(s, 0.15, -0.1), GREY.top)
    plate(body, [[3.0, 0.85], [5.7, 4.4], [6.7, 4.4], [6.9, 0.85]], 0.14, finPlace(0, 0), GREY.top)
    for (const s of [1, -1]) plate(body, [[4.6, 0], [5.6, -0.75], [6.2, -0.75], [6.1, 0]], 0.08, finPlace(s * 0.65, -0.55, s * 0.35), GREY.bot)
    // canopy, a single bubble
    loft(glass, [[-5.4, 0, 0, 0.92], [-4.8, 0.3, 0.28, 0.95], [-3.9, 0.44, 0.42, 0.98], [-2.9, 0.4, 0.38, 0.96], [-1.6, 0.16, 0.16, 0.92]], { paint: () => C('#ffffff'), N: 10, e: 1 })
    pilots.push([0, 1.12, -3.9])
    nozzles.push({ x: 0, y: 0.12, z: 7.2, r: 0.56, len: 1.0 })
    tips.push([4.95, 0.05, 2.2], [-4.95, 0.05, 2.2])
    rails.push([4.98, 0.05, 1.3], [-4.98, 0.05, 1.3], [2.8, -0.35, 0.8], [-2.8, -0.35, 0.8])
    decalQuad(decal, 3.2, 0.15, 1.3, 0.55, ROUNDEL[0], ROUNDEL[1], UP, new THREE.Vector3(1, 0, 0))
    decalQuad(decal, -3.2, 0.15, 1.3, 0.55, ROUNDEL[0], ROUNDEL[1], UP, new THREE.Vector3(1, 0, 0))
    for (const s of [1, -1]) decalQuad(decal, s * 0.09, 2.7, 5.9, 0.6, STENCIL[0], STENCIL[1], new THREE.Vector3(s, 0, 0), new THREE.Vector3(0, 0, -s))
  } else if (type === 'momentum') {
    const top = C('#7a8796'), paint = counter(top, C('#b4bcc5'))
    loft(body, [[-9.6, 0, 0, 0.25], [-8.4, 0.42, 0.4, 0.25], [-6.8, 0.74, 0.72, 0.35], [-5.0, 0.9, 0.86, 0.38], [-3.0, 1.35, 0.86, 0.22],
      [-1.0, 1.95, 0.8, 0.05], [2.0, 2.1, 0.74, 0], [5.0, 1.9, 0.64, 0], [7.4, 1.7, 0.54, 0], [8.2, 1.6, 0.5, 0]], { paint, e: 0.7, N: 12 })
    loft(dark, [[-9.6, 0, 0, 0.25], [-8.4, 0.43, 0.41, 0.25], [-7.8, 0.56, 0.55, 0.28]], { paint: () => C('#6a727b') })
    for (const s of [1, -1]) loft(body, [[-3.6, 0.6, 0.72, -0.3], [-1.6, 0.6, 0.72, -0.3], [1.2, 0.5, 0.6, -0.25], [3.0, 0.3, 0.4, -0.15]], { paint, e: 0.4, x: s * 1.6, capStart: hole })
    for (const s of [1, -1]) plate(body, [[1.7, -2.6], [7.6, 3.3], [7.6, 4.3], [1.9, 4.7]], 0.22, wingPlace(s, 0.05), top)
    for (const s of [1, -1]) plate(body, [[1.4, 5.5], [4.7, 8.3], [4.7, 9.1], [1.4, 9.0]], 0.14, wingPlace(s, 0.05), top)
    for (const s of [1, -1]) plate(body, [[3.6, 0.45], [6.7, 4.7], [7.9, 4.7], [8.3, 0.45]], 0.15, finPlace(s * 1.25, 0.2, s * 0.12), top)
    loft(glass, [[-7.2, 0, 0, 1.0], [-6.5, 0.36, 0.34, 1.05], [-5.4, 0.52, 0.5, 1.08], [-4.2, 0.46, 0.44, 1.05], [-3.0, 0.18, 0.2, 0.98]], { paint: () => C('#ffffff'), N: 10, e: 1 })
    pilots.push([0, 1.22, -5.4])
    nozzles.push({ x: 0.85, y: 0, z: 8.2, r: 0.56, len: 1.0 }, { x: -0.85, y: 0, z: 8.2, r: 0.56, len: 1.0 })
    tips.push([7.7, 0.05, 3.8], [-7.7, 0.05, 3.8])
    rails.push([3.6, -0.4, 1.4], [-3.6, -0.4, 1.4], [5.2, -0.35, 2.6], [-5.2, -0.35, 2.6])
    for (const s of [1, -1]) decalQuad(decal, s * 4.8, 0.2, 2.2, 0.7, ROUNDEL[0], ROUNDEL[1], UP, new THREE.Vector3(1, 0, 0))
    // on the outside of each canted fin
    for (const s of [1, -1]) decalQuad(decal, s * 1.66, 2.65, 6.9, 0.65, STENCIL[0], STENCIL[1], new THREE.Vector3(s * Math.cos(0.12), -Math.sin(0.12), 0), new THREE.Vector3(0, 0, -s))
  } else if (type === 'entropy') {
    const top = C('#7f858d'), paint = counter(top, C('#9da3aa'))
    const facet = { paint, e: 1, N: 6, rot: 0 }
    loft(body, [[-9.6, 0, 0, 0.1], [-8.0, 0.62, 0.42, 0.15], [-6.0, 1.05, 0.66, 0.25], [-4.0, 1.7, 0.8, 0.25], [-2.0, 2.35, 0.76, 0.1],
      [1.0, 2.45, 0.7, 0], [4.0, 2.25, 0.62, 0], [6.5, 1.65, 0.5, 0], [7.8, 1.45, 0.42, 0]], facet)
    for (const s of [1, -1]) loft(body, [[-4.6, 0.55, 0.55, -0.35], [-2.6, 0.6, 0.62, -0.35], [0.5, 0.5, 0.5, -0.25], [2.5, 0.3, 0.3, -0.1]], { ...facet, x: s * 1.8, capStart: hole, N: 4, rot: Math.PI / 4 })
    for (const s of [1, -1]) plate(body, [[2.3, -2.3], [7.0, 2.6], [7.0, 3.4], [2.3, 4.6]], 0.2, wingPlace(s, 0.05), top)
    for (const s of [1, -1]) plate(body, [[1.7, 4.8], [4.6, 6.6], [4.6, 8.6], [1.7, 8.2]], 0.14, wingPlace(s, 0.05), top)
    for (const s of [1, -1]) plate(body, [[2.8, 0.35], [5.1, 3.7], [6.5, 3.7], [6.7, 0.35]], 0.15, finPlace(s * 1.55, 0.3, s * 0.45), top)
    loft(glass, [[-7.6, 0, 0, 0.85], [-6.8, 0.34, 0.3, 0.92], [-5.6, 0.5, 0.46, 0.98], [-4.4, 0.44, 0.4, 0.96], [-3.2, 0.12, 0.12, 0.9]], { paint: () => C('#ffffff'), N: 10, e: 1 })
    pilots.push([0, 1.12, -5.6])
    for (const s of [1, -1]) nozzles.push({ x: s * 0.8, y: 0, z: 7.8, r: 0.5, len: 0.9, square: true })
    tips.push([7.0, 0.05, 3.0], [-7.0, 0.05, 3.0])
    hardpoints.push([0, -0.7, 0], [0, -0.7, 1], [0, -0.7, 2]) // internal bays: missiles come out from underneath
    for (const s of [1, -1]) decalQuad(decal, s * 4.6, 0.17, 2.0, 0.6, ROUNDEL[0], ROUNDEL[1], UP, new THREE.Vector3(1, 0, 0))
  } else if (type === 'law') {
    // a flying wing, and a big one
    const top = C('#4d535b'), paint = counter(top, C('#555b63'))
    const half = [[0, -10.6], [26, 6.3], [25.6, 7.4], [18.6, 3.2], [12.6, 7.2], [6.4, 3.4], [0, 7.4]]
    for (const s of [1, -1]) plate(body, half, 0.9, wingPlace(s, 0, 0.02), top, 0.08)
    loft(body, [[-10.4, 0, 0, 0.3], [-8.5, 1.6, 0.9, 0.5], [-5.0, 3.6, 1.6, 0.7], [0, 4.6, 1.7, 0.6], [4.5, 4.0, 1.3, 0.4], [7.2, 2.6, 0.6, 0.2]], { paint, e: 0.9, N: 12, uvK: 0.08 })
    for (const s of [1, -1]) loft(body, [[-4.0, 0, 0, 0.6], [-2.5, 1.4, 0.9, 0.8], [1.5, 1.6, 0.9, 0.8], [5.5, 1.3, 0.55, 0.6]], { paint, e: 0.8, x: s * 6.6, uvK: 0.08 })
    loft(glass, [[-8.0, 0, 0, 1.3], [-7.2, 1.0, 0.3, 1.45], [-6.2, 1.2, 0.35, 1.5], [-5.4, 0.2, 0.1, 1.4]], { paint: () => C('#ffffff'), N: 8, e: 0.6 })
    pilots.push([0.5, 1.6, -6.6], [-0.5, 1.6, -6.6])
    for (const s of [1, -1]) for (const k of [0, 1]) nozzles.push({ x: s * (5.6 + k * 2), y: 1.0, z: 5.6, r: 0.6, len: 0.4, square: true })
    tips.push([25.8, 0, 6.9], [-25.8, 0, 6.9])
    for (const s of [1, -1]) for (const k of [-1, 0, 1]) hardpoints.push([s * (3 + k), -1.2, -1 + k])
    for (const s of [1, -1]) decalQuad(decal, s * 16, 0.85, 3.0, 2.2, ROUNDEL[0], ROUNDEL[1], UP, new THREE.Vector3(1, 0, 0))
  }

  // engines: a dark can with a hot hole in the middle
  for (const nz of nozzles) {
    if (nz.square) {
      loft(dark, [[nz.z, nz.r * 1.3, nz.r * 0.6, nz.y], [nz.z + nz.len, nz.r * 1.2, nz.r * 0.5, nz.y]], { paint: () => darkCol, e: 0.3, x: nz.x, N: 8, capEnd: hole })
    } else {
      loft(dark, [[nz.z, nz.r, nz.r, nz.y], [nz.z + nz.len * 0.6, nz.r * 0.98, nz.r * 0.98, nz.y], [nz.z + nz.len, nz.r * 0.86, nz.r * 0.86, nz.y]], { paint: () => darkCol, e: 1, x: nz.x, N: 10, capEnd: hole })
    }
  }
  return { body: body.build(), dark: dark.build(), glass: glass.build(), decal: decal.build(), nozzles, rails, tips, pilots, hardpoints }
}

// ------------------------------------------------------------------ ordnance (shared with combat)
export function missileGeo() {
  const g = new Geo(), white = C('#eceef0'), grey = C('#8d949c'), band = C('#d8b030')
  loft(g, [[-1.6, 0, 0, 0], [-1.35, 0.08, 0.08, 0], [-1.1, 0.11, 0.11, 0]], { paint: () => grey, N: 8, e: 1 })
  loft(g, [[-1.1, 0.11, 0.11, 0], [-0.6, 0.11, 0.11, 0]], { paint: () => band, N: 8, e: 1 })
  loft(g, [[-0.6, 0.11, 0.11, 0], [1.5, 0.11, 0.11, 0]], { paint: () => white, N: 8, e: 1, capEnd: C('#333') })
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4
    const place = (u, v, o) => new THREE.Vector3(Math.cos(a) * (0.1 + u) - Math.sin(a) * o, Math.sin(a) * (0.1 + u) + Math.cos(a) * o, v)
    plate(g, [[0, 1.0], [0.28, 1.35], [0.28, 1.5], [0, 1.5]], 0.03, place, grey)
    plate(g, [[0, -1.0], [0.16, -0.85], [0.16, -0.75], [0, -0.75]], 0.02, place, grey)
  }
  return g.build()
}

export function duckGeo() {
  const g = new Geo(), yellow = C('#ffd21f'), orange = C('#ff8a1f')
  loft(g, [[-1.1, 0, 0, 0], [-0.8, 0.6, 0.48, 0], [0, 0.8, 0.6, 0.05], [0.8, 0.6, 0.48, 0.15], [1.2, 0, 0, 0.35]], { paint: () => yellow, N: 10, e: 1 })
  loft(g, [[-1.15, 0, 0, 0.75], [-0.9, 0.42, 0.42, 0.78], [-0.5, 0.48, 0.48, 0.8], [-0.1, 0.36, 0.36, 0.8], [0.15, 0, 0, 0.78]], { paint: () => yellow, N: 10, e: 1 })
  loft(g, [[-1.65, 0, 0, 0.66], [-1.4, 0.2, 0.06, 0.68], [-1.1, 0.24, 0.08, 0.7]], { paint: () => orange, N: 8, e: 1 })
  return g.build()
}

// a round parachute canopy: stripes, a few lines, a small grumpy person
export function chuteGeo() {
  const g = new Geo(), red = C('#e8452f'), white = C('#f4f2ee'), line = C('#8a8a8a'), suit = C('#5b6a4f')
  const N = 12, R = 3.2
  for (let j = 0; j < N; j++) {
    const a0 = j / N * Math.PI * 2, a1 = (j + 1) / N * Math.PI * 2, col = j % 2 ? red : white
    const top = new THREE.Vector3(0, 3.2, 0)
    const p0 = new THREE.Vector3(Math.cos(a0) * R, 2.2, Math.sin(a0) * R), p1 = new THREE.Vector3(Math.cos(a1) * R, 2.2, Math.sin(a1) * R)
    const q0 = new THREE.Vector3(Math.cos(a0) * R * 0.8, 1.5, Math.sin(a0) * R * 0.8), q1 = new THREE.Vector3(Math.cos(a1) * R * 0.8, 1.5, Math.sin(a1) * R * 0.8)
    g.tri(top, p0, p1, col, null, UP)
    g.tri(p0, q0, q1, col, null, p0.clone().setY(0))
    g.tri(p0, q1, p1, col, null, p0.clone().setY(0))
    if (j % 3 === 0) {
      const foot = new THREE.Vector3(0, -2.2, 0), side = new THREE.Vector3(-Math.sin(a0), 0, Math.cos(a0)).multiplyScalar(0.04)
      g.tri(q0.clone().add(side), q0.clone().sub(side), foot, line, null, q0.clone().setY(0))
    }
  }
  // the pilot, built lying along z (head first) and then stood up under the canopy
  const who = new Geo()
  loft(who, [[-0.5, 0, 0, 0], [-0.4, 0.2, 0.2, 0], [-0.1, 0.22, 0.22, 0], [0, 0.12, 0.12, 0]], { paint: () => C('#505860'), N: 8, e: 1 })
  loft(who, [[0, 0.24, 0.17, 0], [0.7, 0.27, 0.19, 0], [1.4, 0.14, 0.14, 0]], { paint: () => suit, N: 8, e: 1 })
  const person = who.build()
  person.rotateX(Math.PI / 2) // +z (feet) points down
  person.translate(0, -2.2, 0)
  const chute = g.build()
  const merged = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'color']) {
    const a = chute.attributes[name].array, b = person.attributes[name].array
    const both = new Float32Array(a.length + b.length)
    both.set(a); both.set(b, a.length)
    merged.setAttribute(name, new THREE.BufferAttribute(both, 3))
  }
  return merged
}

// ------------------------------------------------------------------ afterburner flames
const flameVert = /* glsl */ `
varying float vT;
varying float vR;
void main(){
  vT = clamp(position.z / 6.0, 0.0, 1.0);
  vR = length(position.xy);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const flameFrag = /* glsl */ `
uniform vec3 uCore, uOuter;
uniform float uI;
varying float vT;
varying float vR;
void main(){
  vec3 c = mix(uCore, uOuter, smoothstep(0.0, 0.6, vT));
  float a = (1.0 - vT) * uI;
  gl_FragColor = vec4(c * a, a);
}
`
function flameGeo() {
  const g = new THREE.ConeGeometry(1, 6, 10, 1, true)
  g.rotateX(Math.PI / 2) // apex toward +z (back)
  g.translate(0, 0, 3)
  return g
}

// ------------------------------------------------------------------ the kit
let KIT = null
export function jetKit() {
  if (KIT) return KIT
  const T = textures()
  const frames = {}
  for (const t of Object.keys(TYPES)) frames[t] = airframe(t)
  KIT = {
    frames,
    glass: n64Material({ color: '#3d3524', spec: 1.4, shine: 28, rim: 0.35 }),
    dark: n64Material({ vertexColors: true, spec: 0.3, shine: 10 }),
    decal: n64Material({ map: T.decal, polygonOffset: 2 }),
    helmet: n64Material({ color: '#4e565f', spec: 0.6, shine: 20 }),
    white: n64Material({ vertexColors: true, spec: 0.4, shine: 16 }),
    nav: { red: n64Material({ color: '#ff2a2a', emissive: 1, fog: 0.3 }), green: n64Material({ color: '#2aff6a', emissive: 1, fog: 0.3 }), white: n64Material({ color: '#ffffff', emissive: 1, fog: 0.2 }) },
    missile: missileGeo(),
    flame: flameGeo(),
    diamond: new THREE.SphereGeometry(1, 8, 6),
    // the vapour cone flares out toward the tail
    vapor: (() => { const g = new THREE.ConeGeometry(2.6, 7, 14, 1, true); g.rotateX(-Math.PI / 2); return g })(),
    helmetGeo: new THREE.SphereGeometry(0.24, 8, 6),
    navGeo: new THREE.SphereGeometry(0.16, 6, 4),
  }
  return KIT
}

function buildJetMesh(type) {
  const K = jetKit(), F = K.frames[type], T = textures()
  const g = new THREE.Group()
  const skin = n64Material({ map: type === 'entropy' || type === 'law' ? T.stealth : T.skin, vertexColors: true, spec: 0.35, shine: 14, rim: 0.12 })
  g.add(new THREE.Mesh(F.body, skin))
  g.add(new THREE.Mesh(F.dark, K.dark))
  g.add(new THREE.Mesh(F.glass, K.glass))
  g.add(new THREE.Mesh(F.decal, K.decal))
  for (const p of F.pilots) { const h = new THREE.Mesh(K.helmetGeo, K.helmet); h.position.set(...p); g.add(h) }
  const missiles = F.rails.map(p => { const m = new THREE.Mesh(K.missile, K.white); m.position.set(...p); g.add(m); return m })
  const flames = F.nozzles.map(nz => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCore: { value: new THREE.Color('#fff4d0') }, uOuter: { value: new THREE.Color('#ff7a1a') }, uI: { value: 1 } },
      vertexShader: flameVert, fragmentShader: flameFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    const m = new THREE.Mesh(K.flame, mat)
    m.position.set(nz.x, nz.y, nz.z + nz.len)
    m.renderOrder = 30
    const diamonds = []
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(K.diamond, mat)
      d.position.set(nz.x, nz.y, nz.z + nz.len + 1.2 + i * 1.3)
      d.renderOrder = 31
      g.add(d)
      diamonds.push(d)
    }
    g.add(m)
    return { m, mat, r: nz.r, diamonds, z: nz.z + nz.len }
  })
  const lights = []
  if (F.tips.length >= 2) {
    const l = new THREE.Mesh(K.navGeo, K.nav.green); l.position.set(...F.tips[0]); g.add(l); lights.push(l)
    const r = new THREE.Mesh(K.navGeo, K.nav.red); r.position.set(...F.tips[1]); g.add(r); lights.push(r)
  }
  const strobe = new THREE.Mesh(K.navGeo, K.nav.white)
  strobe.position.set(0, type === 'law' ? 1.2 : -0.9, type === 'law' ? 2 : -1)
  strobe.scale.setScalar(1.4)
  g.add(strobe)
  const vapor = new THREE.Mesh(K.vapor, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide, fog: false }))
  vapor.position.set(0, 0.3, -1.5)
  vapor.visible = false
  g.add(vapor)
  return { group: g, skin, missiles, flames, strobe, vapor, tips: F.tips, hardpoints: F.hardpoints, rails: F.rails }
}

// ------------------------------------------------------------------ an aircraft
let serial = 0
export class Jet {
  constructor(type, scene, callsign) {
    this.id = ++serial
    this.type = type
    this.spec = TYPES[type]
    this.callsign = callsign
    this.mesh = buildJetMesh(type)
    this.group = this.mesh.group
    scene.add(this.group)
    this.scene = scene
    this.pos = new THREE.Vector3()
    this.vel = new THREE.Vector3()
    this.quat = new THREE.Quaternion()
    this.omega = new THREE.Vector3() // body rates: x pitch (nose up), y yaw (nose left), z roll (left wing down)
    this.hp = this.spec.hp
    this.alive = true
    this.down = null // set once it's been shot down
    this.throttle = 0.7
    this.ab = false
    this.brake = 0
    this.alpha = 0
    this.load = 1
    this.missiles = this.spec.missiles === 999 ? 999 : Math.min(this.spec.missiles, Math.max(this.mesh.rails.length, 3))
    this.flash = 0
    this.smokeT = 0
    this.age = 0
    const hit = this.spec.hit
    this.body = new Body(hit[0], hit[1], hit[2], MAT.metal, this)
    this.ai = { mode: 'enter', t: 0, side: Math.random() < 0.5 ? -1 : 1, lockT: 0, gunT: 0, burst: 0, rest: 0, missileCool: 4 + Math.random() * 4, flareT: 0, think: Math.random() * 0.1, danger: 0, wantUp: 0 }
    this.want = new THREE.Vector3(0, 0, -1)
    this.trails = this.spec.boss ? [] : [0, 1].map(() => {
      const r = new Ribbon(30, 0.25, '#ffffff', 0.7)
      r.maxGap = 60
      scene.add(r.mesh)
      return r
    })
  }

  forward(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.quat) }
  up(out = new THREE.Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.quat) }
  right(out = new THREE.Vector3()) { return out.set(1, 0, 0).applyQuaternion(this.quat) }
  get speed() { return this.vel.length() }

  place(pos, dir, speed) {
    this.pos.copy(pos)
    this.quat.setFromUnitVectors(_a.set(0, 0, -1), _b.copy(dir).normalize())
    this.vel.copy(dir).normalize().multiplyScalar(speed)
    this.syncBody()
  }

  shift(dx, dz) {
    this.pos.x -= dx; this.pos.z -= dz
    this.body.shift(dx, dz)
    for (const t of this.trails) t.shift(dx, dz)
  }

  syncBody() {
    this.body.c.copy(this.pos)
    this.body.q.copy(this.quat)
    this.body.vel.copy(this.vel)
  }

  // ---------------------------------------------------------- the real physics
  // fly toward `want` (a direction) like an aircraft would: roll the lift onto it and pull
  fly(h) {
    const S = this.spec, v = this.vel
    const sp = Math.max(1, v.length())
    const f = this.forward(_f), u = this.up(_u), r = this.right(_r)
    const vh = _vh.copy(v).divideScalar(sp)
    const vb = _vb.copy(v).applyQuaternion(_qi.copy(this.quat).invert())
    const alpha = Math.atan2(-vb.y, -vb.z), beta = Math.atan2(vb.x, -vb.z)
    this.alpha = alpha
    const q = sp * sp

    // flight computer: the normal acceleration that would swing the path onto `want`
    const cosA = clamp(vh.dot(this.want), -1, 1), ang = Math.acos(cosA)
    const perp = _perp.copy(this.want).addScaledVector(vh, -cosA)
    if (perp.lengthSq() < 1e-8) perp.copy(u).addScaledVector(vh, -u.dot(vh))
    perp.normalize()
    const demand = Math.min(S.maxAcc, ang * sp * 2.2)
    // lift also has to hold the aircraft up
    const L = _L.copy(perp).multiplyScalar(demand)
    L.y += GRAV
    L.addScaledVector(vh, -L.dot(vh))
    const Lmag = L.length()
    const zb = _a.copy(f).negate()
    const uPerp = _b.copy(u).addScaledVector(vh, -u.dot(vh)).normalize()
    let rollErr = 0, alphaCmd
    if (Lmag > 1e-3) {
      L.divideScalar(Lmag)
      rollErr = Math.atan2(_c.crossVectors(uPerp, L).dot(zb), clamp(uPerp.dot(L), -1, 1))
    }
    if (Math.abs(rollErr) > 2.3 && Lmag < 1.6 * GRAV) {
      // a small push rather than rolling upside down for it
      rollErr -= Math.sign(rollErr) * Math.PI
      alphaCmd = -Lmag / (S.cl * q)
    } else {
      alphaCmd = Lmag / (S.cl * q) * Math.max(0, Math.cos(rollErr))
    }
    const gLim = S.maxAcc / (S.cl * q)
    alphaCmd = clamp(alphaCmd, -Math.min(S.alphaMax * 0.5, gLim), Math.min(S.alphaMax, gLim))

    // the airframe follows the stick with a little lag (the nose has to keep up with the path, too)
    const wx = clamp((alphaCmd - alpha) * 6 + (this.pathRate || 0), -S.pitchMax, S.pitchMax)
    const wz = clamp(rollErr * 3.2 - this.omega.z * 0.15, -S.roll, S.roll)
    const wy = clamp(-beta * 4, -0.6, 0.6)
    const lag = 1 - Math.exp(-h * 9)
    this.omega.x += (wx - this.omega.x) * lag
    this.omega.y += (wy - this.omega.y) * lag
    this.omega.z += (wz - this.omega.z) * lag

    // aerodynamics
    const aEff = Math.abs(alpha) < S.alphaMax ? alpha : Math.sign(alpha) * Math.max(0, S.alphaMax - (Math.abs(alpha) - S.alphaMax) * 2)
    let lift = S.cl * q * aEff
    lift = clamp(lift, -S.maxAcc * 1.15, S.maxAcc * 1.15)
    this.liftAcc = lift
    const liftDir = uPerp
    const sideDir = _c.copy(r).addScaledVector(vh, -r.dot(vh)).normalize()
    const drag = (S.cd0 * (1 + this.brake * 3) + S.ki * alpha * alpha) * q
    const thrust = this.ab ? S.ab : S.thrust * this.throttle
    const acc = _acc.set(0, -GRAV, 0)
      .addScaledVector(f, thrust)
      .addScaledVector(liftDir, lift)
      .addScaledVector(sideDir, -S.cy * q * beta)
      .addScaledVector(vh, -drag)
    v.addScaledVector(acc, h)
    this.load = lift / GRAV
    this.pathRate = (lift - GRAV * liftDir.y) / sp
    this.pos.addScaledVector(v, h)

    const w = this.omega.length()
    if (w > 1e-9) {
      _q.setFromAxisAngle(_w.copy(this.omega).divideScalar(w), w * h)
      this.quat.multiply(_q).normalize()
    }
  }

  // a shot-down aircraft: no lift to speak of, spinning, burning
  fall(h) {
    const D = this.down
    this.vel.y -= GRAV * 1.6 * h
    this.vel.multiplyScalar(Math.exp(-0.25 * h))
    this.pos.addScaledVector(this.vel, h)
    _q.setFromEuler(_e.set(D.spin.x * h, D.spin.y * h, D.spin.z * h))
    this.quat.multiply(_q).normalize()
  }

  // ---------------------------------------------------------- the pilot
  // ctx: { target (pos, vel, fwd, aim), world, jets, dt, skill, missilesOut, missileCap, rnd }
  think(dt, ctx) {
    const A = this.ai, S = this.spec, T = ctx.target, world = ctx.world
    A.t += dt
    const sp = this.speed
    const f = this.forward(_f), vh = _vh.copy(this.vel).divideScalar(Math.max(1, sp))
    const rel = _a.subVectors(T.pos, this.pos), dist = rel.length()
    const dir = _b.copy(rel).divideScalar(Math.max(1, dist))
    const closing = -_c.subVectors(T.vel, this.vel).dot(dir)
    const want = this.want
    let speedWant = S.corner

    // where a burst fired now would meet the target
    const tFly = dist / (950 + Math.max(0, sp))
    const aim = _d.copy(T.pos).addScaledVector(T.vel, tFly)
    A.aim = A.aim || new THREE.Vector3()
    A.aim.copy(aim)
    const aimDir = _p.subVectors(aim, this.pos).normalize()

    if (S.boss) {
      // the bomber circles you at a respectful distance, launching things
      const R = 1100
      const flat = _c.set(rel.x, 0, rel.z)
      const fd = flat.length() || 1
      flat.divideScalar(fd)
      const tangent = _p.set(-flat.z * A.side, 0, flat.x * A.side)
      want.copy(tangent).addScaledVector(flat, clamp((fd - R) / 400, -1, 1))
      want.y = clamp((T.pos.y + 260 - this.pos.y) / 400, -0.4, 0.4)
      want.normalize()
      speedWant = 170
    } else if (A.mode === 'enter') {
      want.copy(dir)
      speedWant = 420
      if (dist < 1700) { A.mode = 'engage'; A.t = 0 }
    } else if (A.mode === 'engage') {
      if (dist < 1300) {
        // the guns point where the nose points, and the nose rides above the path by the angle of
        // attack, so in a gun pass aim the path that much under the target
        want.copy(aimDir)
        if (aimDir.dot(f) > 0.7) want.sub(_c.subVectors(f, vh)).normalize()
      } else want.copy(_c.copy(T.pos).addScaledVector(T.vel, Math.min(2, dist / Math.max(100, sp)) * 0.6).sub(this.pos).normalize())
      speedWant = dist > 1500 ? 430 : dist < 400 ? Math.max(S.corner * 0.8, Math.min(S.corner, T.vel.length() + 140)) : S.corner + 30
      // about to ram it, or already went past: extend and come round again
      const passed = vh.dot(dir) < -0.1 && dist < 450
      if ((dist < 150 && closing > 40) || passed) { A.mode = 'extend'; A.t = 0; A.dur = 2.2 + ctx.rnd() * 1.6; A.side = ctx.rnd() < 0.5 ? -1 : 1; this.radio = passed ? 'overshoot' : 'tooClose' }
      // being shot at from behind: break
      const behind = -dir.dot(vh) // > 0 when target is behind us
      const threat = T.fwd ? -T.fwd.dot(dir) : 0 // target's nose pointing at us
      if (behind > 0.5 && dist < 650 && threat > 0.97 && ctx.rnd() < dt * (0.6 + ctx.skill * 0.8)) {
        A.mode = 'break'; A.t = 0; A.dur = 1.6 + ctx.rnd(); A.side = ctx.rnd() < 0.5 ? -1 : 1; A.flareT = 0; this.radio = 'break'
      }
    } else if (A.mode === 'extend') {
      want.copy(vh).addScaledVector(this.right(_c), A.side * 0.35).addScaledVector(UP, 0.12).normalize()
      speedWant = 440
      if (A.t > A.dur && dist > 600) { A.mode = 'engage'; A.t = 0 }
    } else if (A.mode === 'break') {
      const r = this.right(_c), u = this.up(_u)
      want.copy(r).multiplyScalar(A.side).addScaledVector(u, 0.4).addScaledVector(vh, 0.25).normalize()
      speedWant = 400
      A.flareT -= dt
      if (A.flareT <= 0 && ctx.flare) { A.flareT = 0.22; ctx.flare(this) }
      if (A.t > A.dur) { A.mode = 'engage'; A.t = 0 }
    }

    // don't fly into each other
    for (const o of ctx.jets) {
      if (o === this || !o.alive) continue
      const dx = this.pos.x - o.pos.x, dy = this.pos.y - o.pos.y, dz = this.pos.z - o.pos.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 < 120 * 120 && d2 > 1) { const d = Math.sqrt(d2), k = 0.8 * (1 - d / 120) / d; want.x += dx * k; want.y += dy * k; want.z += dz * k }
    }

    // don't fly into the ground (checked a few times a second, looking ahead along the path)
    A.think -= dt
    if (A.think <= 0) {
      A.think = 0.12
      let danger = 0
      for (const t of [0.5, 1.2, 2.2, 3.4]) {
        const px = this.pos.x + this.vel.x * t, py = this.pos.y + this.vel.y * t, pz = this.pos.z + this.vel.z * t
        const gy = Math.max(world.ground(px, pz), world.waterY)
        const clear = py - gy - (28 + 12 * t)
        if (clear < 0) danger = Math.max(danger, Math.min(1, -clear / 120 + 0.4) * (1.3 - t * 0.2))
      }
      const here = this.pos.y - Math.max(world.ground(this.pos.x, this.pos.z), world.waterY)
      if (here < 40) danger = Math.max(danger, 1 - here / 40 + 0.3)
      A.danger = Math.min(1, danger)
    }
    if (A.danger > 0) {
      want.lerp(_c.copy(vh).setY(0).normalize().multiplyScalar(0.4).add(UP), A.danger).normalize()
      speedWant = Math.max(speedWant, 300)
      if (A.danger > 0.8 && !A.warned) { A.warned = true; this.radio = 'terrain' }
    } else A.warned = false
    if (this.pos.y > LID_Y - 500) want.y -= 0.6
    want.normalize()

    // throttle
    const err = speedWant - sp
    this.throttle = clamp(0.6 + err * 0.02, 0.2, 1)
    this.ab = err > 40
    this.brake = err < -90 ? 1 : 0

    // weapons
    A.fireGun = false
    A.launch = false
    A.locking = false
    if (!T.ko && S.gunCone > 0 && dist < 820 && A.mode !== 'extend') {
      const off = Math.acos(clamp(f.dot(aimDir), -1, 1))
      if (off < S.gunCone * (1.3 - ctx.skill * 0.4)) {
        if (A.rest <= 0) { A.burst += dt; A.fireGun = true; if (A.burst > 0.7) { A.burst = 0; A.rest = 0.55 + ctx.rnd() * 0.5 } }
      }
    }
    A.rest -= dt
    A.missileCool -= dt
    if (!T.ko && this.missiles > 0 && A.missileCool <= 0 && dist > 320 && dist < 2600 && ctx.missilesOut < ctx.missileCap) {
      const off = Math.acos(clamp(f.dot(dir), -1, 1))
      if (off < (S.boss ? 3 : 0.42)) {
        A.lockT += dt
        A.locking = true
        if (A.lockT > (S.boss ? 2.4 : 1.7)) { A.launch = true; A.lockT = 0; A.missileCool = S.boss ? 9 : 7 + ctx.rnd() * 5 }
      } else A.lockT = Math.max(0, A.lockT - dt * 2)
    } else A.lockT = Math.max(0, A.lockT - dt)
    return dist
  }

  // ---------------------------------------------------------- looks
  update(dt, t) {
    const M = this.mesh
    this.group.position.copy(this.pos)
    this.group.quaternion.copy(this.quat)
    this.flash = Math.max(0, this.flash - dt * 6)
    M.skin.uniforms.uFlash.value.setScalar(this.flash * 0.8)
    const burn = this.down ? 0 : this.ab ? 1 : this.throttle
    for (const F of M.flames) {
      const len = this.ab ? 1 + Math.random() * 0.25 : 0.35 + this.throttle * 0.25
      F.m.scale.set(F.r * (this.ab ? 0.85 : 0.7), F.r * (this.ab ? 0.85 : 0.7), len)
      F.mat.uniforms.uI.value = this.down ? 0 : 0.55 + burn * 0.5
      F.mat.uniforms.uOuter.value.set(this.ab ? '#ff7a1a' : '#ff9a4a')
      F.m.visible = !this.down
      F.diamonds.forEach((d, i) => {
        d.visible = this.ab && !this.down
        d.scale.set(F.r * 0.32 * (1 - i * 0.2), F.r * 0.32 * (1 - i * 0.2), F.r * 0.55)
      })
    }
    M.strobe.visible = (t * 1.1 + this.id * 0.37) % 1 < 0.08
    // vapour cone, going through the sound barrier
    const sp = this.speed
    const vk = 1 - Math.min(1, Math.abs(sp - 343) / 22)
    M.vapor.visible = vk > 0.02 && !this.down
    if (M.vapor.visible) { M.vapor.material.opacity = vk * 0.35; M.vapor.scale.setScalar(0.9 + Math.random() * 0.1) }
    // wingtip vortices when pulling
    if (this.trails.length) {
      const gk = clamp((this.load - 3.5) / 4, 0, 1) * (this.down ? 0 : 1)
      const u = this.up(_u)
      M.tips.slice(0, 2).forEach((tp, i) => {
        const p = _p.set(...tp).applyQuaternion(this.quat).add(this.pos)
        this.trails[i].push(p, u, gk, 2)
        this.trails[i].rebuild()
      })
    }
  }

  // how many missiles it carries (and shows)
  arm(n) {
    this.missiles = n
    this.mesh.missiles.forEach((m, i) => { m.visible = i < Math.max(n, this.type === 'inertia' ? 2 : 0) })
  }

  // a missile leaves: hide one off the rails, and say where it left from
  release(out) {
    const shown = this.mesh.missiles.filter(m => m.visible)
    const m = shown[shown.length - 1]
    if (m && this.missiles < 900) { m.visible = false; out.copy(m.position) }
    else { const hp = this.mesh.hardpoints; out.set(...(hp.length ? hp[Math.floor(Math.random() * hp.length)] : [0, -1, 0])) }
    this.missiles--
    return out.applyQuaternion(this.quat).add(this.pos)
  }

  remove() {
    this.scene.remove(this.group)
    for (const t of this.trails) this.scene.remove(t.mesh)
    this.mesh.skin.dispose()
    for (const F of this.mesh.flames) F.mat.dispose()
    this.mesh.vapor.material.dispose()
  }
}
