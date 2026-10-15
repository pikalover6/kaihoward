import * as THREE from 'three'

// Notices the silly things you did and shouts about them. Nothing here changes the flying;
// it only watches.
const _f = new THREE.Vector3(), _n = new THREE.Vector3()

export class Tricks {
  constructor(pop) {
    this.pop = pop
    this.reset()
  }

  reset() {
    this.pitchAcc = 0; this.rollAcc = 0; this.quietPitch = 0; this.quietRoll = 0
    this.slipHist = []; this.backT = 0; this.backDone = false
    this.invT = 0; this.invDone = false
    this.skimT = 0; this.cool = {}
    this.napT = 0; this.napDone = false
  }

  ready(key, t, wait) {
    if ((this.cool[key] || -1e9) > t) return false
    this.cool[key] = t + wait
    return true
  }

  update(dt, t, fl, world) {
    if (fl.daze > 0 || fl.splat) { this.pitchAcc = this.rollAcc = 0; return }
    const sp = fl.speed

    // loops: a full turn of pitch without letting go for long
    if (Math.abs(fl.pitchRate) > 0.7) { this.pitchAcc += fl.pitchRate * dt; this.quietPitch = 0 }
    else if ((this.quietPitch += dt) > 0.8) this.pitchAcc = 0
    if (Math.abs(this.pitchAcc) > Math.PI * 2 - 0.35) { this.pop(this.pitchAcc > 0 ? 'loop-de-loop!' : 'outside loop!', 'trick'); this.pitchAcc = 0 }

    // rolls done by hand (a barrel roll announces itself)
    if (Math.abs(fl.rollRate) > 1.2 && !fl.barrel) { this.rollAcc += fl.rollRate * dt; this.quietRoll = 0 }
    else if ((this.quietRoll += dt) > 0.6) this.rollAcc = 0
    if (Math.abs(this.rollAcc) > Math.PI * 2 - 0.3) { this.pop('aileron roll!', 'trick'); this.rollAcc = 0 }

    // turning round without turning your path round
    const slip = sp > 5 ? Math.acos(THREE.MathUtils.clamp(fl.forward(_f).dot(_n.copy(fl.vel).divideScalar(sp)), -1, 1)) : 0
    this.slipHist.push([t, slip])
    while (this.slipHist.length && this.slipHist[0][0] < t - 2.5) this.slipHist.shift()
    if (sp > 120 && slip > 2.6 && this.slipHist.some(([, s]) => s < 0.5) && this.ready('180', t, 3)) this.pop('one-eighty!', 'trick')
    if (sp > 40 && slip > 2.6) {
      this.backT += dt
      if (this.backT > 2.5 && !this.backDone) { this.pop('flying backwards!', 'trick'); this.backDone = true }
    } else { this.backT = 0; this.backDone = false }

    // upside down
    if (fl.up(_f).y < -0.8 && fl.airborne && sp > 20) {
      this.invT += dt
      if (this.invT > 2.5 && !this.invDone) { this.pop('upside down!', 'trick'); this.invDone = true }
    } else if (fl.up(_f).y > 0.3) { this.invT = 0; this.invDone = false }

    // skimming the ground or the water
    const g = world.ground(fl.pos.x, fl.pos.z)
    const surface = Math.max(g, world.waterY)
    const agl = fl.pos.y - surface
    if (agl < 7 && agl > 0 && sp > 60 && fl.airborne) {
      this.skimT += dt
      if (this.skimT > 0.8 && this.ready('skim', t, 6)) this.pop(g < world.waterY ? 'wave skimmer!' : 'grass cutter!', 'trick')
    } else this.skimT = 0

    // close shaves: something solid went by within a few metres and you didn't touch it
    if (sp > 80 && fl.airborne) {
      let best = Infinity
      for (const s of fl.near) if (s.mat.solid) best = Math.min(best, s.sdf(fl.pos, _n))
      if (best > 2.5 && best < 7 && this.ready('shave', t, 4)) this.pop('close shave!', 'trick')
    }

    // napping on a cloud
    if (fl.touching === 'cloud' && sp < 3) {
      this.napT += dt
      if (this.napT > 2 && !this.napDone) { this.pop('nap time', 'small'); this.napDone = true }
    } else if (fl.touching !== 'cloud') { this.napT = 0; this.napDone = false }
  }
}
