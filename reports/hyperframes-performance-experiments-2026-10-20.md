# HyperFrames performance experiments

> Historical experiment notes, updated with one full-duration A/B run. The
> phase-two status and corrected interpretation are in
> `gta6-performance-phase2.md`. Earlier sections describe earlier evidence;
> they are not claims that the new visual candidate or multi-VPS path is approved.

Date: 2026-10-20  
Host: Oracle Linux ARM64 VPS, 4 CPUs, 24 GiB RAM  
Runtime: Node `v22.23.3`, Bun `1.3.13`, system Chromium `155.0.8059.79`, FFmpeg `5.1.9`  
Browser mode: Linux software SwiftShader unless noted otherwise

## Executive summary

This pass evaluated five optimization directions against the actual
`gta6_countdown_10min.html` composition and small complete-render fixtures.

The main findings are:

1. The GTA6 composition's largest measured browser-side cost is the continuously
   animated full-frame CSS grid (`background-position` plus a mask). Freezing the
   grid reduced a browser JPEG-capture microbenchmark from **150.6 ms/frame to
   71.5 ms/frame**. A complete 5-second GTA6 export also measured **29.8% lower
   traced wall time** and **31.9% lower capture-stage time** across two runs,
   while preserving audio and producing 50.8 dB PSNR / 0.9984 SSIM. It changes
   the designed grid motion, so it was not integrated or accepted as final
   visual design.
2. On this ARM64 host, BeginFrame and experimental drawElement are not the
   actual capture calls. Chromium rejects `HeadlessExperimental.enable`, then
   HyperFrames captures with `Page.captureScreenshot`. Parallel workers also
   clamp drawElement and use screenshot capture.
3. On a complete 1-second render fixture, two workers were slightly faster than
   one, while three and four were slower and used substantially more Chrome
   memory. This is not evidence that four workers are appropriate for GTA6.
4. The opt-in Rust alpha-blit path is proven correct and materially reduces the
   alpha-blit stage. A complete 6-second HDR render measured **160.4 s native vs
   168.8 s TypeScript fallback** with the same cross-warp cache enabled. The
   total difference was about 5%, because browser capture/compositing dominates.
5. A bounded Vello CPU probe is promising for an explicit vector/text scene
   format, but it was not an end-to-end HyperFrames render. Motion Canvas is
   best treated as a future isolated canvas/vector source type, not as a
   renderer replacement.
6. Exact frame-range distributed rendering is feasible for planned integer frame
   ranges. Complete small renders showed a **30.9% lower wall time** for a
   four-way parallel no-audio fixture and **22.8% lower wall time** for an
   audio-bearing fixture. These are fixture-specific results and include all
   measured plan/chunk/assembly work.

At the end of the initial experiments only the 5-second comparison had timing
evidence. **Phase two subsequently completed a full 600-second A/B pair**;
see the full-duration section below and `gta6-performance-phase2.md` for the
current results, resource-measurement corrections and unresolved quality gates.
The original 36m19s historical export still lacks a recorded equivalent command.

## Baseline

### Actual GTA6 output baseline

The source composition is:

```text
gta6_countdown_10min.html
duration:       600.000 s
resolution:     1920x1080
frame rate:     30/1
video frames:   18,000
audio:          AAC, 48 kHz, stereo
video codec:    H.264, yuv420p
file size:      92,551,811 bytes
```

The existing output is:

```text
renders/gta6-headless-shell-rust.mp4
```

Both streams start at `0.000000` and report `600.000000` seconds. The video
has 18,000 frames and the audio has 28,126 AAC frames. The file SHA-256 is:

```text
9ce55b2b6bb15f9692741b160894dbd0c41aecb4dd413b2bab6ff2ba85738637
```

This is an artifact baseline, not a timing baseline. The original render's
wall-clock time, CPU utilization, and peak memory were not recorded in the
workspace, so those values remain **unmeasured**.

The operator-supplied original full-export baseline is **36m19s (2,179s)**.
The exact original command, worker count, browser binary, capture mode, quality,
and CPU/RAM samples for that run are not present in this workspace. It is kept
as the comparison target, but an equivalent before/after conclusion requires
recording those settings alongside a rerun.

Reproduction command:

```bash
ffprobe -v error -show_entries \
  stream=index,codec_name,codec_type,start_time,duration,time_base,nb_frames,\
  r_frame_rate,avg_frame_rate,channels,sample_rate \
  -show_entries format=duration,size -of json \
  renders/gta6-headless-shell-rust.mp4
```

### Representative complete-render baseline

The optimization work also used a fixed 1920×1080, 6-second HDR fixture with
180 frames, one worker, software Chromium, and the same local source tree.
This is not the GTA6 composition; it exercises the HDR layered compositor and
alpha-blit path.

Before the cross-warp field cache:

```text
total:       343,052 ms
capture:     337,264 ms
encode:      335,877 ms
```

With the cache and native alpha-blit instrumentation:

```text
total:       160,380 ms
capture:     156,318 ms
encode:      155,417 ms
```

