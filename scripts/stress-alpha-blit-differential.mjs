import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const repeats = Number.parseInt(process.env.HF_ALPHA_BLIT_REPEATS ?? "1000", 10);
assert(Number.isSafeInteger(repeats) && repeats > 0, "HF_ALPHA_BLIT_REPEATS must be positive");

if (process.argv[2] === "--worker") {
  const { blitRgba8OverRgb48le } = await import("../packages/engine/src/utils/alphaBlit.ts");
  const digest = createHash("sha256");
  const transfers = ["hlg", "pq", "srgb"];

  for (let round = 0; round < repeats; round++) {
    for (const transfer of transfers) {
      const width = 1 + (round % 23);
      const height = 1 + ((round * 7) % 19);
      const pixels = width * height;
      const dom = new Uint8Array(pixels * 4);
      const canvas = Buffer.alloc(pixels * 6);

      for (let i = 0; i < pixels; i++) {
        const domOffset = i * 4;
        dom[domOffset] = (round * 17 + i * 13 + 3) & 0xff;
        dom[domOffset + 1] = (round * 19 + i * 29 + 5) & 0xff;
        dom[domOffset + 2] = (round * 23 + i * 31 + 7) & 0xff;
        dom[domOffset + 3] =
          (round + i) % 11 === 0 ? 0 : (round + i) % 11 === 1 ? 255 : (round * 37 + i * 41) & 0xff;

        const canvasOffset = i * 6;
        for (let channel = 0; channel < 6; channel++) {
          canvas[canvasOffset + channel] = (round * 43 + i * 47 + channel * 53) & 0xff;
        }
      }

      blitRgba8OverRgb48le(dom, canvas, width, height, transfer);
      digest.update(transfer).update(canvas);
    }
  }

  console.log(JSON.stringify({ repeats, digest: digest.digest("hex") }));
} else {
  const nativePath = process.env.HYPERFRAMES_ALPHA_BLIT_NATIVE;
  assert(nativePath, "HYPERFRAMES_ALPHA_BLIT_NATIVE must point to a built .node artifact");

  function run(implementation) {
    const env = { ...process.env };
    if (implementation === "typescript") delete env.HYPERFRAMES_ALPHA_BLIT_NATIVE;
    else env.HYPERFRAMES_ALPHA_BLIT_NATIVE = nativePath;

    const child = spawnSync(process.execPath, [...process.execArgv, process.argv[1], "--worker"], {
      encoding: "utf8",
      env,
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  }

  const typescript = run("typescript");
  const native = run("native");
  assert.equal(native.repeats, repeats);
  assert.equal(native.digest, typescript.digest, "stress differential digest differs");
  console.log(
    JSON.stringify({
      check: "native-alpha-blit-stress-differential",
      repeats,
      digest: native.digest,
      result: "byte-identical",
    }),
  );
}
