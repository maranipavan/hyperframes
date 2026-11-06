import assert from "node:assert/strict";
import {
  getNativeAlphaBlit,
  getNativeAlphaBlitStatus,
} from "../packages/engine/src/utils/nativeAlphaBlit.ts";

const native = getNativeAlphaBlit();
const status = getNativeAlphaBlitStatus();
if (!native || status.implementation !== "native") {
  throw new Error(`HYPERFRAMES_ALPHA_BLIT_NATIVE did not load a native module (${status.reason})`);
}

const domRgba = Buffer.from([255, 128, 0, 255]);
const canvas = Buffer.alloc(6);
native.blitRgba8OverRgb48leNative(domRgba, canvas, 1, 1, "hlg");

const result = [canvas.readUInt16LE(0), canvas.readUInt16LE(2), canvas.readUInt16LE(4)];
const expected = [49151, 27146, 0];
if (result.some((value, index) => value !== expected[index])) {
  throw new Error(`native alpha-blit parity failed: expected ${expected}, got ${result}`);
}

assert.throws(
  () => native.blitRgba8OverRgb48leNative(domRgba, Buffer.alloc(6), 0, 1, "hlg"),
  /HF_INVALID_DIMENSIONS/,
);
assert.throws(
  () => native.blitRgba8OverRgb48leNative(domRgba, Buffer.alloc(5), 1, 1, "hlg"),
  /HF_CANVAS_BUFFER_TOO_SHORT/,
);

console.log(JSON.stringify({ check: "native-alpha-blit-parity", status, result }));