This is a complete-render comparison for the HDR fixture, not a full-video
GTA6 comparison. The cache and other runtime state changed between runs, so it
should be interpreted as evidence for that representative workload rather
than as a general 2.1x product claim.

## Experiment 1: composition-level profiling

### Workload and method

The actual GTA6 HTML was loaded directly in system Chromium at 1920×1080. The
root timeline was sought to representative scene times and JPEG screenshots
were captured. CSS variants were injected at runtime; the source HTML was not
modified. The measured scenes included pricing (`s19`), the headline filter
(`s30`), and the end screen (`s38`).

Composition inventory:

| Item                                | Measured value |
| ----------------------------------- | -------------: |
| DOM elements                        |            861 |
| Scene sections                      |             38 |
| Caption spans                       |            155 |
| GSAP timeline children/tweens       |            589 |
| Elements with box shadows           |             39 |
| Elements with nonzero border radius |            302 |
| Computed masks                      |              1 |
| Computed background-image users     |              6 |

The major full-frame effects are:

- two 1100px radial-gradient orbs animated with transforms;
- a full-frame two-gradient grid with a bottom mask;
- a full-frame wipe at chapter transitions;
- panel/card shadows and rounded surfaces;
- CSS integer counters and normal DOM text/layout.

The source locations are:

```text
gta6_countdown_10min.html:13-16   orbs and grid
gta6_countdown_10min.html:44-57   panels and cards
gta6_countdown_10min.html:107      wipe
gta6_countdown_10min.html:613-616  global bar/orb/grid animations
```

### Measured A/B results

Pricing scene, warm 12-frame JPEG capture samples:

| Variant                         |   Mean total |       P50 |       P95 |
| ------------------------------- | -----------: | --------: | --------: |
| Baseline                        |    150.61 ms | 150.24 ms | 173.11 ms |
| Freeze grid background position | **71.47 ms** |  67.09 ms |  88.25 ms |
| Remove grid background          |     71.58 ms |  66.91 ms |  90.07 ms |
| Remove only grid mask           |    137.14 ms | 137.27 ms | 160.70 ms |
| Hide grid                       |     75.92 ms |  69.84 ms |  88.06 ms |
| Hide two orbs                   |    147.54 ms | 149.80 ms | 155.67 ms |
| Remove all box shadows          |    150.42 ms | 149.88 ms | 165.72 ms |

The grid result reproduced in other scenes:

| Scene                 |  Baseline |  Frozen grid |
| --------------------- | --------: | -----------: |
| `s30` headline filter | 151.83 ms | **66.53 ms** |
| `s38` end screen      | 148.01 ms | **68.26 ms** |

A lower-risk visual alternative was prototyped by moving an oversized grid
child with `transform: translateY(...)` rather than animating CSS
`background-position`. It measured approximately **106.75 ms/frame**: better
than the baseline but materially slower than freezing the grid.

Warm GSAP seeks themselves were inexpensive after initialization:

```text
s19: approximately 3.4 ms
s30: approximately 2.5 ms
s38: approximately 2.3 ms
```

The expensive portion is capture/rasterization, not the author timeline's
JavaScript execution. Initial seeks were higher at approximately 15–37 ms.

### Assessment

| Expected benefit                                | Effort | Compatibility risk                             | Measured result                                                         | Quality decision                                                                      |
| ----------------------------------------------- | ------ | ---------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| High: remove repeated full-frame gradient paint | Low    | Medium: changes motion                         | 52–56% lower browser capture time; 29.8% lower 5-second complete export | **Not integrated**; A/V and image metrics passed, temporal visual parity not accepted |
| Medium: preserve motion with transformed child  | Medium | Medium–high: clipping/rasterization may differ | ~106.75 ms/frame                                                        | Candidate only; no production change                                                  |
| Low: remove or simplify orbs/shadows            | Low    | Medium: visible design change                  | Negligible compared with grid                                           | Rejected as low upside                                                                |

The static-grid candidate was compared at fixed screenshot timestamps. Its
pixels differ from the moving baseline after frame 0 because the intended grid
motion is gone. It therefore cannot be called “quality preserved” merely from
the lower timing. No composition source edit was made.

### Reproducible browser benchmark shape

The benchmark uses Puppeteer with `/usr/bin/chromium`, viewport 1920×1080,
sequential GSAP seek, and `page.screenshot({type: "jpeg", quality: 80})`.
Each variant is loaded into a fresh page, warmed up, then sampled at fixed
times. The runtime variants are:

```js
{
  baseline: "",
  staticGrid: "#grid{background-position:0 0!important}",
  noGridMask: "#grid{mask-image:none!important;-webkit-mask-image:none!important}",
}
```

This is intentionally a browser microbenchmark. It is not an export-time
benchmark and must not be used to claim a complete-render speedup.

### Complete short GTA6 export

