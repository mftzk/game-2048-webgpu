# BRIEF — 2048 WebGPU (nrapkén edition)

Build a **WebGPU-rendered 2048 game** as a Next.js App Router app. The 4x4 board (tiles, numbers,
merge flashes, particles, animated background) is rendered **on the GPU with WebGPU + WGSL**, with a
**Canvas 2D fallback** used automatically when WebGPU is unavailable. Side-by-side comparison app to
the existing DOM version at `game-2048.quick.nrapken.dev`.

It must build with `npm run build` and run under `node server.js` (platform patches `output: 'standalone'`).

## Hard constraints (violating any of these breaks the deploy)

1. **No new npm dependencies.** Only `next`, `react`, `react-dom`. All GPU code is hand-written WGSL + WebGPU API.
2. **Do NOT add `output: 'standalone'` to `next.config.mjs`.** Leave it exactly as committed.
3. `app/page.js` must start with `"use client"`.
4. **SSR-safe**: no `window`/`document`/`navigator`/`AudioContext` access during render — only inside
   `useEffect` / handlers, guarded. The server-rendered HTML must not differ from the first client render.
5. **`app/lib/**` must be importable by plain Node/Deno ESM** (no JSX, no `next/*` imports, no DOM at
   module top level) — an external test harness imports these modules directly to verify the WGSL.
   Browser-only code lives only in the `renderer.js` files and `app/page.js`.
6. `npm run build` must pass with zero errors and zero lint errors. Run it yourself and fix everything.

## Exact module contract (implement these exports EXACTLY; the test harness depends on them)

### `app/lib/game.js` — pure game logic, no DOM
```js
export const SIZE = 4;
export function createBoard(rng = Math.random)            // -> { tiles, score: 0, moves: 0 } with 2 spawned tiles
export function spawnTile(tiles, rng = Math.random)       // -> new tiles array (2 at 90%, 4 at 10%)
export function applyMove(tiles, dir)                     // -> { tiles, ghosts, gained, moved }  dir: 'left'|'right'|'up'|'down'
export function movesAvailable(tiles)                     // -> boolean
export function tileValueAt(tiles, row, col)              // -> number|0
```
- Tile shape: `{ id, value, row, col, isNew, merged }`; `id` unique & increasing, `row`/`col` in `0..3`.
- Standard 2048 rules: slide + merge equal neighbours, **a merged tile cannot merge again in the same
  move** (`[2,2,2,2]` → `[4,4]`), only-spawn-when-the-board-changed, score += sum of merged results.
- `ghosts`: `[{ id, value, row }]`-style entries for tiles absorbed by a merge (used for the absorb flash);
  keep the shape `{ id, value, row, col }`.
- The functions must be pure (no mutation of the input array).

### `app/lib/webgpu/shaders.js` — WGSL source strings
```js
export const BACKGROUND_WGSL = /* wgsl */ `...`;
export const TILE_WGSL = /* wgsl */ `...`;
export const GLYPH_WGSL = /* wgsl */ `...`;
export const PARTICLE_WGSL = /* wgsl */ `...`;
export const UNIFORM_BYTES = 32;
```
All four shaders share one bind group layout: `@group(0) @binding(0) var<uniform> u: Uniforms;`
```wgsl
struct Uniforms {
  boardPx: vec2f,   // board width/height in CSS px  (offset 0, align 8)
  time: f32,        // seconds since start            (offset 8)
  progress: f32,    // 0..1 animation progress        (offset 12)
  cellSize: f32,    // px per cell (offset 16)
  gap: f32,         // px between cells (offset 20)
  _pad0: f32,       // 24
  _pad1: f32,       // 28
};
```
**`progress` is the key requirement: tile movement animation must be interpolated ON THE GPU** —
the vertex shader computes `position = mix(fromPos, toPos, u.progress)`. JavaScript must NOT
interpolate positions; it only advances `progress` from 0 to 1 over ~120 ms (easing may be applied to
`progress` in JS, but the pixel positions themselves come from the shader mix).

