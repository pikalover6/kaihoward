import * as THREE from 'three'
import { GLSL_NOISE, GLSL_SRGB } from './noise.js'
import { SUN_DIR, MOON_DIR, CLOUD_Y } from './constants.js'

const vert = /* glsl */ `
varying vec3 vDir;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const frag = /* glsl */ `
precision highp float;
uniform vec3 uSunDir, uMoonDir, uFogColor;
uniform float uTime, uAlt, uBelow, uEnv, uCeil, uFogDensity;
uniform vec4 uShoot[3];
uniform vec3 uShootTan[3];
varying vec3 vDir;
${GLSL_NOISE}
${GLSL_SRGB}

void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float hi = smoothstep(200.0, 4200.0, uAlt);

  vec3 zenith = mix(S(0.10, 0.22, 0.66), S(0.02, 0.05, 0.28), hi);
  vec3 upper  = mix(S(0.16, 0.42, 0.90), S(0.06, 0.16, 0.60), hi);
  vec3 mid    = S(0.36, 0.72, 0.98);
  vec3 horizon = uFogColor;

  vec3 col = mix(horizon, mid, smoothstep(-0.01, 0.10, y));
  col = mix(col, upper, smoothstep(0.10, 0.36, y));
  col = mix(col, zenith, smoothstep(0.36, 0.85, y));

  // soft diagonal light rays / aurora, like the wallpaper streaks
  vec3 a1 = normalize(vec3(0.8, 0.25, 0.55));
  vec3 a2 = normalize(vec3(-0.3, 0.2, 0.93));
  float u1 = dot(d, a1) * 9.0 + uTime * 0.015;
  float u2 = dot(d, a2) * 7.0 - uTime * 0.011;
  float n1 = fbm3(vec2(u1 * 0.7, dot(d, a2) * 3.0 + uTime * 0.02));
  float ray1 = pow(0.5 + 0.5 * sin(u1 * 3.0 + n1 * 2.5), 7.0);
  float ray2 = pow(0.5 + 0.5 * sin(u2 * 4.0 + n1 * 1.5), 9.0);
  float rayMask = smoothstep(0.12, 0.5, y);
  vec3 rayCol = mix(S(0.45, 0.95, 1.0), S(0.62, 0.55, 1.0), 0.5 + 0.5 * sin(u1 * 0.5 + 1.0));
  col += rayCol * (ray1 * 0.16 + ray2 * 0.10) * rayMask * (1.0 - uBelow);

  // sun
  float sd = max(dot(d, uSunDir), 0.0);
  vec3 sunCol = S(1.0, 0.97, 0.9);
  col += sunCol * (smoothstep(0.9993, 0.9997, sd) * 3.0 + pow(sd, 60.0) * 0.55 + pow(sd, 7.0) * 0.14);
  col += S(1.0, 0.9, 0.75) * pow(sd, 2.0) * 0.05;

  // stars: sparse crosses + fine dust, in an azimuth/elevation grid
  vec2 sky = vec2(atan(d.z, d.x) * 22.0, asin(clamp(y, -1.0, 1.0)) * 40.0);
  float starMask = smoothstep(0.14, 0.5, y) * (1.0 - pow(sd, 6.0)) * (0.55 + 0.45 * hi);
  vec2 cell = floor(sky);
  vec2 f = sky - cell;
  float h = hash12(cell);
  vec2 off = hash22(cell + 7.0) * 0.6 + 0.2;
  vec2 q = f - off;
  float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
  float bright = step(0.93, h);
  float dust = bright * smoothstep(0.06, 0.0, length(q)) * tw;
  float big = step(0.985, h);
  float crossStar = big * (exp(-abs(q.x) * 30.0) * exp(-abs(q.y) * 9.0) + exp(-abs(q.y) * 30.0) * exp(-abs(q.x) * 9.0)) * 0.9 * tw;
  float glow = big * exp(-length(q) * 10.0) * 0.5;
  col += vec3(0.9, 0.95, 1.0) * (dust * 0.8 + crossStar + glow) * starMask * (1.0 - uBelow);

  // moon
  vec3 mt = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
  vec3 mb = cross(mt, uMoonDir);
  float md = dot(d, uMoonDir);
  if (md > 0.0) {
    vec2 mp = vec2(dot(d, mt), dot(d, mb)) / 0.065;
    float r = length(mp);
    float disc = 1.0 - smoothstep(0.97, 1.0, r);
    vec3 n = vec3(mp, sqrt(max(0.0, 1.0 - min(r * r, 1.0))));
    float light = clamp(dot(n, normalize(vec3(0.75, 0.35, 0.6))), 0.0, 1.0);
    float crater = fbm(mp * 3.0 + 4.0) * 0.5 + snoise(mp * 9.0) * 0.12;
    vec3 mc = S(0.9, 0.95, 1.0) * (0.55 + 0.6 * light) * (1.0 - max(crater, 0.0) * 0.3);
    float halo = exp(-max(r - 1.0, 0.0) * 2.5) * 0.55 + exp(-max(r - 1.0, 0.0) * 0.45) * 0.14;
    col = mix(col, mc, disc * 0.96);
    col += S(0.7, 0.85, 1.0) * halo * (1.0 - disc);
  }

  // shooting stars
  for (int i = 0; i < 3; i++) {
    vec3 s0 = uShoot[i].xyz;
    float p = (uTime - uShoot[i].w) / 1.1;
    if (p < 0.0 || p > 1.0) continue;
    if (dot(d, s0) < 0.85) continue;
    vec3 tg = uShootTan[i];
    vec3 bn = cross(s0, tg);
    float u = dot(d - s0, tg);
    float v = dot(d - s0, bn);
    float head = p * 0.32;
    float along = smoothstep(head - 0.11, head, u) * (1.0 - step(head, u));
    float across = exp(-v * v * 60000.0);
    float fade = sin(p * 3.14159);
    col += vec3(0.9, 0.95, 1.0) * along * across * fade * 1.6;
  }

  // under the cloud sea: hazy, and the sky fades into the fog the same way the cloud ceiling does
  vec3 dim = mix(col, uFogColor * 0.92, 0.7);
  float ceilD = uCeil / max(y, 0.02);
  float ceilFog = 1.0 - exp(-uFogDensity * uFogDensity * ceilD * ceilD);
  vec3 under = mix(dim, uFogColor, max(ceilFog, 1.0 - smoothstep(-0.02, 0.12, y)));
  under *= 1.0 - 0.14 * smoothstep(0.05, 0.6, y);
  col = mix(col, under, uBelow);

  if (any(isnan(col))) col = uFogColor;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export function fogColorFor(alt) {
  // returns sRGB THREE.Color for the fog / horizon at a given altitude
  const c = new THREE.Color()
  const above = new THREE.Color('#cfe6ff')
  const inCloud = new THREE.Color('#f4f8ff')
  const below = new THREE.Color('#93a7c2')
  const ground = new THREE.Color('#b3c4d8')
  const r = alt - CLOUD_Y
  if (r > 30) c.copy(above)
  else if (r > -110) c.copy(inCloud).lerp(above, THREE.MathUtils.smoothstep(r, -30, 30))
  else c.copy(below).lerp(inCloud, THREE.MathUtils.smoothstep(r, -300, -110))
  c.lerp(ground, THREE.MathUtils.smoothstep(-r, 1800, 3200))
  return c
}