To test the candidate through the real producer pipeline, two temporary project
copies were created outside the repository. Both copies changed only the root
duration from 600 seconds to 5 seconds; the variant additionally replaced the
600-second grid `background-position` tween with a static position. The actual
repository composition was not edited.

Settings were identical:

```text
1920x1080, 30 fps, 150 frames, 5 seconds
quality=draft, format=mp4, workers=1
system Chromium, software browser GPU
experimental fast capture=false
two local audio tracks
```

Two complete exports per variant were run. Trace-stage results:

| Variant              | Run 1 total | Run 2 total | Median total | Median capture |
| -------------------- | ----------: | ----------: | -----------: | -------------: |
| Original moving grid |   30,493 ms |   29,263 ms |    29,878 ms |    26,152.5 ms |
| Static grid          |   21,050 ms |   20,898 ms |    20,974 ms |    17,820.0 ms |

Compared with the original short export, the static-grid variant measured:

```text
total traced wall time: 29.8% lower
capture stage:          31.9% lower
shell wall-clock median: 27.6% lower
```

The shell wall-clock medians were 32.173 seconds for the original and 23.289
seconds for the static-grid variant. The trace totals are preferred for stage
comparison because they exclude shell startup/reporting noise, but both show
the same direction.

Output checks:

```text
both outputs:             H.264/yuv420p, 1920x1080, 30/1, 150 frames, 5.0 s
decoded audio:            identical PCM SHA-256
audio PCM SHA-256:        de7e2839100db119b2a9f699a24f5889e9878902be0c04e23131c6c636293da7
baseline vs static PSNR:  50.80 dB mean
baseline vs static SSIM:  0.99837 mean
```

The video difference is expected: the static candidate removes the grid's
time-varying motion. The high PSNR/SSIM means the rest of the composition is
closely preserved, not that the two animations are semantically identical.
This is a demonstrated complete-pipeline improvement for a **5-second GTA6
slice**, not proof of a full 10-minute improvement. The candidate remains
unintegrated until its visual motion is explicitly approved or replaced by a
motion-preserving implementation.

## Experiment 2: workers and capture paths

### Capture-path result on Linux ARM64

The configured path requests BeginFrame on Linux, but the installed system
Chromium does not expose the required protocol domain:

```text
HeadlessExperimental.enable was not found
```

BrowserManager then falls back to screenshot capture. The authoritative
runtime evidence was:

```text
HeadlessExperimental.beginFrame probe failed
falling back to screenshot mode
fast capture falls back to screenshot capture: SwiftShader
canvasDrawElement=false
```

Therefore, the actual frame operation on this host is:

```text
Page.captureScreenshot
```

It is not:

```text
HeadlessExperimental.beginFrame
canvas.drawElementImage
```

The top-level perf summary can still label the platform-derived capture mode as
`beginframe`; that field is an upper-bound plan label, not proof that BeginFrame
executed. The browser probe and worker phase diagnostics are the reliable
runtime evidence.

The installed cached headless-shell candidate was also incompatible with this
host:

```text
candidate: x86-64 ELF
host:      aarch64
result:    Exec format error
```

### Worker matrix

The same complete 1-second, 200×200, 30-frame MP4 render was run twice at each
worker count. The fixture has no audio or video and is intended to isolate
worker/capture overhead, not to represent GTA6 visual complexity.

| Workers | Run |    Total |  Capture | Producer peak RSS | Chrome RSS last-sample sum |
| ------: | --: | -------: | -------: | ----------------: | -------------------------: |
|       1 |   1 | 3,266 ms | 2,913 ms |           251 MiB |                    745 MiB |
|       1 |   2 | 3,232 ms | 2,894 ms |           255 MiB |                    748 MiB |
|       2 |   1 | 3,096 ms | 2,744 ms |           259 MiB |                  1,485 MiB |
|       2 |   2 | 3,191 ms | 2,835 ms |           259 MiB |                  1,485 MiB |
|       3 |   1 | 3,562 ms | 3,211 ms |           260 MiB |                  2,223 MiB |
|       3 |   2 | 3,602 ms | 3,260 ms |           262 MiB |                  2,218 MiB |
|       4 |   1 | 4,234 ms | 3,889 ms |           262 MiB |                  2,960 MiB |
|       4 |   2 | 4,154 ms | 3,811 ms |           255 MiB |                  2,954 MiB |

Per-worker medians:

| Workers | Median total | Relative to 1 worker |
| ------: | -----------: | -------------------: |
|       1 |     3,249 ms |             baseline |
|       2 |   3,143.5 ms |           3.2% lower |
|       3 |     3,582 ms |         10.3% higher |
|       4 |     4,194 ms |         29.1% higher |

The two-worker result is a small fixture-specific improvement, not a reason to
force two workers for every composition. Chrome memory roughly doubled per
additional worker, and four workers were slower on this four-CPU machine.

All eight complete outputs had the same SHA-256:

```text
fc93b470116a53bbbf9b0f75d9a4fd69572674fc84296eaa090f749b54591ced
```

