// QA for game-2048-webgpu: renderer badge, board canvas, gameplay, undo, toggle, screenshots.
const { chromium } = require("/home/ubuntu/.hermes/hermes-agent/node_modules/playwright");
const fs = require("fs");

(async () => {
  const url = process.argv[2];
  const outDir = process.argv[3] || "/tmp/g2048webgpu-qa";
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const errors = [];

  for (const s of [
    { name: "desktop", viewport: { width: 1280, height: 900 } },
    { name: "mobile", viewport: { width: 390, height: 844 }, touch: true },
  ]) {
    const ctx = await browser.newContext({
      viewport: s.viewport,
      deviceScaleFactor: 2,
      hasTouch: !!s.touch,
      isMobile: !!s.touch,
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`[${s.name}] pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`[${s.name}] console.error: ${m.text()}`);
    });

    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1800);

    const info = await page.evaluate(() => {
      const badge = document.querySelector('[data-testid="renderer-badge"]');
      const canvas = document.querySelector("canvas");
      const toggle = document.querySelector('[data-testid="renderer-toggle"]');
      const stat = (label) => {
        const el = [...document.querySelectorAll("*")].find(
          (e) => e.children.length === 0 && /^[A-Z ]+$/.test(e.textContent.trim()) && e.textContent.includes(label),
        );
        const parent = el?.parentElement;
        return parent ? parent.innerText.replace(/\s+/g, " ").trim() : null;
      };
      return {
        hasNavigatorGpu: !!navigator.gpu,
        badgeText: badge ? badge.innerText.replace(/\s+/g, " ").trim() : null,
        badgeTitle: badge ? badge.getAttribute("title") : null,
        toggleText: toggle ? toggle.innerText.replace(/\s+/g, " ").trim() : null,
        canvas: canvas ? { w: canvas.width, h: canvas.height, cssW: canvas.clientWidth, cssH: canvas.clientHeight } : null,
        title: document.title,
        score: stat("SCORE"),
        moves: stat("MOVES"),
        bodySnippet: document.body.innerText.replace(/\s+/g, " ").slice(0, 320),
      };
    });
    console.log(`--- ${s.name} ---`);
    console.log("title:", info.title, "| navigator.gpu:", info.hasNavigatorGpu);
    console.log("badge:", JSON.stringify(info.badgeText), "title:", JSON.stringify(info.badgeTitle));
    console.log("toggle:", JSON.stringify(info.toggleText), "| canvas:", JSON.stringify(info.canvas));
    console.log("score/moves:", info.score, "/", info.moves);

    // Play 20 moves.
    const keys = ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"];
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press(keys[i % 4]);
      await page.waitForTimeout(160);
    }
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const gl = canvas ? canvas.getContext("2d") : null;
      // sample the canvas center to prove the board is actually being drawn (non-uniform pixels)
      let drawn = null;
      try {
        const d = gl ? gl.getImageData(0, 0, canvas.width, canvas.height).data : null;
        if (d) {
          const seen = new Set();
          for (let i = 0; i < d.length; i += 4 * 97) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
          drawn = seen.size;
        }
      } catch (e) {
        drawn = "n/a:" + String(e).slice(0, 40);
      }
      const txt = document.body.innerText.replace(/\s+/g, " ");
      return {
        bodySnippet: txt.slice(0, 400),
        distinctCanvasColors: drawn,
        hasGameOver: txt.includes("Game over"),
      };
    });
    console.log("after 20 moves:", after.bodySnippet.slice(0, 200));
    console.log("distinct canvas colors sampled:", after.distinctCanvasColors);

    // Undo
    const undo = page.getByRole("button", { name: /Undo/i });
    let undoInfo = "missing";
    if (await undo.count()) {
      undoInfo = (await undo.first().isEnabled()) ? "enabled" : "disabled";
      if (undoInfo === "enabled") await undo.first().click();
      await page.waitForTimeout(400);
    }
    console.log("undo:", undoInfo);

    // Force WebGPU (unsupported here) -> must fall back to Canvas 2D with a reason, never blank.
    const toggle = page.locator('[data-testid="renderer-toggle"]');
    if (await toggle.count()) {
      await toggle.first().click();
      await page.waitForTimeout(1500);
      const forced = await page.evaluate(() => {
        const badge = document.querySelector('[data-testid="renderer-badge"]');
        const canvas = document.querySelector("canvas");
        return {
          badge: badge ? badge.innerText.replace(/\s+/g, " ").trim() : null,
          banner: document.body.innerText.replace(/\s+/g, " ").match(/WebGPU[^.]{0,120}/g)?.slice(0, 3) ?? null,
          canvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
        };
      });
      console.log("after toggle ->", JSON.stringify(forced));
      await page.waitForTimeout(300);
      // and click through the remaining modes
      for (let i = 0; i < 2; i++) {
        await toggle.first().click();
        await page.waitForTimeout(900);
        const b = await page.evaluate(() =>
          document.querySelector('[data-testid="renderer-badge"]')?.innerText.replace(/\s+/g, " ").trim(),
        );
        console.log(`toggle #${i + 2} -> badge: ${JSON.stringify(b)}`);
      }
    } else {
      console.log("toggle: MISSING");
    }

    await page.screenshot({ path: `${outDir}/${s.name}.png`, fullPage: true });
    await ctx.close();
  }

  await browser.close();
  console.log("== JS errors ==");
  console.log(errors.length ? errors.join("\n") : "none");
})();
