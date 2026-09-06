/**
 * Record the demo video scenes, headless and repeatably.
 *
 * Playwright's video capture does not include the OS cursor, so a synthetic
 * one is injected and animated before every click — without it the demo looks
 * like buttons press themselves.
 *
 * Each scene is recorded to its own file so a retake costs one scene, not the
 * whole video. Scene 3 is captured at real speed and sped up afterwards by
 * build-demo.sh, which is what makes a 90-second run fit a 34-second slot.
 *
 * Usage:
 *   node scripts/record-demo.mjs [baseUrl] [outDir]
 *   node scripts/record-demo.mjs http://localhost:3000 ./demo-raw
 *
 * Scenes 6 and 7 are terminal frames rendered from real captured output, so
 * the whole video comes out of one pipeline and looks consistent.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "https://groundtruth-calle.vercel.app";
const OUT = path.resolve(process.argv[3] ?? "demo-raw");
const SIZE = { width: 1920, height: 1080 };

fs.mkdirSync(OUT, { recursive: true });

// --- synthetic cursor -------------------------------------------------------
const CURSOR = `
  (() => {
    if (document.getElementById('__cur')) return;
    const d = document.createElement('div');
    d.id = '__cur';
    d.style.cssText = [
      'position:fixed','z-index:2147483647','left:0','top:0',
      'width:24px','height:24px','margin:-12px 0 0 -12px','border-radius:50%',
      'background:rgba(52,211,153,.30)','border:2px solid #34d399',
      'pointer-events:none','box-shadow:0 0 0 6px rgba(52,211,153,.10)',
      'transition:transform .45s cubic-bezier(.4,0,.2,1)',
      'transform:translate(960px,540px)',
    ].join(';');
    document.body.appendChild(d);
    window.__moveCur = (x, y) => { d.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
    window.__pressCur = () => {
      d.animate([{ scale: '1' }, { scale: '.6' }, { scale: '1' }], { duration: 220 });
    };
  })();
`;

async function cursorTo(page, x, y) {
  await page.evaluate(([x, y]) => window.__moveCur?.(x, y), [x, y]).catch(() => {});
  await page.waitForTimeout(550);
}

/** Move the visible cursor to an element, pause, then really click it. */
async function click(page, locator, label) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no bounding box for ${label}`);
  await cursorTo(page, Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  await page.evaluate(() => window.__pressCur?.()).catch(() => {});
  await page.waitForTimeout(220);
  await locator.click();
}

/** Smooth scroll, so nothing in the video jumps. */
async function glide(page, to, ms = 1600) {
  await page.evaluate(
    ([to, ms]) =>
      new Promise((res) => {
        const from = window.scrollY;
        const t0 = performance.now();
        const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
        const step = (now) => {
          const p = Math.min(1, (now - t0) / ms);
          window.scrollTo(0, from + (to - from) * ease(p));
          p < 1 ? requestAnimationFrame(step) : res();
        };
        requestAnimationFrame(step);
      }),
    [to, ms],
  );
  await page.waitForTimeout(200);
}

async function scene(name, fn) {
  const browser = await chromium.launch();
  const dir = path.join(OUT, name);
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    recordVideo: { dir, size: SIZE },
  });
  const page = await ctx.newPage();
  await page.addInitScript(CURSOR);
  const started = Date.now();
  try {
    await fn(page);
  } catch (e) {
    console.log(`  ! ${name}: ${e.message}`);
  }
  await page.waitForTimeout(400);
  await ctx.close();
  await browser.close();
  // Playwright names videos randomly; rename to the scene.
  const produced = fs.readdirSync(dir).filter((f) => f.endsWith(".webm"));
  if (produced[0]) {
    const dest = path.join(OUT, `${name}.webm`);
    fs.renameSync(path.join(dir, produced[0]), dest);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`  ✓ ${name}.webm  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } else {
    console.log(`  ! ${name}: no video produced`);
  }
}

// --- terminal frames --------------------------------------------------------
const term = (title, body) => `<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
 html,body{margin:0;height:100%;background:#09090b;font-family:"Geist Mono",ui-monospace,monospace}
 .win{position:absolute;inset:56px;border-radius:14px;border:1px solid #27272a;
      background:#0b0b0d;box-shadow:0 30px 90px rgba(0,0,0,.6);overflow:hidden}
 .bar{height:42px;display:flex;align-items:center;gap:8px;padding:0 16px;
      border-bottom:1px solid #1c1c20;background:#111114;color:#71717a;font-size:14px}
 .dot{width:12px;height:12px;border-radius:50%}
 pre{margin:0;padding:26px 30px;color:#d4d4d8;font-size:19px;line-height:1.62;white-space:pre-wrap}
 .g{color:#34d399}.r{color:#f87171}.y{color:#fbbf24}.d{color:#71717a}.w{color:#fafafa}
</style>
<div class="win">
 <div class="bar"><span class="dot" style="background:#f87171"></span>
 <span class="dot" style="background:#fbbf24"></span>
 <span class="dot" style="background:#34d399"></span>
 <span style="margin-left:10px">${title}</span></div>
 <pre>${body}</pre>
</div>`;

