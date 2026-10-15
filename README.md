# kaihoward.com

**KAI HOWARD 64.** The whole site is a cartoon flying game in the style of a
late-90s console: a chunky red plane with a goggled pilot, an endless island world
of hills, mountains, beaches and sea, rings to fly through, coins to collect, gulls
to annoy, and a big floating KH to buzz. It all runs on a made-up physics system
where turning the plane doesn't turn your path. The contact / projects card is in
the pause menu, behind the `kh` button in the top-left corner (or esc).

## Controls

| key | |
| --- | --- |
| ← → / A D | turn |
| ↑ ↓ / W S | pitch |
| space | boost (shoves you along the nose; there's no top) |
| shift | brake (shoves you along the tail; keep holding and you'll go backwards) |
| Q / E | roll |
| ← ← / → → | barrel roll (double-tap) |
| V | cycle view (chase, cockpit, cinematic, orbit) |
| M | sound and music |
| R | respawn |
| esc / P | pause, and the contact / projects card |

Gamepad: left stick to fly, A / RT boost, B / LT brake, LB / RB roll, X barrel roll,
Y view, start pause. On a phone: drag to fly, with big boost and brake buttons.

## Toon aeronautics, second edition

The plane doesn't use aerodynamics. It obeys nine laws (`src/sim/flight.js`), and
everything it does comes out of them. Nothing is scripted for a particular trick.

1. **Inertia is sacred.** Momentum is a vector that has nothing to do with where
   the nose points. Nothing in the sky slows you down, and turning the plane
   around doesn't turn your path around.
2. **The air pushes sideways, never back.** The wings and the fin are flat plates.
   The air pushes on them in proportion to how far they're tilted into it, but
   only ever across your path: it can bend your path, it can't slow you down. It
   can only push so hard, so the faster you go the less it bends you, and at a
   zillion mph it can't bend you at all. A flat plate doesn't care which edge
   leads, so the plane flies backwards as well as forwards.
3. **The prop pushes where you point.** Boost shoves you along the nose, brake
   shoves you the other way. The shove is in proportion to how fast you're already
   going and grows the longer you hold it, so there's no top speed, and getting
   back down from a zillion mph takes as long as getting there.
4. **Planes like to face their path.** The tail swings the nose into the wind,
   forwards or backwards, whichever is nearer. Gently: the pilot can always
   out-muscle it.
5. **Gravity has to be noticed.** Something that comes to a dead stop in midair
   stays put for a beat, until it has had a look down.
6. **Everything is rubber.** Solid things bounce you like a ball, and spin you if
   they hit you off-centre. Hard hits daze the pilot, and a hit harder than the
   rubber can take splats you flat. Some things (mushrooms, beach balls, the KH)
   are rubberier than others.
7. **Soft things push back.** Water holds up everything and is a bit sticky.
   Clouds only hold up the idle: anything boosting goes straight through.
8. **The sky has a lid.** See 6.
9. **The scenery has a top speed.** Like the looping background in a cartoon
   chase, the world only scrolls past so fast. Past that you only get as far as
   the background can keep up with, and the background is just a painting going
   by: you ride up and over its hills and go straight through anything standing
   on it, leaving a plane-shaped hole. Dive into it hard enough, though, and it'll
   still splat you.

Some of what falls out:

- Hold space until the sky turns plaid. Now turn around, as far as you like: your
  path doesn't budge, because the air can't bend a zillion mph (1, 2). Facing
  backwards, the prop pushes against your momentum: keep boosting and you slow
  down, through zero, and off the other way (3).
- At ordinary speeds the same rules give you ordinary flying. Bank and the wings
  bend your path round (2); let go and the tail lines the nose back up with it (4).
- Pull up until you're going straight up and let go. You slow to a dead stop, hang
  there for a beat (5), then drop tail first with the nose still pointing at the
  sky, because the tail is happy to lead (4).
- Brake to zero and keep braking and you fly backwards, stably, prop spinning the
  wrong way (2, 3, 4). Fly upside down or on a wingtip as long as you like.
- Rings add a shove along their axis, so a chain of them is a catapult (3).
- Skip across the sea like a stone (6, 7), nap on a cloud (7), or bounce off the
  mushrooms higher than you fell (6). Bonk the sky and it ripples (8).

## The look

Everything is drawn the way a 1996 console would have drawn it: per-vertex
(Gouraud) lighting, linear fog, tiny procedural textures, a low-resolution frame
with an ordered 4×4 dither down to 5 bits per channel, scaled up with nearest
neighbour. No assets: every model, texture, tune and noise is generated in code.

## Tech

- React 19 + Vite
- three.js with hand-written shaders
- simplex-noise for the terrain

Source lives in `src/sim/`:

| file | |
| --- | --- |
| `flight.js` | the toon physics: the nine laws, the pilot's hands, contacts and impacts |
| `shapes.js` | collision shapes (signed distance) and the materials things are made of |
| `world.js` | clipmap terrain and sea, streamed trees, clouds, landmarks, rings and coins |
| `noise.js` | the terrain function, shared by the CPU and the GPU |
| `n64.js` | the retro renderer: Gouraud material, procedural textures, the dithered low-res screen |
| `sky.js` | sky dome (a sun in sunglasses, stars near the lid, plaid at ludicrous speed) |
| `plane.js` | the plane, the pilot, the sign, the rocket and the dizzy stars |
| `engine.js` | main loop, turning physics events into pops and noises, rings, coins, HUD |
| `tricks.js` | spots loops, rolls, one-eighties and the like, and names them |
| `birds.js` | gull flocks that scatter when you buzz them |
| `effects.js` | speed streaks, puffs of cloud / dust / smoke, shock rings |
| `cameras.js` | camera rig and view modes |
| `input.js` | keyboard, touch and gamepad |
| `audio.js` | procedural engine, rocket and wind, the boings and splats, and the music |
| `ribbon.js` | wingtip trails and the scarf |
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