- `TILE_WGSL`: instanced rounded-rectangle tiles. Instance buffer stride **32 bytes**, attributes:
  `@location(0) from: vec2f`, `@location(1) to: vec2f`, `@location(2) value: f32`,
  `@location(3) flags: f32` (bit 0 = isNew, bit 1 = merged), `@location(4) flash: f32` (0..1 merge
  pulse), `@location(5) seed: f32` (0..1 per-tile random). Uses a unit-quad expanded from
  `@builtin(vertex_index)` (do NOT put geometry in the instance buffer); color comes from the value's
  palette (see design tokens below); rounded corners via a signed-distance rounded rect in the fragment
  shader with anti-aliased `smoothstep`; merged tiles get a scale pulse driven by `flash`.
- `GLYPH_WGSL`: the tile NUMBERS, drawn as a **5x7 pixel bitmap font implemented in WGSL** — no texture
  atlas, no canvas-generated font texture. Each digit is a `u32` bitmask (7 rows x 5 columns) selected by
  a `fn digit_rows(d: u32) -> array<u32, 7>`-style lookup; multi-digit values are laid out right-aligned
  inside the tile (up to 5 digits, e.g. 16384), each digit as a grid of small rounded squares with
  anti-aliased edges. Same instance buffer/stride as `TILE_WGSL` so both passes can share one buffer.
- `PARTICLE_WGSL`: instanced additive quads for the merge burst (max 128). Instance stride **32 bytes**:
  `@location(0) origin: vec2f`, `@location(1) velocity: vec2f`, `@location(2) age: f32`, `@location(3) size: f32`,
  `@location(4) seed: f32`, `@location(5) _pad: f32`. Position = `origin + velocity * age`, fading +
  shrinking with `age`; color = the merge palette's accent, blended additively.
- `BACKGROUND_WGSL`: fullscreen triangle (no instance buffer) drawing a subtle animated dark gradient
  behind the board, using `time`.

### `app/lib/webgpu/pipelines.js` — pure factory (no DOM)
```js
export const TILE_INSTANCE_FLOATS = 8;      // = stride 32 bytes
export const PARTICLE_INSTANCE_FLOATS = 8;
export function createPipelines(device, format)          // -> { available: true, background, tiles, glyphs, particles }
export function buildTileInstances(tiles, anim = {})     // -> Float32Array, layout: fromCol,fromRow,toCol,toRow,value,flags,flash,seed
export function buildParticleInstances(particles)        // -> Float32Array, layout: originX,originY,velX,velY,age,size,seed,0
export function tileColor(value)                         // -> [r, g, b] floats 0..1 (same palette as the CSS version)
```
- `createPipelines(device, format)` must only use `device` + `format` (no canvas), so it can run headless.
- `anim` may carry `{ from: [{row, col}], flash: Map|object }`; when absent, `from` = current position
  (progress has no visual effect) and `flash` = 0. `buildTileInstances` must be pure.

### `app/lib/webgpu/renderer.js` — browser-only glue
```js
export async function isWebGpuSupported()                 // -> Promise<{ ok: boolean, reason?: string, adapterInfo?: object }>
export async function createWebGpuRenderer(canvas)        // -> renderer { draw(frame), resize(size), destroy(), backend: 'webgpu', adapterInfo, sampleCount }
```
`draw(frame)` where `frame = { tiles, particles, boardPx, progress, time }`. Configure the canvas with
`canvas.getContext('webgpu')`, `format = navigator.gpu.getPreferredCanvasFormat()`, `alphaMode: 'premultiplied'`.
Use MSAA (`sampleCount: 4` when `device.limits` allow it, else 1) for smooth rounded corners, and
handle `device.lost` by surfacing an error so the app can fall back.

### `app/lib/canvas2d/renderer.js` — fallback (identical surface)
```js
export function createCanvas2dRenderer(canvas)            // -> renderer { draw(frame), resize(size), destroy(), backend: 'canvas2d' }
```
Draws the same frame with Canvas 2D: rounded-rect tiles, pixel-font digits (same 5x7 bitmaps), the
same palette, the merge flashes and the particles. It must be visually equivalent (same layout,
colours, animation timing) — this is what most browsers without WebGPU will see.

## App behaviour (keep the proven UX from the DOM version)

- Rules/UX identical to the DOM version: arrows / WASD / HJKL, `R` new game, `Z`/`Ctrl+Z` undo (20 steps),
  touch swipe + pointer drag, score / best (localStorage `nrapken2048w.best`) / moves, win overlay at
  2048 with "Lanjut main", game-over overlay with score submit, leaderboard panel (`/api/scores`),
  "Cara main" hints, sound toggle (Web Audio blips, localStorage `nrapken2048w.sound`, default on).