They also matched on `h264`, 200×200, `yuv420p`, 30 frames, 30 fps, and 1.0 s.
Decoded sample pixels were identical at the background and card locations.

### Assessment

| Expected benefit                          | Effort            | Compatibility risk                        | Measured result                   | Quality decision                    |
| ----------------------------------------- | ----------------- | ----------------------------------------- | --------------------------------- | ----------------------------------- |
| More workers overlap capture and encoding | Low               | High: Chrome memory/compositor contention | 2 workers 3.2% faster; 3/4 slower | Keep bounded/auto; do not force 4   |
| BeginFrame instead of screenshots         | High on this host | High: protocol/browser binary dependency  | BeginFrame probe failed           | Not available with current Chromium |
| drawElement capture                       | Medium            | High under SwiftShader/parallel mode      | Disabled/fell back                | Not available on measured path      |

The GTA6 composition was not rendered four times at full 18,000-frame length;
that would be prohibitively expensive on this host and the actual capture path
is already known to be screenshot fallback. Worker selection for GTA6 remains
unmeasured at full length.

## Experiment 3: Rust graphics paths

### Existing native alpha-blit path

The existing opt-in Rust path is loaded only when:

```bash
export HYPERFRAMES_ALPHA_BLIT_NATIVE=/home/ubuntu/hyperframes-main/.tools/hf-node.node
```

Correctness evidence:

```text
native parity:       passed
HLG/PQ/sRGB diff:     byte-identical
stress:              1,000 repeats, byte-identical
digest:              17a3a2c18925c623eb14b2405003c4148ef9cf9dce75e468b7e59502efa8d595
```

The isolated 1920×1080 kernel benchmark was:

```text
TypeScript: 109.587 ms
Rust/N-API:  25.354 ms
ratio:       4.32x
```

The actual complete 6-second HDR render used the instrumented path 330 times:

| Alpha-blit implementation | Calls |          Time | Complete render total |
| ------------------------- | ----: | ------------: | --------------------: |
| Native Rust/N-API         |   330 |  2,780.867 ms |            160,380 ms |
| TypeScript fallback       |   330 | 17,877.159 ms |            168,810 ms |

The native alpha-blit stage was approximately 84% lower, but total render time
was approximately 5% lower because browser capture and HDR compositing dominate.
This is a complete-render result for the HDR fixture only. It is not a GTA6
result and does not imply a 4.32x video export speedup.

### Vello CPU evaluation

`vello_cpu` was evaluated as a narrowly scoped Rust renderer rather than an
attempt to replace Chromium. A temporary probe resolved Vello CPU `0.3.0` with
the pinned Rust `1.99.1` toolchain and rendered a 1920×1080 vector/text scene.
The direct rasterization probe measured:

```text
30 frames, 3 warmups, 7 samples
median total:       25.522 ms / 30 frames
median raster cost:  0.851 ms/frame
checksum:           3575792750508069603
```

This excludes PNG encoding, disk I/O, FFmpeg, audio, HyperFrames orchestration,
and the native boundary. It is feasibility evidence only; no complete-render
speedup is claimed.

The correct representative production experiment would be an explicit
`vector-launch-card` scene format with fixed layout, geometry, text, opacity,
transforms, and simple clipping, but no arbitrary HTML/CSS, media, filters,
WebGL/WebGPU, or network dependencies. Before integration it must:

1. render the same scene through current HyperFrames HTML and Vello;
2. encode both with identical FFmpeg settings;
3. compare complete wall time, raster time, encode time, RSS, frame count, and
   file metadata over at least three warm runs;
4. compare frames 0, 45, 90, 135, and 179 plus a full-frame sweep;
5. verify deterministic repeated seeks, font bounds, baseline placement, and
   premultiplied-alpha behavior.

### Assessment

| Candidate                    | Expected benefit                     |      Effort |                          Compatibility risk | Measured result                                            | Decision                                   |
| ---------------------------- | ------------------------------------ | ----------: | ------------------------------------------: | ---------------------------------------------------------- | ------------------------------------------ |
| Native alpha-blit            | Lower HDR pixel-kernel CPU time      |      Medium |                Medium: native packaging/ABI | 84% alpha-blit-stage reduction; ~5% complete HDR reduction | Keep opt-in and instrumented               |
| `vello_cpu` vector fast path | Avoid Chrome/DOM for eligible scenes | Medium–high | High: not an HTML/CSS renderer; text parity | 0.851 ms/frame direct raster probe only                    | Prototype separately; do not integrate yet |

## Experiment 4: Motion Canvas

Motion Canvas was evaluated as a future authoring/runtime option for
canvas/vector scenes, not as a wholesale HyperFrames replacement.

### Expected benefit

Motion Canvas provides a strong TypeScript scene graph, generator-based
animation, reusable vector nodes, and a dedicated preview/editor workflow. It
could be useful for a new category of explicitly canvas/vector compositions.

It does not automatically remove Chrome capture cost: an embedded Motion Canvas
scene would still render into a canvas and pass through HyperFrames capture and
the same Linux SwiftShader limitations.

