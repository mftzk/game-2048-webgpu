"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyMove,
  createBoard,
  movesAvailable,
  spawnTile,
} from "./lib/game.js";
import { createCanvas2dRenderer } from "./lib/canvas2d/renderer.js";
import { createWebGpuRenderer, isWebGpuSupported } from "./lib/webgpu/renderer.js";

const BEST_KEY = "nrapken2048w.best";
const SOUND_KEY = "nrapken2048w.sound";
const RENDERER_KEY = "nrapken2048w.renderer";
const MODES = ["auto", "webgpu", "canvas2d"];
const MODE_LABEL = { auto: "Auto", webgpu: "WebGPU", canvas2d: "Canvas 2D" };
const ANIM_MS = 120;
const PARTICLE_LIFE = 0.6;

function easeOut(t) {
  return 1 - (1 - t) ** 3;
}

function buildBursts(mergedTiles, gap, cell, push) {
  for (const tile of mergedTiles) {
    if (!tile.merged) continue;
    const cx = gap + tile.col * (cell + gap) + cell / 2;
    const cy = gap + tile.row * (cell + gap) + cell / 2;
    for (let i = 0; i < 14; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 150;
      push({
        originX: cx,
        originY: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        size: 5 + Math.random() * 10,
        seed: Math.random(),
      });
    }
  }
}

function statusLabel(status) {
  if (status === "won") return "Kamu menang";
  if (status === "over") return "Permainan selesai";
  return "Bermain";
}