const REAL_CALL = term(
  "groundtruth — real CALL-E call",
  `<span class="d">$</span> node scripts/real-call.mjs http://localhost:3000 +91••••••••••

<span class="d">[safety]</span> retired 0 demo candidate(s)
<span class="d">[safety]</span> pending set verified: 1 candidate
<span class="d">[call]</span>   <span class="w">call_DxfIoUheBQMhn2GeKu0_Ww</span> -> completed

  <span class="d">[107s]</span> <span class="g">GT </span>: Thanks — is a genuine XZ-420 compressor
                physically in stock right now, or not?
  <span class="d">[115s]</span> <span class="y">SUP</span>: Correct. No, not at the moment.
  <span class="d">[118s]</span> <span class="g">GT </span>: Could you tell me whether pickup is
                available today, and if so, what time?
  <span class="d">[126s]</span> <span class="y">SUP</span>: No.

<span class="w">CONSTRAINT        RESULT           CLAIM</span>
in stock          not_available    <span class="r">failed</span>
pickup today      false            <span class="r">failed</span>
price             never answered   <span class="y">unknown</span>   <span class="d">&lt;- not guessed</span>
compatibility     uncertain        <span class="y">unknown</span>   <span class="d">&lt;- not promoted</span>
hold until 5 PM   never answered   <span class="y">unknown</span>

<span class="w">DECISION: no_match, confidence 0</span>`,
);

const GOAL_GATE = term(
  "groundtruth — goal contract check",
  `<span class="d">$</span> node scripts/check-goal-compatibility.mjs goal.json \\
      --spec published-goal.json

{
  "goal": "Example stock check",
  "runSpecVersion": 2,
  <span class="w">"compatible": false,</span>
  "bindings": [
    { "kind": "availability", "resultField": "in_stock" },
    { "kind": "price_max",    "resultField": "quoted_price" }
  ],
  <span class="r">"unanswerable": [</span>
    <span class="r">{ "kind": "compatibility" },</span>
    <span class="r">{ "kind": "pickup_today"  },</span>
    <span class="r">{ "kind": "hold_until"    }</span>
  <span class="r">]</span>
}

<span class="r">INCOMPATIBLE</span> — "Example stock check" v2 cannot verify this goal
(no declared result field for: compatibility, pickup_today, hold_until).
<span class="w">Do not run it: the constraint would stay UNKNOWN after a real call.</span>

<span class="d">$</span> echo $?
<span class="r">2</span>`,
);

// --- scenes -----------------------------------------------------------------
console.log(`recording from ${BASE}\n`);

// 1 · the problem — 23s
await scene("scene1-problem", async (page) => {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(4500);
  await glide(page, 620, 3500);
  await page.waitForTimeout(3000);
  await glide(page, 1180, 3000);
  await page.waitForTimeout(8000);
});

// 2 · compiling the goal — 22s
await scene("scene2-understanding", async (page) => {
  await page.goto(`${BASE}/verify`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await click(page, page.getByRole("button", { name: /Analyze goal/i }), "analyze");
  await page.waitForTimeout(4000);
  await glide(page, 320, 2200);
  await page.waitForTimeout(3500);
  await glide(page, 760, 2600);
  await page.waitForTimeout(6000);
});

// 3 · the live run — recorded at real speed, sped up in post
await scene("scene3-live-run", async (page) => {
  await page.goto(`${BASE}/verify`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await click(page, page.getByRole("button", { name: /Analyze goal/i }), "analyze");
  await page.waitForTimeout(3000);
  await click(page, page.getByRole("button", { name: /Start verification/i }), "start");
  // Let the whole run play out; build-demo.sh compresses it.
  await page.getByText(/REALITY VERIFIED/i).first().waitFor({ timeout: 300000 });
  await page.waitForTimeout(2500);
});

// 4 · evidence — 22s
await scene("scene4-evidence", async (page) => {
  await page.goto(`${BASE}/verify`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Analyze goal/i }).click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /Start verification/i }).click();
  await page.getByText(/REALITY VERIFIED/i).first().waitFor({ timeout: 300000 });
  await page.waitForTimeout(2500);
  await click(page, page.getByRole("button", { name: /Hold confirmed/i }).first(), "chip");
  await page.waitForTimeout(4000);
  // walk the evidence list so the provenance chain is readable
  const modal = page.locator("div.overflow-y-auto").last();
  for (const y of [220, 460, 700]) {
    await modal.evaluate((el, y) => el.scrollTo({ top: y, behavior: "smooth" }), y).catch(() => {});
    await page.waitForTimeout(3200);
  }
  await page.waitForTimeout(2500);
});

// 5a · the verdict — only the tail is kept
await scene("scene5a-verdict", async (page) => {
  await page.goto(`${BASE}/verify`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Analyze goal/i }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Start verification/i }).click();
  await page.getByText(/REALITY VERIFIED/i).first().waitFor({ timeout: 300000 });
  await glide(page, 0, 900);
  await page.waitForTimeout(9000); // hold the money frame
});

// 5b · the honest no — only the tail is kept
await scene("scene5b-honest-no", async (page) => {
  await page.goto(`${BASE}/verify`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await click(page, page.getByText(/honest failure path/i).first(), "failure scenario");
  await page.waitForTimeout(1000);
  await click(page, page.getByRole("button", { name: /Analyze goal/i }), "analyze");
  await page.waitForTimeout(2500);
  await click(page, page.getByRole("button", { name: /Start verification/i }), "start");
  await page.getByText(/NO FULLY VERIFIED MATCH/i).first().waitFor({ timeout: 420000 });
  await glide(page, 0, 900);
  await page.waitForTimeout(9000); // hold
});

// 6 + 7 · terminal frames
for (const [name, html, holds] of [
  ["scene6-real-call", REAL_CALL, [3000, 5000, 7000, 6000]],
  ["scene7-goal-gate", GOAL_GATE, [3500, 5000, 7000]],
]) {
  const file = path.join(OUT, `${name}.html`);
  fs.writeFileSync(file, html);
  await scene(name, async (page) => {
    await page.goto("file://" + file);
    await page.waitForTimeout(800);
    for (const h of holds) await page.waitForTimeout(h);
  });
}

console.log(`\nraw scenes in ${OUT}`);
console.log("next: bash scripts/build-demo.sh " + OUT);
