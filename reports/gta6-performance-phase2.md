# GTA6 performance phase 2 — measured results and open gates

**Latest continuation:** a separate active-chapter capture-stability candidate
passes four complete 900-frame exports across one/three workers, including exact
decoded video and audio parity. A full 600-second one-worker export is also now
complete at **2,491.270 s (41m31.3s)**. See section 6 of
`gta6-repeatability-investigation.md` for the resumable handoff and the
separately tested outlined-text audit fix.

## Decision

**Retain the SVG-grid change as an isolated candidate; do not overwrite the
original or change renderer defaults.** One complete 600-second A/B pair shows
an 18.9% export-time reduction with the original motion and both audio tracks.
The candidate has strong visual evidence but still needs human approval.
Actual multi-VPS benchmarking is blocked on approved hosts/access.

**Neither full render beat the supplied 36m19s baseline.** Its original command,
quality, browser, worker count and capture path have not been supplied, so it
cannot be treated as equivalent to these new measurements.

## Baseline, isolation and reproducibility

- Original: `gta6_countdown_10min.html`, unchanged.
- Original SHA-256: `bca316b923831e3c26731cd8ed64e7d8827d0b67a798f998db5954f3ccbd8abd`.
- Candidate SHA-256: `9728753a8498bd1c878cc7c4b067be9c751df97ebf0a810a4379cfaa431bd4ae`.
- Candidate: `reports/performance-full/repro/texture/index.html`.
- Recovery: `backups/performance-phase2-20261020/source-snapshot-before-new-experiments.tar.gz`.
- Reversible delta: `reports/performance-full/repro/grid-texture.patch`.
- Generator: `scripts/perf/gta6-experiment.mjs`; it refuses changed source hashes
  and existing output directories. Its self-test verifies that **all script
  blocks and both audio elements remain byte-for-byte unchanged**.
- Audio asset hashes are in `reports/performance-full/repro/manifest.json`.
- Local built CLI 0.8.177, not an unrelated `npx` release; Node 22.23.3,
  Bun 1.3.13, system Chromium 155.0.8059.79, Linux ARM64, four CPUs.
- Same FFmpeg **n8.0.1-66-g27b8d1a017-20260228** binaries under `.tools/ffmpeg`,
  software browser GPU, one worker,
  draft MP4, 1920×1080, 30 fps, 18,000 frames, two original audio tracks.
- Existing dependencies/caches were present. No concurrent benchmark load was
  intentionally launched. One sequential full run per variant: not a median,
  not randomized, and not a statistical confidence interval.

The retained video-quality comparisons used system FFmpeg 5.1.9 to decode both
outputs; the encoder used the project-local 8.0.1 build above. Do not confuse the
analysis binary with the encoder when reproducing these results.

No new native kernel, engine change or deployment was made in this phase.
All existing alpha-blit instrumentation and TypeScript fallbacks were preserved.

## 1. Motion-preserving composition optimization

The change replaces the two CSS gradient grid images with a 64×64 inline SVG
texture. It retains the mask, opacity, background size, and **the existing
600-second background-position tween**. Orbs, captions, chapter wipes, slow
camera scaling, progress indicators and all other animation code are unchanged.
It is not the earlier static-grid experiment that removed movement.

Expected benefit: reduce recurring browser background-paint cost. Effort: small,
one CSS replacement. Compatibility risk: SVG edge/intersection rasterization
differs slightly from two separately composited gradients. It is not
mathematically pixel-identical and is not a general HTML renderer optimization.

### Complete 10-minute result (no extrapolation)

| Metric                                | Original animated gradients |       Animated SVG texture |
| ------------------------------------- | --------------------------: | -------------------------: |
| Shell wall time                       |  3,068.212 s (**51m08.2s**) | 2,487.828 s (**41m27.8s**) |
| Producer total                        |                 3,065.066 s |                2,485.326 s |
| Compile including probe               |                     1.054 s |                    1.038 s |
| Audio processing                      |                    10.504 s |                   10.271 s |
| Capture/frame-production envelope     |                 3,019.548 s |                2,440.097 s |
| Encoder lifetime, overlapping capture |                 3,019.539 s |                2,440.088 s |
| Assembly                              |                    33.886 s |                   33.848 s |
| Mean / p50 capture time               |                168 / 167 ms |               136 / 133 ms |
| Full-export throughput                |                    5.87 fps |                   7.24 fps |

