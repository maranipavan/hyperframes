# GTA6 chapter-boundary repeatability investigation

**Latest state:** the approved continuation produced a scoped capture-stability
candidate with four matching 900-frame exports. See **section 6** for the
resumable handoff, current files, checks and remaining full-film gates. Sections
1–5 preserve the earlier investigation rather than rewriting its failed controls.

## Earlier result and decision

**Capture-side instability is reproduced before video encoding. No production
fix or worker-default change is approved.** Lossless captures of the outlined
`01` chapter number differ despite matching sampled DOM state. Holding the
timeline at the _same frame_ also produces two distinct raster results, even
after awaiting `document.fonts.ready` on every capture.

A fixed-input encode replay is deterministic in the bounded test. This narrows
the investigation to browser painting/capture for the reproduced defect, but
does not identify the precise Chromium/Skia mechanism or prove that it is the
only cause of the earlier MP4 differences. Those exports did not retain their
original pre-encode buffers.

The original composition, animated SVG-grid candidate, engine/producer sources,
Rust instrumentation, TypeScript fallbacks and renderer defaults are unchanged.
The earlier **18.9% full-export A/B observation** is unchanged; no new full-film
speedup or multi-VPS result is claimed.

## 1. Encode-only control

Tool: `scripts/perf/gta6-encode-repeat.py`.

- Decode frames 840–899 of the retained `w1-1.mp4` **once** to fixed YUV420P.
- Replay those identical 60 input frames through two fresh encoders.
- Use the project-local FFmpeg 8.0.1 build and matching draft parameters:
  libx264, ultrafast, CRF 28, `-bf 0`, `aq-mode=3`, BT.709 limited-range tags.
- No forced single-threading or bit-exact override. Embedded x264 settings
  confirm six threads in the originals and both new encodes.
- Both outputs have 60 frames and **identical decoded per-frame hashes and
  identical MP4 bytes** (296,344 bytes each).
- Fixed input hash unchanged before/after. The diagnostic took 5.92 seconds
  wall time; this is not a rendering-throughput benchmark.

MP4 SHA-256 for both replays:

```text
83ab4b863327a40c3e77b7a3fde68f77b85954bdf7216402b7fdda96502febdf
```

Limitations: input was decoded from a lossy MP4, encoder history starts fresh
rather than replaying the preceding 840 frames, and browser capture, JPEG
conversion, streaming pacing, audio and final assembly were not replayed.

Evidence and exact FFmpeg commands:

- `reports/performance-full/encode-repeat/README.md`
- `reports/performance-full/encode-repeat/run-1/summary.json`
- `reports/performance-full/encode-repeat/run-1/commands.jsonl`
- `reports/performance-full/encode-repeat/checks.md`

## 2. Real engine capture, without a video encoder

Tool: `scripts/perf/gta6-capture-repeat.mjs` uses the producer's runtime-injecting
file server and the built engine's `initializeSession` / `captureFrameToBuffer`.
Each repeat starts a fresh browser; no browser-pool reuse.

Input is the frozen compiled HTML from the original worker benchmark, including
inlined GSAP and fonts:

```text
packages/.debug/34924e85-649b-4baa-867b-834a88350af2/compiled/index.html
SHA-256 62c57da84b4a1582fcffb95412e35caa827d1c8642b576546a8d0f1253c83888
```

Settings: Chromium 155.0.8059.79, Linux ARM64, 1920×1080, 30 fps,
software rendering, forced screenshot capture, drawElement disabled. Frames
are sought by absolute frame number divided by 30.

### Lossless reproduction

Two independent captures of frames 810–899 differ at **844–847**. Differences
are confined to the outlined chapter number, bounding box approximately
`x=193..567, y=353..641`:

| Frame | Changed pixels | Maximum channel difference |      PSNR |
| ----: | -------------: | -------------------------: | --------: |
|   844 |          5,022 |                     52/255 | 49.591 dB |
|   845 |          5,109 |                     78/255 | 46.059 dB |
|   846 |          5,122 |                     99/255 | 43.965 dB |
|   847 |          5,134 |                    115/255 | 42.655 dB |

The other 86 sampled frames are identical. Sampled boxes, transforms,
opacity, visibility, font declarations and stroke declarations match across
the two runs. This is not merely a difference in PNG compression: comparison
uses decoded RGBA pixels.

