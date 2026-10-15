// Procedural sound: prop hum, the rocket, wind, the cartoon noises the physics sets off,
// and a little cheerful loop to fly to. Nothing plays until you turn sound on (M).
export class SkyAudio {
  constructor() { this.ctx = null; this.on = false }

  init() {
    const C = new (window.AudioContext || window.webkitAudioContext)()
    this.ctx = C
    this.master = C.createGain(); this.master.gain.value = 0
    this.master.connect(C.destination)
    this.sfx = C.createGain(); this.sfx.gain.value = 1; this.sfx.connect(this.master)
    this.musicBus = C.createGain(); this.musicBus.gain.value = 0.55; this.musicBus.connect(this.master)

    const len = C.sampleRate * 2
    const brown = C.createBuffer(1, len, C.sampleRate), bd = brown.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; bd[i] = last * 3.5 }
    const white = C.createBuffer(1, len, C.sampleRate), wd = white.getChannelData(0)
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1
    this.noiseBuf = brown; this.whiteBuf = white
    const loop = (buf, type, f, q) => {
      const src = C.createBufferSource(); src.buffer = buf; src.loop = true
      const flt = C.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q
      const g = C.createGain(); g.gain.value = 0
      src.connect(flt); flt.connect(g); g.connect(this.sfx); src.start()
      return { flt, g }
    }
    // prop: two detuned oscillators through a lowpass
    this.osc1 = C.createOscillator(); this.osc1.type = 'sawtooth'
    this.osc2 = C.createOscillator(); this.osc2.type = 'square'
    this.propLP = C.createBiquadFilter(); this.propLP.type = 'lowpass'; this.propLP.frequency.value = 300; this.propLP.Q.value = 1
    this.propGain = C.createGain(); this.propGain.gain.value = 0.03
    this.osc1.connect(this.propLP); this.osc2.connect(this.propLP); this.propLP.connect(this.propGain); this.propGain.connect(this.sfx)
    this.osc1.start(); this.osc2.start()
    this.rocket = loop(white, 'lowpass', 600, 0.7)
    this.wind = loop(brown, 'bandpass', 500, 0.5)
    // the falling whistle
    this.whistle = C.createOscillator(); this.whistle.type = 'sine'; this.whistle.frequency.value = 1600
    this.whistleGain = C.createGain(); this.whistleGain.gain.value = 0
    this.whistle.connect(this.whistleGain); this.whistleGain.connect(this.sfx)
    this.whistle.start()
    this.fallT = 0
    this.startMusic()
  }

  toggle() {
    if (!this.ctx) this.init()
    this.on = !this.on
    if (this.ctx.state === 'suspended') this.ctx.resume()
    const t = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(t)
    this.master.gain.setTargetAtTime(this.on ? 0.8 : 0, t, 0.3)
  }

  // s: { speed, push, held, falling, dt }
  update(s) {
    if (!this.ctx || !this.on) return
    const t = this.ctx.currentTime
    const decades = Math.log10(1 + s.speed / 60)
    const boost = s.push > 0 ? 1 : 0, brake = s.push < 0 ? 1 : 0
    const f = 60 + decades * 30 + boost * 40 + brake * 25
    this.osc1.frequency.setTargetAtTime(f, t, 0.1)
    this.osc2.frequency.setTargetAtTime(f * 1.498, t, 0.1)
    this.propLP.frequency.setTargetAtTime(260 + decades * 150 + boost * 300, t, 0.15)
    this.propGain.gain.setTargetAtTime(0.025 + boost * 0.015, t, 0.2)
    this.rocket.g.gain.setTargetAtTime(boost * (0.25 + Math.min(0.35, s.held * 0.05)), t, boost ? 0.05 : 0.15)
    this.rocket.flt.frequency.setTargetAtTime(500 + Math.min(2500, s.held * 300), t, 0.2)
    this.wind.g.gain.setTargetAtTime(Math.min(0.6, decades * 0.22), t, 0.25)
    this.wind.flt.frequency.setTargetAtTime(380 + Math.min(1500, decades * 380), t, 0.3)
    this.fallT = s.falling ? this.fallT + s.dt : 0
    this.whistle.frequency.setTargetAtTime(1700 * Math.pow(0.5, this.fallT / 2.2) + 260, t, 0.05)
    this.whistleGain.gain.setTargetAtTime(s.falling ? 0.04 * Math.min(1, this.fallT * 2) : 0, t, s.falling ? 0.2 : 0.06)
  }

  // ---- one-shots
  ready() { return this.ctx && this.on }

  tone(type, f0, f1, dur, gain, { t = 0, vibrato = 0, bus = this.sfx } = {}) {
    const C = this.ctx, t0 = C.currentTime + t
    const o = C.createOscillator(); o.type = type
    o.frequency.setValueAtTime(f0, t0)
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur)
    const g = C.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(g); g.connect(bus)
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
    src.connect(flt); flt.connect(g); g.connect(this.sfx)
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.02)
  }

  boing(strength = 0.5) {
    if (!this.ready()) return
    const k = Math.min(1, strength)
    this.tone('sine', 150 + 60 * k, 420 + 200 * k, 0.45 + 0.3 * k, 0.16 + 0.12 * k, { vibrato: 40 + 60 * k })
  }
  bonk(v = 1) {
    if (!this.ready()) return
    this.tone('square', 220, 120, 0.12, 0.08 * v)
    this.burst(0.15, 0.3 * v, { f0: 600, f1: 90 })
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
  poof() { if (this.ready()) this.burst(0.35, 0.35, { type: 'bandpass', f0: 1200, f1: 300, q: 0.8, white: true }) }
  splash(k = 0.5) {
    if (!this.ready()) return
    this.burst(0.5 + k * 0.4, 0.3 + k * 0.4, { type: 'bandpass', f0: 2500, f1: 400, q: 0.6, white: true })
    this.tone('sine', 500, 200, 0.15, 0.06)
  }
  rustle() { if (this.ready()) for (let i = 0; i < 4; i++) this.burst(0.08, 0.15, { type: 'highpass', f0: 3000, f1: 2000, q: 0.5, t: i * 0.06, white: true }) }
  whoosh() { if (this.ready()) this.burst(0.5, 0.35, { type: 'bandpass', f0: 400, f1: 2400, q: 1.5, white: true }) }
  // an indignant gull
  squawk() {
    if (!this.ready()) return
    for (let i = 0; i < 3; i++) this.tone('sawtooth', 1500 - i * 120, 700, 0.11, 0.05, { t: i * 0.13, vibrato: 30 })
  }
  gulp() {
    if (!this.ready()) return
    this.tone('sine', 300, 180, 0.12, 0.12)
    this.tone('sine', 240, 140, 0.14, 0.1, { t: 0.13 })
  }
  // a rising arpeggio; each ring in a chain goes up a step
  ring(n = 1) {
    if (!this.ready()) return
    const base = 523.25 * Math.pow(2, Math.min(n - 1, 7) / 12)
    ;[1, 1.25, 1.5, 2].forEach((m, i) => this.tone('square', base * m, base * m, 0.12, 0.05, { t: i * 0.05 }))
  }
  coin(n = 1) {
    if (!this.ready()) return
    const up = (n % 5) / 12
    this.tone('square', 988 * Math.pow(2, up), 988 * Math.pow(2, up), 0.07, 0.05)
    this.tone('square', 1319 * Math.pow(2, up), 1319 * Math.pow(2, up), 0.25, 0.05, { t: 0.07 })
  }

  // ---- music: I–vi–IV–V in C, a bouncy bass, chord stabs, and a pentatonic tune that
  // repeats with small changes. Scheduled a little ahead on the audio clock.
  startMusic() {
    const C = this.ctx
    const bpm = 116, beat = 60 / bpm, step = beat / 2
    const prog = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]] // C Am F G (midi)
    const scale = [60, 62, 64, 67, 69, 72, 74, 76]
    let seed = 7
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const motif = Array.from({ length: 16 }, () => (rnd() < 0.7 ? Math.floor(rnd() * scale.length) : -1))
    const midi = m => 440 * Math.pow(2, (m - 69) / 12)
    let next = C.currentTime + 0.1, i = 0
    const note = (type, m, t, dur, gain) => this.tone(type, midi(m), midi(m), dur, gain, { t: t - C.currentTime, bus: this.musicBus })
    const tick = () => {
      if (!this.ctx) return
      while (next < C.currentTime + 0.25) {
        const bar = Math.floor(i / 8) % 4, s = i % 8, chord = prog[bar]
        if (this.on) {
          if (s % 2 === 0) note('triangle', chord[0] - 12 + (s === 4 ? 7 : 0), next, beat * 0.9, 0.09)
          if (s === 1 || s === 5) chord.forEach(m => note('square', m + 12, next, step * 0.6, 0.012))
          const phrase = Math.floor(i / 32) % 4
          let mi = motif[(i % 16 + 16) % 16]
          if (phrase === 3 && s >= 6) mi = -1
          if (mi >= 0) {
            if (phrase === 1 && (i % 16) > 10) mi = Math.min(scale.length - 1, mi + 1)
            note('square', scale[mi], next, step * 0.85, 0.022)
          }
          if (s % 2 === 1) this.burstAt(next, 0.03, 0.04)
        }
        next += step; i++
      }
    }
    this.musicTimer = setInterval(tick, 60)
  }

  burstAt(t0, dur, gain) {
    const C = this.ctx
    const src = C.createBufferSource(); src.buffer = this.whiteBuf
    const flt = C.createBiquadFilter(); flt.type = 'highpass'; flt.frequency.value = 7000
    const g = C.createGain()
    g.gain.setValueAtTime(gain, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(flt); flt.connect(g); g.connect(this.musicBus)
    src.start(t0, Math.random()); src.stop(t0 + dur + 0.01)
  }

  dispose() {
    clearInterval(this.musicTimer)
    if (this.ctx) this.ctx.close()
    this.ctx = null
  }
}