Observed same-settings wall reduction: **580.384 seconds (9m40.4s), 18.9%,
1.233×**. This is a complete-export result, not the raster microbenchmark.
Encoder lifetime includes waiting for frames; do not add it to capture or call
its reduction an isolated encoder speedup.

Compared numerically with the operator's **2,179 seconds (36m19s)**:
the original rerun took 40.8% longer; the candidate took 14.2% longer.
Those are contextual differences only, because settings equivalence is unknown.
The earlier draft report contained incorrect percentages and a false "faster"
comparison against 36m19s; those statements have been corrected.

### Output and audio checks

Both complete outputs: 600.000 s, 18,000 decoded video frames, 1920×1080,
nominal/average 30/1, H.264 yuv420p, AAC 48 kHz stereo. Sizes:
69,361,918 bytes (original), 69,361,438 bytes (candidate).

Decoded audio is identical: **115,200,000 PCM bytes**, SHA-256:

```text
7ce0a94728439d6ee1b6313a7a8bc01255d23eb78b6b84cb4f1c0cf4c1197143
```

This proves no A/B change to the decoded mix, not that the narration's factual
content or original caption timing has been independently reviewed.

Videos are retained inside the workspace:

- `reports/performance-full/outputs/baseline.mp4`
- `reports/performance-full/outputs/grid-texture.mp4`

### Visual checks and review

- All **18,000 encoded frames** compared: mean finite per-frame PSNR **56.763 dB**,
  minimum **40.11 dB** at frame 9366; three frames were identical. This mean of
  dB values is not pooled-MSE PSNR.
- Mean SSIM **0.999592**, minimum **0.994803** at frame 2686.
- Separate **lossless browser screenshots at 73 samples**: every scene midpoint,
  three frames around every chapter wipe, worst encoded differences, and backward
  seeks. Identical layout boxes, transforms, opacity, visibility and per-layer
  grid positions. Grid positions change over time in both variants.
- Maximum raw RGB error **1/255**, minimum raw PSNR **80.671 dB** on those samples.
  These direct-browser samples complement, but do not replace, the compiled
  producer's encoded-video comparison.
- Inspected representative worst-frame images: no obvious text or layout loss
  at displayed scale. This is assistant inspection, **not human approval**.
- Review page: **`reports/performance-full/review.html`**, with synchronized
  baseline/candidate playback and buttons for seams/worst-frame timestamps.
  Running locally at **http://localhost:8765/review.html**. The local-only server
  supports MP4 byte ranges; both 600-second videos successfully sought to
  312.2 seconds in a browser smoke test with no page errors.
- Both generated full compositions passed local CLI `lint` and browser `check`.
  Existing structural/authoring warnings remain; no unrelated design was changed.

Lossless evidence: `reports/performance-full/raw-visual/results.json`.
No automatic threshold has been substituted for the requested human review.

### CPU and memory: correction to the earlier monitor

The original full-run external monitor traversed only the process leader's
children list. It missed processes launched by other threads and dropped CPU
time when processes exited. Its recorded ~600/~580 MiB RSS and ~1,184 CPU seconds
are **incomplete diagnostics, not full-process-tree resource measurements**.
No CPU-utilization conclusion can be drawn from them.

The framework's independently recorded resource samples remain usable:

| Resource sample          |  Original | Candidate |
| ------------------------ | --------: | --------: |
| Producer RSS peak        |   232 MiB |   206 MiB |
| Producer heap peak       |    75 MiB |    62 MiB |
| Chrome browser RSS peak  |   212 MiB |   212 MiB |
| Chrome renderer RSS peak |   455 MiB |   479 MiB |
| Chrome last RSS sum      | 1,075 MiB | 1,104 MiB |

These are not simultaneous fleet peaks and must not be summed as such.
**Full-run total CPU and trustworthy fleet-wide peak RAM remain unmeasured.**
The new command monitor scans process PPIDs across all `/proc` entries, tracks
known reparented descendants/PID start times, and retains sampled CPU for exited
processes. Its worker measurements below include explicit sampling/accounting
limitations. This does not retroactively repair the two full-run samples.

## 2. Worker tuning on the actual animated composition

Workload: **first 30 seconds of the original**, 900 frames at 1080p/30, both audio
tracks, all original motion, including the first chapter wipe. Only the root
duration was shortened. Draft MP4, forced screenshots, same local CLI. Serial
run order: 1, 2, 3, 4, then 4, 3, 2, 1. Two complete exports per worker count.

