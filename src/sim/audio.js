// Small procedural soundscape: engine hum and wind, plus the cartoon noises
// (boing, splat, sonic boom, the falling whistle) the physics sets off.
export class SkyAudio {
  constructor() { this.ctx = null; this.on = false }

  init() {
    const C = new (window.AudioContext || window.webkitAudioContext)()
    this.ctx = C
    this.master = C.createGain(); this.master.gain.value = 0
    this.master.connect(C.destination)
    // engine: two detuned saws through a lowpass
    this.osc1 = C.createOscillator(); this.osc1.type = 'sawtooth'
    this.osc2 = C.createOscillator(); this.osc2.type = 'triangle'
    this.engineLP = C.createBiquadFilter(); this.engineLP.type = 'lowpass'; this.engineLP.frequency.value = 320; this.engineLP.Q.value = 0.8
    this.engineGain = C.createGain(); this.engineGain.gain.value = 0.05
    this.osc1.connect(this.engineLP); this.osc2.connect(this.engineLP)
    this.engineLP.connect(this.engineGain); this.engineGain.connect(this.master)
    this.osc1.start(); this.osc2.start()
    // noise, shared by the wind and the one-shots
    const len = C.sampleRate * 2
    const buf = C.createBuffer(1, len, C.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = last * 3.5 }
    this.noiseBuf = buf
    const white = C.createBuffer(1, len, C.sampleRate)
    const wd = white.getChannelData(0)
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1
    this.whiteBuf = white
    this.noise = C.createBufferSource(); this.noise.buffer = buf; this.noise.loop = true
    this.windBP = C.createBiquadFilter(); this.windBP.type = 'bandpass'; this.windBP.frequency.value = 500; this.windBP.Q.value = 0.5
    this.windGain = C.createGain(); this.windGain.gain.value = 0.0
    this.noise.connect(this.windBP); this.windBP.connect(this.windGain); this.windGain.connect(this.master)
    this.noise.start()
    // the falling whistle
    this.whistle = C.createOscillator(); this.whistle.type = 'sine'; this.whistle.frequency.value = 1600
    this.whistleGain = C.createGain(); this.whistleGain.gain.value = 0
    this.whistle.connect(this.whistleGain); this.whistleGain.connect(this.master)
    this.whistle.start()
    this.fallT = 0
  }

  toggle() {
    if (!this.ctx) this.init()
    this.on = !this.on
    if (this.ctx.state === 'suspended') this.ctx.resume()
    const t = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(t)
    this.master.gain.setTargetAtTime(this.on ? 0.8 : 0, t, 0.4)
  }

  // s: { speed, push, spool, engine, falling, inside, dt }
  update(s) {
    if (!this.ctx || !this.on) return
    const t = this.ctx.currentTime
    const decades = Math.log10(1 + s.speed / 60)
    const effort = Math.min(1, Math.abs(s.push) / 60)
    const f = (52 + effort * 45 + decades * 38) * (0.4 + 0.6 * s.spool)
    this.osc1.frequency.setTargetAtTime(f, t, 0.12)
    this.osc2.frequency.setTargetAtTime(f * 1.503, t, 0.12)
    this.engineLP.frequency.setTargetAtTime(240 + effort * 300 + decades * 160, t, 0.2)
    this.engineGain.gain.setTargetAtTime(s.engine ? (0.04 + effort * 0.03) * (0.3 + 0.7 * s.spool) : 0, t, s.engine ? 0.3 : 0.08)
    const w = Math.min(0.75, decades * 0.25) + s.inside * 0.4
    this.windGain.gain.setTargetAtTime(w, t, 0.25)
    this.windBP.frequency.setTargetAtTime(380 + Math.min(1600, decades * 400) - s.inside * 200, t, 0.3)
    // the classic: a falling thing whistles, lower and lower
    this.fallT = s.falling ? this.fallT + s.dt : 0
    const wf = 1700 * Math.pow(0.5, this.fallT / 2.2) + 260
    this.whistle.frequency.setTargetAtTime(wf, t, 0.05)
    this.whistleGain.gain.setTargetAtTime(s.falling ? 0.05 * Math.min(1, this.fallT * 2) : 0, t, s.falling ? 0.2 : 0.06)
  }

