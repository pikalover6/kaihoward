// Keyboard / pointer / touch input -> normalised control axes.
export class Input {
  constructor(el) {
    this.el = el
    this.keys = new Set()
    this.pitch = 0; this.roll = 0; this.yaw = 0; this.throttle = 0
    this.pointer = { x: 0, y: 0, down: false, dx: 0, dy: 0 }
    this.touch = { active: false, sx: 0, sy: 0, x: 0, y: 0 }
    this.isTouch = window.matchMedia('(pointer: coarse)').matches
    this.listeners = {}
    this.anyKey = false
    this.wheel = 0
    this._onKeyDown = e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return
      const k = e.key.toLowerCase()
      if (!this.keys.has(k)) this.emit('press', k, e)
      this.keys.add(k)
      this.anyKey = true
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
    }
    this._onKeyUp = e => this.keys.delete(e.key.toLowerCase())
    this._onBlur = () => this.keys.clear()
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    window.addEventListener('blur', this._onBlur)

    this._onPointerDown = e => {
      if (e.target !== this.el) return
      this.pointer.down = true
      this.pointer.x = e.clientX; this.pointer.y = e.clientY
      if (e.pointerType === 'touch') {
        this.touch.active = true
        this.touch.sx = this.touch.x = e.clientX
        this.touch.sy = this.touch.y = e.clientY
      }
      this.emit('pointerdown', e)
    }
    this._onPointerMove = e => {
      const dx = e.clientX - this.pointer.x, dy = e.clientY - this.pointer.y
      this.pointer.x = e.clientX; this.pointer.y = e.clientY
      if (this.pointer.down) { this.pointer.dx += dx; this.pointer.dy += dy }
      if (this.touch.active) { this.touch.x = e.clientX; this.touch.y = e.clientY }
      this.emit('pointermove', e)
    }
    this._onPointerUp = e => {
      this.pointer.down = false
      this.touch.active = false
      this.emit('pointerup', e)
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
  has(...ks) { return ks.some(k => this.keys.has(k)) }

  // read axes (call once per frame)
  poll() {
    const k = this.keys
    let pitch = 0, roll = 0, yaw = 0, throttle = 0
    if (k.has('w') || k.has('arrowup')) pitch += 1
    if (k.has('s') || k.has('arrowdown')) pitch -= 1
    if (k.has('a') || k.has('arrowleft')) roll -= 1
    if (k.has('d') || k.has('arrowright')) roll += 1
    if (k.has('q')) yaw -= 1
    if (k.has('e')) yaw += 1
    if (k.has('shift')) throttle += 1
    if (k.has('control')) throttle -= 1
    if (this.touch.active) {
      const dx = (this.touch.x - this.touch.sx) / 90, dy = (this.touch.y - this.touch.sy) / 90
      roll += Math.max(-1, Math.min(1, dx))
      pitch += Math.max(-1, Math.min(1, -dy))
    }
    this.pitch = pitch; this.roll = roll; this.yaw = yaw; this.throttle = throttle
    const out = { pitch, roll, yaw, throttle, pdx: this.pointer.dx, pdy: this.pointer.dy, wheel: this.wheel }
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