| Workers | Individual wall times (s) | Median (s) | Export fps | Maximum sampled RSS sum | Accounted CPU, one-core % range |
| ------: | ------------------------- | ---------: | ---------: | ----------------------: | ------------------------------- |
|       1 | 160.866, 161.377          |    161.121 |       5.59 |               1,532 MiB | 163.6–164.6%                    |
|       2 | 101.891, 102.844          |    102.368 |       8.79 |               2,458 MiB | 262.4–281.2%                    |
|       3 | 90.925, 89.389            | **90.157** |   **9.98** |               3,552 MiB | 333.7–342.0%                    |
|       4 | 96.590, 94.024            |     95.307 |       9.44 |               4,640 MiB | 303.4–305.7%                    |

Three workers were fastest **on this excerpt**; four used more memory and took
longer. No extrapolation to the full film and no default worker change was made.
The original 200×200 fixture's earlier two-worker result did not predict this
representative workload's ordering.

CPU columns are `getrusage(RUSAGE_CHILDREN)` accounting for reaped processes,
not a complete guarantee for orphaned subprocesses. 100% denotes one fully busy
core (four cores available). RSS is a 500ms sampled sum of discovered process
RSS, includes shared pages more than once, and can miss transient peaks.

### Correctness caveat — not ready to lock a default

- All eight outputs: 900 video frames, 30 fps, 30 seconds, matching dimensions;
  both stream start times zero. All decoded audio PCM hashes match.
- **Decoded video hashes are not identical.** The same one-worker configuration
  differs between repeated runs in frames **845–899**, around the first chapter
  transition. The first 845 frames match exactly.
- Repeated one-worker outputs: pooled video PSNR **65.861 dB**, mean SSIM
  **0.999964**. This is small but real drift; it also occurs without changing
  worker count. The continuation reproduced capture-side instability in the
  outlined chapter number before video encoding; a fixed-input encode replay
  was identical. See `gta6-repeatability-investigation.md` for scope and controls.
- `scripts/perf/gta6-results.py` intentionally exits nonzero when exact decoded
  video parity fails. The emitted `verification.json` retains the finding.
  No assertion was weakened to turn it into a pass.

The continuation's lossless engine captures differ at frames 844–847 in the
outlined `01`, with matching sampled DOM state. Holding frame 845 also produces
two raster states while geometry, opacity and font readiness stay unchanged.
This establishes capture instability, not the precise Chromium mechanism or
the sole cause of the earlier MP4 drift (its original capture buffers were not
retained). A later composition-specific layout-reset candidate passed the
30-second repeated-export case; final-filter all-chapter controls and full-length
validation remain open. Three workers are not a renderer-wide deterministic preset.

### Separating encoding from frame production

With one worker the encoder overlaps capture. With multiple workers this
forced-screenshot path captured first, then encoded. At three workers:
capture **71.801 / 70.861 s** versus encode **10.851 / 10.638 s** for 900 frames
(about 12.6 fps frame production versus 84 fps encode-stage throughput).
Assembly was about 1.85 s. These stage rates apply to the tested excerpt and
capture route only. They demonstrate why capture remains the priority.

## 3. Multi-VPS investigation and local proof

**No second VPS was contacted or benchmarked.** Approved SSH host aliases,
working directories, CPU/RAM capacity and access are still needed. No cloud
provisioning, spending or infrastructure changes were performed.

Existing code supports contiguous half-open ranges `[startFrame,endFrame)`;
filenames are range-relative but seek time remains `absoluteFrame / fps`.
Planning freezes artifacts; chunks encode closed GOPs; assembly orders chunks
and mixes/muxes audio once (or uses packet ownership for chunk-carried AAC).

Relevant source:

- `packages/producer/src/services/distributed/plan.ts`
- `packages/producer/src/services/distributed/renderChunk.ts`
- `packages/producer/src/services/distributed/assemble.ts`
- `packages/producer/src/services/distributed/chunkAudio.ts`
- `packages/producer/src/services/render/stages/captureStage.ts`
- `packages/engine/src/services/parallelCoordinator.ts`

### Tests actually run here

Using the compatible `/usr/bin/chromium`, rather than the incompatible cached
x86-64 browser, the combined boundary/idempotency tests produced **9 passes and
2 failures**:

- All six adapter boundary tests passed: GSAP, Anime.js, Three.js, Lottie, CSS,
  WAAPI. Each compares all 60 PNG frames from one chunk versus four chunks,
  including boundaries 15/30/45. No soft-skip was logged in this rerun.
