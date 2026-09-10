// WGSL sources for the 2048 WebGPU renderer.
// All four pipelines share one bind group layout: @group(0) @binding(0) uniform.

export const UNIFORM_BYTES = 32;

const UNIFORMS = /* wgsl */ `
struct Uniforms {
  boardPx: vec2f,
  time: f32,
  progress: f32,
  cellSize: f32,
  gap: f32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
`;

const PALETTE = /* wgsl */ `
fn palette(v: f32) -> vec3f {
  if (v < 3.0) { return vec3f(0.9294, 0.9059, 0.8706); }
  if (v < 6.0) { return vec3f(0.9020, 0.8510, 0.7647); }
  if (v < 12.0) { return vec3f(0.9490, 0.6941, 0.4745); }
  if (v < 24.0) { return vec3f(0.9608, 0.5843, 0.3882); }
  if (v < 48.0) { return vec3f(0.9647, 0.4863, 0.3725); }
  if (v < 96.0) { return vec3f(0.9647, 0.3686, 0.2314); }
  if (v < 192.0) { return vec3f(1.0, 0.2941, 0.0275); }
  if (v < 384.0) { return vec3f(0.9373, 0.2471, 0.0); }
  if (v < 768.0) { return vec3f(0.8392, 0.2157, 0.0); }
  if (v < 1536.0) { return vec3f(0.9608, 0.7725, 0.0941); }
  if (v < 3072.0) { return vec3f(1.0, 0.8353, 0.2902); }
  return vec3f(0.0706, 0.0706, 0.1020);
}
`;

const QUAD = /* wgsl */ `
fn quad_corner(i: u32) -> vec2f {
  if (i == 0u) { return vec2f(0.0, 0.0); }
  if (i == 1u) { return vec2f(1.0, 0.0); }
  if (i == 2u) { return vec2f(0.0, 1.0); }
  return vec2f(1.0, 1.0);
}
`;

const TILE_STRUCT = /* wgsl */ `
struct TileIn {
  @location(0) fromPos: vec2f,
  @location(1) toPos: vec2f,
  @location(2) value: f32,
  @location(3) flags: f32,
  @location(4) flash: f32,
  @location(5) seed: f32,
};
`;

export const BACKGROUND_WGSL = /* wgsl */ `
${UNIFORMS}

fn rrect(p: vec2f, c: vec2f, half: vec2f, r: f32) -> f32 {
  let q = abs(p - c) - (half - vec2f(r, r));
  return length(max(q, vec2f(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = vec2f(-1.0, -1.0);
  if (vi == 1u) { p = vec2f(3.0, -1.0); }
  if (vi == 2u) { p = vec2f(-1.0, 3.0); }
  return vec4f(p, 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let px = frag.xy;
  let uv = px / max(u.boardPx, vec2f(1.0, 1.0));
  var tray = vec3f(0.0784, 0.0784, 0.1098);
  let glow = exp(-length(uv - vec2f(0.5, 0.42)) * 2.6);
  tray = tray + vec3f(0.34, 0.19, 0.04) * glow * 0.35;
  let glow2 = exp(-length(uv - vec2f(0.88, 0.94)) * 3.2);
  tray = tray + vec3f(0.02, 0.08, 0.22) * glow2 * 0.4;
  let band = 0.5 + 0.5 * sin((uv.x + uv.y) * 6.2831 + u.time * 0.25);
  tray = tray + vec3f(0.018, 0.018, 0.03) * band;

  let trayD = rrect(px, u.boardPx * 0.5, u.boardPx * 0.5, u.cellSize * 0.15);
  let trayAA = fwidth(trayD) + 0.001;
  let trayA = 1.0 - smoothstep(-trayAA, trayAA, trayD);
  var col = mix(vec3f(0.0431, 0.0431, 0.0627), tray, trayA);

  let step = u.cellSize + u.gap;
  for (var r = 0u; r < 4u; r = r + 1u) {
    for (var c = 0u; c < 4u; c = c + 1u) {
      let cx = u.gap + f32(c) * step + u.cellSize * 0.5;
      let cy = u.gap + f32(r) * step + u.cellSize * 0.5;
      let d = rrect(px, vec2f(cx, cy), vec2f(u.cellSize * 0.5, u.cellSize * 0.5), u.cellSize * 0.17);
      let aa = fwidth(d) + 0.001;
      let a = 1.0 - smoothstep(-aa, aa, d);
      col = mix(col, vec3f(0.1137, 0.1137, 0.149), a);
    }
  }
  return vec4f(col, 1.0);
}
`;