Evidence: `reports/performance-full/capture-repeat-short/summary.json` and
`reports/performance-full/capture-repeat-short/worst-diff-x16.png`.

### Stronger control: hold frame 845

After pre-roll from frame 830, capture frame **845 (28.166667 s)** twelve times
in each of two fresh browsers. Both runs produce **two different pixel hashes**
while staying at that same timeline time. The change occurs at a different
sample in each run. This is not animation advancing by a frame.

Repeating the held-frame experiment with `await document.fonts.ready` before
each capture still produces **two pixel states per run**, with exactly **one
sampled DOM state per run** and font status `loaded` throughout. The two runs
happen to change at the same sample in this test, so cross-run equality alone
would falsely appear to pass. The tool also checks _within-run held-frame_
equality and correctly fails the determinism gate.

In held-mode filenames/sample labels 845–856 enumerate twelve captures;
**every `seekFrame` is 845**. They are not twelve consecutive timeline frames.

Evidence:

- `reports/performance-full/capture-repeat-held-845/summary.json`
- `reports/performance-full/capture-repeat-held-fonts-845/summary.json`
- Each run's `repeat-*/frames.json` records hashes and sampled DOM state.

PNG uses the engine's alpha-capable screenshot path. Diagnostics add state
reads and file writes; they are not identical to the original streaming JPEG
pipeline. A separate JPEG-quality-80 pair with sequential pre-roll from frame
0 to 869 had identical sampled frames 830–869. That clean pair demonstrates
intermittency/route sensitivity, **not a fix** or a rejection of the PNG evidence.

## 3. Small mitigation experiments — none adopted

All CSS changes below were injected only into diagnostic pages in memory, not
written into the original, compiled artifact or retained SVG-grid candidate.
Each completed experiment used two fresh browsers.

| Experiment                                                                   | Actual result                                             | Decision                                        |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| `.ch-num { text-rendering: geometricPrecision !important; }`, frames 830–869 | All 40 frame pairs match                                  | Insufficient alone                              |
| Same CSS, sequential capture from frame 0 through 899, retaining 810–899     | Frames **847–848 differ**                                 | Rejected as a fix                               |
| `.ch-num { will-change: transform; }`, frames 830–869                        | Frame **845 differs**                                     | Rejected as a fix                               |
| Request `captureBeyondViewport: true`, frames 830–869                        | Init downgraded it to **false**; all 40 pairs match       | Not a test of effective beyond-viewport capture |
| Await `document.fonts.ready`, frames 830–869                                 | All 40 pairs match                                        | Held-frame control below still fails            |
| Await fonts, hold frame 845 twelve times                                     | **Two pixel states per run**, one DOM state               | Rejected as a sufficient fix                    |
| Synchronous compositor diagnostic flags                                      | First `Page.captureScreenshot` timed out after 60 seconds | Rejected; no frames/quality proof               |
| Two extra animation frames before capture                                    | Batch deadline interrupted repeat 2                       | Incomplete; no mitigation claim                 |

The first longer font-wait attempt was also interrupted by the outer 600-second
batch deadline after the preceding full-pre-roll experiment completed. It has
partial files but no `summary.json`; it is **not** a completed pass/fail pair.
The later short font-wait and held-font experiments completed separately.

The flag wrapper is retained for reproducing the failed experiment only:
`scripts/perf/chromium-sync-diagnostic.sh`. It adds
`--run-all-compositor-stages-before-draw`,
`--disable-new-content-rendering-timeout`, `--disable-threaded-animation`,
`--disable-threaded-scrolling`, and `--disable-checker-imaging`, without
enabling BeginFrame control. **Do not make this the default browser executable.**

Raw evidence directories, all under `reports/performance-full/`:

```text
capture-repeat-short/
capture-repeat-geometric/
capture-repeat-geometric-long/
capture-repeat-promoted/
capture-repeat-beyond/
capture-repeat-fonts/              # interrupted, no completed summary
capture-repeat-fonts-short/
capture-repeat-sync/               # capture timeout
capture-repeat-settle/             # interrupted, no completed summary
capture-repeat-jpeg-preroll/
capture-repeat-held-845/
capture-repeat-held-fonts-845/
```

