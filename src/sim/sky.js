import * as THREE from 'three'
import { GLSL_NOISE } from './noise.js'
import { SUN_DIR } from './n64.js'
import { LID_Y } from './constants.js'

// A painted sky, Frutiger Aero by way of a 64-bit cartridge: a deep glossy blue, a band of
// chunky clouds round the horizon, a radiant sun, and two ribbons of light swooshing across
// it like a 2007 desktop. Stars once you're up near the lid. Plus plaid, for emergencies.

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
  vec3 col = mix(hor, zen, pow(clamp(y, 0.0, 1.0), 0.5));
  col = mix(col, uBelow, smoothstep(0.0, -0.25, y));
  float az = atan(d.z, d.x);

  // the swooshes: two glowing ribbons, slowly undulating
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float centre = 0.3 + 0.12 * fk + 0.08 * sin(az * (2.0 + fk) + uTime * (0.05 + 0.03 * fk) + fk * 2.0) + 0.03 * sin(az * 5.0 - uTime * 0.04);
    float width = 0.016 + 0.01 * sin(az * 3.0 + fk + uTime * 0.03);
    float band = exp(-pow((y - centre) / width, 2.0));
    float fade = smoothstep(-0.3, 0.8, sin(az + fk * 2.6 + uTime * 0.02));
    vec3 rc = mix(vec3(0.55, 1.0, 0.72), vec3(0.62, 0.92, 1.0), fk);
    float k2 = (1.0 - uSpace * 0.4) * (1.0 - uPlaid);
    col += rc * band * fade * 0.42 * k2;
    col += rc * exp(-pow((y - centre) / (width * 6.0), 2.0)) * fade * 0.07 * k2;
  }

  // the cloud band: two tones, hard edges, drifting
  float band = smoothstep(-0.02, 0.06, y) * (1.0 - smoothstep(0.1, 0.3, y));
  float n = fbm3(vec2(az * 3.0 + uTime * 0.004, y * 9.0)) + fbm3(vec2(az * 7.0 - uTime * 0.006, y * 18.0)) * 0.4;
  float cloud = step(0.12 + y * 2.2, n) * band;
  float shade = step(0.3 + y * 2.2, n + 0.08);
  vec3 cc = mix(vec3(0.84, 0.93, 1.0), vec3(1.0), shade);
  col = mix(col, mix(cc, hor, uSpace * 0.7), cloud * (1.0 - uSpace * 0.5));

  // stars, up near the lid
  vec2 g = vec2(az * 40.0, asin(clamp(y, -1.0, 1.0)) * 40.0);
  float h = hash12(floor(g));
  float star = step(0.985, h) * step(0.08, y) * uSpace;
  col = mix(col, vec3(1.0, 1.0, 0.85), star * (0.6 + 0.4 * sin(uTime * 3.0 + h * 50.0)));

  // the sun: a white-hot disc, a glow, and slowly turning rays
  vec3 sd = normalize(uSunDir);
  float sdot = dot(d, sd);
  float ang = acos(clamp(sdot, -1.0, 1.0));
  vec3 st = normalize(cross(sd, vec3(0.0, 1.0, 0.0)));
  vec3 sb = cross(st, sd);
  float ra = atan(dot(d, sb), dot(d, st));
  float rays = pow(0.5 + 0.5 * sin(ra * 11.0 + uTime * 0.12), 8.0) * exp(-ang * 3.5) * step(0.0, sdot);
  col += vec3(1.0, 0.99, 0.9) * rays * 0.22;
  col += vec3(1.0, 0.96, 0.82) * exp(-ang * 8.0) * 0.5;
  col = mix(col, vec3(1.0, 1.0, 0.96), smoothstep(0.075, 0.06, ang));

  // the lid, bonked
  float rt = uTime - uRipple.w;
  if (rt > 0.0 && rt < 3.5) {
    float ra2 = acos(clamp(dot(d, uRipple.xyz), -1.0, 1.0));
    float ring = 0.0;
    for (int k = 0; k < 4; k++) { float r0 = rt * 1.25 - float(k) * 0.2; ring += step(abs(ra2 - r0), 0.025) * step(0.0, r0); }
    col = mix(col, vec3(1.0), ring * 0.8 * (1.0 - rt / 3.5));
  }

  if (uPlaid > 0.0) {
    vec2 pp = vec2(az * 2.0, asin(clamp(y, -1.0, 1.0)) * 4.0);
    col = mix(col, (sett(pp.x) + sett(pp.y)) * 0.5, uPlaid * 0.9);
  }
  gl_FragColor = vec4(col, 1.0);
}
`

const ZENITH = new THREE.Color('#1670e0'), HORIZON = new THREE.Color('#bdeeff'), BELOW = new THREE.Color('#8ccbef')
const SPACE_HAZE = new THREE.Color(0.25, 0.32, 0.6)
const _c = new THREE.Color()

// the colour the far distance fades to at a given altitude (and what the fog uses)
export function hazeFor(alt) {
  const space = THREE.MathUtils.smoothstep(alt, 2500, LID_Y)
  return _c.copy(HORIZON).lerp(SPACE_HAZE, space * 0.8)
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