export function fogDensityFor(alt) {
  const r = alt - CLOUD_Y
  const inside = Math.exp(-Math.pow((r + 35) / 55, 2))
  let base
  if (r > 0) base = 0.000075
  else base = THREE.MathUtils.lerp(0.00032, 0.00022, THREE.MathUtils.smoothstep(-r, 150, 1500))
  base = THREE.MathUtils.lerp(base, 0.00019, THREE.MathUtils.smoothstep(-r, 1800, 3200))
  return base + inside * 0.006
}

export class Sky {
  constructor() {
    this.uniforms = {
      uSunDir: { value: SUN_DIR.clone() },
      uMoonDir: { value: MOON_DIR.clone() },
      uFogColor: { value: fogColorFor(200) },
      uTime: { value: 0 },
      uAlt: { value: 200 },
      uBelow: { value: 0 },
      uEnv: { value: 0 },
      uCeil: { value: 0 },
      uFogDensity: { value: 0.0001 },
      uShoot: { value: [new THREE.Vector4(0, 1, 0, -100), new THREE.Vector4(0, 1, 0, -100), new THREE.Vector4(0, 1, 0, -100)] },
      uShootTan: { value: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0, 0)] },
    }
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    })
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), this.material)
    this.mesh.renderOrder = -100
    this.mesh.frustumCulled = false
    this.nextShoot = 3
    this.shootIdx = 0
  }

  update(t, camera, alt) {
    this.uniforms.uTime.value = t
    this.uniforms.uAlt.value = alt
    this.uniforms.uBelow.value = THREE.MathUtils.smoothstep(-(alt - CLOUD_Y), 60, 300)
    this.uniforms.uFogColor.value.copy(fogColorFor(alt))
    this.uniforms.uCeil.value = Math.max(0, CLOUD_Y - alt)
    this.uniforms.uFogDensity.value = fogDensityFor(alt)
    this.mesh.position.copy(camera.position)
    if (t > this.nextShoot) {
      this.nextShoot = t + 3 + Math.random() * 7
      const i = this.shootIdx++ % 3
      const az = Math.random() * Math.PI * 2
      const el = 0.4 + Math.random() * 0.9
      const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el))
      const rnd = new THREE.Vector3(Math.random() - 0.5, -0.6 - Math.random() * 0.4, Math.random() - 0.5)
      const tan = rnd.sub(dir.clone().multiplyScalar(rnd.dot(dir))).normalize()
      this.uniforms.uShoot.value[i].set(dir.x, dir.y, dir.z, t)
      this.uniforms.uShootTan.value[i].copy(tan)
    }
  }
}