export default function Page() {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const rendererRef = useRef(null);
  const frameRef = useRef({
    tiles: [],
    from: null,
    progress: 1,
    start: 0,
    duration: ANIM_MS,
    phase: "idle",
    active: false,
    done: true,
    onDone: null,
  });
  const particlesRef = useRef([]);
  const timeRef = useRef(0);
  const lastFrameRef = useRef(0);
  const boardSizeRef = useRef(320);
  const animatingRef = useRef(false);
  const historyRef = useRef([]);
  const reachedRef = useRef(false);
  const soundRef = useRef(true);
  const pointerRef = useRef(null);
  const gameRef = useRef({
    tiles: [],
    score: 0,
    moves: 0,
    best: 0,
    status: "playing",
    keepPlaying: false,
  });

  const [tiles, setTiles] = useState([]);
  const [score, setScore] = useState(0);
  const [moves, setMoves] = useState(0);
  const [best, setBest] = useState(0);
  const [status, setStatus] = useState("playing");
  const [keepPlaying, setKeepPlaying] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [rendererMode, setRendererMode] = useState("auto");
  const [backend, setBackend] = useState("canvas2d");
  const [badgeReason, setBadgeReason] = useState("");
  const [adapterInfo, setAdapterInfo] = useState(null);
  const [scores, setScores] = useState([]);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [rank, setRank] = useState(0);

  const commit = useCallback((patch) => {
    gameRef.current = { ...gameRef.current, ...patch };
    if ("tiles" in patch) setTiles(patch.tiles);
    if ("score" in patch) setScore(patch.score);
    if ("moves" in patch) setMoves(patch.moves);
    if ("best" in patch) setBest(patch.best);
    if ("status" in patch) setStatus(patch.status);
    if ("keepPlaying" in patch) setKeepPlaying(patch.keepPlaying);
  }, []);

  const blip = useCallback((kind) => {
    if (!soundRef.current || typeof window === "undefined") return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    try {
      if (!blip.ctx) blip.ctx = new Ctor();
      const ctx = blip.ctx;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const table = {
        move: [196, 0.05, "sine", 0.05],
        merge: [392, 0.09, "triangle", 0.07],
        win: [660, 0.35, "triangle", 0.09],
        over: [130, 0.4, "sawtooth", 0.06],
      }[kind] || [220, 0.05, "sine", 0.05];
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = table[2];
      osc.frequency.value = table[0];
      gain.gain.setValueAtTime(table[3], ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + table[1]);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + table[1]);
    } catch {
      /* audio is best effort */
    }
  }, []);

  const persistBest = useCallback((value) => {
    try {
      localStorage.setItem(BEST_KEY, String(value));
    } catch {
      /* ignore */
    }
  }, []);

  const finishSpawn = useCallback(() => {
    animatingRef.current = false;
    frameRef.current.active = false;
    frameRef.current.phase = "idle";
    frameRef.current.from = null;
    frameRef.current.progress = 1;
    const snapshot = gameRef.current;
    if (!movesAvailable(snapshot.tiles)) {
      commit({ status: "over" });
      blip("over");
      return;
    }
    const reached = snapshot.tiles.some((t) => t.value >= 2048);
    if (reached && !reachedRef.current) {
      reachedRef.current = true;
      commit({ status: "won", keepPlaying: false });
      blip("win");
    }
  }, [blip, commit]);

  const finishMove = useCallback(() => {
    const current = frameRef.current.tiles;
    const afterSpawn = spawnTile(current);
    commit({ tiles: afterSpawn });
    particlesRef.current = particlesRef.current.slice(-128);
    frameRef.current = {
      tiles: afterSpawn,
      from: null,
      progress: 0,
      start: performance.now(),
      duration: ANIM_MS,
      phase: "spawn",
      active: true,
      done: false,
      onDone: finishSpawn,
    };
  }, [commit, finishSpawn]);

  const doMove = useCallback(
    (dir) => {
      if (animatingRef.current) return;
      const snapshot = gameRef.current;
      if (snapshot.status === "over") return;
      if (snapshot.status === "won" && !snapshot.keepPlaying) return;
      const result = applyMove(snapshot.tiles, dir);
      if (!result.moved) return;

      historyRef.current.push({
        tiles: snapshot.tiles,
        score: snapshot.score,
        moves: snapshot.moves,
        status: snapshot.status,
        keepPlaying: snapshot.keepPlaying,
      });
      if (historyRef.current.length > 20) historyRef.current.shift();

      const positions = new Map(snapshot.tiles.map((t) => [t.id, { row: t.row, col: t.col }]));
      const from = result.tiles.map((t) => positions.get(t.id) || { row: t.row, col: t.col });

      const nextScore = snapshot.score + result.gained;
      const nextBest = Math.max(snapshot.best, nextScore);
      commit({ tiles: result.tiles, score: nextScore, moves: snapshot.moves + 1, best: nextBest });
      if (nextBest > snapshot.best) persistBest(nextBest);

      const gap = boardSizeRef.current * 0.03;
      const cell = Math.max(1, (boardSizeRef.current - gap * 5) / 4);
      buildBursts(result.tiles, gap, cell, (p) => particlesRef.current.push(p));
      if (particlesRef.current.length > 128) {
        particlesRef.current = particlesRef.current.slice(-128);
      }

      blip(result.gained > 0 ? "merge" : "move");
      animatingRef.current = true;
      frameRef.current = {
        tiles: result.tiles,
        from,
        progress: 0,
        start: performance.now(),
        duration: ANIM_MS,
        phase: "move",
        active: true,
        done: false,
        onDone: finishMove,
      };
    },
    [blip, commit, finishMove, persistBest],
  );

  const newGame = useCallback(() => {
    const board = createBoard();
    historyRef.current = [];
    reachedRef.current = false;
    particlesRef.current = [];
    animatingRef.current = false;
    setSubmitted(false);
    setRank(0);
    commit({ tiles: board.tiles, score: 0, moves: 0, status: "playing", keepPlaying: false });
    frameRef.current = {
      tiles: board.tiles,
      from: null,
      progress: 1,
      start: 0,
      duration: ANIM_MS,
      phase: "idle",
      active: false,
      done: true,
      onDone: null,
    };
  }, [commit]);

  const undo = useCallback(() => {
    if (animatingRef.current) return;
    const entry = historyRef.current.pop();
    if (!entry) return;
    particlesRef.current = [];
    commit({
      tiles: entry.tiles,
      score: entry.score,
      moves: entry.moves,
      status: entry.status,
      keepPlaying: entry.keepPlaying,
    });
    frameRef.current = {
      tiles: entry.tiles,
      from: null,
      progress: 1,
      start: 0,
      duration: ANIM_MS,
      phase: "idle",
      active: false,
      done: true,
      onDone: null,
    };
  }, [commit]);

  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      soundRef.current = next;
      try {
        localStorage.setItem(SOUND_KEY, next ? "on" : "off");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const cycleRenderer = useCallback(() => {
    setRendererMode((prev) => {
      const next = MODES[(MODES.indexOf(prev) + 1) % MODES.length];
      try {
        localStorage.setItem(RENDERER_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const loadScores = useCallback(async () => {
    try {
      const res = await fetch("/api/scores", { cache: "no-store" });
      const data = await res.json();
      setScores(Array.isArray(data) ? data : data.scores || []);
    } catch {
      /* offline is fine */
    }
  }, []);

  const submitScore = useCallback(
    async (event) => {
      event.preventDefault();
      const trimmed = name.trim();
      if (!trimmed || submitting) return;
      setSubmitting(true);
      try {
        const res = await fetch("/api/scores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed, score: gameRef.current.score }),
        });
        const data = await res.json();
        if (data.ok) {
          setSubmitted(true);
          setRank(data.rank);
          loadScores();
        }
      } catch {
        /* ignore */
      }
      setSubmitting(false);
    },
    [loadScores, name, submitting],
  );

  useEffect(() => {
    try {
      const storedMode = localStorage.getItem(RENDERER_KEY);
      if (storedMode && MODES.includes(storedMode)) setRendererMode(storedMode);
      const storedBest = Number(localStorage.getItem(BEST_KEY) || 0);
      if (storedBest > 0) {
        gameRef.current.best = storedBest;
        setBest(storedBest);
      }
      if (localStorage.getItem(SOUND_KEY) === "off") {
        soundRef.current = false;
        setSoundOn(false);
      }
    } catch {
      /* ignore */
    }
    const board = createBoard();
    commit({ tiles: board.tiles, score: 0, moves: 0, status: "playing", keepPlaying: false });
    frameRef.current = {
      tiles: board.tiles,
      from: null,
      progress: 1,
      start: 0,
      duration: ANIM_MS,
      phase: "idle",
      active: false,
      done: true,
      onDone: null,
    };
    loadScores();
  }, [commit, loadScores]);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    async function setup() {
      let renderer = null;
      let reason = "";
      let info = null;

      if (rendererMode !== "canvas2d") {
        const support = await isWebGpuSupported();
        if (support.ok) {
          try {
            renderer = await createWebGpuRenderer(canvas);
            info = renderer.adapterInfo || support.adapterInfo || null;
          } catch (error) {
            reason = String((error && error.message) || error);
          }
        } else {
          reason = support.reason || "WebGPU tidak tersedia";
        }
      }

      if (!renderer) {
        renderer = createCanvas2dRenderer(canvas);
      }

      if (cancelled) {
        renderer.destroy();
        return;
      }

      rendererRef.current = renderer;
      renderer.onLost = () => {
        setBadgeReason("Device WebGPU hilang, beralih ke Canvas 2D");
        setRendererMode("canvas2d");
      };
      setBackend(renderer.backend);
      setBadgeReason(reason);
      setAdapterInfo(info);
      renderer.resize({
        width: boardSizeRef.current,
        height: boardSizeRef.current,
        dpr: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      });
    }

    setup();

    return () => {
      cancelled = true;
      const active = rendererRef.current;
      if (active) active.destroy();
      rendererRef.current = null;
    };
  }, [rendererMode]);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return undefined;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const size = Math.max(120, Math.floor(Math.min(rect.width, rect.height)));
      boardSizeRef.current = size;
      const renderer = rendererRef.current;
      if (renderer) {
        renderer.resize({
          width: size,
          height: size,
          dpr: window.devicePixelRatio || 1,
        });
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const loop = (now) => {
      const previous = lastFrameRef.current;
      lastFrameRef.current = now;
      const dt = previous ? Math.min(0.05, (now - previous) / 1000) : 0;
      if (!timeRef.current) timeRef.current = now;

      if (particlesRef.current.length) {
        const next = [];
        for (const p of particlesRef.current) {
          const age = p.age + dt / PARTICLE_LIFE;
          if (age < 1) next.push({ ...p, age });
        }
        particlesRef.current = next;
      }

      const frame = frameRef.current;
      if (frame.active) {
        const t = frame.duration > 0 ? Math.min(1, (now - frame.start) / frame.duration) : 1;
        frame.progress = easeOut(t);
        if (t >= 1 && !frame.done) {
          frame.done = true;
          if (frame.onDone) frame.onDone();
        }
      }

      let flash = null;
      if (frame.phase === "move") {
        const value = Math.sin(Math.PI * frame.progress);
        flash = {};
        for (const tile of frame.tiles) if (tile.merged) flash[tile.id] = value;
      } else if (frame.phase === "spawn") {
        const value = Math.sin(Math.PI * frame.progress);
        flash = {};
        for (const tile of frame.tiles) if (tile.isNew) flash[tile.id] = value;
      }

      const renderer = rendererRef.current;
      if (renderer) {
        try {
          renderer.draw({
            tiles: frame.tiles,
            anim: { from: frame.from, flash },
            particles: particlesRef.current,
            boardPx: [boardSizeRef.current, boardSizeRef.current],
            progress: frame.active ? frame.progress : 1,
            time: (now - timeRef.current) / 1000,
          });
        } catch (error) {
          setBadgeReason(String((error && error.message) || error));
          setRendererMode("canvas2d");
        }
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const key = event.key.toLowerCase();
      if (key === "arrowleft" || key === "a" || key === "h") {
        event.preventDefault();
        doMove("left");
      } else if (key === "arrowright" || key === "d" || key === "l") {
        event.preventDefault();
        doMove("right");
      } else if (key === "arrowup" || key === "w" || key === "k") {
        event.preventDefault();
        doMove("up");
      } else if (key === "arrowdown" || key === "s" || key === "j") {
        event.preventDefault();
        doMove("down");
      } else if (key === "r") {
        event.preventDefault();
        newGame();
      } else if (key === "z") {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doMove, newGame, undo]);

  const onPointerDown = (event) => {
    pointerRef.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerUp = (event) => {
    const start = pointerRef.current;
    pointerRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) doMove(dx > 0 ? "right" : "left");
    else doMove(dy > 0 ? "down" : "up");
  };

  const winVisible = status === "won" && !keepPlaying;
  const overVisible = status === "over";

  return (
    <div className="page">
      <div className="shell">
        <header className="header">
          <div className="brand">
            <h1 className="brand-title">2048</h1>
            <span className="brand-tag">WebGPU</span>
          </div>
          <p className="subtitle">Gabung angka, capai 2048. Board dirender di GPU lewat WebGPU + WGSL.</p>
        </header>

        <main className="layout">
          <section className="game" aria-label="Papan permainan">
            <div className="stats">
              <div className="stat">
                <span className="stat-label">Skor</span>
                <span className="stat-value" data-testid="score">{score}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Terbaik</span>
                <span className="stat-value" data-testid="best">{best}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Langkah</span>
                <span className="stat-value" data-testid="moves">{moves}</span>
              </div>
            </div>

            <div
              className="board-wrap"
              ref={wrapRef}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              role="presentation"
            >
              <canvas
                ref={canvasRef}
                className="board-canvas"
                data-testid="board-canvas"
                width={320}
                height={320}
                aria-label="Papan 2048 dirender WebGPU"
              />
              {winVisible ? (
                <div className="overlay" data-testid="win-overlay">
                  <div className="overlay-card">
                    <h2 className="overlay-title">2048 tercapai!</h2>
                    <p className="overlay-text">Skormu {score}. Lanjutkan untuk mengejar angka lebih besar.</p>
                    <div className="overlay-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => commit({ status: "playing", keepPlaying: true })}
                      >
                        Lanjut main
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={newGame}>
                        Main baru
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              {overVisible ? (
                <div className="overlay" data-testid="over-overlay">
                  <div className="overlay-card">
                    <h2 className="overlay-title">Permainan selesai</h2>
                    <p className="overlay-text">Tidak ada langkah tersisa. Skor akhir {score}.</p>
                    {submitted ? (
                      <p className="overlay-rank">Tersimpan di peringkat #{rank}</p>
                    ) : (
                      <form className="score-form" onSubmit={submitScore}>
                        <input
                          className="input"
                          type="text"
                          maxLength={20}
                          placeholder="Nama kamu"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          aria-label="Nama untuk papan skor"
                        />
                        <button type="submit" className="btn btn-primary" disabled={submitting || !name.trim()}>
                          {submitting ? "Mengirim…" : "Simpan skor"}
                        </button>
                      </form>
                    )}
                    <div className="overlay-actions">
                      <button type="button" className="btn btn-ghost" onClick={newGame}>
                        Coba lagi
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="controls">
              <button type="button" className="btn btn-primary" onClick={newGame}>
                Main baru <span className="key">R</span>
              </button>
              <button type="button" className="btn" onClick={undo}>
                Undo <span className="key">Z</span>
              </button>
              <button type="button" className="btn" onClick={toggleSound} aria-pressed={soundOn}>
                Suara: {soundOn ? "Aktif" : "Nonaktif"}
              </button>
            </div>
            <p className="status-line" data-testid="status-line">
              {statusLabel(status)} · geser atau pakai tombol
            </p>
          </section>

          <aside className="sidebar">
            <section className="panel" data-testid="renderer-panel">
              <h2 className="panel-title">Renderer</h2>
              <div className="badge-row">
                <span
                  className="badge"
                  data-testid="renderer-badge"
                  title={adapterInfo ? `${adapterInfo.vendor || "GPU"} ${adapterInfo.architecture || ""}` : badgeReason}
                >
                  <span className={`badge-dot ${backend === "webgpu" ? "on" : ""}`} />
                  {backend === "webgpu" ? "WebGPU" : "Canvas 2D (fallback)"}
                </span>
                <button
                  type="button"
                  className="btn btn-small"
                  data-testid="renderer-toggle"
                  onClick={cycleRenderer}
                >
                  Mode: {MODE_LABEL[rendererMode]}
                </button>
              </div>
              {badgeReason ? <p className="badge-reason">{badgeReason}</p> : null}
              {backend === "webgpu" && adapterInfo ? (
                <p className="adapter-info">
                  {adapterInfo.vendor || "GPU"} {adapterInfo.architecture || ""}
                </p>
              ) : null}
            </section>

            <section className="panel" data-testid="leaderboard-panel">
              <h2 className="panel-title">Papan skor</h2>
              {scores.length === 0 ? (
                <p className="lb-empty">Belum ada skor. Jadilah yang pertama.</p>
              ) : (
                <ol className="leaderboard">
                  {scores.map((entry, index) => (
                    <li className="lb-row" key={`${entry.name}-${entry.score}-${index}`}>
                      <span className="lb-rank">{index + 1}</span>
                      <span className="lb-name">{entry.name}</span>
                      <span className="lb-score">{entry.score}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="panel" data-testid="hints-panel">
              <h2 className="panel-title">Cara main</h2>
              <ul className="hint-list">
                <li>Panah atau WASD/HJKL untuk menggeser tile.</li>
                <li>Dua angka sama bergabung saat bertabrakan.</li>
                <li>Setiap langkah yang berubah memunculkan tile baru.</li>
                <li>Tombol R untuk main baru, Z untuk undo (20 langkah).</li>
                <li>Di layar sentuh, geser jari di atas board.</li>
              </ul>
            </section>
          </aside>
        </main>

        <footer className="footer">
          <span>Dibuat dengan AI · Deploy di </span>
          <a href="https://nrapken.dev" target="_blank" rel="noreferrer">
            nrapkén.dev
          </a>
        </footer>
      </div>
    </div>
  );
}
