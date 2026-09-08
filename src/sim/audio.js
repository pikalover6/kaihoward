// Small procedural soundscape: engine hum + wind, bubble pops.
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
    // wind: looping noise through a bandpass
    const len = C.sampleRate * 2
    const buf = C.createBuffer(1, len, C.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = last * 3.5 }
    this.noise = C.createBufferSource(); this.noise.buffer = buf; this.noise.loop = true
    this.windBP = C.createBiquadFilter(); this.windBP.type = 'bandpass'; this.windBP.frequency.value = 500; this.windBP.Q.value = 0.5
    this.windGain = C.createGain(); this.windGain.gain.value = 0.0
    this.noise.connect(this.windBP); this.windBP.connect(this.windGain); this.windGain.connect(this.master)
    this.noise.start()
  }

  toggle() {
    if (!this.ctx) this.init()
    this.on = !this.on
    if (this.ctx.state === 'suspended') this.ctx.resume()
    const t = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(t)
    this.master.gain.setTargetAtTime(this.on ? 0.8 : 0, t, 0.4)
  }

  update(engineSpeed, throttle, inside, engineOff, airSpeed) {
    if (!this.ctx || !this.on) return
    const t = this.ctx.currentTime
    const f = 52 + throttle * 55 + engineSpeed * 0.22
    this.osc1.frequency.setTargetAtTime(f, t, 0.15)
    this.osc2.frequency.setTargetAtTime(f * 1.503, t, 0.15)
    this.engineLP.frequency.setTargetAtTime(240 + throttle * 300 + engineSpeed, t, 0.2)
    this.engineGain.gain.setTargetAtTime(engineOff ? 0.0 : 0.045 + throttle * 0.03, t, 0.5)
    const w = Math.pow(Math.min(1, airSpeed / 150), 2) * (engineOff ? 0.7 : 0.5) + inside * 0.4
    this.windGain.gain.setTargetAtTime(w, t, 0.25)
    this.windBP.frequency.setTargetAtTime(380 + airSpeed * 5 - inside * 200, t, 0.3)
  }

  pop() {
    if (!this.ctx || !this.on) return
    const C = this.ctx, t = C.currentTime
    const o = C.createOscillator(); o.type = 'sine'
    o.frequency.setValueAtTime(700 + Math.random() * 500, t)
    o.frequency.exponentialRampToValueAtTime(1600, t + 0.06)
    const g = C.createGain(); g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    o.connect(g); g.connect(this.master)
    o.start(t); o.stop(t + 0.14)
  }

  dispose() { if (this.ctx) this.ctx.close() }
}
