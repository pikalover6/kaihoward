# kaihoward.com

A flight over a sea of clouds in a toy plane that runs on cartoon physics. The whole
site is one WebGL scene: the plane, a wallpaper-inspired sky with a moon, stars and
light rays, hot air balloons, birds, bubbles, and a long way down to some low-poly
mountains and rivers. The old contact / projects card is still there, behind the
`kh` monogram in the top-left corner.

## Controls

| key | |
| --- | --- |
| arrows / WASD | pitch and roll |
| Q / E | rudder |
| shift / ctrl | speed up / slow down. Hold it: there's no top, and below zero is reverse |
| space (or X) | engine on / off |
| R | respawn above the clouds |
| V | cycle view (chase, cockpit, cinematic, orbit) |
| F | draw a path with the mouse, the plane flies it |
| M | sound |
| esc | leave draw mode / close the card |

On a phone: drag to fly, with buttons for faster, slower and the engine.

## Toon aeronautics

The plane doesn't use aerodynamics. It follows eight laws (`src/sim/flight.js`), and
everything it does comes out of them. Nothing is scripted for a particular trick.

1. **Inertia is sacred.** The plane has a momentum vector that has nothing to do
   with where it points. There's no drag, and nothing ever swings the nose into the
   wind. Spin is momentum too.
2. **The engine is intention.** While it runs, the plane wants to go where its nose
   points, at the speed on the dial. The prop pushes along the nose and the wings
   grip the air across it. Their authority scales with the speeds involved, so the
   engine feels the same at 60 mph as at a zillion. It cancels gravity too,
   because it doesn't believe in it. Cut it and the plane is a brick with momentum.
3. **The dial has no top.** Holding the throttle multiplies the target speed, faster
   the longer you hold. It parks at zero (hover) on the way down; below zero is
   reverse.
4. **Gravity has to be noticed.** Gravity only pulls as hard as the plane is aware of
   it. Awareness drops to zero when things change suddenly (the engine dies, or the
   plane comes to a dead stop in midair) and comes back after a beat, once the
   pilot has had a look down.
5. **Everything is rubber.** The ground and the sky are solid and the plane bounces
   off them like a ball. Off-centre hits spin it, hard hits daze the pilot (a dazed
   pilot has no intention), and anything harder than the rubber can take splats it
   flat for a moment.
6. **Clouds hold up the idle.** A cloud catches anything that isn't trying to get
   through it, softly, like a pillow.
7. **The sky has a lid.** See 5.
8. **The scenery has a top speed.** Like the looping background in a cartoon chase,
   the world can only scroll by so fast. Momentum is still real: the dial, the
   impacts and the speedometer all know you're doing a zillion mph.

Some of what falls out:

- Hold shift until the sky turns plaid, cut the engine, turn around. You keep going
  the way you were going, tail first (1). Start the engine and it brakes you
  through zero and off the other way (2).
- Pull up until you're going straight up and cut the engine. The plane carries on
  for a beat (4), slows to a dead stop, hangs there while the pilot holds up a sign
  (4), then drops tail first with the nose still pointing at the sky (1).
- Fly upside down or on a wingtip as long as you like. The plane settles into
  whichever of upright, knife-edge or inverted is nearest (2).
- Cut the engine above the clouds and you'll land on one and can nap there (6).
  Fall from high enough and you go straight through.
- Dive into the ground and you'll bounce and tumble (5). Hit it at more than about
  1,300 mph and you'll splat, and the impact knocks the dial back to cruise.
- Throttle down to zero and the plane hovers (2, 3). Keep going and it flies
  backwards, prop spinning the wrong way and scarf blowing over the nose.

## Tech

- React 19 + Vite
- three.js, hand-written shaders (sky, cloud sea, cloud puffs, ribbons, birds, bubbles)
- simplex-noise for the terrain
- no assets: every model, texture and sound is generated in code

Source lives in `src/sim/`:

| file | |
| --- | --- |
| `flight.js` | the toon physics: the eight laws, the pilot, contacts and impacts |
| `engine.js` | scene setup, main loop, lighting/fog by altitude, turning physics events into noises |
| `effects.js` | speed streaks, puffs of cloud / dust / smoke, shock rings |
| `units.js` | mph, and the words for numbers too big for digits |
| `sky.js` | sky dome shader (plus plaid, and ripples when you bonk the lid), fog per altitude |
| `clouds.js` | cloud deck with breaks, cirrus veil, instanced billboard puffs |
| `plane.js` | the aircraft model, the pilot, the sign and the dizzy stars |
| `cameras.js` | camera rig and view modes |
| `drawpath.js` | draw-a-path mode and path following |
| `terrain.js` | endless clipmap terrain (heights computed in the vertex shader) with trees |
| `life.js` | birds, balloons, bubbles, sparkles |
| `audio.js` | procedural engine and wind, and the boings, splats, booms and falling whistle |

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
