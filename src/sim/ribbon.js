import * as THREE from 'three'

const vert = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
varying float vFogDepth;
void main(){
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`
const frag = /* glsl */ `
uniform vec3 uColor, uFogColor;
uniform float uFogDensity, uOpacity;
varying float vAlpha;
varying float vFogDepth;
void main(){
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  vec3 c = mix(uColor, uFogColor, fogF);
  gl_FragColor = vec4(c, vAlpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

// A trailing ribbon of N samples. Each sample stores centre, side vector and alpha.
export class Ribbon {
  constructor(n, width, color, opacity, fogUniforms, additive = false) {
    this.n = n
    this.width = width
    this.centers = new Float32Array(n * 3)
    this.sides = new Float32Array(n * 3)
    this.alphas = new Float32Array(n)
    this.filled = 0
    const geo = new THREE.BufferGeometry()
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3)
    this.alp = new THREE.BufferAttribute(new Float32Array(n * 2), 1)
    this.pos.setUsage(THREE.DynamicDrawUsage)
    this.alp.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('position', this.pos)
    geo.setAttribute('aAlpha', this.alp)
    const idx = []
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3
      idx.push(a, b, c, b, d, c)
    }
    geo.setIndex(idx)
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
        uFogColor: fogUniforms.color,
        uFogDensity: fogUniforms.density,
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }))
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 20
    this.last = new THREE.Vector3(1e9, 1e9, 1e9)
  }

  clear() { this.filled = 0; this.alphas.fill(0); this.alp.array.fill(0); this.alp.needsUpdate = true }

  shift(dx, dz) {
    for (let i = 0; i < this.n; i++) { this.centers[i * 3] -= dx; this.centers[i * 3 + 2] -= dz }
    this.last.x -= dx; this.last.z -= dz
  }

  // push a new sample at the head (index 0) and rebuild
  push(center, side, alpha, minSpacing = 0.25) {
    const n = this.n
    if (this.filled > 0 && center.distanceToSquared(this.last) > 40 * 40) this.clear() // teleported
    if (center.distanceToSquared(this.last) < minSpacing * minSpacing && this.filled > 0) {
      // update the head only
      this.centers[0] = center.x; this.centers[1] = center.y; this.centers[2] = center.z
      this.sides[0] = side.x; this.sides[1] = side.y; this.sides[2] = side.z
      this.alphas[0] = Math.max(this.alphas[0], alpha)
    } else {
      this.centers.copyWithin(3, 0, (n - 1) * 3)
      this.sides.copyWithin(3, 0, (n - 1) * 3)
      this.alphas.copyWithin(1, 0, n - 1)
      this.centers[0] = center.x; this.centers[1] = center.y; this.centers[2] = center.z
      this.sides[0] = side.x; this.sides[1] = side.y; this.sides[2] = side.z
      this.alphas[0] = alpha
      this.last.copy(center)
      this.filled = Math.min(n, this.filled + 1)
    }
  }

  // set every sample directly (used for the scarf, which lives in the plane's frame)
  setSamples(fn) {
    for (let i = 0; i < this.n; i++) {
      const { c, s, a } = fn(i)
      this.centers[i * 3] = c.x; this.centers[i * 3 + 1] = c.y; this.centers[i * 3 + 2] = c.z
      this.sides[i * 3] = s.x; this.sides[i * 3 + 1] = s.y; this.sides[i * 3 + 2] = s.z
      this.alphas[i] = a
    }
    this.filled = this.n
  }

  rebuild(t = 0, flutter = 0) {
    const n = this.n, P = this.pos.array, A = this.alp.array
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1)
      const w = this.width * (1 - u) * (i < this.filled ? 1 : 0)
      const fl = flutter ? Math.sin(t * 14 - i * 0.9) * flutter * u : 0
      const cx = this.centers[i * 3], cy = this.centers[i * 3 + 1], cz = this.centers[i * 3 + 2]
      const sx = this.sides[i * 3] * w, sy = this.sides[i * 3 + 1] * w + fl, sz = this.sides[i * 3 + 2] * w
      P[i * 6] = cx + sx; P[i * 6 + 1] = cy + sy; P[i * 6 + 2] = cz + sz
      P[i * 6 + 3] = cx - sx; P[i * 6 + 4] = cy - sy + fl * 0.5; P[i * 6 + 5] = cz - sz
      const a = this.alphas[i] * (1 - u) * (i < this.filled ? 1 : 0)
      A[i * 2] = a; A[i * 2 + 1] = a
    }
    this.pos.needsUpdate = true
    this.alp.needsUpdate = true
  }
}
