import {
  BACKGROUND_WGSL,
  TILE_WGSL,
  GLYPH_WGSL,
  PARTICLE_WGSL,
} from "./shaders.js";

export const TILE_INSTANCE_FLOATS = 8;
export const PARTICLE_INSTANCE_FLOATS = 8;

const TILE_LAYOUT = {
  arrayStride: 32,
  stepMode: "instance",
  attributes: [
    { shaderLocation: 0, offset: 0, format: "float32x2" },
    { shaderLocation: 1, offset: 8, format: "float32x2" },
    { shaderLocation: 2, offset: 16, format: "float32" },
    { shaderLocation: 3, offset: 20, format: "float32" },
    { shaderLocation: 4, offset: 24, format: "float32" },
    { shaderLocation: 5, offset: 28, format: "float32" },
  ],
};

const PARTICLE_LAYOUT = {
  arrayStride: 32,
  stepMode: "instance",
  attributes: [
    { shaderLocation: 0, offset: 0, format: "float32x2" },
    { shaderLocation: 1, offset: 8, format: "float32x2" },
    { shaderLocation: 2, offset: 16, format: "float32" },
    { shaderLocation: 3, offset: 20, format: "float32" },
    { shaderLocation: 4, offset: 24, format: "float32" },
    { shaderLocation: 5, offset: 28, format: "float32" },
  ],
};

const ALPHA_BLEND = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

const ADDITIVE_BLEND = {
  color: { srcFactor: "one", dstFactor: "one", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
};

export function createPipelines(device, format, sampleCount = 1) {
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });

  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const multisample = { count: sampleCount };

  function pipeline(code, vertexBuffers, blend) {
    const module = device.createShaderModule({ code });
    return device.createRenderPipeline({
      layout,
      vertex: { module, entryPoint: "vs_main", buffers: vertexBuffers },
      fragment: { module, entryPoint: "fs_main", targets: [{ format, blend }] },
      primitive: { topology: "triangle-strip" },
      multisample,
    });
  }

  const background = pipeline(BACKGROUND_WGSL, [], undefined);
  const tiles = pipeline(TILE_WGSL, [TILE_LAYOUT], ALPHA_BLEND);
  const glyphs = pipeline(GLYPH_WGSL, [TILE_LAYOUT], ALPHA_BLEND);
  const particles = pipeline(PARTICLE_WGSL, [PARTICLE_LAYOUT], ADDITIVE_BLEND);

  return { available: true, background, tiles, glyphs, particles, bindGroupLayout };
}

const PALETTE = {
  2: [0.9294, 0.9059, 0.8706],
  4: [0.902, 0.851, 0.7647],
  8: [0.949, 0.6941, 0.4745],
  16: [0.9608, 0.5843, 0.3882],
  32: [0.9647, 0.4863, 0.3725],
  64: [0.9647, 0.3686, 0.2314],
  128: [1.0, 0.2941, 0.0275],
  256: [0.9373, 0.2471, 0.0],
  512: [0.8392, 0.2157, 0.0],
  1024: [0.9608, 0.7725, 0.0941],
  2048: [1.0, 0.8353, 0.2902],
};

export function tileColor(value) {
  if (PALETTE[value]) return PALETTE[value].slice();
  return [0.0706, 0.0706, 0.102];
}

function seedFor(id) {
  const x = Math.sin(id * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function buildTileInstances(tiles, anim = {}) {
  const list = tiles ?? [];
  const from = anim && anim.from ? anim.from : null;
  const flash = anim && anim.flash ? anim.flash : null;
  const out = new Float32Array(list.length * TILE_INSTANCE_FLOATS);
  for (let i = 0; i < list.length; i += 1) {
    const tile = list[i];
    const o = i * TILE_INSTANCE_FLOATS;
    const start = from && from[i] ? from[i] : { row: tile.row, col: tile.col };
    out[o + 0] = start.col;
    out[o + 1] = start.row;
    out[o + 2] = tile.col;
    out[o + 3] = tile.row;
    out[o + 4] = tile.value;
    let flags = 0;
    if (tile.isNew) flags |= 1;
    if (tile.merged) flags |= 2;
    out[o + 5] = flags;
    let pulse = 0;
    if (flash) {
      pulse = typeof flash.get === "function" ? flash.get(tile.id) : flash[tile.id];
      if (pulse == null) pulse = 0;
    }
    out[o + 6] = pulse;
    out[o + 7] = seedFor(tile.id);
  }
  return out;
}

export function buildParticleInstances(particles) {
  const list = particles ?? [];
  const out = new Float32Array(list.length * PARTICLE_INSTANCE_FLOATS);
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    const o = i * PARTICLE_INSTANCE_FLOATS;
    out[o + 0] = p.originX != null ? p.originX : p.x != null ? p.x : 0;
    out[o + 1] = p.originY != null ? p.originY : p.y != null ? p.y : 0;
    out[o + 2] = p.vx != null ? p.vx : 0;
    out[o + 3] = p.vy != null ? p.vy : 0;
    out[o + 4] = p.age != null ? p.age : 0;
    out[o + 5] = p.size != null ? p.size : 8;
    out[o + 6] = p.seed != null ? p.seed : 0.5;
    out[o + 7] = 0;
  }
  return out;
}
