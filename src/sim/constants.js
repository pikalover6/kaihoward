import * as THREE from 'three'

export const LID_Y = 6000           // the sky's lid: solid, and bouncy
export const SPAWN_POS = new THREE.Vector3(0, 170, 0)
export const SPAWN_HEADING = 0.35   // radians, yaw

export const FORWARD = new THREE.Vector3(0, 0, -1)
export const UP = new THREE.Vector3(0, 1, 0)
export const RIGHT = new THREE.Vector3(1, 0, 0)

export const ORIGIN_SHIFT = 6000

export const V = () => new THREE.Vector3()

// d wrapped into [-R, R] (modulo, so it copes with things a zillion units away)
export const wrapR = (d, R) => (Math.abs(d) <= R ? d : ((((d + R) % (2 * R)) + 2 * R) % (2 * R)) - R)