## 4. Verification and reproduction

No dependencies added. Node 22 with the existing local `tsx`, built engine/core,
Python 3, system Chromium, and the existing project-local FFmpeg are required.
Run from the workspace root. Source and output paths resolve relative to the
workspace; output parents must exist and output directories must be fresh.

```bash
# Fast checks, no browser render.
node --import tsx scripts/perf/gta6-capture-repeat.mjs self-test
python3 scripts/perf/gta6-encode-repeat.py self-test
sh -n scripts/perf/chromium-sync-diagnostic.sh
node scripts/perf/gta6-experiment.mjs self-test

# Independent artifact/hash checks. Exit 1 is EXPECTED for these failing
# determinism gates; stdout must say evidenceVerified:true, gatePassed:false.
node --import tsx scripts/perf/gta6-capture-repeat.mjs verify \
  reports/performance-full/capture-repeat-short
node --import tsx scripts/perf/gta6-capture-repeat.mjs verify \
  reports/performance-full/capture-repeat-held-fonts-845

# A short raw reproduction. Intermittent: a clean pair alone is not a repair.
node --import tsx scripts/perf/gta6-capture-repeat.mjs run \
  reports/performance-full/capture-repeat-new 810 900 810 baseline png

# Stronger held-time control; the output filenames are sample labels.
node --import tsx scripts/perf/gta6-capture-repeat.mjs run \
  reports/performance-full/capture-repeat-held-new 845 857 830 hold-fonts png

# Sequential JPEG pre-roll, no FFmpeg video encoder running concurrently.
node --import tsx scripts/perf/gta6-capture-repeat.mjs run \
  reports/performance-full/capture-repeat-jpeg-new 830 870 0 baseline jpeg
```

Completed verification: both diagnostic self-tests, Node syntax, Python AST and
tabnanny checks, shell syntax, original/candidate source guard, MJS oxlint and
oxfmt. Saved raw artifacts were independently re-decoded and checked against
their recorded hashes. The failures above remain failures; neither thresholds
nor existing distributed tests were weakened. No new full root suite was run;
production code did not change. Earlier engine/producer checks are recorded in
`reports/gta6-performance-phase2.md`, not claimed as fresh results here.

Recovery snapshot of the new tools/report and frozen compiled input:
`backups/performance-phase2-20261020/repeatability-tools-and-report.tar.gz`.
Original pre-change archive remains intact. No Git metadata is available and
no commit was attempted.

## 5. Next bounded step

Build a minimal outlined-text/scale/opacity reproduction from this evidence and
test whether the pixel-state switch is Chromium paint/raster cache behavior,
layer promotion or another screenshot presentation issue. A proposed repair
must pass held-time checks, non-monotonic seeks, fresh-browser repetitions and
actual pre-encode JPEG/PNG seam comparisons, without freezing motion or adding
a large per-frame wait. Preserve the failing controls alongside it.

Do not choose three workers as a deterministic preset from the performance
numbers alone. Original worker-video parity and the two distributed MP4
capture-mode assertions remain open. Real multi-VPS benchmarking still needs
approved hosts/access, and comparison with 36m19s needs the historical command.
Human approval of the animated grid candidate is also still pending.

## 6. Approved continuation — resumable handoff

### Goal and stop point

Preserve the original animated GTA6 film and audio, resolve capture drift, then
validate complete-export performance. The user approved continuation, then asked
about wrapping up before the session/token limit. **No new long render was
started after that request.** Remaining app token/time allowance is not visible.

### Current result

**The scoped candidate passes the reproduced 30-second export repeatability
case.** Four complete exports (order 1, 3, 3, 1 workers) each contain 900 decoded
frames, 1920×1080 at 30 fps, with both streams starting at zero and lasting 30 s.
Every decoded video frame matches across all four. Decoded audio also matches
the original excerpt, SHA-256:

```text
9a728dec160a1dceb6bddc47b2737b40901529fdb5682bfee49434dbb644abc9
```

| Final scoped candidate | Wall time | Sampled peak RSS sum |
| ---------------------- | --------: | -------------------: |
| 1 worker, repeat 1     | 174.997 s |          1,500.7 MiB |
| 3 workers, repeat 1    | 120.131 s |          3,504.3 MiB |
| 3 workers, repeat 2    | 116.702 s |          3,532.2 MiB |
| 1 worker, repeat 2     | 175.044 s |          1,499.6 MiB |

