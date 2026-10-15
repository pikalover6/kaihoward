import * as THREE from 'three'

// Cartoon effects: speed streaks, puffs of cloud / dust / smoke, shock rings.

const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion()
const Z = new THREE.Vector3(0, 0, 1)

// ------------------------------------------------------------ speed streaks
// "Air" around the camera that rushes past along the momentum (not the nose), so you can
// always see which way you're really going. The apparent flow is capped, so at a zillion mph
// it reads as a warp tunnel rather than noise.
const streakVert = /* glsl */ `
attribute float aAlpha;
varying float vA;
void main(){
  vA = aAlpha;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`
const streakFrag = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main(){
  gl_FragColor = vec4(uColor * vA, vA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

class Streaks {
  constructor(scene, n = 150, box = 46) {
    this.n = n
    this.box = box
    this.p = new Float32Array(n * 3) // relative to the camera
    for (let i = 0; i < n * 3; i++) this.p[i] = (Math.random() * 2 - 1) * box
    const geo = new THREE.BufferGeometry()
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3)
    this.alp = new THREE.BufferAttribute(new Float32Array(n * 4), 1)
    this.pos.setUsage(THREE.DynamicDrawUsage); this.alp.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('position', this.pos)
    geo.setAttribute('aAlpha', this.alp)
    const idx = []
    for (let i = 0; i < n; i++) { const a = i * 4; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
    geo.setIndex(idx)
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#eaf6ff') } },
      vertexShader: streakVert, fragmentShader: streakFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 40
    scene.add(this.mesh)
    this.dir = new THREE.Vector3(0, 0, -1)
  }

  update(dt, camera, vel, speed) {
    const vis = THREE.MathUtils.smoothstep(speed, 130, 700)
    this.mesh.visible = vis > 0.01
    if (!this.mesh.visible) return
    const B = this.box, p = this.p, P = this.pos.array, A = this.alp.array
    this.dir.lerp(_v.copy(vel).divideScalar(speed), 1 - Math.exp(-dt * 12)).normalize()
    const d = this.dir
    const decades = Math.log10(Math.max(1, speed / 130))
    const flow = Math.min(speed, 260 + decades * 220)
    const len = (3 + Math.min(34, decades * 9)) * vis
    const cam = camera.position
    for (let i = 0; i < this.n; i++) {
      const k = i * 3
      p[k] -= d.x * flow * dt; p[k + 1] -= d.y * flow * dt; p[k + 2] -= d.z * flow * dt
      if (Math.abs(p[k]) > B || Math.abs(p[k + 1]) > B || Math.abs(p[k + 2]) > B) {
        // respawn upstream
        _v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).multiplyScalar(B)
        const along = _v.dot(d)
        _v.addScaledVector(d, B * 0.95 - along)
        p[k] = _v.x; p[k + 1] = _v.y; p[k + 2] = _v.z
      }
      const hx = cam.x + p[k], hy = cam.y + p[k + 1], hz = cam.z + p[k + 2]
      // width faces the camera
      _s.set(p[k], p[k + 1], p[k + 2])
      const dist = _s.length()
      _s.cross(d).normalize().multiplyScalar(0.03 + dist * 0.0018)
      const tx = hx + d.x * len, ty = hy + d.y * len, tz = hz + d.z * len
      const o = i * 12
      P[o] = hx + _s.x; P[o + 1] = hy + _s.y; P[o + 2] = hz + _s.z
      P[o + 3] = hx - _s.x; P[o + 4] = hy - _s.y; P[o + 5] = hz - _s.z
      P[o + 6] = tx + _s.x; P[o + 7] = ty + _s.y; P[o + 8] = tz + _s.z
      P[o + 9] = tx - _s.x; P[o + 10] = ty - _s.y; P[o + 11] = tz - _s.z
      // fade out near the camera and toward the box edge
      const a = vis * 0.4 * THREE.MathUtils.smoothstep(dist, 5, 14) * (1 - THREE.MathUtils.smoothstep(dist, B * 0.6, B))
      A[i * 4] = a; A[i * 4 + 1] = a; A[i * 4 + 2] = 0; A[i * 4 + 3] = 0
    }
    this.pos.needsUpdate = true
    this.alp.needsUpdate = true
  }
}

// ------------------------------------------------------------ puffs
const puffVert = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iCol; // rgb, alpha
attribute float iSize;
varying vec2 vUv;
varying vec4 vCol;
void main(){
  vUv = uv;
  vCol = iCol;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = iPos + (right * position.x + up * position.y) * iSize;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`
const puffFrag = /* glsl */ `
varying vec2 vUv;
varying vec4 vCol;
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;
  // a round, cartoon-shaded blob: lighter toward the top
  float a = smoothstep(1.0, 0.82, d) * vCol.a;
  vec3 c = vCol.rgb * (0.82 + 0.25 * smoothstep(-0.9, 0.7, p.y - p.x * 0.3));
  gl_FragColor = vec4(c * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

class Puffs {
  constructor(scene, n = 900) {
    this.n = n
    this.list = []
    const quad = new THREE.PlaneGeometry(1, 1)
    const geo = new THREE.InstancedBufferGeometry()
    geo.index = quad.index
    geo.attributes.position = quad.attributes.position
    geo.attributes.uv = quad.attributes.uv
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3)
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4)
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(n), 1)
    for (const a of [this.aPos, this.aCol, this.aSize]) a.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('iPos', this.aPos)
    geo.setAttribute('iCol', this.aCol)
    geo.setAttribute('iSize', this.aSize)
    geo.instanceCount = 0
    this.geo = geo
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: puffVert, fragmentShader: puffFrag, transparent: true, depthWrite: false, premultipliedAlpha: true,
    }))
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 22
    scene.add(this.mesh)
  }

  spawn(pos, { vel = null, size = 3, grow = 4, life = 1, color = '#ffffff', alpha = 1, drag = 1.5 } = {}) {
    if (this.list.length >= this.n) this.list.shift()
    this.list.push({ p: pos.clone(), v: vel ? vel.clone() : new THREE.Vector3(), size, grow, life, t: 0, c: new THREE.Color(color), alpha, drag })
  }

  shift(dx, dz) { for (const q of this.list) { q.p.x -= dx; q.p.z -= dz } }
  clear() { this.list.length = 0 }

  update(dt) {
    const L = this.list
    for (let i = L.length - 1; i >= 0; i--) {
      const q = L[i]
      q.t += dt
      if (q.t >= q.life) { L.splice(i, 1); continue }
      q.p.addScaledVector(q.v, dt)
      q.v.multiplyScalar(Math.exp(-q.drag * dt))
    }
    const P = this.aPos.array, C = this.aCol.array, S = this.aSize.array
    for (let i = 0; i < L.length; i++) {
      const q = L[i], k = q.t / q.life
      P[i * 3] = q.p.x; P[i * 3 + 1] = q.p.y; P[i * 3 + 2] = q.p.z
      C[i * 4] = q.c.r; C[i * 4 + 1] = q.c.g; C[i * 4 + 2] = q.c.b
      C[i * 4 + 3] = q.alpha * (1 - k * k) * Math.min(1, q.t * 12)
      S[i] = q.size + q.grow * (1 - (1 - k) * (1 - k))
    }
    this.geo.instanceCount = L.length
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true
  }
}

