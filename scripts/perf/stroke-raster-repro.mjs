// Standalone diagnostic, not a composition. Existing workspace dependencies only.
// node scripts/perf/stroke-raster-repro.mjs {self-test|run <fresh-output>|verify <output>}
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildChromeArgs } from "../../packages/engine/dist/services/browserManager.js";
import { decodePng, encodePng } from "../../packages/engine/dist/utils/alphaBlit.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceRoot = "reports/performance-full/stroke-minimal";
const compiledPath = "packages/.debug/34924e85-649b-4baa-867b-834a88350af2/compiled/index.html";
const originalPath = "reports/performance-full/capture-repeat-held-fonts-845";
const scriptPath = "scripts/perf/stroke-raster-repro.mjs";
const sampleCount = 12;
const budgetMs = 290_000;
const viewport = { width: 1920, height: 1080, deviceScaleFactor: 1 };
// Same CDP call/parameters as built screenshotService.pageScreenshotCapture (PNG).
const screenshotOptions = {
  format: "png",
  fromSurface: true,
  captureBeyondViewport: false,
  optimizeForSpeed: false,
  clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
};
const sha = (value) => createHash("sha256").update(value).digest("hex");
const stateHash = (value) => sha(JSON.stringify(value));
const read = (path) => readFile(resolve(root, path));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = (path, value) =>
  writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });

function outputPath(argument) {
  assert(argument && !isAbsolute(argument), "Supply a workspace-relative output path");
  const output = resolve(root, argument);
  assert.equal(
    dirname(output),
    resolve(root, evidenceRoot),
    `Output must be a child of ${evidenceRoot}`,
  );
  return output;
}

function difference(a, b) {
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  assert.equal(a.data.length, a.width * a.height * 4);
  assert.equal(b.data.length, a.data.length);
  let changedPixels = 0,
    maxChannelError = 0,
    squaredRgba = 0;
  let left = a.width,
    top = a.height,
    right = -1,
    bottom = -1;
  for (let i = 0; i < a.data.length; i += 4) {
    let changed = false;
    for (let c = 0; c < 4; c++) {
      const error = Math.abs(a.data[i + c] - b.data[i + c]);
      changed ||= error !== 0;
      maxChannelError = Math.max(maxChannelError, error);
      squaredRgba += error * error;
    }
    if (!changed) continue;
    changedPixels++;
    const x = (i / 4) % a.width,
      y = Math.floor(i / 4 / a.width);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  return {
    changedPixels,
    maxChannelError,
    mseRgba: squaredRgba / a.data.length,
    bounds: changedPixels ? { left, top, right, bottom } : null,
  };
}

function diffPng(a, b) {
  const data = new Uint8Array(a.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alphaError = Math.abs(a.data[i + 3] - b.data[i + 3]);
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.min(
        255,
        16 * Math.max(alphaError, Math.abs(a.data[i + c] - b.data[i + c])),
      );
    }
    data[i + 3] = 255;
  }
  return encodePng(a.width, a.height, data);
}

