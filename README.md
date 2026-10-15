# kaihoward.com

**KAI HOWARD 64 vs. the Newtonian Air Force.** The whole site is a high-speed
dogfighting game in the style of a late-90s console, dressed in Frutiger Aero. You
fly a chunky red cartoon plane that runs on made-up physics. They fly grey,
realistic fighter jets that run on real physics, and they've been sent to arrest
you for breaking it. The contact / projects card is in the pause menu, behind the
`kh` button in the top-left corner (or esc).

## Controls

| key | |
| --- | --- |
| ← → / A D | turn |
| ↑ ↓ / W S | pitch |
| space | boost (shoves you along the nose; there's no top) |
| shift | brake (shoves you along the tail; keep holding and you'll go backwards) |
| F / J / Z / X / enter / click | fire. The guns also go off by themselves when a jet is lined up |
| ← ← / → → | barrel roll (double-tap). Bats away bullets and missiles. Too many and you get dizzy |
| Q / E | roll |
| V | cycle view (chase, cockpit, cinematic, orbit) |
| M | sound and music |
| R | respawn |
| esc / P | pause, and the contact / projects card |

Gamepad: left stick to fly, RT boost, LT brake, A / X fire, B barrel roll, LB / RB
roll, Y view, start pause. On a phone: drag to fly, with big boost, brake and roll
buttons. The guns fire on their own.

## The game

Jets arrive in waves: light *Inertia* fighters first, then twin-tailed *Momentum*
fighters with missiles, then *Entropy* stealth jets, and every fifth wave a flying
wing called *The Second Law*. They chatter on the radio, mostly about how what
you're doing isn't allowed.

Your power meter is a pie of eight wedges. Their bullets chip it, their missiles
take a chunk, coins patch it up a little and a heart refills it. Run out and you're
knocked out for a moment, then back in the fight where you left off. Glossy power-up
bubbles float about: a heart, triple orbs, a bubble shield, and a clutch of homing
rubber ducks that launch themselves at whatever you're pointing at (they can be
fooled by flares).

Kills score more for doing something no real aircraft could: flying backwards,
upside down, hanging still in midair, going supersonic on a propeller, ramming,
or sending their own missile back to them. Kills in quick succession multiply.

## Toon aeronautics (you)

The plane doesn't use aerodynamics. It obeys ten laws (`src/sim/flight.js`), and
everything it does comes out of them. Nothing is scripted for a particular trick.

1. **Inertia is sacred.** Momentum is a vector that has nothing to do with where
   the nose points. Nothing in the sky slows you down, and turning the plane
   around doesn't turn your path around.
2. **The air pushes sideways, never back.** The wings and the fin are flat plates.
   The air pushes on them in proportion to how far they're tilted into it, but
   only ever across your path, and only so hard: the faster you go the less it
   bends you, and at a zillion mph it can't bend you at all. A flat plate doesn't
   care which edge leads, so the plane flies backwards as well as forwards.
3. **The prop pushes where you point.** Boost shoves you along the nose, brake
   the other way, in proportion to how fast you're already going. No top speed.
4. **Planes like to face their path,** forwards or backwards, whichever is nearer.
5. **Gravity has to be noticed.** Something that comes to a dead stop in midair
   stays put for a beat, until it has had a look down.
6. **Everything is rubber.** Solid things bounce you like a ball, and spin you if
   they hit you off-centre. Hard hits daze the pilot; harder ones splat you.
7. **Soft things push back.** Water holds up everything. Clouds only hold up the
   idle.
8. **The sky has a lid.** See 6.
9. **The scenery has a top speed.** Past it the world is just a painting going by:
   you ride over its hills and punch plane-shaped holes through anything on it,
   other people's aircraft included.
10. **A spin is a shield.** Anything that hits a plane rolling flat out glances off
    and goes back the way it came. Roll too many times in a row and the pilot gets
    dizzy.

Things that move hit you as hard as you're moving relative to them, and if one of
them splats you, you ride along on it for a moment.

## Real aeronautics (them)

The jets (`src/sim/jets.js`) fly by the real rules: lift in proportion to angle of
attack and airspeed squared, stall past a critical angle, drag that grows with
lift so hard turns bleed speed, thrust and afterburners, gravity at 9.81, and a
flight computer that won't pull more g than the airframe can take. To turn they
roll the lift where they want to go and pull. So they can't stop, can't turn on
the spot and can't fly backwards, and the faster they go the wider they turn.

Most of the fighting falls out of the difference:

- Hit the brakes with a jet on your tail and it overshoots. You don't have to turn
  round to shoot back: at speed, spin the plane and your path doesn't change.
- Their missiles fly proportional navigation. Stop dead and they can't turn tight
  enough to follow; hide in a cloud and they lose you; barrel roll as one arrives
  and it goes back to whoever fired it.
- Lead them low through the hills. They pull up as hard as their airframes allow,
  and sometimes that isn't enough.
- Faster than the scenery, you go straight through them.

## The look

N64 rendering: per-vertex (Gouraud) lighting, linear fog, tiny procedural
textures, and a low-resolution frame with an ordered 4×4 dither down to 5 bits a
channel, blown up with nearest-neighbour. Frutiger Aero on top: a deep glossy
sky with ribbons of light, a lens flare, iridescent soap bubbles to pop, dolphins,
turquoise water with sun glitter, glossy highlights on everything, and a HUD of
glass panels and gel buttons. No assets: every model, texture, tune and noise is
generated in code.

## Tech

- React 19 + Vite
- three.js with hand-written shaders
- simplex-noise for the terrain

Source lives in `src/sim/`:

| file | |
| --- | --- |
| `flight.js` | the toon physics: the ten laws, the pilot's hands, contacts and impacts |
| `jets.js` | the Newtonian Air Force: realistic airframes, real flight physics, and the pilots |
| `combat.js` | guns, missiles, rubber ducks, damage, waves, scoring, power-ups, the radio |
| `hud2d.js` | the combat overlay: target brackets, arrows, the gunsight, the radar |
| `aero.js` | bubbles, the lens flare, dolphins |
| `shapes.js` | collision shapes (signed distance) and the materials things are made of |
| `world.js` | clipmap terrain and sea, streamed trees, clouds, landmarks, rings and coins |
| `noise.js` | the terrain function, shared by the CPU and the GPU |
| `n64.js` | the retro renderer: Gouraud material, procedural textures, the dithered low-res screen |
| `sky.js` | sky dome (a radiant sun, light ribbons, stars near the lid, plaid at ludicrous speed) |
| `plane.js` | the plane, the pilot, the sign, the rocket and the dizzy stars |
| `engine.js` | main loop, turning physics events into pops and noises, rings, coins, HUD |
| `tricks.js` | spots loops, rolls, one-eighties and the like, and names them |
| `birds.js` | gull flocks that scatter when you buzz them |
| `effects.js` | speed streaks, puffs of cloud / dust / smoke / fire, shock rings |
| `cameras.js` | camera rig and view modes |
| `input.js` | keyboard, mouse, touch and gamepad |
| `audio.js` | engine, rocket, wind, jets, guns, warnings, the boings and splats, and the music |
| `ribbon.js` | wingtip trails, vortices and the scarf |
| `units.js` | mph, and the words for numbers too big for digits |

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```