export const TILE_WGSL = /* wgsl */ `
${UNIFORMS}
${PALETTE}
${QUAD}
${TILE_STRUCT}

struct TileOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) value: f32,
  @location(2) flags: f32,
  @location(3) flash: f32,
  @location(4) seed: f32,
};

@vertex
fn vs_main(in: TileIn, @builtin(vertex_index) vi: u32) -> TileOut {
  var out: TileOut;
  let step = u.cellSize + u.gap;
  let fromPx = vec2f(u.gap + in.fromPos.x * step, u.gap + in.fromPos.y * step);
  let toPx = vec2f(u.gap + in.toPos.x * step, u.gap + in.toPos.y * step);
  let origin = mix(fromPx, toPx, u.progress);
  let corner = quad_corner(vi);
  let isMerged = (u32(in.flags) & 2u) != 0u;
  let pulse = select(1.0, 1.0 + 0.14 * in.flash, isMerged);
  let size = u.cellSize * pulse;
  let inset = (u.cellSize - size) * 0.5;
  let px = origin + vec2f(inset, inset) + corner * size;
  out.pos = vec4f(
    px.x / max(u.boardPx.x, 1.0) * 2.0 - 1.0,
    1.0 - px.y / max(u.boardPx.y, 1.0) * 2.0,
    0.0,
    1.0,
  );
  out.uv = corner;
  out.value = in.value;
  out.flags = in.flags;
  out.flash = in.flash;
  out.seed = in.seed;
  return out;
}

@fragment
fn fs_main(in: TileOut) -> @location(0) vec4f {
  let p = in.uv * 2.0 - vec2f(1.0, 1.0);
  let r = 0.34;
  let q = abs(p) - (vec2f(1.0, 1.0) - vec2f(r, r));
  let dist = length(max(q, vec2f(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r;
  let aa = fwidth(dist) + 0.001;
  let alpha = 1.0 - smoothstep(-aa, aa, dist);
  if (alpha <= 0.0) { discard; }
  var col = palette(in.value);
  let isMerged = (u32(in.flags) & 2u) != 0u;
  if (isMerged) {
    col = mix(col, vec3f(1.0, 0.96, 0.9), clamp(in.flash, 0.0, 1.0) * 0.55);
  }
  return vec4f(col, alpha);
}
`;