These are excerpt measurements, not full-film extrapolations. They are slower
than the earlier no-hook matrix (161.121 s / 90.157 s medians). The earlier
matrix was not a contemporaneous randomized control, so do not attribute the
whole difference to the hook. RSS sums double-count shared pages and are sampled.
No faster full-film result or new worker default is claimed.

Final evidence: `reports/performance-full/stability-active-exports/verification.json`,
the four MP4s, and each run's `.json`/`.log` in the same directory.

### Implementation and scope

`scripts/perf/gta6-stability-hook.mjs` installs a capture-only `hf-seek` listener.
It registers a microtask through the supported `event.detail.waitUntil` gate,
after synchronous timeline/clip updates and before capture. For the **active
chapter's authored half-open time window**, it temporarily sets the chapter
container's display to none, flushes layout, then restores the **exact original
style attribute in a finally block**. This recreates its layout/paint objects.

There are no sleeps, extra animation frames, cloned/reinserted DOM nodes,
cleared transforms or modified authored timeline scripts. Preview is a no-op.
This is **GTA6-specific**, not a general renderer workaround: arbitrary custom
elements, media, focus and unrelated compositions have not been validated.

An earlier prototype selected chapters by client rects alone. In this film,
opacity-zero inactive chapters still have boxes, so it reset all eight chapters
on every seek. That prototype passed four exports and eight-chapter held tests,
but was replaced with the authored-time filter. Its separate artifacts remain
in `stability-exports/`, `stability-30/`, and `capture-full-chapter-*-{forward,back}/`.
**Do not present those eight-chapter tests as final-filter validation.**

Current deliverables:

- `scripts/perf/gta6-stability-hook.mjs`: scoped hook.
- `scripts/perf/gta6-stability-candidate.mjs`: hash-guarded isolated generator and self-test.
- `scripts/perf/gta6-stability-verify.py`: all-frame/audio/metadata verification.
- `scripts/perf/gta6-capture-repeat.mjs`: extended with mitigation, held/backward,
  cross-history comparison and frozen full-source options.
- `reports/performance-full/stability-active-30/index.html`: tested excerpt.
- `reports/performance-full/texture-stability-full/index.html`: 600-second
  animated-SVG-grid + scoped-hook candidate; lint/check passed and was rendered
  once as `reports/performance-full/full-stability-w1.mp4`.
- Each candidate directory contains `capture-stability.js`, both original audio
  assets, `candidate.patch` and `manifest.json`.

Final hook SHA-256: `74db70b4c11d036dba7ff83a28b975fc81b9be3be80f19575602cc08fd274d8d`.
The earlier prototype hook was `338bd638a584b062e6f13862dff9f7cdc85bf0dc7b5ed072b9e12a1a0a1c90d2`.
**The HTML hashes alone are insufficient: the hook is a separate local asset.**
The original composition, earlier SVG-grid candidate, engine/producer capture
defaults, Rust instrumentation and TypeScript fallbacks remain untouched.

### Browser reduction and rejected approaches

`scripts/perf/stroke-raster-repro.mjs` produced a static, network-free reduction
using the same embedded Inter font and geometry. Eight fresh browsers / 96 held
captures showed no temporal drift in that reduction, but **different preparation
histories produced different pixels with identical final DOM state**. Evidence:
`reports/performance-full/stroke-minimal/README.md` and its `run-01/` directory.

Putting `will-change: transform` on the scaling parent passed temporal/sequence
checks but failed real-GTA6 direct-versus-pre-roll equality:
`reports/performance-full/parent-history-comparison.json`. It is not adopted.
`force3D:false` and disabling partial raster did not remove the held-frame drift.
Disabling threaded compositing timed out. Browser re-rasterization history is
supported by these observations, not a proven single Chromium source-code bug.
The compiled input already had global `text-rendering: geometricPrecision`, so
the earlier geometricPrecision experiment was not an independent new setting.

### Production audit fix