### Compatibility and effort

| Integration option                               |      Effort |                             Compatibility risk | Expected benefit               |
| ------------------------------------------------ | ----------: | ---------------------------------------------: | ------------------------------ |
| External Motion Canvas render, import MP4/PNG    |         Low |       High loss of editable HyperFrames layers | Fast access to external scenes |
| Embed as a canvas-backed HyperFrames composition | Medium–high | High: deterministic seeking and canvas capture | New vector source type         |
| First-class Studio/parser format                 |   Very high |   Very high: conflicts with HTML-first tooling | Full Motion Canvas authoring   |
| Replace HyperFrames renderer                     |   Very high |                Unacceptable compatibility loss | No demonstrated benefit        |

HyperFrames currently already supports SVG/D3, canvas, WebGPU, GSAP, custom
frame adapters, Studio editing, variables, sub-compositions, audio, HDR, and
distributed rendering. Motion Canvas therefore adds an authoring model rather
than filling a proven renderer bottleneck.

No complete Motion Canvas-to-HyperFrames render was run, so there is no speedup
claim and no quality-preservation claim. The next bounded experiment should be
a 2-second, 1920×1080, 30-fps scene containing a title, three vector cards, a
bar chart, and one opacity/position transition. It must test seeks in the order
`0, 15, 30, 45, 10, 50, 10`, capture each twice, then compare the complete
HyperFrames render to the equivalent image-sequence/FFmpeg output.

## Experiment 5: encoding and distributed rendering

### Separating frame production and encoding

The bounded no-audio CSS fixture was 320×180, 30 fps, 2 seconds, and 60 frames.
The measured complete stages were:

| Path                           |    Total | Frame production |      Encoding | Assembly |
| ------------------------------ | -------: | ---------------: | ------------: | -------: |
| In-process                     | 4,404 ms |         2,401 ms |        199 ms |   125 ms |
| Distributed, serial chunks     | 9,392 ms |  3,116 ms summed | 609 ms summed |   128 ms |
| Distributed, four-way parallel | 3,045 ms |  2,779 ms summed | 708 ms summed |   130 ms |

For the in-process path, approximate throughputs were:

```text
frame production: 60 / 2.401 s = 25.0 frames/s
encoding:         60 / 0.199 s = 301.5 frames/s
```

The parallel distributed result is a complete end-to-end wall-time result,
including plan, chunk work, and assembly. It was 1,359 ms lower than the
same-fixture in-process result, approximately 30.9%. Chunk-stage sums overlap
and must not be added as wall time.

Serial distributed execution was slower because every chunk paid browser and
session startup without overlapping work.

### Audio-bearing distributed render

A temporary audio-bearing 2-second fixture was rendered through both paths:

| Path                                 |    Total |
| ------------------------------------ | -------: |
| In-process                           | 5,278 ms |
| Distributed plan + chunks + assembly | 4,073 ms |

The distributed result was approximately 22.8% lower wall time for this
fixture. Both outputs had 60 video frames, 2.000 seconds, 30/1 video, AAC
48-kHz stereo audio, and 95 audio packets.

Decoded PCM was byte-identical:

```text
SHA-256: 3062a3a6ea5abe3048e46fda58169f1292396faface43be8169fa7a862e5360a
```

The decoded video comparison reported approximately 50.83 dB average PSNR.
FFmpeg warned that the encoded outputs had different video time bases, so any
production deployment must retain the stream-metadata checks described below.

### Exact time-range feasibility

The implementation uses planned half-open integer frame ranges:

```text
[startFrame, endFrame)
```

Frame filenames are chunk-relative, but each frame seeks the composition at its
absolute frame time. This preserves timeline offsets. Chunk-carried audio owns
AAC packet intervals at chunk boundaries, with priming retained by chunk 0.
The assembler joins video and muxes or stitches audio according to the selected
path.

The strongest correctness evidence is:

- a 60-frame one-chunk and four-chunk CSS render produced byte-identical PNG
  frames at every position;
- a distributed chunk rendered twice produced the same fingerprint;
- decoded PCM was identical between in-process and distributed audio outputs;
- the MP4 stitcher tests cover sample tables, keyframes, edit lists, and
  rejection of composition-time offsets/B-frames.

Important restrictions:

- this is planned chunk rendering, not a general public arbitrary
  `startTime/endTime` API;
- audio is normally owned by the assembler unless `chunksCarryAudio` is
  enabled;
- deterministic seek-based authoring is required;
- HDR MP4, HLS, WebM, GIF, PNG-sequence, and shader-transition paths have
  restrictions or exclusions in the segmented/distributed routes;
- real cloud transfer, scheduler, container startup, and object-storage costs
  were not included in the local distributed numbers;
- all workers need matching FFmpeg/runtime/browser behavior.

### Assessment