export const GLYPH_WGSL = /* wgsl */ `
${UNIFORMS}
${QUAD}
${TILE_STRUCT}

struct GlyphOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) value: f32,
  @location(2) flags: f32,
};

fn digit_rows(d: u32) -> array<u32, 7> {
  if (d == 0u) { return array<u32, 7>(0x0Eu, 0x11u, 0x13u, 0x15u, 0x19u, 0x11u, 0x0Eu); }
  if (d == 1u) { return array<u32, 7>(0x04u, 0x0Cu, 0x04u, 0x04u, 0x04u, 0x04u, 0x0Eu); }
  if (d == 2u) { return array<u32, 7>(0x0Eu, 0x11u, 0x01u, 0x02u, 0x04u, 0x08u, 0x1Fu); }
  if (d == 3u) { return array<u32, 7>(0x1Fu, 0x02u, 0x04u, 0x02u, 0x01u, 0x11u, 0x0Eu); }
  if (d == 4u) { return array<u32, 7>(0x02u, 0x06u, 0x0Au, 0x12u, 0x1Fu, 0x02u, 0x02u); }
  if (d == 5u) { return array<u32, 7>(0x1Fu, 0x10u, 0x1Eu, 0x01u, 0x01u, 0x11u, 0x0Eu); }
  if (d == 6u) { return array<u32, 7>(0x06u, 0x08u, 0x10u, 0x1Eu, 0x11u, 0x11u, 0x0Eu); }
  if (d == 7u) { return array<u32, 7>(0x1Fu, 0x01u, 0x02u, 0x04u, 0x08u, 0x08u, 0x08u); }
  if (d == 8u) { return array<u32, 7>(0x0Eu, 0x11u, 0x11u, 0x0Eu, 0x11u, 0x11u, 0x0Eu); }
  return array<u32, 7>(0x0Eu, 0x11u, 0x11u, 0x0Fu, 0x01u, 0x02u, 0x0Cu);
}

fn digit_count(v: u32) -> u32 {
  if (v >= 100000u) { return 6u; }
  if (v >= 10000u) { return 5u; }
  if (v >= 1000u) { return 4u; }
  if (v >= 100u) { return 3u; }
  if (v >= 10u) { return 2u; }
  return 1u;
}

fn pow10(n: u32) -> u32 {
  var r = 1u;
  for (var i = 0u; i < n; i = i + 1u) { r = r * 10u; }
  return r;
}

@vertex
fn vs_main(in: TileIn, @builtin(vertex_index) vi: u32) -> GlyphOut {
  var out: GlyphOut;
  let step = u.cellSize + u.gap;
  let fromPx = vec2f(u.gap + in.fromPos.x * step, u.gap + in.fromPos.y * step);
  let toPx = vec2f(u.gap + in.toPos.x * step, u.gap + in.toPos.y * step);
  let origin = mix(fromPx, toPx, u.progress);
  let corner = quad_corner(vi);
  let px = origin + corner * u.cellSize;
  out.pos = vec4f(
    px.x / max(u.boardPx.x, 1.0) * 2.0 - 1.0,
    1.0 - px.y / max(u.boardPx.y, 1.0) * 2.0,
    0.0,
    1.0,
  );
  out.local = corner * u.cellSize;
  out.value = in.value;
  out.flags = in.flags;
  return out;
}

@fragment
fn fs_main(in: GlyphOut) -> @location(0) vec4f {
  let v = u32(in.value + 0.5);
  let n = digit_count(v);
  let nf = f32(n);
  let availW = u.cellSize * 0.82;
  let availH = u.cellSize * 0.52;
  let totalUnitsW = nf * 6.0 - 1.0;
  let unit = min(availH / 7.0, availW / totalUnitsW);
  let totalW = unit * totalUnitsW;
  let totalH = unit * 7.0;
  let rel = in.local - vec2f((u.cellSize - totalW) * 0.5, (u.cellSize - totalH) * 0.5);
  if (rel.x < 0.0 || rel.y < 0.0 || rel.x >= totalW || rel.y >= totalH) { discard; }
  let pitch = unit * 6.0;
  let di = floor(rel.x / pitch);
  let withinX = rel.x - di * pitch;
  if (withinX >= unit * 5.0) { discard; }
  let col = floor(withinX / unit);
  let row = floor(rel.y / unit);
  let rowi = u32(row);
  let coli = u32(col);
  if (rowi > 6u || coli > 4u) { discard; }
  let place = nf - 1.0 - di;
  let divisor = pow10(u32(place));
  let digit = (v / divisor) % 10u;
  var rows = digit_rows(digit);
  let bits = rows[rowi];
  let colBit = 4u - coli;
  if (((bits >> colBit) & 1u) == 0u) { discard; }
  let fx = withinX / unit - col;
  let fy = rel.y / unit - row;
  let cp = abs(vec2f(fx, fy) * 2.0 - vec2f(1.0, 1.0));
  let rr = 0.34;
  let q = cp - (vec2f(1.0, 1.0) - vec2f(rr, rr));
  let dist = length(max(q, vec2f(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - rr;
  let aa = 1.0 / unit;
  let cov = 1.0 - smoothstep(-aa, aa, dist);
  if (cov <= 0.0) { discard; }
  let ink = select(vec3f(1.0, 1.0, 1.0), vec3f(0.1686, 0.1294, 0.0941), in.value <= 16.0);
  return vec4f(ink, cov);
}
`;

export const PARTICLE_WGSL = /* wgsl */ `
${UNIFORMS}
${QUAD}

struct ParticleIn {
  @location(0) origin: vec2f,
  @location(1) velocity: vec2f,
  @location(2) age: f32,
  @location(3) size: f32,
  @location(4) seed: f32,
  @location(5) _pad: f32,
};

struct ParticleOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) age: f32,
  @location(2) seed: f32,
};

@vertex
fn vs_main(in: ParticleIn, @builtin(vertex_index) vi: u32) -> ParticleOut {
  var out: ParticleOut;
  let corner = quad_corner(vi) - vec2f(0.5, 0.5);
  let life = clamp(in.age, 0.0, 1.0);
  let pos = in.origin + in.velocity * in.age;
  let half = in.size * (1.0 - life * 0.65) * 0.5;
  let px = pos + corner * half;
  out.pos = vec4f(
    px.x / max(u.boardPx.x, 1.0) * 2.0 - 1.0,
    1.0 - px.y / max(u.boardPx.y, 1.0) * 2.0,
    0.0,
    1.0,
  );
  out.uv = quad_corner(vi);
  out.age = in.age;
  out.seed = in.seed;
  return out;
}

@fragment
fn fs_main(in: ParticleOut) -> @location(0) vec4f {
  let r = length(in.uv - vec2f(0.5, 0.5)) * 2.0;
  if (r > 1.0) { discard; }
  let life = clamp(in.age, 0.0, 1.0);
  let edge = 1.0 - smoothstep(0.72, 1.0, r);
  let fade = 1.0 - life * 0.5;
  let a = edge * fade;
  if (a <= 0.0) { discard; }
  return vec4f(1.0, 0.2941, 0.0275, a);
}
`;
