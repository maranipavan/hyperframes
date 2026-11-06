# Rust media kernels

This workspace contains the first isolated Rust performance slice for
HyperFrames. It mirrors the deterministic
`blitRgba8OverRgb48le` kernel from
`packages/engine/src/utils/alphaBlit.ts`.

The Rust crate is wired into the renderer through an opt-in Node native
boundary. The current TypeScript implementation remains the default and
complete fallback; no published package enables the native path automatically.
The integration is intentionally limited to this alpha-blit kernel while
byte-level parity, packaging, and platform coverage are established.

## Checks

Run from the repository root. The wrapper runs Cargo inside `rust/`, so
`rust/rust-toolchain.toml` is honored by rustup and the commands also work with
a standalone Cargo binary:

```bash
bun run test:rust
```

The same checks are available from the repository root as `bun run test:rust`
when the pinned Rust toolchain is installed.

## Benchmark

The benchmark uses the same deterministic 1920×1080 mixed-alpha HLG workload
for both implementations. It measures only the blit kernel; buffer generation,
reset, allocation, and checksum are outside the timed region.

TypeScript source path:

```bash
node --experimental-strip-types \
  --experimental-loader ./scripts/ts-source-loader.mjs \
  ./scripts/bench-alpha-blit.mjs 1920 1080
```

Rust release path:

```bash
(cd rust && cargo run --release --bin bench-alpha-blit -- 1920 1080)
```

To build and opt into the Node native boundary on Linux:

```bash
(cd rust && cargo build --release -p hf-node --locked)
cp rust/target/release/libhf_node.so /tmp/hf-node.node
HYPERFRAMES_ALPHA_BLIT_NATIVE=/tmp/hf-node.node \
  node --experimental-strip-types \
  --experimental-loader ./scripts/ts-source-loader.mjs \
  ./scripts/test-alpha-blit-native.mjs
HYPERFRAMES_ALPHA_BLIT_NATIVE=/tmp/hf-node.node \
  node --experimental-strip-types \
  --experimental-loader ./scripts/ts-source-loader.mjs \
  ./scripts/bench-alpha-blit.mjs 1920 1080
HF_ALPHA_BLIT_REPEATS=1000 HYPERFRAMES_ALPHA_BLIT_NATIVE=/tmp/hf-node.node \
  node --experimental-strip-types \
  --experimental-loader ./scripts/ts-source-loader.mjs \
  ./scripts/stress-alpha-blit-differential.mjs
```

The native path is opt-in through `HYPERFRAMES_ALPHA_BLIT_NATIVE`; without it,
or when the artifact cannot be loaded, the renderer uses the existing
TypeScript implementation. The copied `.node` artifact is a local build output
and must not be committed.

Both commands print JSON containing the individual timings, median, min/max,
throughput, and a checksum. The checksums must match before comparing speed.

The Rust implementation is a complete library kernel with explicit buffer
validation and byte-oriented little-endian reads/writes. It does not assume
that a Node `Buffer` or other caller-provided byte slice is aligned to a
`u16` boundary.