| Expected benefit                 | Effort          | Compatibility risk                          | Measured result                                                      | Quality decision                          |
| -------------------------------- | --------------- | ------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| Overlap independent frame ranges | Medium          | Medium–high: deterministic seek/audio seams | 30.9% lower wall time on no-audio fixture; 22.8% on audio fixture    | Preserved on tested fixtures              |
| Parallel encoder work            | Already present | Medium: memory and stream metadata          | Encoding was not the dominant stage in the tested in-process fixture | Keep separate from capture decisions      |
| Arbitrary public time ranges     | High            | High: assets, audio, metadata, seek state   | Not implemented as a public API                                      | Do not expose without a stronger contract |

## Full 10-minute original-animation benchmark

The requested full workload was run after creating the recovery snapshot. Both
renders used the complete 600-second composition, both original audio tracks,
1920×1080, 30 fps, draft MP4, one worker, system Chromium, software GPU, and
forced screenshot capture. The baseline used the original animated CSS gradient
grid. The candidate used a temporary copy that replaces only the grid's CSS
linear gradients with an equivalent static SVG texture; the grid's original
`background-position` animation remained active, so the grid motion was
preserved. The source composition was not overwritten.

Commands:

```bash
node packages/cli/dist/cli.js render /tmp/gta6-full-baseline \
  --output /tmp/gta6-full-baseline.mp4 \
  --fps 30 --quality draft --format mp4 --workers 1 \
  --no-browser-gpu --experimental-fast-capture=false --debug \
  --protocol-timeout 600000 --browser-timeout 120

node packages/cli/dist/cli.js render /tmp/gta6-full-grid-texture \
  --output /tmp/gta6-full-grid-texture.mp4 \
  --fps 30 --quality draft --format mp4 --workers 1 \
  --no-browser-gpu --experimental-fast-capture=false --debug \
  --protocol-timeout 600000 --browser-timeout 120
```

### End-to-end result

| Metric                | Original animated CSS grid | Motion-preserving static SVG texture |      Difference |
| --------------------- | -------------------------: | -----------------------------------: | --------------: |
| Shell wall time       |     3,068.212 s (51m 8.2s) |              2,487.828 s (41m 27.8s) | **18.9% lower** |
| Producer total        |                3,065.066 s |                          2,485.326 s | **18.9% lower** |
| Capture stage         |                3,019.548 s |                          2,440.097 s | **19.2% lower** |
| Encode during capture |                3,019.539 s |                          2,440.088 s | **19.2% lower** |
| Audio processing      |                   10.504 s |                             10.271 s |      2.2% lower |
| Assembly              |                   33.886 s |                             33.848 s |      0.1% lower |

The operator-supplied earlier baseline was 36m19s (2,179 seconds). That run's
settings are not recorded in this workspace, so it is not an equivalent
comparison. The measured shell times are **40.8% longer** for the original
rerun and **14.2% longer** for the texture candidate than that reference. Neither
beat 36m19s. Only the new same-settings A/B pair supports the 18.9% reduction.

The full baseline's average capture time was 168 ms/frame, p50 167 ms/frame.
The motion-preserving texture candidate measured 136 ms/frame, p50 133 ms/frame.
Both used actual screenshot capture; BeginFrame and drawElement were not active.

### Full output correctness

Both outputs passed artifact validation and reported:

```text
H.264 / yuv420p
1920x1080
30/1 average and nominal frame rate
18,000 video frames
600.000 seconds
AAC, 48 kHz, stereo
28,125 counted audio frames
```

Output sizes were 69,361,918 bytes for the original run and 69,361,438 bytes
for the texture run. The decoded audio PCM SHA-256 was identical for both:

```text
7ce0a94728439d6ee1b6313a7a8bc01255d23eb78b6b84cb4f1c0cf4c1197143
```

Full decoded-video comparison produced:

```text
mean PSNR: 56.763 dB
minimum PSNR: 40.11 dB
mean SSIM: 0.999592
minimum SSIM: 0.994803
```

These are decoded lossy-video metrics, not proof of raw-pixel equivalence or of
where the differences occur. The PSNR value is the mean of finite per-frame
dB values (three frames were identical), not pooled-MSE PSNR. Worst-difference
frames require inspection. The original timeline code is byte-for-byte unchanged,
including grid motion. The contact sheet at
`reports/performance-frames/gta6-grid-side-by-side.png` covers only the first five
seconds; a still contact sheet does not prove motion quality or human approval.

### CPU and memory

The original external sampler recorded the following **incomplete diagnostics**:

| Metric                                                         |   Original | Texture candidate |
| -------------------------------------------------------------- | ---------: | ----------------: |
| Peak RSS of discovered processes (not full tree)               | 600.60 MiB |        579.86 MiB |
| Maximum CPU ticks of live discovered processes (not total CPU) | 1,183.33 s |        1,184.70 s |

The sampler walked only each process leader's `/proc/PID/task/PID/children`.
Children launched by other threads can be missed, and exited processes' CPU
time was not retained. The totals are therefore not valid full-render CPU or
memory measurements and must not be used for utilization or efficiency claims.

The producer perf summaries additionally reported:

