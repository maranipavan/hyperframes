// Run with node --import tsx. Uses the real engine/producer capture protocol,
// a retained compiled artifact (inlined fonts/GSAP), and fresh browsers.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createFileServer } from "../../packages/producer/src/services/fileServer.ts";
import {
  createCaptureSession,
  initializeSession,
  captureFrameToBuffer,
  closeCaptureSession,
} from "../../packages/engine/dist/services/frameCapture.js";
import { decodePng, encodePng } from "../../packages/engine/dist/utils/alphaBlit.js";
import { gta6CaptureStabilitySource } from "./gta6-stability-hook.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function decode(buffer, format) {
  if (format === "png") return decodePng(buffer);
  const data = execFileSync(
    resolve(root, ".tools/ffmpeg/ffmpeg"),
    [
      "-v",
      "error",
      "-f",
      "image2pipe",
      "-i",
      "pipe:0",
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "pipe:1",
    ],
    { input: buffer, maxBuffer: 1920 * 1080 * 4 + 1024, timeout: 10000 },
  );
  assert.equal(data.length, 1920 * 1080 * 4);
  return { width: 1920, height: 1080, data };
}

function failed(summary) {
  return (
    summary.differingFrames.length > 0 ||
    summary.differingStateFrames.length > 0 ||
    (summary.uniquePixelsPerHeldFrame ?? []).some((count) => count !== 1) ||
    (summary.uniqueStatesPerHeldFrame ?? []).some((count) => count !== 1)
  );
}

