// Raw, lossless screenshot check; separate from lossy MP4 quality metrics.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodePng, encodePng } from "../../packages/engine/dist/utils/alphaBlit.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "packages/engine/package.json"));
const puppeteer = require("puppeteer");
const project = resolve(root, "reports/performance-full/repro");
const output = resolve(root, "reports/performance-full/raw-visual");
await mkdir(output, { recursive: true });
assert.equal((await readdir(output)).length, 0, "Refuse to overwrite an earlier run");
const html = await readFile(resolve(project, "baseline/index.html"), "utf8");
const frames = new Set([0, 30, 60, 149, 2686, 9366, 11662, 17999]);
for (const match of html.matchAll(
  /<section[^>]*data-start="([\d.]+)"[^>]*data-duration="([\d.]+)"/g,
)) {
  frames.add(Math.round((Number(match[1]) + Number(match[2]) / 2) * 30));
}
for (const match of html.matchAll(/WIPE\(([\d.]+)\);/g)) {
  const boundary = Math.round(Number(match[1]) * 30);
  for (const offset of [-1, 0, 1]) frames.add(boundary + offset);
}
const browser = await puppeteer.launch({
  executablePath: process.env.HYPERFRAMES_BROWSER_PATH || "/usr/bin/chromium",
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  protocolTimeout: 30000,
});
const results = [];
try {
  const pages = [];
  for (const variant of ["baseline", "texture"]) {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(resolve(project, variant, "index.html")).href, {
      waitUntil: "load",
    });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    assert(await page.evaluate(() => !!window.__timelines?.main), "Timeline missing");
    pages.push(page);
  }
  // Seek backwards as well as forwards: direct seek must reconstruct state.
  const sampleFrames = [...frames].sort((a, b) => a - b).concat([9366, 30, 9366]);
  for (const frame of sampleFrames) {
    const shots = [];
    const geometry = [];
    const positions = [];
    for (const page of pages) {
      await page.bringToFront();
      // NEVER return a GSAP timeline: it is thenable; Puppeteer would await
      // completion of the paused animation and eventually time out.
      const state = await page.evaluate((time) => {
        window.__timelines.main.seek(time);
        return {
          grid: getComputedStyle(document.querySelector("#grid")).backgroundPosition,
          boxes: [...document.querySelectorAll(".scene-inner,.rv,.it,.cap span,#wipe")].map(
            (element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return [
                rect.x,
                rect.y,
                rect.width,
                rect.height,
                style.opacity,
                style.transform,
                style.visibility,
              ];
            },
          ),
        };
      }, frame / 30);
      geometry.push(state.boxes);
      positions.push(state.grid);
      shots.push(Buffer.from(await page.screenshot({ type: "png" })));
    }
    assert.deepEqual(geometry[0], geometry[1], `Layout/transform mismatch at ${frame}`);
    assert(
      positions[0].split(",").every((position) => position.trim() === positions[1]),
      `Grid motion mismatch at ${frame}`,
    );
    const a = decodePng(shots[0]);
    const b = decodePng(shots[1]);
    assert.equal(a.width, b.width);
    assert.equal(a.height, b.height);
    let squared = 0,
      changedPixels = 0,
      maxError = 0;
    const diff = new Uint8Array(a.data.length);
    for (let i = 0; i < a.data.length; i += 4) {
      let changed = false;
      for (let channel = 0; channel < 3; channel++) {
        const error = Math.abs(a.data[i + channel] - b.data[i + channel]);
        squared += error * error;
        maxError = Math.max(maxError, error);
        changed ||= error !== 0;
        diff[i + channel] = Math.min(255, error * 32);
      }
      diff[i + 3] = 255;
      if (changed) changedPixels++;
    }
    const mse = squared / (a.width * a.height * 3);
    results.push({
      frame,
      gridPosition: positions[0],
      changedPixels,
      maxChannelError: maxError,
      mse,
      psnr: mse ? 10 * Math.log10(255 ** 2 / mse) : "Infinity",
      geometryMatches: true,
    });
    if ([2686, 9366, 11662].includes(frame)) {
      await writeFile(resolve(output, `${frame}-baseline.png`), shots[0]);
      await writeFile(resolve(output, `${frame}-texture.png`), shots[1]);
      await writeFile(resolve(output, `${frame}-diff-x32.png`), encodePng(a.width, a.height, diff));
    }
  }
  assert(new Set(results.map((row) => row.gridPosition)).size > 10, "Grid must actually move");
  const repeated = results.filter((row) => row.frame === 9366);
  assert(
    repeated.every((row) => row.mse === repeated[0].mse),
    "Non-monotonic seeks differ",
  );
  await writeFile(
    resolve(output, "results.json"),
    JSON.stringify({ browser: await browser.version(), samples: results }, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      samples: results.length,
      maxChannelError: Math.max(...results.map((r) => r.maxChannelError)),
      minPsnr: Math.min(...results.map((r) => Number(r.psnr))),
      geometryMatches: true,
      gridMoves: true,
      humanReview: "pending",
    }),
  );
} finally {
  await browser.close();
}