| Metric                      |  Original | Texture candidate |
| --------------------------- | --------: | ----------------: |
| Producer peak RSS           |   232 MiB |           206 MiB |
| Producer peak heap          |    75 MiB |            62 MiB |
| Chrome browser RSS peak     |   212 MiB |           212 MiB |
| Chrome renderer RSS peak    |   455 MiB |           479 MiB |
| Chrome last sampled RSS sum | 1,075 MiB |         1,104 MiB |

Full-run CPU utilization and simultaneous fleet-wide peak RAM remain unmeasured.
The producer and Chrome metrics above are separately sampled: they should not
be added as though their peaks happened at the same instant. Capture/encode
timings overlap; their similar reduction is not an isolated encoder speedup.

### Recovery artifacts

Full benchmark logs and summaries are retained in:

```text
reports/performance-full/gta6-full-baseline.metrics.json
reports/performance-full/gta6-full-baseline.perf-summary.json
reports/performance-full/gta6-full-baseline.render.log
reports/performance-full/gta6-full-grid-texture.metrics.json
reports/performance-full/gta6-full-grid-texture.perf-summary.json
reports/performance-full/gta6-full-grid-texture.render.log
reports/performance-full/gta6-full-baseline.ffprobe.json
reports/performance-full/gta6-full-grid-texture.ffprobe.json
reports/performance-full/gta6-full-psnr.log
reports/performance-full/gta6-full-ssim.log
reports/performance-full/output-sha256.txt
backups/performance-phase2-20261020/source-snapshot-before-new-experiments.tar.gz
```

## Current implementation status

No GTA6 composition optimization was integrated during this experiment pass.
The grid experiment remains a measured candidate because freezing it changes
the designed motion and the transformed-child alternative has not passed a
full visual acceptance gate.

The existing performance work present in the workspace includes:

```text
packages/engine/src/utils/nativeAlphaBlit.ts
packages/engine/src/utils/alphaBlit.ts
packages/engine/src/utils/shaderTransitions.ts
packages/engine/src/index.ts
packages/producer/src/services/renderOrchestrator.ts
packages/producer/src/services/render/perfSummary.ts
rust/crates/hf-media-kernels/src/lib.rs
rust/crates/hf-node/src/lib.rs
scripts/rust-cargo.mjs
rust/README.md
RUST_BENCHMARKS.md
RUST_MIGRATION_PLAN.md
```

The alpha-blit native path remains opt-in through
`HYPERFRAMES_ALPHA_BLIT_NATIVE`; TypeScript remains the fallback when the
variable is unset. No cloud deployment or infrastructure change was made.

## Checks completed

The following checks passed after the current implementation work:

```text
bun run build
bun run --cwd packages/producer typecheck
engine focused tests: 285 passed
producer unit suite: passed
HLG HDR regression: passed, 0 failed frames, audio correlation 1.000
native alpha-blit parity: passed
native HLG/PQ/sRGB differential: byte-identical
native 1,000-repeat stress differential: passed
changed-file oxlint: passed
changed-file oxfmt --check: passed
```

The full root test command was not used as the primary gate because it exceeds
the available session timeout. Existing unrelated formatting issues remain in
`RUST_BENCHMARKS.md`, `TASK.md`, `review_task.md`, and `tui.json`.

## Reproducible commands

### Full GTA6 artifact inspection

```bash
ffprobe -v error -count_frames \
  -show_entries format=duration,size:stream=index,codec_type,codec_name,\
width,height,pix_fmt,r_frame_rate,avg_frame_rate,nb_read_frames \
  -of json renders/gta6-headless-shell-rust.mp4
```

### Native alpha-blit checks

```bash
export HYPERFRAMES_ALPHA_BLIT_NATIVE="$PWD/.tools/hf-node.node"
bun run test:rust:native
bun run test:rust:differential
bun run test:rust:stress
```

### Engine focused tests

```bash
bun run --cwd packages/engine test \
  src/utils/shaderTransitions.test.ts \
  src/utils/alphaBlit.test.ts \
  src/utils/uint16-alignment-audit.test.ts
```

### Complete short GTA6 export

The short export used temporary copies outside the repository so the authored
composition remained unchanged. Create a 5-second baseline copy and a variant
whose only authored difference is the grid tween:

```bash
python3 - <<'PY'
from pathlib import Path

source = Path("gta6_countdown_10min.html")
for name, freeze_grid in (
    ("/tmp/gta6-short-baseline", False),
    ("/tmp/gta6-short-static-grid", True),
):
    target = Path(name)
    target.mkdir(parents=True, exist_ok=True)
    html = source.read_text().replace('data-duration="600.00"', 'data-duration="5.00"', 1)
    if freeze_grid:
        html = html.replace(
            "tl.to('#grid', { backgroundPosition: '0px -3840px', duration: 600.00, ease: 'none' }, 0);",
            "tl.set('#grid', { backgroundPosition: '0px 0px' }, 0);",
        )
    (target / "index.html").write_text(html)
    for asset in ("voiceover.mp3", "music_bed.mp3"):
        (target / asset).write_bytes(Path(asset).read_bytes())
PY
```

