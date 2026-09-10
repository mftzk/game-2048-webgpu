export async function GET() {
  return Response.json({
    ok: true,
    app: "game-2048-webgpu",
    version: "1.0.0",
    renderer: "webgpu+canvas2d",
  });
}