- PNG retry/idempotency tests passed for chunk indices 0 and 1.
- Two MP4 tests fail at the hard-coded `captureMode === "beginframe"` assertion;
  this browser reports `screenshot`. They do not reach their byte-comparison
  assertions. Therefore MP4 retry parity is **not proven by this rerun**.

Evidence: `reports/performance-full/distributed-boundary-tests.log`.
Tests were left intact. The production fallback is working as reported; calling
these two tests passed or replacing their assertion with a skip would hide a gap.

### Real cross-host benchmark contract

1. Obtain approved hosts and identical pinned Node/Bun/browser/FFmpeg builds,
   architecture, fonts and local assets. GTA6 currently uses `system-ui` fonts;
   cross-host font differences must be eliminated, not ignored by turning off
   the distributed planner's font checks.
2. Freeze one compiled plan and hash its assets on the coordinator. Compare
   browser and font digests in addition to the existing FFmpeg checks.
3. Render the **same full film** first on one VPS, then partition across the
   approved VPSes. Exact 18,000-frame coverage; no overlapping/missing indices.
   Include cuts inside wipes and caption transitions in the seam test set.
4. Repeat one nonzero chunk on each host. Compare raw frames, especially the
   first/last frames of each range, before trusting encoded-file hashes.
5. Assemble ordered video chunks and one global audio mix. Verify A/V starts,
   all timestamps, 18,000 frames, 600 seconds, decoded PCM and seam-window
   PSNR/SSIM. Compare to the single-host output.
6. Measure from planning through transport, startup, retries, render, return
   transfer and assembly. Include those costs in the multi-VPS wall time.

The current repeated-render chapter drift must be understood first. Previous
local parallel simulations are not multi-VPS evidence. Also, the existing
`examples/aws-lambda/scripts/eval.sh` local comparison invokes the producer unit
test command rather than a render; do not use that reported local time as the
single-VPS baseline without correcting its invocation.

## 4. Rust priorities and runtime attribution

Both full GTA6 perf summaries report **zero native and zero TypeScript alpha-blit
calls**. This SDR composition does not use the HDR DOM-overlay kernel. None of
the GTA6 gain is attributed to Rust. Loading an addon would not change that.

Existing native differential and 1,000-repeat stress tests still produce
byte-identical HLG/PQ/sRGB outputs. No fallbacks or instrumentation were removed.
Remember that counters are process-global: do not attribute snapshot deltas to
overlapping render jobs in one Node process without scoping them.

Other measured _HDR_ candidates (not GTA6 hot paths):

| Candidate                 | Prior measured envelope              | Next proof required                                                    | Effort / risk                                 |
| ------------------------- | ------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------- |
| RGB48 region/affine blits | ~9.9s video + ~8.8s image blits      | Separate opaque, alpha, mask and bilinear cases; bulk-call parity      | Medium / rounding, clipping, buffer ownership |
| PNG defilter/conversion   | ~14.8s over 330 decodes              | Separate native zlib inflate from JS filters/conversion first          | Medium / PNG types, validation, copies        |
| Shader math               | ~50.9s transition composite envelope | Isolate the transition call; envelope also includes two scene captures | High / sampling and floating-point parity     |

Do not move these to Rust just because a broad timing bucket is large. No new
native prototype was integrated; the highest-upside evidence for GTA6 is still
browser paint/capture and bounded worker parallelism.

## 5. Checks, commands and next steps

### Checks performed after adding the experiment tools

- Generator self-test: pass (source hash, exactly one reversible change, unchanged
  JavaScript and audio, fail-closed on source drift).
- Resource sampler self-test: pass (PPID ancestry, reparented processes, PID reuse,
  actual `/proc` parsing).
- Local HTML lint: zero errors; browser check: `ok: true` for original/candidate.
  Existing 41 lint warnings remain in each; checks were not run with `--strict`.
- Engine alpha-blit/shader/alignment: **285 tests passed**.
- Producer typecheck: pass.
- Producer complete unit command: pass, including **58 Vitest files / 961 tests**
  plus the Bun lane. One pre-existing skipped Vitest test. The first run caught
  a missing `--` terminator in the new Python ffprobe command; that was fixed and
  the complete unit command rerun successfully.
- Native differential + 1,000-repeat stress: byte-identical, passed.
- Distributed browser tests: **9 pass / 2 fail**, for the documented capture-mode
  assumption. Not reported as green and not weakened.
- Worker exact decoded-video gate: **fails**, documented above. Audio gate passes.
- Changed MJS lint/format and report formatting: checked separately. No full root
  suite or fresh workspace build was needed for unchanged production source.

