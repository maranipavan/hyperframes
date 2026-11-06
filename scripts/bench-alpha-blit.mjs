import { blitRgba8OverRgb48le } from "../packages/engine/src/utils/alphaBlit.ts";
import { getNativeAlphaBlitStatus } from "../packages/engine/src/utils/nativeAlphaBlit.ts";

const width = Number.parseInt(process.argv[2] ?? "1920", 10);
const height = Number.parseInt(process.argv[3] ?? "1080", 10);
const warmups = 3;
const samples = 7;
const pixelCount = width * height;

if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
  throw new Error(`Expected positive integer dimensions, got ${width}x${height}`);
}

const domRgba = Buffer.allocUnsafe(pixelCount * 4);
const canvas = Buffer.allocUnsafe(pixelCount * 6);

for (let i = 0; i < pixelCount; i++) {
  const domOffset = i * 4;
  domRgba[domOffset] = (17 * i + 13) & 0xff;
  domRgba[domOffset + 1] = (31 * i + 71) & 0xff;
  domRgba[domOffset + 2] = (47 * i + 149) & 0xff;
  const lane = i & 7;
  domRgba[domOffset + 3] = lane === 0 ? 0 : lane === 1 ? 255 : (29 * i + 37) & 0xff;

  const canvasOffset = i * 6;
  canvas[canvasOffset] = (11 * i + 3) & 0xff;
  canvas[canvasOffset + 1] = (7 * i + 19) & 0xff;
  canvas[canvasOffset + 2] = (13 * i + 29) & 0xff;
  canvas[canvasOffset + 3] = (17 * i + 41) & 0xff;
  canvas[canvasOffset + 4] = (19 * i + 53) & 0xff;
  canvas[canvasOffset + 5] = (23 * i + 67) & 0xff;
}

const initialCanvas = Buffer.from(canvas);

function runOnce() {
  canvas.set(initialCanvas);
  const start = process.hrtime.bigint();
  blitRgba8OverRgb48le(domRgba, canvas, width, height, "hlg");
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

for (let i = 0; i < warmups; i++) runOnce();
const timings = [];
for (let i = 0; i < samples; i++) timings.push(runOnce());

const sorted = [...timings].sort((a, b) => a - b);
const checksum = canvas.reduce((sum, byte) => (sum * 33 + byte) >>> 0, 0);
const median = sorted[Math.floor(sorted.length / 2)];
const implementation =
  getNativeAlphaBlitStatus().implementation === "native" ? "node-native-rust" : "typescript-source";

console.log(
  JSON.stringify({
    implementation,
    nativeStatus: getNativeAlphaBlitStatus(),
    operation: "blitRgba8OverRgb48le",
    transfer: "hlg",
    width,
    height,
    warmups,
    samples,
    timingsMs: timings,
    medianMs: median,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    megapixelsPerSecond: (pixelCount / 1_000_000 / median) * 1000,
    checksum,
  }),
);
