import * as THREE from 'three'

export const CLOUD_Y = 0            // altitude of the cloud sea
export const GROUND_Y = -3600       // base altitude of the land below (about a 30 s dive)
export const CEILING_Y = 4800       // soft ceiling
export const SPAWN_POS = new THREE.Vector3(0, 170, 0)
export const SPAWN_HEADING = 0.35   // radians, yaw

export const SUN_DIR = new THREE.Vector3(0.42, 0.58, -0.7).normalize()
export const MOON_DIR = new THREE.Vector3(-0.62, 0.2, -0.75).normalize()

export const FORWARD = new THREE.Vector3(0, 0, -1)
export const UP = new THREE.Vector3(0, 1, 0)
export const RIGHT = new THREE.Vector3(1, 0, 0)

export const ORIGIN_SHIFT = 6000

export const V = () => new THREE.Vector3()