The candidate's normal browser check exposed a separate false positive:
`text_not_painted` rejected visibly outlined text because the fill is transparent.
Fixed in `packages/cli/src/commands/layout-audit.browser.js`: positive stroke
width and stroke alpha × cumulative opacity must exceed the existing visibility
threshold. Transparent, zero-width and effectively invisible strokes still fail.
This is an actual audit fix, not a suppression or a change to the film's colors.

Regression tests changed:

- `packages/cli/src/commands/layout-audit.browser.test.ts`
- `packages/cli/src/commands/layout-audit.chromium.test.ts`

Pre-change source backup:
`backups/performance-phase2-20261020/pre-stroke-audit-fix.tar.gz`.

Latest tool/source/handoff snapshot:
`backups/performance-phase2-20261020/stability-handoff.tar.gz`, verified by
`backups/performance-phase2-20261020/stability-handoff.SHA256SUMS`.

### Checks actually completed

From the workspace root, with the existing Bun on PATH and
`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`:

```bash
bun run --cwd packages/cli test src/commands/layout-audit.browser.test.ts src/commands/layout-audit.chromium.test.ts
bun run --cwd packages/cli build
node scripts/perf/gta6-stability-candidate.mjs self-test
node --import tsx scripts/perf/gta6-capture-repeat.mjs self-test
python3 scripts/perf/gta6-stability-verify.py reports/performance-full/stability-active-exports
```

- **Tests:** 200 audit unit tests + 42 real Chromium tests passed. Visible-stroke
  regressions failed before the fix; screenshots independently show painted ink.
- **Build:** CLI passed; nonfatal existing missing `skills/gsap` copy warning.
- **Typecheck:** no separate new full-project typecheck; CLI build performed its
  build checks. No fresh full root test suite was run.
- **Self-tests:** hook/generator source guards, unchanged original scripts/audio,
  preview no-op, idempotent installation, deferred wait gate, half-open active
  windows (including invisible-but-laid-out scenes), exact style restoration,
  exception restoration and invalid-time handling passed.
- **Export verification:** all four final scoped exports passed exact decoded
  video/audio equality and frame-count/duration/dimension/A-V-start checks.
  The verifier refuses to overwrite `verification.json`; retain that evidence
  or use a fresh output directory for a new export set.
- **Composition validation:** both final candidates passed local CLI `lint` and
  `check`. Existing warnings remain (79 for the truncated excerpt, 41 for full).
  Logs/exit statuses are `stability-active-exports/{lint,check}-{30,full}.{log,json}`.
- **Lint/format:** changed audit files and MJS tools checked with oxlint/oxfmt;
  no renderer-wide warning exemption or test assertion was weakened.

The original failed export evidence remains intact. All delegated tasks finished;
there is no unresolved agent work. No Git metadata, commit or deployment exists.

### First action for the next session

Re-run the eight-chapter held/forward/backward controls with the **final scoped
hook**, using fresh directory names. Start with chapter 2:

```bash
export GTA6_DIAG_COMPILED_DIR=packages/.debug/ab11b61a-6c9c-44dd-9d57-71645d64c7d5/compiled
node --import tsx scripts/perf/gta6-capture-repeat.mjs run reports/performance-full/capture-final-3707-forward 3707 3719 3692 hold-listener
node --import tsx scripts/perf/gta6-capture-repeat.mjs run reports/performance-full/capture-final-3707-back 3707 3719 3707 hold-back-listener
node --import tsx scripts/perf/gta6-capture-repeat.mjs compare reports/performance-full/capture-final-3707-forward reports/performance-full/capture-final-3707-back reports/performance-full/chapter-final-3707-history.json
```

Then cover frames `845,3707,6961,8557,11086,12830,14167,15896`. Check the recorded
`stabilityStats` to ensure only the active chapter is reset. Geometry sampling
in the existing diagnostic still targets `#s3`; later-chapter raw-pixel equality
is meaningful, but expand that selector before claiming later DOM-box coverage.

After those controls and visual review, run a **second 600-second export** of
`texture-stability-full` with the prior pinned FFmpeg/browser settings, then
compare both full outputs frame-by-frame and verify seams. One full run is now
measured; the second full repeat and full output-to-output visual comparison are
**not run**. Do not extrapolate the 30-second worker matrix.
The historical 36m19s settings and approved multi-VPS hosts/access remain missing.
No cloud authorization or human visual acceptance is inferred from “continue approved”.