  // ---- one-shots
  ready() { return this.ctx && this.on }

  tone(type, f0, f1, dur, gain, { t = 0, vibrato = 0 } = {}) {
    const C = this.ctx, t0 = C.currentTime + t
    const o = C.createOscillator(); o.type = type
    o.frequency.setValueAtTime(f0, t0)
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur)
    const g = C.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(g); g.connect(this.master)
    if (vibrato) {
      const lfo = C.createOscillator(); lfo.frequency.value = 18
      const lg = C.createGain(); lg.gain.value = vibrato
      lfo.connect(lg); lg.connect(o.frequency); lfo.start(t0); lfo.stop(t0 + dur + 0.02)
    }
    o.start(t0); o.stop(t0 + dur + 0.02)
  }

  burst(dur, gain, { type = 'lowpass', f0 = 800, f1 = 200, q = 0.7, t = 0, white = false } = {}) {
    const C = this.ctx, t0 = C.currentTime + t
    const src = C.createBufferSource(); src.buffer = white ? this.whiteBuf : this.noiseBuf
    const flt = C.createBiquadFilter(); flt.type = type; flt.Q.value = q
    flt.frequency.setValueAtTime(f0, t0)
    flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur)
    const g = C.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(flt); flt.connect(g); g.connect(this.master)
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.02)
  }

  pop() {
    if (!this.ready()) return
    this.tone('sine', 700 + Math.random() * 500, 1600, 0.12, 0.12)
  }

  boing(strength = 0.5) {
    if (!this.ready()) return
    const k = Math.min(1, strength)
    this.tone('sine', 150 + 60 * k, 420 + 200 * k, 0.45 + 0.3 * k, 0.16 + 0.12 * k, { vibrato: 40 + 60 * k })
    this.burst(0.12, 0.25 * k, { f0: 400, f1: 80 })
  }

  splat() {
    if (!this.ready()) return
    this.burst(0.5, 0.7, { f0: 1600, f1: 90, q: 1.2 })
    this.tone('sine', 120, 40, 0.4, 0.35)
  }

  boom() {
    if (!this.ready()) return
    this.burst(1.6, 0.9, { f0: 500, f1: 40, q: 0.5 })
    this.tone('sine', 70, 28, 1.0, 0.4)
  }

  bonk() {
    if (!this.ready()) return
    this.tone('square', 1250, 1150, 0.07, 0.08)
    this.tone('sine', 880, 870, 0.9, 0.12, { t: 0.02 })
    this.tone('sine', 1320, 1310, 0.7, 0.06, { t: 0.02 })
  }

  poof() {
    if (!this.ready()) return
    this.burst(0.35, 0.35, { type: 'bandpass', f0: 1200, f1: 300, q: 0.8, white: true })
  }

  sputter() {
    if (!this.ready()) return
    for (let i = 0; i < 4; i++) this.burst(0.09, 0.4 - i * 0.07, { f0: 900, f1: 150, q: 2, t: i * 0.16 + Math.random() * 0.05 })
    this.tone('sawtooth', 90, 30, 0.7, 0.06)
  }

  cough() {
    if (!this.ready()) return
    this.burst(0.1, 0.4, { f0: 700, f1: 150, q: 2 })
    this.burst(0.1, 0.4, { f0: 800, f1: 160, q: 2, t: 0.22 })
    this.tone('sawtooth', 40, 140, 0.5, 0.07, { t: 0.4 })
  }

  gulp() {
    if (!this.ready()) return
    this.tone('sine', 300, 180, 0.12, 0.12)
    this.tone('sine', 240, 140, 0.14, 0.1, { t: 0.13 })
  }

  dispose() { if (this.ctx) this.ctx.close() }
}