function extract(source) {
  // Parse only style blocks: never execute or carry over source scripts/markup.
  const css = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1])
    .join("\n");
  const fontRules = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]);
  const fonts = fontRules.filter(
    (rule) =>
      /font-family:\s*["']Inter["']\s*;/.test(rule) &&
      /font-style:\s*normal\s*;/.test(rule) &&
      /font-weight:\s*100 900\s*;/.test(rule),
  );
  assert.equal(
    fonts.length,
    1,
    "Expected the single normal variable Inter face used at weight 800",
  );
  const fontCss = fonts[0];
  const urls = [...fontCss.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^data:font\/woff2;base64,[A-Za-z0-9+/=]+$/);
  const selectors = [
    "*",
    "html, body",
    "body",
    "#root",
    ".scene",
    ".scene-inner",
    ".chapter",
    ".ch-num",
  ];
  const rules = [...css.matchAll(/(?:^|\n)\s*([^{}]+)\{([^{}]*)\}/g)];
  const selected = selectors.map((selector) => {
    const matches = rules.filter((m) => m[1].trim() === selector);
    assert.equal(matches.length, 1, `Expected exactly one rule: ${selector}`);
    return `${selector} {${matches[0][2]}}`;
  });
  assert(
    source.includes(
      'data-hyperframes-text-rendering="true">html,body,*{text-rendering:geometricPrecision}',
    ),
  );
  assert(!selected.some((rule) => /url\(|@import|animation|transition/i.test(rule)));
  return {
    fontCss,
    fontBytesSha256: sha(Buffer.from(urls[0].split(",")[1], "base64")),
    targetCss: `html,body,*{text-rendering:geometricPrecision}\n${selected.join("\n")}`,
    selectors,
  };
}

function historyAt(frame) {
  // Source FI: power1.out, 0.25s. PUSH: 1 -> 1.022 over 9.44s, linear.
  // GSAP emits scale rounded to four decimals and opacity to four decimals.
  const elapsed = Math.max(0, frame / 30 - 28.08);
  const progress = Math.min(1, elapsed / 0.25);
  return {
    frame,
    seconds: frame / 30,
    display: frame / 30 < 28.08 ? "none" : "flex",
    scale: Number((1 + (0.022 * elapsed) / 9.44).toFixed(4)),
    opacity: Number((1 - (1 - progress) ** 2).toFixed(4)),
  };
}

function makePage(parts, height) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:">
<title>Static outlined 01 raster diagnostic</title><style>
${parts.fontCss}
${parts.targetCss}
/* Preserve the original parent box after removing its invisible text siblings. */
.scene-inner { height: ${height}px; }
/* Match the engine PNG initialization, retaining the opaque #root ground. */
html,body { background: transparent !important; }
</style></head><body><div id="root"><section id="s3" class="scene" style="display:none;opacity:0"><div class="scene-inner chapter" style="transform:scale(1)"><div class="ch-num">01</div></div></section></div></body></html>`;
}

async function snapshot(page) {
  return page.evaluate(() => ({
    // Clock values are observations, deliberately excluded from the DOM-state hash.
    clock: { performanceNowMs: performance.now(), timelineMs: document.timeline.currentTime },
    state: {
      dom: document.querySelector("#root").outerHTML,
      fontsStatus: document.fonts.status,
      font800Loaded: document.fonts.check("800 380px Inter", "01"),
      fontFaces: [...document.fonts].map((font) => ({
        family: font.family,
        style: font.style,
        weight: font.weight,
        status: font.status,
      })),
      animations: document.getAnimations().length,
      scripts: document.scripts.length,
      devicePixelRatio,
      elements: [...document.querySelectorAll("#root,#s3,.scene-inner,.ch-num")].map((el) => {
        const rect = el.getBoundingClientRect(),
          css = getComputedStyle(el);
        return {
          id: el.id,
          className: el.className,
          rect: [rect.x, rect.y, rect.width, rect.height],
          transform: css.transform,
          transformOrigin: css.transformOrigin,
          opacity: css.opacity,
          display: css.display,
          visibility: css.visibility,
          font: css.font,
          letterSpacing: css.letterSpacing,
          color: css.color,
          stroke: css.webkitTextStroke,
          fill: css.webkitTextFillColor,
          textRendering: css.textRendering,
          willChange: css.willChange,
        };
      }),
    },
  }));
}

async function applyState(page, state) {
  await page.evaluate(({ display, scale, opacity }) => {
    const scene = document.querySelector("#s3");
    scene.style.display = display;
    scene.style.opacity = String(opacity);
    document.querySelector(".scene-inner").style.transform = `scale(${scale})`;
  }, state);
}

function summarize(rows) {
  const states = new Set(rows.flatMap((r) => [r.beforeStateSha256, r.afterStateSha256]));
  const pixels = new Set(rows.map((r) => r.rgbaSha256));
  return {
    samples: rows.length,
    uniqueRgba: pixels.size,
    uniqueDomStates: states.size,
    temporalPixelDrift: pixels.size > 1,
    fixedStateDrift: pixels.size > 1 && states.size === 1,
    sequence: rows.map((r) => [...pixels].indexOf(r.rgbaSha256)),
    hashes: [...pixels],
  };
}

async function executable() {
  if (process.env.HYPERFRAMES_BROWSER_PATH) return process.env.HYPERFRAMES_BROWSER_PATH;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    for (const name of ["chromium", "chromium-browser", "google-chrome"]) {
      const candidate = resolve(dir, name);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        /* next candidate */
      }
    }
  }
  throw new Error("Set HYPERFRAMES_BROWSER_PATH to the browser used for the held-frame evidence");
}

async function validateOriginal(output) {
  const records = [];
  for (const repeat of [1, 2]) {
    const run = await json(resolve(root, originalPath, `repeat-${repeat}/frames.json`));
    let first;
    const variants = new Map();
    const states = new Set();
    for (const frame of run.frames) {
      assert.equal(frame.seekFrame, 845);
      const path = `${originalPath}/repeat-${repeat}/${frame.frame}.png`;
      const bytes = await read(path),
        decoded = decodePng(bytes);
      assert.equal(sha(bytes), frame.captureSha256);
      assert.equal(sha(decoded.data), frame.rgbaSha256);
      states.add(stateHash(frame.state));
      first ??= decoded;
      if (!variants.has(frame.rgbaSha256))
        variants.set(frame.rgbaSha256, {
          firstAtFrameLabel: frame.frame,
          sourcePng: path,
          rgbaSha256: frame.rgbaSha256,
          versusFirst: difference(first, decoded),
        });
    }
    records.push({
      repeat,
      browser: run.browser,
      samples: run.frames.length,
      uniqueDomStates: states.size,
      uniqueRgba: variants.size,
      sequence: run.frames.map((f) => [...variants.keys()].indexOf(f.rgbaSha256)),
      variants: [...variants.values()],
    });
  }
  await writeJson(resolve(output, "original-evidence-validation.json"), records);
  return records;
}

async function captureCase({
  puppeteer,
  browserPath,
  args,
  html,
  output,
  history,
  hint,
  repeat,
  deadline,
  reference,
}) {
  const id = `${history}-${hint ? "parent-hint" : "no-hint"}-${repeat}`;
  const folder = resolve(output, id);
  await mkdir(folder);
  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    defaultViewport: null,
    args,
    timeout: 20_000,
    protocolTimeout: 20_000,
  });
  // Harness-only watchdog: the page contains no script, timer, rAF or animation.
  const watchdog = setTimeout(
    () => browser.process()?.kill("SIGKILL"),
    Math.max(1, deadline - performance.now()),
  );
  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    const errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const local = /^(data:|about:)/.test(request.url());
      requests.push({ scheme: request.url().split(":")[0], blocked: !local });
      void (local ? request.continue() : request.abort()).catch((error) =>
        errors.push(String(error)),
      );
    });
    await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
    const cdp = await page.createCDPSession();
    await cdp.send("Emulation.setDefaultBackgroundColorOverride", {
      color: { r: 0, g: 0, b: 0, a: 0 },
    });
    await page.evaluate(async (promote) => {
      document.querySelector(".scene-inner").style.willChange = promote ? "transform" : "auto";
      await document.fonts.load("800 380px Inter", "01");
      await document.fonts.ready;
    }, hint);
    const capture = async () => {
      assert(performance.now() < deadline, "Browser experiment time budget exhausted");
      const result = await cdp.send("Page.captureScreenshot", screenshotOptions);
      return Buffer.from(result.data, "base64");
    };
    const prelude = [];
    const steps =
      history === "plain"
        ? [historyAt(830)]
        : Array.from({ length: 15 }, (_, i) => historyAt(830 + i));
    for (const step of steps) {
      await applyState(page, step);
      const bytes = await capture();
      const path = `setup-${step.frame}.png`;
      await writeFile(resolve(folder, path), bytes, { flag: "wx" });
      prelude.push({
        ...step,
        path,
        pngSha256: sha(bytes),
        rgbaSha256: sha(decodePng(bytes).data),
        snapshot: await snapshot(page),
      });
    }
    const held = historyAt(845);
    await applyState(page, held);
    // No DOM writes after this point. Each sample is a fresh screenshot of fixed state.
    const rows = [];
    let first, previous;
    for (let index = 0; index < sampleCount; index++) {
      const startedAt = new Date().toISOString(),
        startMs = performance.now();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const before = await snapshot(page);
      const bytes = await capture();
      const after = await snapshot(page);
      const decoded = decodePng(bytes);
      assert.equal(decoded.width, viewport.width);
      assert.equal(decoded.height, viewport.height);
      first ??= decoded;
      previous ??= decoded;
      const path = `sample-${String(index).padStart(2, "0")}.png`;
      const versusFirst = difference(first, decoded),
        versusPrevious = difference(previous, decoded);
      await writeFile(resolve(folder, path), bytes, { flag: "wx" });
      if (versusPrevious.changedPixels)
        await writeFile(resolve(folder, `diff-${index}-x16.png`), diffPng(previous, decoded), {
          flag: "wx",
        });
      rows.push({
        index,
        path,
        heldFrame: 845,
        heldSeconds: 845 / 30,
        startedAt,
        elapsedMs: performance.now() - startMs,
        pngSha256: sha(bytes),
        rgbaSha256: sha(decoded.data),
        beforeStateSha256: stateHash(before.state),
        afterStateSha256: stateHash(after.state),
        before,
        after,
        versusFirst,
        versusPrevious,
      });
      previous = decoded;
    }
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root: documentNode } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: documentNode.nodeId,
      selector: ".ch-num",
    });
    const platformFonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    const observed = rows[0].before.state;
    const geometry = observed.elements.slice(1).map((element, i) => ({
      className: element.className,
      original: reference[i].rect,
      minimal: element.rect,
      delta: element.rect.map((value, c) => value - reference[i].rect[c]),
    }));
    const record = {
      id,
      history,
      hintOnScalingParent: hint,
      repeat,
      browser: await browser.version(),
      browserProtocol: await cdp.send("Browser.getVersion"),
      launchArguments: browser.process().spawnargs,
      screenshotOptions,
      viewport,
      platformFonts,
      requests,
      errors,
      geometry,
      prelude,
      rows,
      ...summarize(rows),
    };
    await writeJson(resolve(folder, "samples.json"), record);
    assert.equal(errors.length, 0, `Browser errors in ${id}`);
    assert(
      requests.every((request) => !request.blocked),
      "Unexpected network attempt",
    );
    assert(
      rows.every((r) => r.before.state.fontsStatus === "loaded" && r.before.state.font800Loaded),
    );
    assert.equal(observed.scripts, 0);
    assert.equal(observed.animations, 0);
    assert.equal(observed.elements[1].opacity, "0.5732");
    assert.equal(observed.elements[2].transform, "matrix(1.0002, 0, 0, 1.0002, 0, 0)");
    assert.equal(observed.elements[2].willChange, hint ? "transform" : "auto");
    assert.equal(observed.elements[3].willChange, "auto");
    assert.equal(observed.elements[3].font, reference[2].font);
    assert.equal(observed.elements[3].stroke, reference[2].stroke);
    assert.equal(observed.elements[3].letterSpacing, "-22.8px");
    assert(
      geometry.every((g) => g.delta.every((delta) => Math.abs(delta) < 0.02)),
      "Minimal geometry deviated from reference",
    );
    console.log(JSON.stringify({ id, ...summarize(rows) }));
    return { id, history, hintOnScalingParent: hint, repeat, ...summarize(rows) };
  } finally {
    await browser.close().catch(() => browser.process()?.kill("SIGKILL"));
    clearTimeout(watchdog);
  }
}

async function run(destination) {
  const output = outputPath(destination);
  assert.equal(
    await realpath(dirname(output)),
    dirname(output),
    "Symlinked evidence directory refused",
  );
  await mkdir(output); // Deliberately non-recursive: EEXIST refuses all prior evidence.
  const started = performance.now(),
    startedAt = new Date().toISOString();
  const completed = [];
  try {
    const source = (await read(compiledPath)).toString();
    const parts = extract(source);
    const originalRun = await json(resolve(root, originalPath, "run.json"));
    assert.equal(sha(source), originalRun.compiledSha256);
    assert(source.includes("PUSH('#s3 .scene-inner',28.08,9.44)"));
    assert(source.includes("duration: 0.25, ease: 'power1.out'"));
    assert(source.includes("scale: 1.022, duration: d, ease: 'none'"));
    const originalFrames = await json(resolve(root, originalPath, "repeat-1/frames.json"));
    const reference = originalFrames.frames[0].state.slice(0, 3);
    // Undo the known scale and snap to Blink's 1/64px layout units.
    const parentHeight = Math.round((reference[1].rect[3] / 1.0002) * 64) / 64;
    const html = makePage(parts, parentHeight);
    await writeFile(resolve(output, "minimal.html"), html, { flag: "wx" });
    const sources = {};
    for (const path of [
      compiledPath,
      scriptPath,
      "packages/engine/dist/services/browserManager.js",
      "packages/engine/dist/services/screenshotService.js",
      "packages/engine/dist/utils/alphaBlit.js",
      "bun.lock",
      "packages/engine/package.json",
      ...["run.json", "summary.json", "repeat-1/frames.json", "repeat-2/frames.json"].map(
        (p) => `${originalPath}/${p}`,
      ),
    ]) {
      sources[path] = sha(await read(path));
    }
    const original = await validateOriginal(output);
    const requireEngine = createRequire(resolve(root, "packages/engine/package.json"));
    const puppeteer = (await import(requireEngine.resolve("puppeteer"))).default;
    const browserPath = await executable();
    const args = buildChromeArgs(
      { width: 1920, height: 1080, captureMode: "screenshot", requiresWebGpu: false },
      { browserGpuMode: "software" },
    );
    assert(args.includes("--disable-gpu-compositing"));
    assert(!args.includes("--enable-begin-frame-control"));
    await writeJson(resolve(output, "run.json"), {
      command: ["node", scriptPath, ...process.argv.slice(2)],
      startedAt,
      budgetMs,
      sampleCount,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      puppeteer: requireEngine("puppeteer/package.json").version,
      browserPath,
      args,
      screenshotOptions,
      viewport,
      sources,
      fontCssSha256: sha(parts.fontCss),
      fontBytesSha256: parts.fontBytesSha256,
      targetCssSha256: sha(parts.targetCss),
      minimalHtmlSha256: sha(html),
      extractedSelectors: parts.selectors,
      parentHeight,
      reference,
      sourceBrowser: original[0].browser,
      plan: "Two repeats of plain hide/reveal, without/with hint on scaling parent; if both plain no-hint runs stable, two repeats of 830..844 pre-roll then hold 845 without/with parent hint. At most eight fresh browsers.",
      historyDerivation:
        "FI power1.out 0.25s at 28.08; PUSH 1 -> 1.022 over 9.44s. Four-decimal style values. Pre-start display:none models engine clip visibility; source scripts never execute.",
      scene:
        "Only root, opacity ancestor, scaling flex parent, outlined 01; inline normal variable Inter; no scripts/animation/timers/media/network. Harness drives discrete style changes before hold only.",
    });
    const deadline = started + budgetMs;
    for (const history of ["plain", "preroll"]) {
      if (
        history === "preroll" &&
        completed.some(
          (r) => r.history === "plain" && !r.hintOnScalingParent && r.temporalPixelDrift,
        )
      )
        break;
      for (const repeat of [1, 2]) {
        for (const hint of [false, true]) {
          assert(
            performance.now() + 20_000 < deadline,
            "Insufficient remaining time for another fresh browser",
          );
          completed.push(
            await captureCase({
              puppeteer,
              browserPath,
              args,
              html,
              output,
              history,
              hint,
              repeat,
              deadline,
              reference,
            }),
          );
        }
      }
    }
    for (const [path, hash] of Object.entries(sources))
      assert.equal(sha(await read(path)), hash, `Input changed during diagnostic: ${path}`);
    const summary = {
      status: "completed",
      elapsedSeconds: (performance.now() - started) / 1000,
      sourcesUnchanged: true,
      cases: completed,
      reproducedFixedStateDrift: completed.some((r) => r.fixedStateDrift),
      crossBrowser: [...new Set(completed.map((r) => r.history))].flatMap((history) =>
        [false, true].map((hint) => {
          const runs = completed.filter(
            (r) => r.history === history && r.hintOnScalingParent === hint,
          );
          return {
            history,
            hint,
            repeats: runs.length,
            uniqueRgbaAcrossBrowsers: new Set(runs.flatMap((r) => r.hashes)).size,
          };
        }),
      ),
      caveats: [
        "Negative result does not disprove original temporal drift; original PNGs verified separately without running the original scene.",
        "Reduced page removes sibling paint, gradients, wipe, full layer tree, framework seeks and render scheduling. Pre-roll matches target style history, not full compositor history.",
        "No scene clock exists: heldSeconds is a reference label. Wall/browser times advance and are recorded separately from DOM state.",
        "State reads, font readiness checks, decoding and file writes affect capture spacing. This is a bounded diagnostic, not a production benchmark or a fix recommendation.",
        "Will-change is an experimental hint on the scaling parent only; equal stability in both arms cannot establish a benefit.",
      ],
    };
    await writeJson(resolve(output, "summary.json"), summary);
    console.log(
      JSON.stringify({
        output: relative(root, output),
        elapsedSeconds: summary.elapsedSeconds,
        reproducedFixedStateDrift: summary.reproducedFixedStateDrift,
      }),
    );
  } catch (error) {
    await writeJson(resolve(output, "failure.json"), {
      error: String(error),
      completed,
      elapsedSeconds: (performance.now() - started) / 1000,
    });
    throw error;
  }
}

async function verify(destination) {
  const output = outputPath(destination);
  assert.equal(await realpath(output), output);
  const manifest = await json(resolve(output, "run.json"));
  const summary = await json(resolve(output, "summary.json"));
  assert.equal(summary.status, "completed");
  assert.equal(sha(await readFile(resolve(output, "minimal.html"))), manifest.minimalHtmlSha256);
  for (const [path, hash] of Object.entries(manifest.sources))
    assert.equal(sha(await read(path)), hash, path);
  for (const item of summary.cases) {
    const record = await json(resolve(output, item.id, "samples.json"));
    assert.equal(record.rows.length, sampleCount);
    let first, previous;
    for (const row of record.rows) {
      const bytes = await readFile(resolve(output, item.id, row.path)),
        decoded = decodePng(bytes);
      assert.equal(sha(bytes), row.pngSha256);
      assert.equal(sha(decoded.data), row.rgbaSha256);
      assert.equal(stateHash(row.before.state), row.beforeStateSha256);
      assert.equal(stateHash(row.after.state), row.afterStateSha256);
      first ??= decoded;
      previous ??= decoded;
      assert.deepEqual(difference(first, decoded), row.versusFirst);
      assert.deepEqual(difference(previous, decoded), row.versusPrevious);
      previous = decoded;
    }
    for (const step of record.prelude) {
      const bytes = await readFile(resolve(output, item.id, step.path));
      assert.equal(sha(bytes), step.pngSha256);
      assert.equal(sha(decodePng(bytes).data), step.rgbaSha256);
    }
    for (const [key, value] of Object.entries(summarize(record.rows)))
      assert.deepEqual(item[key], value);
  }
  assert.equal(
    summary.reproducedFixedStateDrift,
    summary.cases.some((r) => r.fixedStateDrift),
  );
  console.log(
    `PASS: verified ${summary.cases.length} cases, all setup/held PNGs, decoded pixel metrics, states and source hashes`,
  );
}

async function selfTest() {
  const a = { width: 2, height: 1, data: Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255]) };
  const b = { ...a, data: Uint8Array.from([0, 0, 0, 255, 4, 0, 0, 253]) };
  assert.deepEqual(difference(a, b), {
    changedPixels: 1,
    maxChannelError: 4,
    mseRgba: 20 / 8,
    bounds: { left: 1, top: 0, right: 1, bottom: 0 },
  });
  assert.equal(difference(a, a).changedPixels, 0);
  assert.equal(
    difference(a, { ...a, data: Uint8Array.from([0, 0, 0, 254, 0, 0, 0, 255]) }).changedPixels,
    1,
  );
  assert.throws(() => difference(a, { ...b, width: 1 }));
  const decoded = decodePng(encodePng(b.width, b.height, b.data));
  assert.equal(difference(b, decoded).changedPixels, 0);
  const source = (await read(compiledPath)).toString(),
    parts = extract(source);
  assert(parts.fontCss.includes("data:font/woff2;base64,"));
  assert.throws(() => extract(source.replaceAll("data:font/woff2;base64,", "https://invalid/")));
  const html = makePage(parts, 353.859375);
  assert(!/<script|<audio|<video|gsap|setTimeout|setInterval|requestAnimationFrame/i.test(html));
  assert.equal((html.match(/@font-face/g) ?? []).length, 1);
  assert.deepEqual(historyAt(845), {
    frame: 845,
    seconds: 845 / 30,
    display: "flex",
    scale: 1.0002,
    opacity: 0.5732,
  });
  assert.equal(historyAt(842).display, "none");
  assert.equal(historyAt(844).scale, 1.0001);
  assert.throws(() => outputPath("reports/performance-full/elsewhere"));
  assert.throws(() => outputPath(`${evidenceRoot}/../elsewhere`));
  assert.throws(() => outputPath(resolve(root, evidenceRoot, "absolute")));
  const row = { rgbaSha256: "a", beforeStateSha256: "state", afterStateSha256: "state" };
  assert.equal(summarize([row, row]).fixedStateDrift, false);
  assert.equal(summarize([row, { ...row, rgbaSha256: "b" }]).fixedStateDrift, true);
  assert.equal(
    summarize([row, { ...row, rgbaSha256: "b", afterStateSha256: "changed" }]).fixedStateDrift,
    false,
  );
  console.log(
    "PASS: RGBA/alpha differences, bounds, PNG roundtrip, font-only extraction, static page, history values, output scope and fixed-state drift classification",
  );
}

const [command, destination, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0, "Unexpected arguments");
if (command === "self-test" && !destination) await selfTest();
else if (command === "run" && destination) await run(destination);
else if (command === "verify" && destination) await verify(destination);
else
  throw new Error(
    `Usage: node ${scriptPath} self-test | run ${evidenceRoot}/<fresh-name> | verify ${evidenceRoot}/<name>`,
  );