function difference(a, b) {
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  let changedPixels = 0,
    maximum = 0,
    squared = 0;
  let left = a.width,
    top = a.height,
    right = -1,
    bottom = -1;
  const diff = new Uint8Array(a.data.length);
  for (let i = 0; i < a.data.length; i += 4) {
    let changed = false;
    for (let c = 0; c < 4; c++) {
      const error = Math.abs(a.data[i + c] - b.data[i + c]);
      maximum = Math.max(maximum, error);
      changed ||= error !== 0;
      if (c < 3) {
        squared += error * error;
        diff[i + c] = Math.min(255, error * 16);
      }
    }
    diff[i + 3] = 255;
    if (changed) {
      changedPixels++;
      const x = (i / 4) % a.width,
        y = Math.floor(i / 4 / a.width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const mse = squared / (a.width * a.height * 3);
  return {
    changedPixels,
    maxChannelError: maximum,
    mse,
    bounds: changedPixels ? { left, top, right, bottom } : null,
    psnr: mse ? 10 * Math.log10(255 ** 2 / mse) : "Infinity",
    diff,
  };
}

if (process.argv[2] === "self-test") {
  const a = { width: 2, height: 1, data: Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255]) };
  assert.equal(difference(a, a).changedPixels, 0);
  const b = { ...a, data: Uint8Array.from([0, 0, 0, 255, 4, 0, 0, 255]) };
  const result = difference(a, b);
  assert.equal(result.maxChannelError, 4);
  assert.equal(result.changedPixels, 1);
  assert.deepEqual(result.bounds, { left: 1, top: 0, right: 1, bottom: 0 });
  assert.equal(result.mse, 16 / 6);
  const stable = {
    differingFrames: [],
    differingStateFrames: [],
    uniquePixelsPerHeldFrame: [1, 1],
  };
  assert.equal(failed(stable), false);
  assert.equal(failed({ ...stable, differingFrames: [845] }), true);
  assert.equal(failed({ ...stable, uniquePixelsPerHeldFrame: [2, 2] }), true);
  assert.equal(failed({ ...stable, uniqueStatesPerHeldFrame: [1, 2] }), true);
  console.log(
    "PASS: raw pixel comparison, bounds, identity, channel error and within/across-run gates",
  );
} else if (process.argv[2] === "verify") {
  await verifyResults();
} else if (process.argv[2] === "compare") {
  await compareHistories();
} else {
  await run();
}

async function compareHistories() {
  const [aPath, bPath, outPath] = process.argv.slice(3);
  assert(aPath && bPath && outPath, "compare <run-a> <run-b> <fresh-json-output>");
  const readRun = async (folder) => {
    const path = await realpath(resolve(root, folder));
    assert(path.startsWith(root + sep));
    return JSON.parse(await readFile(resolve(path, "repeat-1/frames.json"), "utf8")).frames;
  };
  const a = await readRun(aPath),
    b = await readRun(bPath);
  const results = [];
  for (const frame of new Set(a.map((f) => f.seekFrame ?? f.frame))) {
    const first = a.filter((f) => (f.seekFrame ?? f.frame) === frame);
    const second = b.filter((f) => (f.seekFrame ?? f.frame) === frame);
    if (!second.length) continue;
    results.push({
      frame,
      pixelsEqual: new Set([...first, ...second].map((f) => f.rgbaSha256)).size === 1,
      stateEqual: new Set([...first, ...second].map((f) => JSON.stringify(f.state))).size === 1,
    });
  }
  assert(results.length, "No shared absolute frames");
  const summary = {
    aPath,
    bPath,
    comparedFrames: results.length,
    results,
    gatePassed: results.every((r) => r.pixelsEqual && r.stateEqual),
    note: "Compares recorded RGBA/state hashes of repeat-1 over shared absolute frames; verify each input separately.",
  };
  const output = resolve(root, outPath);
  assert((await realpath(dirname(output))).startsWith(root + sep));
  await writeFile(output, JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(summary));
  if (!summary.gatePassed) process.exitCode = 1;
}

async function verifyResults() {
  assert(process.argv[3], "Usage: verify <retained-output>");
  const folder = await realpath(resolve(root, process.argv[3]));
  assert(folder.startsWith(root + sep), "Evidence must be inside workspace");
  const summary = JSON.parse(await readFile(resolve(folder, "summary.json"), "utf8"));
  const rows = [];
  const ext = summary.format === "png" ? "png" : "jpg";
  for (let repeat = 1; repeat <= 2; repeat++) {
    const run = JSON.parse(await readFile(resolve(folder, `repeat-${repeat}/frames.json`), "utf8"));
    assert.equal(run.frames.length, summary.end - summary.start);
    for (const [index, frame] of run.frames.entries()) {
      assert.equal(frame.frame, summary.start + index);
      const buffer = await readFile(resolve(folder, `repeat-${repeat}/${frame.frame}.${ext}`));
      assert.equal(hash(buffer), frame.captureSha256 ?? frame.pngSha256);
      assert.equal(hash(decode(buffer, summary.format).data), frame.rgbaSha256);
    }
    rows.push(run.frames);
  }
  for (const [index, comparison] of summary.comparisons.entries()) {
    assert.equal(comparison.frame, rows[0][index].frame);
    assert.equal(comparison.pixelsEqual, rows[0][index].rgbaSha256 === rows[1][index].rgbaSha256);
    assert.equal(
      comparison.stateEqual,
      JSON.stringify(rows[0][index].state) === JSON.stringify(rows[1][index].state),
    );
  }
  assert.equal(summary.comparisons.length, summary.end - summary.start);
  assert.deepEqual(
    summary.differingFrames,
    summary.comparisons.filter((c) => !c.pixelsEqual).map((c) => c.frame),
  );
  assert.deepEqual(
    summary.differingStateFrames,
    summary.comparisons.filter((c) => !c.stateEqual).map((c) => c.frame),
  );
  if (summary.mode?.startsWith("hold")) {
    assert.deepEqual(
      summary.uniquePixelsPerHeldFrame,
      rows.map((r) => new Set(r.map((f) => f.rgbaSha256)).size),
    );
    // Upgrade the earlier diagnostic's evidence in memory, never rewrite it.
    summary.uniqueStatesPerHeldFrame = rows.map(
      (r) => new Set(r.map((f) => JSON.stringify(f.state))).size,
    );
    assert(rows.every((r) => r.every((f) => f.seekFrame === summary.start)));
  }
  console.log(
    JSON.stringify({
      evidenceVerified: true,
      samples: summary.comparisons.length,
      differingFrames: summary.differingFrames,
      uniquePixelsPerHeldFrame: summary.uniquePixelsPerHeldFrame,
      uniqueStatesPerHeldFrame: summary.uniqueStatesPerHeldFrame,
      gatePassed: !failed(summary),
    }),
  );
  if (failed(summary)) process.exitCode = 1;
}

async function run() {
  const [
    command,
    destination,
    startArg = "810",
    endArg = "900",
    preRollArg = "810",
    mode = "baseline",
    format = "png",
  ] = process.argv.slice(2);
  assert.equal(
    command,
    "run",
    "Usage: node --import tsx scripts/perf/gta6-capture-repeat.mjs run <fresh-output> [start=810] [end=900] [preRollStart=810] [mode=baseline] [png|jpeg]; see the explicit mode allowlist below",
  );
  assert(destination, "Fresh output directory required");
  assert(
    [
      "baseline",
      "geometric",
      "promoted",
      "settle",
      "fonts",
      "beyond",
      "hold",
      "hold-fonts",
      "parent",
      "hold-parent",
      "force2d",
      "hold-force2d",
      "rebuild",
      "hold-rebuild",
      "relayout",
      "hold-relayout",
      "hold-back-relayout",
      "listener",
      "hold-listener",
      "hold-back-listener",
    ].includes(mode),
  );
  assert(["png", "jpeg"].includes(format));
  const ext = format === "png" ? "png" : "jpg";
  const start = Number(startArg),
    end = Number(endArg),
    preRollStart = Number(preRollArg);
  assert([start, end, preRollStart].every(Number.isInteger));
  assert(preRollStart >= 0 && preRollStart <= start && start < end);
  const output = resolve(root, destination);
  const parent = await realpath(dirname(output));
  assert(parent.startsWith(root + sep), "Output must stay inside workspace; parent must exist");
  await mkdir(output); // EEXIST deliberately refuses an earlier run.
  const compiled = await realpath(
    resolve(
      root,
      process.env.GTA6_DIAG_COMPILED_DIR ||
        "packages/.debug/34924e85-649b-4baa-867b-834a88350af2/compiled",
    ),
  );
  assert(compiled.startsWith(root + sep));
  const compiledHtml = await readFile(resolve(compiled, "index.html"), "utf8");
  const sourceHash = hash(compiledHtml);
  const duration = Number(
    compiledHtml.match(/data-composition-id="main"[^>]*data-duration="([\d.]+)"/)?.[1],
  );
  assert(Number.isFinite(duration) && duration > 0 && duration <= 600 && end <= duration * 30);
  await writeFile(
    resolve(output, "run.json"),
    JSON.stringify(
      {
        args: process.argv.slice(2),
        compiledSha256: sourceHash,
        scriptSha256: hash(await readFile(fileURLToPath(import.meta.url))),
        browserExecutable: process.env.HYPERFRAMES_BROWSER_PATH || "/usr/bin/chromium",
        start,
        end,
        preRollStart,
        mode,
        format,
        status: "started; summary.json required for a completed result",
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  const server = await createFileServer({
    projectDir: resolve(root, "reports/performance-full/workers-input/baseline"),
    compiledDir: compiled,
    fps: { num: 30, den: 1 },
  });
  const runs = [];
  try {
    for (let repeat = 1; repeat <= 2; repeat++) {
      const folder = resolve(output, `repeat-${repeat}`);
      await mkdir(folder);
      const session = await createCaptureSession(
        server.url,
        folder,
        {
          width: 1920,
          height: 1080,
          fps: { num: 30, den: 1 },
          compositionDurationSeconds: duration,
          format,
          quality: 80,
          deviceScaleFactor: 1,
          ...(mode === "beyond" ? { captureBeyondViewport: true } : {}),
        },
        mode === "settle"
          ? async (page) => {
              await page.evaluate(
                () =>
                  new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
              );
            }
          : mode.endsWith("relayout")
            ? async (page) => {
                await page.evaluate(() => {
                  const element = document.querySelector("#s3 .scene-inner");
                  const value = element.style.getPropertyValue("display");
                  const priority = element.style.getPropertyPriority("display");
                  element.style.setProperty("display", "none", "important");
                  void document.body.offsetWidth;
                  if (value) element.style.setProperty("display", value, priority);
                  else element.style.removeProperty("display");
                });
              }
            : mode.endsWith("rebuild")
              ? async (page) => {
                  await page.evaluate(() => {
                    // Diagnostic only: preserve DOM node identities/GSAP targets,
                    // but recreate layout/paint objects for the affected subtree.
                    const element = document.querySelector("#s3 .scene-inner");
                    const parent = element.parentNode,
                      next = element.nextSibling;
                    element.remove();
                    void document.body.offsetWidth;
                    parent.insertBefore(element, next);
                  });
                }
              : mode.endsWith("fonts")
                ? async (page) => {
                    await page.evaluate(async () => {
                      await document.fonts.ready;
                    });
                  }
                : null,
        {
          chromePath: process.env.HYPERFRAMES_BROWSER_PATH || "/usr/bin/chromium",
          browserGpuMode: "software",
          forceScreenshot: true,
          useDrawElement: false,
          enableBrowserPool: false,
          protocolTimeout: 60000,
        },
      );
      const frames = [];
      try {
        await initializeSession(session);
        assert.equal(session.captureMode, "screenshot");
        if (mode === "geometric")
          await session.page.addStyleTag({
            content: ".ch-num { text-rendering: geometricPrecision !important; }",
          });
        if (mode === "promoted")
          await session.page.addStyleTag({ content: ".ch-num { will-change: transform; }" });
        if (mode === "parent" || mode === "hold-parent")
          await session.page.addStyleTag({ content: ".scene-inner { will-change: transform; }" });
        if (mode === "force2d" || mode === "hold-force2d")
          await session.page.evaluate(() => {
            window.gsap.set(".scene-inner", { force3D: false });
          });
        if (mode.endsWith("listener"))
          await session.page.addScriptTag({ content: gta6CaptureStabilitySource });
        const browser = await session.browser.version();
        if (mode.includes("back")) {
          const laterFrame = Math.min(duration * 30 - 1, start + 54);
          await captureFrameToBuffer(session, laterFrame, laterFrame / 30);
        }
        for (let frame = preRollStart; frame < end; frame++) {
          const seekFrame = mode.startsWith("hold") && frame >= start ? start : frame;
          const { buffer } = await captureFrameToBuffer(session, seekFrame, seekFrame / 30);
          if (frame < start) continue;
          const png = decode(buffer, format);
          assert.equal(png.width, 1920);
          assert.equal(png.height, 1080);
          await writeFile(resolve(folder, `${frame}.${ext}`), buffer, { flag: "wx" });
          const state = await session.page.evaluate(() =>
            [...document.querySelectorAll("#s3,#s3 .scene-inner,#s3 .ch-num,#s3 .rv,#wipe")].map(
              (el) => {
                const rect = el.getBoundingClientRect(),
                  css = getComputedStyle(el);
                return {
                  id: el.id,
                  className: el.className,
                  rect: [rect.x, rect.y, rect.width, rect.height],
                  transform: css.transform,
                  opacity: css.opacity,
                  display: css.display,
                  visibility: css.visibility,
                  font: css.font,
                  stroke: css.webkitTextStroke,
                  fontsStatus: document.fonts.status,
                };
              },
            ),
          );
          frames.push({
            frame,
            seekFrame,
            captureSha256: hash(buffer),
            rgbaSha256: hash(png.data),
            state,
          });
        }
        runs.push({
          repeat,
          browser,
          stabilityStats: await session.page.evaluate(() => window.__gta6CaptureStability ?? null),
          captureMode: session.captureMode,
          captureBeyondViewport: session.options.captureBeyondViewport,
          frames,
        });
        await writeFile(resolve(folder, "frames.json"), JSON.stringify(runs.at(-1), null, 2));
        console.log(
          `Captured repeat ${repeat}: ${frames.length} pre-video-encode ${format} frames`,
        );
      } finally {
        await closeCaptureSession(session);
      }
    }
  } catch (error) {
    await writeFile(
      resolve(output, "failure.json"),
      JSON.stringify(
        {
          error: error instanceof Error ? error.message : String(error),
          completedRuns: runs.length,
        },
        null,
        2,
      ),
      { flag: "wx" },
    );
    throw error;
  } finally {
    server.close();
  }
  await compareRuns({ output, compiled, sourceHash, start, end, preRollStart, mode, format, runs });
}

async function compareRuns({
  output,
  compiled,
  sourceHash,
  start,
  end,
  preRollStart,
  mode,
  format,
  runs,
}) {
  const comparisons = [];
  const ext = format === "png" ? "png" : "jpg";
  let worstMse = -1;
  for (let index = 0; index < end - start; index++) {
    const a = runs[0].frames[index],
      b = runs[1].frames[index];
    assert.equal(a.frame, start + index);
    assert.equal(a.frame, b.frame);
    const pixelsEqual = a.rgbaSha256 === b.rgbaSha256;
    const stateEqual = JSON.stringify(a.state) === JSON.stringify(b.state);
    const result = { frame: a.frame, seekFrame: a.seekFrame, pixelsEqual, stateEqual };
    if (!pixelsEqual) {
      const first = decode(
        await readFile(resolve(output, "repeat-1", `${a.frame}.${ext}`)),
        format,
      );
      const second = decode(
        await readFile(resolve(output, "repeat-2", `${a.frame}.${ext}`)),
        format,
      );
      const { diff, ...metrics } = difference(first, second);
      Object.assign(result, metrics);
      if (metrics.mse > worstMse) {
        worstMse = metrics.mse;
        await writeFile(
          resolve(output, "worst-diff-x16.png"),
          encodePng(first.width, first.height, diff),
        );
      }
    }
    comparisons.push(result);
  }
  assert.equal(hash(await readFile(resolve(compiled, "index.html"))), sourceHash);
  const summary = {
    compiled: relative(root, compiled),
    compiledSha256: sourceHash,
    start,
    end,
    preRollStart,
    mode,
    browsers: runs.map((r) => r.browser),
    effectiveCaptureBeyondViewport: runs.map((r) => r.captureBeyondViewport),
    ...(mode.startsWith("hold")
      ? {
          uniquePixelsPerHeldFrame: runs.map(
            (r) => new Set(r.frames.map((f) => f.rgbaSha256)).size,
          ),
          uniqueStatesPerHeldFrame: runs.map(
            (r) => new Set(r.frames.map((f) => JSON.stringify(f.state))).size,
          ),
        }
      : {}),
    format,
    captureMode: "screenshot",
    note: "No video encoder; fresh browsers, frozen compiled HTML. PNG uses alpha capture. Diagnostic decoding/state reads add overhead unlike streaming JPEG production.",
    differingFrames: comparisons.filter((c) => !c.pixelsEqual).map((c) => c.frame),
    differingStateFrames: comparisons.filter((c) => !c.stateEqual).map((c) => c.frame),
    comparisons,
  };
  await writeFile(resolve(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      samples: comparisons.length,
      differingFrames: summary.differingFrames,
      differingStateFrames: summary.differingStateFrames,
      uniquePixelsPerHeldFrame: summary.uniquePixelsPerHeldFrame,
      uniqueStatesPerHeldFrame: summary.uniqueStatesPerHeldFrame,
      gatePassed: !failed(summary),
    }),
  );
  // An observed mismatch is a failing determinism gate, not a passing diagnostic.
  if (failed(summary)) process.exitCode = 1;
}
