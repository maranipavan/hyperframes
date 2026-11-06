import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const transfers = ["hlg", "pq", "srgb"];
const width = 17;
const height = 11;

if (process.argv[2] === "--worker") {
  const transfer = process.argv[3];
  const { blitRgba8OverRgb48le } = await import("../packages/engine/src/utils/alphaBlit.ts");
  const dom = new Uint8Array(width * height * 4);
  const canvas = Buffer.alloc(width * height * 6);

  for (let i = 0; i < width * height; i++) {
    const domOffset = i * 4;
    dom[domOffset] = (17 * i + 13) & 0xff;
    dom[domOffset + 1] = (31 * i + 71) & 0xff;
    dom[domOffset + 2] = (47 * i + 149) & 0xff;
    dom[domOffset + 3] = i % 7 === 0 ? 0 : i % 7 === 1 ? 255 : (29 * i + 37) & 0xff;

    const canvasOffset = i * 6;
    canvas[canvasOffset] = (11 * i + 3) & 0xff;
    canvas[canvasOffset + 1] = (7 * i + 19) & 0xff;
    canvas[canvasOffset + 2] = (13 * i + 29) & 0xff;
    canvas[canvasOffset + 3] = (17 * i + 41) & 0xff;
    canvas[canvasOffset + 4] = (19 * i + 53) & 0xff;
    canvas[canvasOffset + 5] = (23 * i + 67) & 0xff;
  }

  blitRgba8OverRgb48le(dom, canvas, width, height, transfer);
  process.stdout.write(JSON.stringify({ transfer, result: canvas.toString("base64") }));
} else {
  const nativePath = process.env.HYPERFRAMES_ALPHA_BLIT_NATIVE;
  assert(nativePath, "HYPERFRAMES_ALPHA_BLIT_NATIVE must point to a built .node artifact");

  function runWorker(implementation, transfer) {
    const env = { ...process.env };
    if (implementation === "typescript") delete env.HYPERFRAMES_ALPHA_BLIT_NATIVE;
    else env.HYPERFRAMES_ALPHA_BLIT_NATIVE = nativePath;

    const child = spawnSync(
      process.execPath,
      [...process.execArgv, process.argv[1], "--worker", transfer],
      { encoding: "utf8", env },
    );
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  }

  for (const transfer of transfers) {
    const typescript = runWorker("typescript", transfer);
    const native = runWorker("native", transfer);
    assert.equal(native.transfer, transfer);
    assert.equal(native.result, typescript.result, `${transfer} output differs`);
  }

  console.log(
    JSON.stringify({
      check: "native-alpha-blit-differential",
      transfers,
      dimensions: `${width}x${height}`,
      result: "byte-identical",
    }),
  );
}