### Reproduce the candidate and benchmark

From the workspace root after the normal locked install/build:

```bash
export PATH="$PWD/.tools/ffmpeg:$PWD/.tools/bin:$PWD/.tools/bun/bin:$PATH"
export HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
export HYPERFRAMES_FFMPEG_PATH="$PWD/.tools/ffmpeg/ffmpeg"
export HYPERFRAMES_FFPROBE_PATH="$PWD/.tools/ffmpeg/ffprobe"
export HYPERFRAMES_NO_TELEMETRY=1
unset HYPERFRAMES_ALPHA_BLIT_NATIVE

node scripts/perf/gta6-experiment.mjs self-test
python3 scripts/perf/measure-command.py --self-test

# Fresh destination required; use a new name for each preparation.
node scripts/perf/gta6-experiment.mjs prepare --out reports/performance-full/repro-new

# Repeat with /texture and a different output/metrics prefix for the candidate.
python3 scripts/perf/measure-command.py \
  --out reports/performance-full/rerun-baseline --timeout 5400 -- \
  node packages/cli/dist/cli.js render reports/performance-full/repro-new/baseline \
  --output reports/performance-full/rerun-baseline.mp4 \
  --fps 30 --quality draft --format mp4 --workers 1 \
  --no-browser-gpu --experimental-fast-capture=false --debug \
  --protocol-timeout 600000 --browser-timeout 120
```

For worker input generation, use `prepare --duration 30 --out <fresh-workspace-dir>`;
then the same render command, changing only `--workers 1|2|3|4`, output path and
metrics prefix. The retained matrix used `--protocol-timeout 60000`, a 600-second
per-run cutoff, and no concurrent render runs.

```bash
# Re-check retained worker and full-video quality evidence.
# Exits 1 on the known worker repeatability mismatch, not on missing audio.
python3 scripts/perf/gta6-results.py

# Serve only the review/evidence directory on localhost (MP4 byte-range support).
python3 scripts/perf/review-server.py

# Raw screenshots use the fixed repro path and refuse existing sample artifacts.
node scripts/perf/gta6-visual-check.mjs

# Run native checks only with an actual built .node addon.
HYPERFRAMES_ALPHA_BLIT_NATIVE="$PWD/.tools/hf-node.node" bun run test:rust:differential
HYPERFRAMES_ALPHA_BLIT_NATIVE="$PWD/.tools/hf-node.node" bun run test:rust:stress
```

The generated HTML still references the original pinned GSAP CDN script. The
compiler inlines it; cold compilation may require network access. For cross-host
or fully offline replay, distribute the frozen compiled plan and asset/font
bundle rather than allowing each VPS to resolve remote resources independently.

### Files added or updated in this continuation

New portable experiment tools (Node 22 / Python 3.11, no new dependencies):

- `scripts/perf/gta6-experiment.mjs`
- `scripts/perf/gta6-visual-check.mjs`
- `scripts/perf/measure-command.py`
- `scripts/perf/gta6-results.py`
- `scripts/perf/review-server.py`

User-facing deliverables:

- This report: `reports/gta6-performance-phase2.md`.
- Corrected historical report: `reports/hyperframes-performance-experiments-2026-10-20.md`.
- Human review: `reports/performance-full/review.html`.
- Full MP4s: `reports/performance-full/outputs/`.
- Candidate, original copy, patch and asset hashes: `reports/performance-full/repro/`.
- Per-frame metrics, perf summaries, validation and test outputs:
  `reports/performance-full/`.
- Worker artifacts and measurements: `reports/performance-full/workers/`.

The backup verifies with `sha256sum --check
backups/performance-phase2-20261020/SHA256SUMS`. No original composition,
application source, credentials, model choice or Git configuration was changed.
There is no `.git` metadata and no commit was attempted.

### Open gates (do not call the phase finished)

1. **Human review** of the candidate's motion and subtle grid raster differences.
2. **Complete full-film validation of the scoped capture-stability candidate**
   before claiming worker/host determinism or selecting a general preset.
   The 900-frame repeated-export gate now passes and one full run is measured;
   a second full repeat and full output-to-output visual comparison remain open.
3. **Approved second VPS and the 36m19s command/settings** from the operator.
4. **Actual multi-VPS full workload**, with transport costs and audio/seam checks.
5. If a full resource comparison is required, repeat the full pair with the new
   monitor plus container/cgroup accounting; do not retrofit incomplete CPU/RAM
   samples into a successful claim.
