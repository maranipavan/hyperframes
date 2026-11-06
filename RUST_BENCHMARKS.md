# Rust alpha-blit benchmark report

**Date:** 2026-10-19  
**Workload:** deterministic mixed-alpha HLG compositing  
**Operation:** `blitRgba8OverRgb48le`  
**Status:** native Rust path is opt-in; TypeScript remains the default

## What was measured

The benchmark compares the existing TypeScript implementation with the Rust
`hf-media-kernels` implementation through the optional N-API boundary. Both
paths receive the same deterministic RGBA8 DOM buffer and RGB48LE canvas. The
timed region includes only the compositing kernel. Buffer allocation, input
generation, canvas reset, and checksum calculation are outside the timed
region.

Workload details:

- Mixed alpha lanes: transparent, opaque, and intermediate alpha values.
- HLG transfer LUT.
- Three warmup iterations and seven measured iterations.
- Median is the primary comparison; min/max and every sample are printed by
  the benchmark command.
- The checksum is required to match before speed is compared.

Environment:

| Item | Value |
| --- | --- |
| OS architecture | Linux `aarch64` |
| Logical CPUs | 4 |
| Node | `v22.23.3` |
| Rust | `rustc 1.99.1` |
| Native build | Cargo release profile, thin LTO, one codegen unit |

## Results

| Resolution | TypeScript median | Rust/N-API median | Speedup | Time reduction | Checksum |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1920×1080 | 107.149819 ms | 25.491519 ms | 4.20× | 76.21% | `3661789628` |
| 3840×2160 | 439.827644 ms | 101.951554 ms | 4.31× | 76.82% | `3414288112` |

The result is a measured kernel improvement, not a claim that an entire video
render is 4× faster. Chrome capture, PNG decoding, media extraction, FFmpeg,
audio, and other compositor work remain outside this benchmark.

## Reproduce

Build the Rust native artifact locally. Do not commit the copied `.node` file:

```bash
cargo build --manifest-path rust/Cargo.toml --release -p hf-node
cp rust/target/release/libhf_node.so /tmp/hf-node.node
```

Run the native parity smoke test:

```bash
HYPERFRAMES_ALPHA_BLIT_NATIVE=/tmp/hf-node.node \
  node --experimental-strip-types \
  --experimental-loader ./scripts/ts-source-loader.mjs \
  ./scripts/test-alpha-blit-native.mjs
```

Run the two implementations at a selected resolution:

```bash
# TypeScript fallback
node --experimental-strip-types \
  --experimental-loader ./scripts/ts-source-loader.mjs \
  ./scripts/bench-alpha-blit.mjs 1920 1080

# Rust through the optional Node boundary
HYPERFRAMES_ALPHA_BLIT_NATIVE=/tmp/hf-node.node \
  node --experimental-strip-types \
  --experimental-loader ./scripts/ts-source-loader.mjs \
  ./scripts/bench-alpha-blit.mjs 1920 1080
```

The benchmark loader exists only to import the repository's TypeScript source
directly without installing the missing Bun workspace dependencies. A normal
HyperFrames build uses its existing package build/export flow.

## Correctness checks

The Rust library tests cover:

- HLG, PQ, and sRGB LUT reference values;
- transparent pixels leaving the destination unchanged;
- opaque replacement and mixed-alpha rounding;
- short-buffer validation before mutation;
- oddly offset byte slices, avoiding unsafe `u16` alignment assumptions.

The N-API smoke test verifies that a real Node Buffer crosses the native
boundary and produces the expected HLG values `[49151, 27146, 0]`. The
benchmark checksums match across both implementations at both resolutions.

## Current limitation

The native path is enabled only when
`HYPERFRAMES_ALPHA_BLIT_NATIVE` points to a locally built `.node` artifact.
Published packages do not yet ship platform-specific native binaries, so the
default renderer remains the complete TypeScript implementation. The next
production step is platform packaging and CI parity coverage for supported
Node/OS/CPU combinations.
