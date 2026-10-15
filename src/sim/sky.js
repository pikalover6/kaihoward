import * as THREE from 'three'
import { GLSL_NOISE } from './noise.js'
import { SUN_DIR } from './n64.js'
import { LID_Y } from './constants.js'

// A painted N64 sky: a hard gradient, a band of chunky clouds round the horizon, a sun in
// sunglasses, and stars once you're up near the lid. Plus plaid, for emergencies.

const vert = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`
const frag = /* glsl */ `
uniform vec3 uSunDir, uZenith, uHorizon, uBelow;
uniform float uTime, uSpace, uPlaid;
uniform vec4 uRipple;
varying vec3 vDir;
${GLSL_NOISE}

vec3 sett(float x){
  x = fract(x);
  vec3 c = vec3(0.75, 0.12, 0.14);
  c = mix(c, vec3(0.1, 0.42, 0.22), step(0.10, x) * step(x, 0.40));
  c = mix(c, vec3(0.1, 0.14, 0.5), step(0.55, x) * step(x, 0.74));
  c = mix(c, vec3(1.0, 0.86, 0.35), step(0.465, x) * step(x, 0.49));
  c = mix(c, vec3(0.95), step(0.86, x) * step(x, 0.875));
  return c;
}

void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 zen = mix(uZenith, vec3(0.02, 0.03, 0.12), uSpace);
  vec3 hor = mix(uHorizon, vec3(0.25, 0.32, 0.6), uSpace * 0.8);
  vec3 col = mix(hor, zen, pow(clamp(y, 0.0, 1.0), 0.55));
  col = mix(col, uBelow, smoothstep(0.0, -0.25, y));

  // the cloud band: two tones, hard edges, drifting
  float az = atan(d.z, d.x);
  float band = smoothstep(-0.02, 0.06, y) * (1.0 - smoothstep(0.1, 0.3, y));
  float n = fbm3(vec2(az * 3.0 + uTime * 0.004, y * 9.0)) + fbm3(vec2(az * 7.0 - uTime * 0.006, y * 18.0)) * 0.4;
  float cloud = step(0.12 + y * 2.2, n) * band;
  float shade = step(0.3 + y * 2.2, n + 0.08);
  vec3 cc = mix(vec3(0.82, 0.88, 1.0), vec3(1.0), shade);
  col = mix(col, mix(cc, hor, uSpace * 0.7), cloud * (1.0 - uSpace * 0.5));

  // stars, up near the lid
  vec2 g = vec2(az * 40.0, asin(clamp(y, -1.0, 1.0)) * 40.0);
  float h = hash12(floor(g));
  float star = step(0.985, h) * step(0.08, y) * uSpace;
  col = mix(col, vec3(1.0, 1.0, 0.85), star * (0.6 + 0.4 * sin(uTime * 3.0 + h * 50.0)));

  // the sun, in sunglasses
  vec3 sd = normalize(uSunDir);
  vec3 st = normalize(cross(sd, vec3(0.0, 1.0, 0.0)));
  vec3 sb = cross(st, sd);
  float sdot = dot(d, sd);
  if (sdot > 0.0) {
    vec2 sp = vec2(dot(d, st), dot(d, sb)) / 0.075;
    float r = length(sp);
    col = mix(col, vec3(1.0, 0.97, 0.75), step(r, 1.0) * 0.98);
    col += vec3(1.0, 0.9, 0.6) * (1.0 - smoothstep(1.0, 2.6, r)) * 0.25 * step(1.0, r);
    // the shades: two round lenses and a bridge
    float lens = min(length((sp - vec2(-0.36, 0.12)) * vec2(1.0, 1.35)), length((sp - vec2(0.36, 0.12)) * vec2(1.0, 1.35)));
    float bridge = step(abs(sp.x), 0.12) * step(abs(sp.y - 0.2), 0.05);
    float glasses = max(step(lens, 0.3), bridge) * step(r, 1.0);
    col = mix(col, vec3(0.08, 0.08, 0.14), glasses);
    col = mix(col, vec3(0.6, 0.65, 0.9), step(lens, 0.3) * step(0.18, length(sp - vec2(-0.42, 0.2))) * step(length(sp - vec2(-0.42, 0.2)), 0.24) * step(r, 1.0));
    // and a grin
    float smile = step(abs(length(sp - vec2(0.0, 0.05)) - 0.5), 0.05) * step(sp.y, -0.15) * step(abs(sp.x), 0.42);
    col = mix(col, vec3(0.75, 0.35, 0.1), smile);
  }

  // the lid, bonked
  float rt = uTime - uRipple.w;
  if (rt > 0.0 && rt < 3.5) {
    float ang = acos(clamp(dot(d, uRipple.xyz), -1.0, 1.0));
    float ring = 0.0;
    for (int k = 0; k < 4; k++) { float r0 = rt * 1.25 - float(k) * 0.2; ring += step(abs(ang - r0), 0.025) * step(0.0, r0); }
    col = mix(col, vec3(1.0), ring * 0.8 * (1.0 - rt / 3.5));
  }

  if (uPlaid > 0.0) {
    vec2 pp = vec2(az * 2.0, asin(clamp(y, -1.0, 1.0)) * 4.0);
    col = mix(col, (sett(pp.x) + sett(pp.y)) * 0.5, uPlaid * 0.9);
  }
  gl_FragColor = vec4(col, 1.0);
}
`

const ZENITH = new THREE.Color('#2f6fe6'), HORIZON = new THREE.Color('#a8dcff'), BELOW = new THREE.Color('#7fb4e6')
const _c = new THREE.Color()

// the colour the far distance fades to at a given altitude (and what the fog uses)
export function hazeFor(alt) {
  const space = THREE.MathUtils.smoothstep(alt, 2500, LID_Y)
  return _c.copy(HORIZON).lerp(new THREE.Color(0.25, 0.32, 0.6), space * 0.8)
}

export class Sky {
  constructor() {
    this.uniforms = {
      uSunDir: { value: SUN_DIR.clone() },
      uZenith: { value: ZENITH.clone() },
      uHorizon: { value: HORIZON.clone() },
      uBelow: { value: BELOW.clone() },
      uTime: { value: 0 },
      uSpace: { value: 0 },
      uPlaid: { value: 0 },
      uRipple: { value: new THREE.Vector4(0, 1, 0, -100) },
    }
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    })
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.material)
    this.mesh.renderOrder = -100
    this.mesh.frustumCulled = false
  }

  update(t, camera) {
    this.uniforms.uTime.value = t
    this.uniforms.uSpace.value = THREE.MathUtils.smoothstep(camera.position.y, 2500, LID_Y)
    this.mesh.position.copy(camera.position)
  }
}