Run each copy with the same local built CLI and settings:

```bash
export PATH="$PWD/.tools/ffmpeg:$PWD/.tools/bin:$PWD/.tools/bun/bin:$PATH"
export HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium
export HYPERFRAMES_FFMPEG_PATH="$PWD/.tools/ffmpeg/ffmpeg"
export HYPERFRAMES_FFPROBE_PATH="$PWD/.tools/ffmpeg/ffprobe"
export HYPERFRAMES_NO_TELEMETRY=1

time node packages/cli/dist/cli.js render /tmp/gta6-short-baseline \
  --output /tmp/gta6-short-baseline.mp4 \
  --fps 30 --quality draft --format mp4 --workers 1 \
  --no-browser-gpu --experimental-fast-capture=false --debug \
  --protocol-timeout 600000 --browser-timeout 120

time node packages/cli/dist/cli.js render /tmp/gta6-short-static-grid \
  --output /tmp/gta6-short-static-grid.mp4 \
  --fps 30 --quality draft --format mp4 --workers 1 \
  --no-browser-gpu --experimental-fast-capture=false --debug \
  --protocol-timeout 600000 --browser-timeout 120
```

Compare metadata and decoded A/V:

```bash
ffprobe -v error -count_frames -show_entries \
  format=duration,size:stream=index,codec_name,codec_type,width,height,\
  pix_fmt,r_frame_rate,avg_frame_rate,nb_read_frames \
  -of json /tmp/gta6-short-baseline.mp4

ffmpeg -hide_banner -loglevel error \
  -i /tmp/gta6-short-baseline.mp4 \
  -i /tmp/gta6-short-static-grid.mp4 \
  -lavfi '[0:v][1:v]psnr;[0:v][1:v]ssim' -f null -
```

### Worker matrix

The worker matrix used the temporary runner `/tmp/hf-worker-bench.mts` and
existing `createRenderJob()`/`executeRenderJob()` APIs. Each run used the same
fixture and settings, changing only `workers` from 1 through 4:

```bash
HF_CHROME_MEMORY_SAMPLE_MS=250 \
HF_BENCH_CHROME_PATH=/usr/bin/chromium \
HF_BENCH_OUTPUT=/tmp/hf-worker-bench-system \
HF_BENCH_WORKERS=2 \
HF_BENCH_RUN=1 \
node --import tsx /tmp/hf-worker-bench.mts
```

The runner resolved:

```ts
createRenderJob({
  fps: 30,
  quality: "standard",
  format: "mp4",
  workers,
  producerConfig: resolveConfig({
    fps: 30,
    quality: "standard",
    format: "jpeg",
    concurrency: "auto",
    forceScreenshot: false,
    useDrawElement: true,
    enableStreamingEncode: true,
    browserGpuMode: "software",
    chromePath: "/usr/bin/chromium",
    debug: false,
  }),
});
```

### Distributed range checks

The focused range and assembly checks were:

```bash
npx vitest run \
  src/services/render/segmentManifest.test.ts \
  src/services/render/segmentPlan.test.ts \
  src/services/render/capturePlan.test.ts

bun test \
  src/services/distributed/plan.test.ts \
  src/services/distributed/assemble.test.ts \
  src/services/distributed/chunkAudio.test.ts \
  src/services/distributed/mp4Stitch.test.ts

bun test \
  src/services/distributed/renderChunk.test.ts \
  src/services/distributed/renderChunkVideoMetadata.test.ts \
  src/services/distributed/videoMetadata.test.ts \
  src/services/distributed/planV2.test.ts
```

The range/plan tests passed. A few synthetic audio/assembly metadata
assertions were sensitive to the installed FFmpeg 5.1.9 time-base reporting;
the actual complete audio-bearing outputs had matching duration, frame rate,
frame count, and decoded PCM.

## Original next-step plan (superseded by phase two)

The next high-value experiment is not another isolated kernel benchmark. It is
an alternating three-run complete GTA6 short-export matrix using the actual
producer pipeline:

1. choose a deterministic 30–60 second range containing the grid, captions,
   chapter wipes, and audio;
2. record a real baseline with one worker and the current screenshot path;
3. apply exactly one composition change (prefer the transformed-child grid);
4. render the same range three times in alternating baseline/variant order;
5. compare total wall time, capture/encode/assembly stages, CPU/RSS, frame
   metadata, audio PCM, and screenshots at every chapter seam;
6. integrate only if the complete short export improves and the visual gate
   passes.

The later full export used an animated SVG-grid texture, not the static-grid or
transformed-child candidate. It showed an observed 18.9% reduction against a
fresh same-settings full baseline. Human acceptance, full-run CPU accounting,
chapter-boundary repeatability and multi-VPS benchmarking remain open. Follow
`gta6-performance-phase2.md` rather than extrapolating these earlier short tests.
