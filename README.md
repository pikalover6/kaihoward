# kaihoward.com

A quiet little flight over a sea of clouds. The whole site is one WebGL scene:
a toy plane, a wallpaper-inspired sky with a moon, stars and light rays,
hot air balloons, birds, bubbles, and a long way down to some low-poly
mountains and rivers. The old contact / projects card is still there,
behind the `kh` monogram in the top-left corner.

## Controls

| key | |
| --- | --- |
| arrows / WASD | pitch and roll |
| Q / E | rudder |
| shift / ctrl | throttle |
| space | barrel roll |
| V | cycle view (chase, cockpit, cinematic, orbit) |
| F | draw a path with the mouse, the plane flies it |
| M | sound |
| esc | leave draw mode / close the card |

Dive below the clouds and keep going for a couple of minutes to reach the
ground. You can't crash: get close and the plane lands itself, then you're
back above the clouds.

## Tech

- React 19 + Vite
- three.js, hand-written shaders (sky, cloud sea, cloud puffs, ribbons, birds, bubbles)
- simplex-noise for the terrain
- no assets: every model and texture is generated in code

Source lives in `src/sim/`:

| file | |
| --- | --- |
| `engine.js` | scene setup, main loop, lighting/fog by altitude, auto-landing |
| `sky.js` | sky dome shader, fog colour/density per altitude |
| `clouds.js` | cloud sea surface, cirrus veil, instanced billboard puffs |
| `plane.js` | the aircraft model |
| `flight.js` | arcade flight model |
| `cameras.js` | camera rig and view modes |
| `drawpath.js` | draw-a-path mode and path following |
| `terrain.js` | tiled procedural terrain with trees |
| `life.js` | birds, balloons, bubbles, sparkles |
| `audio.js` | procedural engine + wind |

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
