// Isolated performance experiment: never edits the authored GTA6 composition.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = resolve(root, "gta6_countdown_10min.html");
const originalGrid =
  "background-image: linear-gradient(rgba(148,163,184,.13) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.13) 1px, transparent 1px); background-size: 64px 64px;";
// EXACT candidate used by the measured 600-second export. Do not silently
// change rasterization (e.g. two rectangles instead of this crossing path).
const textureGrid =
  'background-image: url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2764%27 height=%2764%27 viewBox=%270 0 64 64%27%3E%3Cpath d=%27M0 .5H64M.5 0V64%27 stroke=%27rgb(148 163 184 / .13)%27 stroke-width=%271%27/%3E%3C/svg%3E"); background-size: 64px 64px;';
const digest = (data) => createHash("sha256").update(data).digest("hex");
const expectedOriginal = "bca316b923831e3c26731cd8ed64e7d8827d0b67a798f998db5954f3ccbd8abd";
const expectedCandidate = "9728753a8498bd1c878cc7c4b067be9c751df97ebf0a810a4379cfaa431bd4ae";

function transform(html) {
  assert.equal(digest(html), expectedOriginal, "Original changed; establish a new baseline first");
  assert.equal(html.split(originalGrid).length, 2, "Expected exactly one grid definition");
  const candidate = html.replace(originalGrid, textureGrid);
  assert.equal(digest(candidate), expectedCandidate, "Candidate differs from measured source");
  return candidate;
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: "reports/performance-full/repro" },
    duration: { type: "string", default: "600" },
  },
});
const command = positionals[0];
const html = await readFile(source, "utf8");

if (command === "self-test") {
  const candidate = transform(html);
  assert.equal(candidate.replace(textureGrid, originalGrid), html);
  const scripts = (text) =>
    [...text.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]);
  const audio = (text) => [...text.matchAll(/<audio\b[^>]*>[\s\S]*?<\/audio>/g)].map((m) => m[0]);
  assert.deepEqual(scripts(candidate), scripts(html), "All JavaScript must remain unchanged");
  assert.deepEqual(audio(candidate), audio(html), "Both audio tracks must remain unchanged");
  assert.equal(audio(candidate).length, 2);
  assert.throws(() => transform(html + "\n"), /Original changed/);
  console.log(
    "PASS: exact source/candidate hashes, reversible single CSS replacement, unchanged scripts and both audio tracks, source-drift guard",
  );
} else if (command === "prepare") {
  const output = resolve(root, values.out);
  assert(output.startsWith(root + "/"), "Keep experiment files in this workspace");
  const duration = Number(values.duration);
  assert(Number.isFinite(duration) && duration > 0 && duration <= 600, "Duration must be (0,600]");
  const candidate = transform(html);
  // Exclusive creation prevents overwriting earlier runs or user work.
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  const manifest = {
    source: relative(root, source),
    sourceSha256: digest(html),
    duration,
    projects: {},
  };
  for (const [name, input] of [
    ["baseline", html],
    ["texture", candidate],
  ]) {
    const dir = resolve(output, name);
    await mkdir(dir);
    const content =
      duration === 600
        ? input
        : input.replace('data-duration="600.00"', `data-duration="${duration.toFixed(2)}"`);
    await writeFile(resolve(dir, "index.html"), content, { flag: "wx" });
    const assets = {};
    for (const asset of ["voiceover.mp3", "music_bed.mp3"]) {
      await copyFile(resolve(root, asset), resolve(dir, asset), constants.COPYFILE_EXCL);
      assets[asset] = digest(await readFile(resolve(dir, asset)));
    }
    manifest.projects[name] = { htmlSha256: digest(content), assets };
  }
  const diff = spawnSync(
    "diff",
    [
      "-u",
      "--label",
      "a/gta6_countdown_10min.html",
      "--label",
      "b/gta6_countdown_10min.grid-texture.html",
      resolve(output, "baseline/index.html"),
      resolve(output, "texture/index.html"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(diff.status, 1, diff.stderr || "Expected a one-change patch");
  await writeFile(resolve(output, "grid-texture.patch"), diff.stdout, { flag: "wx" });
  await writeFile(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
  });
  assert.equal(digest(await readFile(source)), expectedOriginal, "Original must stay untouched");
  await access(resolve(output, "texture/index.html"));
  console.log(JSON.stringify({ prepared: relative(root, output), ...manifest }, null, 2));
} else {
  throw new Error(
    "Usage: node scripts/perf/gta6-experiment.mjs self-test | prepare [--duration 600] [--out reports/performance-full/repro]",
  );
}
