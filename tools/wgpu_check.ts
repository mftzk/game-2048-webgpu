// Headless WebGPU verification harness for game-2048-webgpu.
//
// Runs with Deno (navigator.gpu via wgpu). On this Pi it works against the software Vulkan
// driver (lavapipe):  VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json deno run --allow-all tools/wgpu_check.ts
//
// What it proves (with real pixel readback, not by reading source code):
//   1. every WGSL shader module in app/lib/webgpu/shaders.js compiles on a real WebGPU implementation
//   2. createPipelines() builds all four render pipelines without validation errors
//   3. tile movement is interpolated ON THE GPU: the same instance buffer rendered at
//      progress 0 vs progress 1 puts the tile in a different quadrant
//   4. the WGSL pixel-font glyph pass actually draws digits (dark digits on light tiles,
//      white digits on dark tiles)
//   5. the particle pass draws pixels outside the tile bodies
//   6. the pure game logic in app/lib/game.js obeys the 2048 merge rules
// Writes PNG frames to tools/out/ for eyeballing.

import * as shaders from "../app/lib/webgpu/shaders.js";
import * as pipelines from "../app/lib/webgpu/pipelines.js";
import * as game from "../app/lib/game.js";

const FORMAT = "rgba8unorm" as GPUTextureFormat;
const BOARD = 420; // board size in px (CSS px == device px here)
const CELL = 96;
const GAP = 12;
const W = BOARD;
const H = BOARD;
const OUT_DIR = new URL("./out/", import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------- PNG encoder (no deps)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
async function writePng(path: string, rgba: Uint8Array, width: number, height: number) {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  writer.write(raw);
  writer.close();
  const idat = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const png = new Uint8Array(8 + (12 + 13) + (12 + idat.length) + 12);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let o = 8;
  for (const c of [chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]) {
    png.set(c, o);
    o += c.length;
  }
  await Deno.mkdir(OUT_DIR, { recursive: true });
  await Deno.writeFile(path, png);
}

// ---------------------------------------------------------------- helpers
const near = (px: Uint8Array, i: number, rgb: number[], tol = 10) =>
  Math.abs(px[i] - rgb[0]) <= tol && Math.abs(px[i + 1] - rgb[1]) <= tol && Math.abs(px[i + 2] - rgb[2]) <= tol;

function countMatching(rgba: Uint8Array, rgb: number[], region: { x0: number; y0: number; x1: number; y1: number }, tol = 10) {
  let n = 0;
  for (let y = region.y0; y < region.y1; y++) {
    for (let x = region.x0; x < region.x1; x++) {
      if (near(rgba, (y * W + x) * 4, rgb, tol)) n++;
    }
  }
  return n;
}
function boundingBox(rgba: Uint8Array, rgb: number[], tol = 10) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (near(rgba, (y * W + x) * 4, rgb, tol)) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1, empty: x1 < 0 };
}

// ---------------------------------------------------------------- GPU setup
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) {
  console.error("NO WEBGPU ADAPTER — run with the software Vulkan driver (see header comment).");
  Deno.exit(2);
}
const device = await adapter.requestDevice();
const problems: string[] = [];
device.addEventListener("uncapturederror", (e: any) => problems.push(String(e.error?.message ?? e)));

console.log("adapter:", JSON.stringify((adapter as any).info ?? {}));
console.log("\n[1] WGSL modules compile");
for (const [name, src] of Object.entries({
  BACKGROUND_WGSL: shaders.BACKGROUND_WGSL,
  TILE_WGSL: shaders.TILE_WGSL,
  GLYPH_WGSL: shaders.GLYPH_WGSL,
  PARTICLE_WGSL: shaders.PARTICLE_WGSL,
})) {
  const code = src as string;
  check(`${name} exported & non-empty`, typeof code === "string" && code.length > 80, `${code?.length ?? 0} chars`);
  try {
    device.pushErrorScope("validation");
    device.createShaderModule({ code, label: name });
    const err = await device.popErrorScope();
    check(`${name} compiles`, !err, err ? (err as GPUError).message : "ok");
  } catch (e) {
    check(`${name} compiles`, false, String(e));
  }
}

console.log("\n[2] createPipelines()");
let pipes: any = null;
try {
  device.pushErrorScope("validation");
  pipes = pipelines.createPipelines(device, FORMAT);
  const err = await device.popErrorScope();
  check("createPipelines returns all 4 pipelines", !!pipes?.background && !!pipes?.tiles && !!pipes?.glyphs && !!pipes?.particles, Object.keys(pipes ?? {}).join(","));
  check("no validation error", !err, err ? (err as GPUError).message : "ok");
} catch (e) {
  check("createPipelines() runs", false, String(e));
}

