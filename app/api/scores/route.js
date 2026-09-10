const MAX_ENTRIES = 50;

let scores = [];

export async function GET() {
  const top = [...scores].sort((a, b) => b.score - a.score).slice(0, 10);
  return Response.json({ scores: top });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const rawName = body && typeof body.name === "string" ? body.name.trim() : "";
  const name = rawName.slice(0, 20);
  const score = Number(body && body.score);

  if (!name || !Number.isFinite(score) || !Number.isInteger(score) || score < 0 || score > 100000000) {
    return Response.json({ ok: false, error: "invalid name or score" }, { status: 400 });
  }

  scores.push({ name, score, at: new Date().toISOString() });
  scores = scores.sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
  const rank = scores.filter((entry) => entry.score > score).length + 1;
  return Response.json({ ok: true, rank });
}
