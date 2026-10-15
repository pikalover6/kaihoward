import { MACH, LIGHT } from './flight.js'

// a unit is a metre
export const MPH = 2.23694

const WORDS = [
  [1e21, 'gazillion'], [1e18, 'bajillion'], [1e15, 'zillion'],
  [1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'],
]

// speed in units/s -> { num, unit } for the speedometer, in words once the digits get silly
export function speedText(ups) {
  const mph = ups * MPH
  if (mph < 1e6) return { num: Math.round(mph).toLocaleString('en-US'), unit: 'mph' }
  for (const [at, word] of WORDS) {
    if (mph < at) continue
    const n = mph / at
    if (at >= 1e15) return { num: n < 2 ? 'a' : Math.floor(n).toLocaleString('en-US'), unit: `${word} mph` }
    return { num: n < 10 ? n.toFixed(1) : Math.floor(n).toLocaleString('en-US'), unit: `${word} mph` }
  }
  return { num: '?', unit: 'mph' }
}

// named speeds; crossing one going up gets announced
export const TIERS = [
  { at: MACH, name: 'mach 1', boom: true },
  { at: MACH * 10, name: 'mach 10' },
  { at: 11186, name: 'escape velocity' },
  { at: LIGHT, name: 'light speed' },
  { at: LIGHT * 10, name: 'ridiculous speed' },
  { at: LIGHT * 100, name: 'ludicrous speed' },
  { at: LIGHT * 1000, name: 'they’ve gone to plaid' },
]
