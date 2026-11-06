import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile, realpath } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { gta6CaptureStabilitySource } from "./gta6-stability-hook.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const bases = {
  original: [
    "gta6_countdown_10min.html",
    "bca316b923831e3c26731cd8ed64e7d8827d0b67a798f998db5954f3ccbd8abd",
  ],
  texture: [
    "reports/performance-full/repro/texture/index.html",
    "9728753a8498bd1c878cc7c4b067be9c751df97ebf0a810a4379cfaa431bd4ae",
  ],
};

function candidate(html, duration) {
  const rootMarker = 'data-composition-id="main" data-start="0" data-duration="600.00"';
  assert.equal(html.split(rootMarker).length, 2, "Exactly one original root expected");
  assert.equal(html.split("</body>").length, 2);
  return html
    .replace(rootMarker, rootMarker.replace("600.00", duration.toFixed(2)))
    .replace("</body>", '<script src="./capture-stability.js"></script>\n</body>');
}

if (process.argv[2] === "self-test") {
  await selfTest();
} else {
  const [command, destination, durationArg = "600", base = "original"] = process.argv.slice(2);
  assert.equal(command, "prepare", "prepare <fresh-output> [duration=600] [original|texture]");
  assert(destination && Object.hasOwn(bases, base));
  const duration = Number(durationArg);
  assert(Number.isInteger(duration) && duration > 0 && duration <= 600);
  const output = resolve(root, destination);
  assert((await realpath(dirname(output))).startsWith(root + sep));
  const [sourcePath, sourceSha256] = bases[base];
  const source = await readFile(resolve(root, sourcePath), "utf8");
  assert.equal(sha(source), sourceSha256, "Refuse source drift");
  const html = candidate(source, duration);
  await mkdir(output); // Refuse any existing output.
  await writeFile(resolve(output, "index.html"), html, { flag: "wx" });
  await writeFile(resolve(output, "capture-stability.js"), gta6CaptureStabilitySource, {
    flag: "wx",
  });
  const assets = {};
  for (const name of ["voiceover.mp3", "music_bed.mp3"]) {
    await copyFile(resolve(root, name), resolve(output, name));
    assets[name] = sha(await readFile(resolve(output, name)));
    assert.equal(assets[name], sha(await readFile(resolve(root, name))));
  }
  const patch = spawnSync(
    "diff",
    [
      "-u",
      "--label",
      sourcePath,
      "--label",
      `${relative(root, output)}/index.html`,
      resolve(root, sourcePath),
      resolve(output, "index.html"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(patch.status, 1, patch.stderr || "Expected one isolated candidate diff");
  await writeFile(resolve(output, "candidate.patch"), patch.stdout, { flag: "wx" });
  const manifest = {
    sourcePath,
    sourceSha256,
    base,
    duration,
    candidateSha256: sha(html),
    hookSha256: sha(gta6CaptureStabilitySource),
    assets,
    scope:
      "Experimental capture-only active chapter layout reset; original scripts and audio tags unchanged. No renderer default changes.",
  };
  await writeFile(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
  });
  assert.equal(sha(await readFile(resolve(root, sourcePath))), sourceSha256);
  console.log(JSON.stringify(manifest));
}

async function selfTest() {
  for (const [path, expected] of Object.values(bases)) {
    const source = await readFile(resolve(root, path), "utf8");
    assert.equal(sha(source), expected);
    const html = candidate(source, 600);
    assert.equal(html.replace('<script src="./capture-stability.js"></script>\n', ""), source);
    const scripts = (text) => [...text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.deepEqual(scripts(html), scripts(source));
    assert.deepEqual(html.match(/<audio\b[^>]*>/g), source.match(/<audio\b[^>]*>/g));
  }
  const listeners = [];
  let flushes = 0,
    throwOnFlush = false;
  function element(initial, visible) {
    let style = initial;
    return {
      getClientRects: () => [{}],
      parentElement: {
        getAttribute: (name) => (name === "data-start" ? (visible ? "28" : "100") : "10"),
      },
      getAttribute: () => style,
      setAttribute: (_name, value) => {
        style = value;
      },
      removeAttribute: () => {
        style = null;
      },
      style: {
        setProperty: (name, value, priority) => {
          assert.equal(name, "display");
          assert.equal(value, "none");
          assert.equal(priority, "important");
          style = "display: none !important;";
        },
      },
    };
  }
  const elements = [
    element("transform: scale(1.0002);", true),
    element(null, true),
    element("opacity: 0", false),
  ];
  const originals = elements.map((el) => el.getAttribute("style"));
  const window = {
    __HF_RENDER_CAPTURE_MODE: false,
    addEventListener: (name, fn) => {
      assert.equal(name, "hf-seek");
      listeners.push(fn);
    },
  };
  const document = { querySelectorAll: () => elements, body: {} };
  Object.defineProperty(document.body, "offsetWidth", {
    get() {
      flushes++;
      assert.equal(elements[0].getAttribute("style"), "display: none !important;");
      assert.equal(elements[1].getAttribute("style"), "display: none !important;");
      assert.equal(elements[2].getAttribute("style"), originals[2]);
      if (throwOnFlush) throw new Error("fixture layout failure");
      return 1920;
    },
  });
  runInNewContext(gta6CaptureStabilitySource, { window, document });
  runInNewContext(gta6CaptureStabilitySource, { window, document });
  assert.equal(listeners.length, 1, "Idempotent installation");
  listeners[0]({});
  assert.equal(flushes, 0, "Preview is untouched");
  window.__HF_RENDER_CAPTURE_MODE = true;
  const waits = [];
  listeners[0]({ detail: { time: 28.166, waitUntil: (promise) => waits.push(promise) } });
  assert.equal(flushes, 0, "Work is deferred until synchronous seek updates finish");
  await Promise.all(waits);
  assert.equal(flushes, 1);
  assert.deepEqual(
    elements.map((el) => el.getAttribute("style")),
    originals,
  );
  assert.equal(window.__gta6CaptureStability.resets, 2);
  throwOnFlush = true;
  waits.length = 0;
  listeners[0]({ detail: { time: 28.166, waitUntil: (promise) => waits.push(promise) } });
  await assert.rejects(Promise.all(waits), /fixture layout failure/);
  assert.deepEqual(
    elements.map((el) => el.getAttribute("style")),
    originals,
    "Restore even on failure",
  );
  assert.throws(() => listeners[0]({ detail: {} }), /waitUntil support/);
  assert.throws(() => listeners[0]({ detail: { time: NaN, waitUntil() {} } }), /finite seek time/);
  throwOnFlush = false;
  waits.length = 0;
  const before = flushes;
  for (const time of [0, 27.99, 38])
    listeners[0]({ detail: { time, waitUntil: (promise) => waits.push(promise) } });
  await Promise.all(waits);
  assert.equal(
    flushes,
    before,
    "No reset outside half-open chapter windows, even with layout boxes",
  );
  console.log(
    "PASS: source guards, untouched original scripts/audio, preview no-op, idempotent install, deferred gate, active-only reset, exact style restoration and failure restoration",
  );
}
