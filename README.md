# हमारी यादों की दुनिया ❤️

A full-screen, cinematic 3D globe built from real family photographs. Every
picture is its own plane sitting on a Fibonacci sphere — no spherical textures,
no stock images, no generated faces.

**33 photographs** from `D:\uncle` are used. The globe is made of **231 tiles**,
so each photograph appears about seven times, scattered across the sphere at
different crops. That is what turns 33 pictures into a planet — every tile is
still individually clickable and opens the untouched original.

---

## Run it

```bash
cd D:\uncle\memory-sphere
npm install          # first time only
npm run dev          # http://127.0.0.1:5173
```

Production build:

```bash
npm run build        # type check + bundle into dist/
npm run preview      # serve the built app
```

Node 20+ is required. The app is intentionally **not deployed**.

---

## Photographs

`npm run photos` rescans the photo folder and rebuilds every derived asset:

| Output | Purpose |
| --- | --- |
| `public/photos/thumb/pNN.jpg` | 384×512 textures for the 3D tiles (~30 KB each) |
| `public/photos/original/pNN.*` | byte-for-byte copy of every original, shown in the viewer |
| `src/data/photos.json` | id, paths, dimensions and aspect of every photograph |

* The scan is recursive and picks up **JPG, JPEG, PNG, WEBP, AVIF, GIF, BMP,
  TIFF and HEIC**.
* The source folder defaults to the project's parent (`D:\uncle`). Pass another
  folder if needed: `npm run photos -- "E:\family"`.
* `node_modules`, the project folder itself and the generated `public/photos`
  output are skipped, so re-running never picks up its own thumbnails.
* **Originals are only ever read.** Nothing in the source folder is renamed,
  edited or deleted; the viewer copy is a separate file.

Add more photographs to the folder and re-run `npm run photos` — the globe picks
them up automatically and the repetition drops as the collection grows.

---

## Controls

| Action | Desktop | Mobile |
| --- | --- | --- |
| घुमाएँ (rotate) | drag with the mouse, with inertia | one-finger drag |
| ज़ूम करें (zoom) | mouse wheel / trackpad | pinch |
| तस्वीर देखें (open) | click a photograph | tap a photograph |
| बंद करें (close) | `Esc` or the × button | × button or tap the background |
| पिछली / अगली (browse) | `←` `→`, on-screen arrows, or the buttons | on-screen arrows |

The globe drifts slowly on its own once it has been idle for a couple of
seconds, and stops the moment you touch it. The sphere's position is frozen
while a photograph is open, so closing the viewer puts you back exactly where
you were.

---

## Tuning

Everything visual lives in `src/config.ts`:

```ts
sphere: { targetTiles: 200, tileAspect: 0.94, coverage: 0.78 }
camera: { fov: 42, fitMargin: 1.16, zoomMin: 0.44, zoomMax: 1.38 }
interaction: { rotateSpeed, inertiaDamping, autoRotateSpeed, hoverScale }
dust: { count: 900, … }
```

* `targetTiles` — how many cards the globe is made of. Higher = denser and more
  repetition; lower = larger, more distinct photographs.
* `tileAspect` / `coverage` — card shape and how much of the sphere is covered.
  Higher coverage closes the gaps between cards.

---

## How it works

* **`src/sphere/layout.ts`** — golden-angle (Fibonacci) sphere distribution, so
  the tiles are spread evenly with no poles or seams, each one oriented along
  its own surface normal.
* **`src/sphere/tileMaterial.ts`** — one small shader per card: rounded-corner
  mask, cover-crop of the photo, per-tile vignette, a warm rim that lights up on
  hover, and soft lighting that dims the cards turning away from the viewer.
* **`src/sphere/PhotoSphere.ts`** — three.js scene, custom trackball controls
  (drag + inertia + auto-drift + wheel/pinch zoom), raycast picking, and the
  render loop. Nothing in the animation path touches React or the DOM.
* **`src/sphere/textures.ts`** — textures stream in progressively, front-facing
  photographs first, five at a time; duplicate tiles share one GPU texture.
* **`src/sphere/planet.ts`** — the dark planet body (which also hides the far
  side of the sphere) plus a faint atmosphere halo.
* **`src/sphere/dust.ts`** — the slow background particles.
* **`src/viewer/PhotoViewer.ts`** — the full-screen viewer: it animates out of
  the clicked tile's projected screen rectangle, loads the untouched original,
  and cycles with the arrow keys.

Performance choices: adaptive drawing-buffer cap (max ~5 MP regardless of
device DPR), no MSAA (the cards antialias their own edges in the shader), one
shared plane geometry, ~234 draw calls, and the animation stops entirely while a
photograph is open or the tab is hidden. Measured 60 fps on an Intel integrated
GPU at 1440×900 and on a 390×844 phone viewport; ~57 fps at a 5K desktop window.

If WebGL2 is unavailable the canvas is replaced by a quiet, scrollable gallery
of the same photographs, with a short Hindi note.