- Only the **board is a canvas**; the header/hud/buttons/overlays stay DOM (React) so the game stays
  usable and testable.
- **Renderer badge** (must be a DOM element with `data-testid="renderer-badge"`): shows
  `WebGPU` when the WebGPU renderer is active, `Canvas 2D (fallback)` when it is not, plus a short
  reason when WebGPU failed. A **toggle button** (`data-testid="renderer-toggle"`) switches backends
  manually and persists the choice in `localStorage` key `nrapken2048w.renderer` (`auto` | `webgpu` | `canvas2d`).
  In `auto` mode: use WebGPU when available, else Canvas 2D. A user-forced WebGPU that fails must fall
  back to Canvas 2D with the reason shown, never a blank board.
- Also show the adapter info (vendor/architecture) in the badge tooltip area when WebGPU is live.
- Never let a GPU error break the game: wrap device creation and `draw()` in try/catch; on `device.lost`
  or a lost context, switch to Canvas 2D and keep the game state.

## Design (dark, GPU-showcase, nrapkén brand)

- Page background `#0B0B10`; the canvas board has its own animated dark gradient (near-black with a
  subtle radial glow), tray `#14141C`, empty cells `#1D1D26`.
- Brand accent **`#FF4B07`** (orange) for the title, primary buttons, focus ring and the merge bursts;
  a secondary cool accent **`#2E86FF`** may be used sparingly in the background gradient only.
- Tile palette (same values as the DOM version, must be mirrored in `tileColor()`):
  `2 #EDE7DE` · `4 #E6D9C3` · `8 #F2B179` · `16 #F59563` · `32 #F67C5F` · `64 #F65E3B` · `128 #FF4B07` ·
  `256 #EF3F00` · `512 #D63700` · `1024 #F5C518` · `2048 #FFD54A` · above 2048 `#12121A` with `#FF4B07` text.
  Digit color: dark `#2B2118` on the light tiles (2/4/8/16) and `#FFFFFF` on the rest (the DOM version's
  contrast rule — replicate it in both renderers).
- Layout: header (title `2048` + `WebGPU` tag + subtitle) → stats row → canvas board (square,
  `min(92vw, 46vh, 460px)`) → controls → sidebar (renderer badge panel, leaderboard, hints) → footer
  `Dibuat dengan AI · Deploy di nrapkén.dev` linking to https://nrapken.dev. Responsive 320px → desktop,
  no horizontal scroll. Dark theme only. No emoji in UI copy.

## API routes
- `app/api/health/route.js` → `{ ok: true, app: "game-2048-webgpu", version: "1.0.0", renderer: "webgpu+canvas2d" }`
- `app/api/scores/route.js` → identical contract to the DOM version (GET top 10 / POST `{name, score}` →
  `{ok, rank}`, 400 on invalid, in-memory module-level array, max 50 entries).
- `app/opengraph-image.js` → `ImageResponse` from `next/og`, 1200x630: dark `#0B0B10`, big `2048` wordmark
  in `#FF4B07`, a small `WebGPU` chip in `#2E86FF`, subtitle "Gabung angka, capai 2048.", footer "nrapkén.dev".
  No external fonts, no network fetch.
- `app/layout.js` → `metadata` with `metadataBase: new URL("https://game-2048-webgpu.quick.nrapken.dev")`,
  title `2048 WebGPU — nrapkén`, description, openGraph + twitter card entries, `viewport` export,
  imports `./globals.css`.

## Quality bar
- No `console.log` in shipped code.
- `npm run build` clean; then `npx next start -p 3101 &`, curl `/`, `/api/health`, `POST /api/scores`
  (expect `ok: true`), `GET /api/scores`, and confirm `/` renders the board canvas element +
  `data-testid="renderer-badge"`. Then kill the server with `fuser -k 3101/tcp` — **never** `pkill -f "next start"`
  (it kills your own shell).
- IMPORTANT: on this machine the headless browser has no WebGPU adapter, so the live page will show the
  Canvas 2D fallback — that is expected and correct. Do not "fix" it by faking WebGPU.
- Write `BRIEF.md`-compliant code, then self-review the WGSL for type errors (naga is strict: use explicit
  `f32(...)` casts, avoid `vecNf` mixing with literals of the wrong type, no unsupported builtins).
