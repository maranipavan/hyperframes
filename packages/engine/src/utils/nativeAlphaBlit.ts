import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

interface NativeAlphaBlit {
  blitRgba8OverRgb48leNative(
    domRgba: Uint8Array,
    canvas: Buffer,
    width: number,
    height: number,
    transfer: "hlg" | "pq" | "srgb",
  ): void;
}

export type NativeAlphaBlitStatus =
  | { implementation: "native"; reason: "loaded" }
  | {
      implementation: "typescript";
      reason: "not-configured" | "load-failed" | "invalid-export";
    };

export interface AlphaBlitStats {
  nativeCalls: number;
  nativeMs: number;
  typescriptCalls: number;
  typescriptMs: number;
}

interface NativeAlphaBlitLoadState {
  module: NativeAlphaBlit | undefined;
  status: NativeAlphaBlitStatus;
}

function isNativeAlphaBlit(value: unknown): value is NativeAlphaBlit {
  if (typeof value !== "object" || value === null) return false;
  if (!("blitRgba8OverRgb48leNative" in value)) return false;
  return typeof value.blitRgba8OverRgb48leNative === "function";
}

let cached: NativeAlphaBlitLoadState | undefined;
let nativeCalls = 0;
let nativeMs = 0;
let typescriptCalls = 0;
let typescriptMs = 0;

function loadNativeAlphaBlit(): NativeAlphaBlitLoadState {
  if (cached) return cached;

  const modulePath = process.env.HYPERFRAMES_ALPHA_BLIT_NATIVE;
  if (!modulePath) {
    cached = {
      module: undefined,
      status: { implementation: "typescript", reason: "not-configured" },
    };
    return cached;
  }

  try {
    const loaded: unknown = createRequire(import.meta.url)(modulePath);
    if (isNativeAlphaBlit(loaded)) {
      cached = { module: loaded, status: { implementation: "native", reason: "loaded" } };
    } else {
      cached = {
        module: undefined,
        status: { implementation: "typescript", reason: "invalid-export" },
      };
    }
  } catch {
    // Keep the fallback quiet for normal installs, but expose a stable status
    // so callers and benchmarks do not mistake fallback execution for native.
    cached = {
      module: undefined,
      status: { implementation: "typescript", reason: "load-failed" },
    };
  }

  return cached;
}

/**
 * Load the optional native kernel only when the caller explicitly supplies a
 * `.node` path. The normal renderer remains the TypeScript implementation so
 * published packages and source checkouts need no native artifact.
 */
export function getNativeAlphaBlit(): NativeAlphaBlit | undefined {
  return loadNativeAlphaBlit().module;
}

/** Report which implementation this process will use after the first load. */
export function getNativeAlphaBlitStatus(): NativeAlphaBlitStatus {
  return loadNativeAlphaBlit().status;
}

/** Run the native kernel and record the work done by this process. */
export function invokeNativeAlphaBlit(
  domRgba: Uint8Array,
  canvas: Buffer,
  width: number,
  height: number,
  transfer: "hlg" | "pq" | "srgb",
): boolean {
  const native = getNativeAlphaBlit();
  if (!native) return false;
  const start = performance.now();
  native.blitRgba8OverRgb48leNative(domRgba, canvas, width, height, transfer);
  nativeCalls += 1;
  nativeMs += performance.now() - start;
  return true;
}

/** Record the TypeScript fallback duration for render-level diagnostics. */
export function recordTypescriptAlphaBlit(ms: number): void {
  typescriptCalls += 1;
  typescriptMs += ms;
}

/** Snapshot cumulative alpha-blit work; callers can diff two snapshots per render. */
export function getAlphaBlitStats(): AlphaBlitStats {
  return { nativeCalls, nativeMs, typescriptCalls, typescriptMs };
}