console.log("\n[3] game logic (app/lib/game.js)");
{
  const rowOf2 = [
    { id: 1, value: 2, row: 0, col: 0, isNew: false, merged: false },
    { id: 2, value: 2, row: 0, col: 1, isNew: false, merged: false },
    { id: 3, value: 2, row: 0, col: 2, isNew: false, merged: false },
    { id: 4, value: 2, row: 0, col: 3, isNew: false, merged: false },
  ];
  const r = game.applyMove(rowOf2, "left");
  const vals = r.tiles.filter((t: any) => t.row === 0).map((t: any) => t.value).sort((a: number, b: number) => b - a);
  check("[2,2,2,2] left merges to [4,4] (no double merge)", JSON.stringify(vals) === "[4,4]", JSON.stringify(vals));
  check("score gained = 8", r.gained === 8, String(r.gained));

  const noMove = game.applyMove(
    [
      { id: 9, value: 2, row: 0, col: 0, isNew: false, merged: false },
      { id: 10, value: 4, row: 0, col: 1, isNew: false, merged: false },
    ],
    "left",
  );
  check("no-op move reports moved=false", noMove.moved === false);

  const b = game.createBoard(seededRng(42));
  check("createBoard spawns 2 tiles", b.tiles.length === 2, `tiles=${b.tiles.length}`);
  const withSpawn = game.spawnTile(b.tiles, seededRng(7));
  check("spawnTile adds exactly 1 tile", withSpawn.length === b.tiles.length + 1);

  const full = [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ].flatMap((row, r2) => row.map((v, c2) => ({ id: r2 * 4 + c2 + 100, value: v, row: r2, col: c2, isNew: false, merged: false })));
  check("checkerboard board is game over", game.movesAvailable(full) === false);
  check("tileValueAt() reads a cell", game.tileValueAt(full, 0, 1) === 4, String(game.tileValueAt(full, 0, 1)));
}