// ------------------------------------------------------------ shock rings
class Rings {
  constructor(scene, n = 8) {
    this.pool = []
    const geo = new THREE.RingGeometry(0.86, 1, 64)
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }))
      m.visible = false
      m.renderOrder = 24
      m.frustumCulled = false
      scene.add(m)
      this.pool.push({ m, t: 0, life: 0, size: 1, grow: 1, alpha: 1 })
    }
    this.next = 0
  }

  spawn(pos, normal, { size = 2, grow = 40, life = 0.8, color = '#ffffff', alpha = 0.9 } = {}) {
    const r = this.pool[this.next++ % this.pool.length]
    r.m.position.copy(pos)
    r.m.quaternion.copy(_q.setFromUnitVectors(Z, normal))
    r.m.material.color.set(color)
    Object.assign(r, { t: 0, life, size, grow, alpha })
    r.m.visible = true
  }

  shift(dx, dz) { for (const r of this.pool) { r.m.position.x -= dx; r.m.position.z -= dz } }

  update(dt) {
    for (const r of this.pool) {
      if (!r.m.visible) continue
      r.t += dt
      const k = r.t / r.life
      if (k >= 1) { r.m.visible = false; continue }
      r.m.scale.setScalar(r.size + r.grow * (1 - (1 - k) ** 3))
      r.m.material.opacity = r.alpha * (1 - k) ** 2
    }
  }
}

export class Effects {
  constructor(scene) {
    this.streaks = new Streaks(scene)
    this.puffs = new Puffs(scene)
    this.rings = new Rings(scene)
  }

  shift(dx, dz) { this.puffs.shift(dx, dz); this.rings.shift(dx, dz) }
  clear() { this.puffs.clear() }

  // a ring of puffs around a point on a surface, thrown outward along it
  splash(pos, normal, { n = 10, speed = 30, size = 3, grow = 7, life = 1.1, color = '#ffffff', alpha = 0.95, lift = 0.4, radius = 0 } = {}) {
    const t1 = _v.set(1, 0, 0)
    if (Math.abs(normal.x) > 0.9) t1.set(0, 0, 1)
    const a = new THREE.Vector3().crossVectors(normal, t1).normalize()
    const b = new THREE.Vector3().crossVectors(normal, a)
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2 + Math.random() * 0.5
      const vel = new THREE.Vector3().addScaledVector(a, Math.cos(th)).addScaledVector(b, Math.sin(th))
        .addScaledVector(normal, lift * (0.5 + Math.random())).multiplyScalar(speed * (0.6 + Math.random() * 0.6))
      const p = pos.clone().addScaledVector(normal, size * 0.4)
      if (radius) p.addScaledVector(a, Math.cos(th) * radius).addScaledVector(b, Math.sin(th) * radius)
      this.puffs.spawn(p, { vel, size: size * (0.7 + Math.random() * 0.6), grow, life: life * (0.8 + Math.random() * 0.4), color, alpha, drag: 2.5 })
    }
  }

  update(dt, camera, flight) {
    this.streaks.update(dt, camera, flight.vel, flight.speed)
    this.puffs.update(dt)
    this.rings.update(dt)
  }
}
