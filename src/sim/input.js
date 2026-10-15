// Keyboard, gamepad and touch -> a handful of control axes.
//   pitch  ↑↓ / W S / left stick       turn  ←→ / A D / left stick
//   roll   Q E / bumpers               throttle  space / RT boost, shift / LT brake
//   fire   F J Z X / enter / click / A (and the guns go off by themselves when something's lined up)
// Double-tap ← or → (or press B on a pad) for a barrel roll.
const FIRE_KEYS = ['f', 'j', 'z', 'x', 'enter']
const DEAD = 0.18
const dz = v => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD))

export class Input {
  constructor(el) {
    this.el = el
    this.keys = new Set()
    this.pointer = { x: 0, y: 0, down: false, dx: 0, dy: 0 }
    this.touch = { active: false, id: null, sx: 0, sy: 0, x: 0, y: 0 }
    this.isTouch = window.matchMedia('(pointer: coarse)').matches
    this.listeners = {}
    this.wheel = 0
    this.virtualThrottle = 0 // held on-screen buttons (touch)
    this.virtualFire = false
    this.mouseFire = false
    this.lastTap = { key: '', t: 0 }
    this.padPrev = []
    this.usingPad = false

    this._onKeyDown = e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return
      const k = e.key.toLowerCase()
      if (!this.keys.has(k)) {
        this.emit('press', k, e)
        const side = k === 'arrowleft' || k === 'a' ? -1 : k === 'arrowright' || k === 'd' ? 1 : 0
        if (side) {
          const now = performance.now()
          if (this.lastTap.key === k && now - this.lastTap.t < 280) { this.emit('barrel', side); this.lastTap.key = '' }
          else this.lastTap = { key: k, t: now }
        }
      }
      this.keys.add(k)
      this.usingPad = false
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'enter'].includes(k)) e.preventDefault()
    }
    this._onKeyUp = e => this.keys.delete(e.key.toLowerCase())
    this._onBlur = () => this.keys.clear()
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    window.addEventListener('blur', this._onBlur)

    this._onPointerDown = e => {
      if (e.target !== this.el) return
      this.pointer.down = true
      if (e.pointerType === 'mouse' && e.button === 0) this.mouseFire = true
      this.pointer.x = e.clientX; this.pointer.y = e.clientY
      if (e.pointerType === 'touch' && !this.touch.active) {
        this.touch.active = true
        this.touch.id = e.pointerId
        this.touch.sx = this.touch.x = e.clientX
        this.touch.sy = this.touch.y = e.clientY
      }
      this.emit('pointerdown', e)
    }
    this._onPointerMove = e => {
      const dx = e.clientX - this.pointer.x, dy = e.clientY - this.pointer.y
      this.pointer.x = e.clientX; this.pointer.y = e.clientY
      if (this.pointer.down) { this.pointer.dx += dx; this.pointer.dy += dy }
      if (this.touch.active && e.pointerId === this.touch.id) { this.touch.x = e.clientX; this.touch.y = e.clientY }
    }
    this._onPointerUp = e => {
      this.pointer.down = false
      if (e.pointerType === 'mouse') this.mouseFire = false
      if (e.pointerId === this.touch.id) { this.touch.active = false; this.touch.id = null }
    }
    this._onWheel = e => { this.wheel += e.deltaY }
    window.addEventListener('pointerdown', this._onPointerDown)
    window.addEventListener('pointermove', this._onPointerMove)
    window.addEventListener('pointerup', this._onPointerUp)
    window.addEventListener('pointercancel', this._onPointerUp)
    window.addEventListener('wheel', this._onWheel, { passive: true })
  }

  on(name, fn) { (this.listeners[name] ||= []).push(fn) }
  emit(name, ...args) { for (const fn of this.listeners[name] || []) fn(...args) }

  // read the axes (call once per frame)
  poll() {
    const k = this.keys
    let pitch = 0, turn = 0, roll = 0, throttle = 0
    if (k.has('w') || k.has('arrowup')) pitch += 1
    if (k.has('s') || k.has('arrowdown')) pitch -= 1
    if (k.has('a') || k.has('arrowleft')) turn -= 1
    if (k.has('d') || k.has('arrowright')) turn += 1
    if (k.has('q')) roll -= 1
    if (k.has('e')) roll += 1
    if (k.has(' ')) throttle += 1
    if (k.has('shift')) throttle -= 1
    throttle += this.virtualThrottle
    let fire = this.mouseFire || this.virtualFire || FIRE_KEYS.some(f => k.has(f))
    if (this.touch.active) {
      turn += Math.max(-1, Math.min(1, (this.touch.x - this.touch.sx) / 80))
      pitch += Math.max(-1, Math.min(1, -(this.touch.y - this.touch.sy) / 80))
    }
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    for (const p of pads) {
      if (!p || !p.connected) continue
      const b = i => (p.buttons[i] ? p.buttons[i].value : 0)
      const pressed = i => b(i) > 0.5 && !(this.padPrev[i] > 0.5)
      const sx = dz(p.axes[0] || 0), sy = dz(p.axes[1] || 0)
      if (sx || sy || b(0) || b(1) || b(6) || b(7)) this.usingPad = true
      turn += sx
      pitch -= sy
      roll += b(5) - b(4)
      throttle += b(7) - b(6)
      if (b(0) > 0.5 || b(2) > 0.5) fire = true
      if (pressed(1)) this.emit('barrel', sx < -0.3 ? -1 : 1)
      if (pressed(3)) this.emit('press', 'v')
      if (pressed(9)) this.emit('press', 'escape')
      if (pressed(8)) this.emit('press', 'r')
      this.padPrev = p.buttons.map(x => x.value)
      break
    }
    const clamp = v => Math.max(-1, Math.min(1, v))
    const out = { pitch: clamp(pitch), turn: clamp(turn), roll: clamp(roll), throttle: clamp(throttle), fire, pdx: this.pointer.dx, pdy: this.pointer.dy, wheel: this.wheel }
    this.pointer.dx = 0; this.pointer.dy = 0; this.wheel = 0
    return out
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    window.removeEventListener('blur', this._onBlur)
    window.removeEventListener('pointerdown', this._onPointerDown)
    window.removeEventListener('pointermove', this._onPointerMove)
    window.removeEventListener('pointerup', this._onPointerUp)
    window.removeEventListener('pointercancel', this._onPointerUp)
    window.removeEventListener('wheel', this._onWheel)
  }
}