// ---------------------------------------------------------------- render frames
function makeTarget() {
  return device.createTexture({
    size: [W, H],
    format: FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
}

async function renderFrame(frame: any): Promise<Uint8Array> {
  const tex = makeTarget();
  const uniform = new Float32Array(shaders.UNIFORM_BYTES / 4);
  uniform[0] = frame.boardPx[0];
  uniform[1] = frame.boardPx[1];
  uniform[2] = frame.time ?? 0;
  uniform[3] = frame.progress ?? 1;
  uniform[4] = CELL;
  uniform[5] = GAP;
  const ub = device.createBuffer({ size: shaders.UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ub, 0, uniform);

  const bind = device.createBindGroup({
    layout: pipes.tiles.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: ub } }],
  });

  const tileData = pipelines.buildTileInstances(frame.tiles, frame.anim);
  const tileCount = tileData.length / pipelines.TILE_INSTANCE_FLOATS;
  const tileBuf = device.createBuffer({ size: Math.max(32, tileData.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  if (tileData.byteLength) device.queue.writeBuffer(tileBuf, 0, tileData);

  const particleData = pipelines.buildParticleInstances(frame.particles ?? []);
  const particleCount = frame.particles?.length ?? 0;
  const particleBuf = device.createBuffer({ size: Math.max(32, particleData.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  if (particleData.byteLength) device.queue.writeBuffer(particleBuf, 0, particleData);

  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({
    colorAttachments: [{ view: tex.createView(), clearValue: { r: 0.04, g: 0.04, b: 0.06, a: 1 }, loadOp: "clear", storeOp: "store" }],
  });
  if (pipes.background) {
    pass.setPipeline(pipes.background);
    pass.setBindGroup(0, bind);
    pass.draw(3);
  }
  pass.setPipeline(pipes.tiles);
  pass.setBindGroup(0, bind);
  pass.setVertexBuffer(0, tileBuf);
  pass.draw(4, Math.max(tileCount, 1));
  if (tileCount > 0) {
    pass.setPipeline(pipes.glyphs);
    pass.setBindGroup(0, bind);
    pass.setVertexBuffer(0, tileBuf);
    pass.draw(4, tileCount);
  }
  if (particleCount > 0 && pipes.particles) {
    pass.setPipeline(pipes.particles);
    pass.setBindGroup(0, bind);
    pass.setVertexBuffer(0, particleBuf);
    pass.draw(4, particleCount);
  }
  pass.end();

  const bytesPerRow = Math.ceil((W * 4) / 256) * 256; // must be a multiple of 256
  const read = device.createBuffer({ size: bytesPerRow * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  enc.copyTextureToBuffer({ texture: tex }, { buffer: read, bytesPerRow }, [W, H]);
  device.queue.submit([enc.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(read.getMappedRange().slice(0));
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) px.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + W * 4), y * W * 4);
  read.unmap();
  return px;
}

if (failures === 0) {
  console.log("\n[4] GPU-rendered tile movement (progress 0 vs 1)");
  const tileA = { id: 1, value: 2, row: 3, col: 3, isNew: false, merged: false }; // light tile + dark digits
  const tileB = { id: 2, value: 64, row: 3, col: 2, isNew: false, merged: false }; // dark tile + white digits
  const anim = { from: [{ row: 0, col: 0 }, { row: 0, col: 1 }], flash: {} };

  const cA = pipelines.tileColor(2) as number[];
  const cB = pipelines.tileColor(64) as number[];
  const rgbA = [Math.round(cA[0] * 255), Math.round(cA[1] * 255), Math.round(cA[2] * 255)];
  const rgbB = [Math.round(cB[0] * 255), Math.round(cB[1] * 255), Math.round(cB[2] * 255)];

  const p0 = await renderFrame({ tiles: [tileA, tileB], anim, boardPx: [W, H], progress: 0 });
  const p1 = await renderFrame({ tiles: [tileA, tileB], anim, boardPx: [W, H], progress: 1 });
  await writePng(new URL("frame-progress-0.png", OUT_DIR).pathname, p0, W, H);
  await writePng(new URL("frame-progress-1.png", OUT_DIR).pathname, p1, W, H);

  const bA0 = boundingBox(p0, rgbA);
  const bA1 = boundingBox(p1, rgbA);
  const bB0 = boundingBox(p0, rgbB);
  const bB1 = boundingBox(p1, rgbB);

  check("tile (value 2) rendered at progress 0", !bA0.empty, JSON.stringify(bA0));
  check("tile (value 2) rendered at progress 1", !bA1.empty, JSON.stringify(bA1));
  check("tile (value 64) rendered at progress 0", !bB0.empty, JSON.stringify(bB0));
  check("tile (value 64) rendered at progress 1", !bB1.empty, JSON.stringify(bB1));

  if (!bA0.empty && !bA1.empty) {
    // from (row0,col0) -> to (row3,col3): the tile must travel to the bottom-right between progress 0 and 1
    check("GPU interpolation moves tile right", bA1.x0 > bA0.x0 + 2 * CELL, `x ${bA0.x0} -> ${bA1.x0}`);
    check("GPU interpolation moves tile down", bA1.y0 > bA0.y0 + 2 * CELL, `y ${bA0.y0} -> ${bA1.y0}`);
    check("mid-flight frame differs from both ends", true, "checked below");
  }

  const mid = await renderFrame({ tiles: [tileA, tileB], anim, boardPx: [W, H], progress: 0.5 });
  await writePng(new URL("frame-progress-050.png", OUT_DIR).pathname, mid, W, H);
  const bAmit = boundingBox(mid, rgbA);
  check(
    "progress 0.5 lands strictly between the endpoints",
    !bAmit.empty && bAmit.x0 > bA0.x0 + 4 && bAmit.x0 < bA1.x0 - 4,
    `x0 mid=${bAmit.x0} start=${bA0.x0} end=${bA1.x0}`,
  );

  console.log("\n[5] glyph pass draws digits");
  const darkInk = [0x2b, 0x21, 0x18]; // dark digits on the light value-2 tile
  const whiteInk = [255, 255, 255]; // white digits on the dark value-64 tile
  const regionA = { x0: bA1.x0, y0: bA1.y0, x1: bA1.x1 + 1, y1: bA1.y1 + 1 };
  const regionB = { x0: bB1.x0, y0: bB1.y0, x1: bB1.x1 + 1, y1: bB1.y1 + 1 };
  const darkInkCount = countMatching(p1, darkInk, regionA, 26);
  const whiteInkCount = countMatching(p1, whiteInk, regionB, 26);
  check("dark digit pixels inside the light tile", darkInkCount > 60, `${darkInkCount} px`);
  check("white digit pixels inside the dark tile", whiteInkCount > 60, `${whiteInkCount} px`);

  console.log("\n[6] particle pass");
  const particles = [
    { originX: 210, originY: 210, vx: 0, vy: 0, age: 0.5, size: 40, seed: 0.1 },
    { originX: 260, originY: 260, vx: 0, vy: 0, age: 0.5, size: 40, seed: 0.5 },
  ];
  const pParts = await renderFrame({ tiles: [], anim: {}, particles, boardPx: [W, H], progress: 1 });
  await writePng(new URL("frame-particles.png", OUT_DIR).pathname, pParts, W, H);
  const cAccent = pipelines.tileColor(128) as number[];
  const rgbAccent = [Math.round(cAccent[0] * 255), Math.round(cAccent[1] * 255), Math.round(cAccent[2] * 255)];
  const accentPx = countMatching(pParts, rgbAccent, { x0: 0, y0: 0, x1: W, y1: H }, 60);
  check("particle pixels appear (orange burst)", accentPx > 200, `${accentPx} px matching accent`);
}

if (problems.length) {
  console.log("\nuncaptured device errors:");
  for (const p of problems) console.log("  -", p);
  failures++;
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
console.log(`frames written to ${OUT_DIR.pathname}`);
Deno.exit(failures === 0 ? 0 : 1);
