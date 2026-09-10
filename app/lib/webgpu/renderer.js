import { createPipelines, buildTileInstances, buildParticleInstances } from "./pipelines.js";
import { UNIFORM_BYTES } from "./shaders.js";

function layoutFor(px, gapRatio = 0.03) {
  const gap = px * gapRatio;
  const cellSize = Math.max(1, (px - gap * 5) / 4);
  return { gap, cellSize };
}

export async function isWebGpuSupported() {
  if (typeof navigator === "undefined" || !navigator.gpu) {
    return { ok: false, reason: "WebGPU tidak didukung browser ini" };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: "Tidak ada adapter WebGPU" };
    const adapterInfo = adapter.info ? { ...adapter.info } : {};
    if (!adapterInfo.vendor && !adapterInfo.architecture) {
      adapterInfo.vendor = adapterInfo.vendor || "unknown";
    }
    return { ok: true, adapterInfo };
  } catch (error) {
    return { ok: false, reason: String((error && error.message) || error) };
  }
}

export async function createWebGpuRenderer(canvas) {
  if (typeof navigator === "undefined" || !navigator.gpu) {
    throw new Error("WebGPU tidak tersedia");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Tidak ada adapter WebGPU");
  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();
  const context = canvas.getContext("webgpu");
  if (!context) throw new Error("Gagal membuat konteks WebGPU");

  context.configure({ device, format, alphaMode: "premultiplied" });

  const adapterInfo = adapter.info ? { ...adapter.info } : {};

  let sampleCount = 1;
  const maxSamples = device.limits && device.limits.maxSamplesPerPixel;
  if (maxSamples === undefined || maxSamples >= 4) sampleCount = 4;

  let pipelines;
  try {
    pipelines = createPipelines(device, format, sampleCount);
  } catch (error) {
    sampleCount = 1;
    pipelines = createPipelines(device, format, sampleCount);
  }

  const renderer = {
    backend: "webgpu",
    adapterInfo,
    sampleCount,
    device,
    lost: false,
    lostReason: null,
    onLost: null,
  };

  let tileBuffer = null;
  let particleBuffer = null;
  let uniformBuffer = null;
  let bindGroup = null;
  let msaaTexture = null;
  let msaaView = null;
  let size = { width: 0, height: 0, dpr: 1 };
  let destroyed = false;

  uniformBuffer = device.createBuffer({
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  bindGroup = device.createBindGroup({
    layout: pipelines.bindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  function ensureBuffer(current, bytes, usage) {
    if (current && current.size >= bytes) return current;
    if (current) current.destroy();
    const buffer = device.createBuffer({
      size: Math.max(UNIFORM_BYTES, Math.ceil(bytes / 4) * 4),
      usage,
    });
    return buffer;
  }

  function ensureMsaa() {
    const w = Math.max(1, Math.round(size.width * size.dpr));
    const h = Math.max(1, Math.round(size.height * size.dpr));
    if (sampleCount <= 1) return;
    if (msaaTexture && msaaTexture.width === w && msaaTexture.height === h) return;
    if (msaaTexture) msaaTexture.destroy();
    try {
      msaaTexture = device.createTexture({
        size: [w, h],
        format,
        sampleCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    } catch (error) {
      sampleCount = 1;
      msaaTexture = null;
      pipelines = createPipelines(device, format, sampleCount);
      bindGroup = device.createBindGroup({
        layout: pipelines.bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      });
      return;
    }
    msaaView = msaaTexture.createView();
  }

  renderer.resize = function resize(next) {
    size = {
      width: Math.max(1, next.width || 0),
      height: Math.max(1, next.height || 0),
      dpr: next.dpr || 1,
    };
    const w = Math.max(1, Math.round(size.width * size.dpr));
    const h = Math.max(1, Math.round(size.height * size.dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    if (canvas.style) {
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
    }
    ensureMsaa();
  };

  renderer.draw = function draw(frame) {
    if (destroyed || renderer.lost) return;
    if (!size.width || !size.height) return;

    const uniform = new Float32Array(UNIFORM_BYTES / 4);
    const bw = frame.boardPx ? frame.boardPx[0] : size.width;
    const bh = frame.boardPx ? frame.boardPx[1] : size.height;
    const { cellSize, gap } = layoutFor(bw);
    uniform[0] = bw;
    uniform[1] = bh;
    uniform[2] = frame.time || 0;
    uniform[3] = frame.progress == null ? 1 : frame.progress;
    uniform[4] = cellSize;
    uniform[5] = gap;
    device.queue.writeBuffer(uniformBuffer, 0, uniform);

    const tileData = buildTileInstances(frame.tiles || [], frame.anim || {});
    const tileCount = tileData.length / 8;
    if (tileData.byteLength) {
      tileBuffer = ensureBuffer(tileBuffer, tileData.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
      device.queue.writeBuffer(tileBuffer, 0, tileData);
    }

    const particleData = buildParticleInstances(frame.particles || []);
    const particleCount = particleData.length / 8;
    if (particleData.byteLength) {
      particleBuffer = ensureBuffer(particleBuffer, particleData.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
      device.queue.writeBuffer(particleBuffer, 0, particleData);
    }

    let colorAttachment;
    if (sampleCount > 1 && msaaView) {
      colorAttachment = {
        view: msaaView,
        resolveTarget: context.getCurrentTexture().createView(),
        clearValue: { r: 0.043, g: 0.043, b: 0.063, a: 1 },
        loadOp: "clear",
        storeOp: "discard",
      };
    } else {
      colorAttachment = {
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.043, g: 0.043, b: 0.063, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      };
    }

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [colorAttachment] });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(pipelines.background);
    pass.draw(3);
    if (tileCount > 0 && tileBuffer) {
      pass.setPipeline(pipelines.tiles);
      pass.setVertexBuffer(0, tileBuffer);
      pass.draw(4, tileCount);
      pass.setPipeline(pipelines.glyphs);
      pass.setVertexBuffer(0, tileBuffer);
      pass.draw(4, tileCount);
    }
    if (particleCount > 0 && particleBuffer) {
      pass.setPipeline(pipelines.particles);
      pass.setVertexBuffer(0, particleBuffer);
      pass.draw(4, particleCount);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  };

  renderer.destroy = function destroy() {
    destroyed = true;
    renderer.lost = true;
    if (msaaTexture) msaaTexture.destroy();
    if (tileBuffer) tileBuffer.destroy();
    if (particleBuffer) particleBuffer.destroy();
    if (uniformBuffer) uniformBuffer.destroy();
  };

  device.lost
    .then((info) => {
      renderer.lost = true;
      renderer.lostReason = (info && info.message) || "device lost";
      if (typeof renderer.onLost === "function") renderer.onLost(renderer.lostReason);
    })
    .catch(() => {});

  return renderer;
}
