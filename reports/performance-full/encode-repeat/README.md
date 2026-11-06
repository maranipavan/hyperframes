# GTA6 bounded encode-only repeatability diagnostic

## Result

**Encoder nondeterminism was not reproduced.** Two fresh libx264 processes,
reading the same frozen 60-frame sequence, produced identical decoded frames
**and** byte-identical MP4 files. This supports repeatability for this input and
configuration; it does not prove that the original discrepancy came from capture.

The diagnostic independently confirmed the retained discrepancy within the
selected window: zero-based frames **840–844 match; all 845–899 differ**. Frames
0–839 were not re-compared. The 900-frame originals were only read.

| Measurement | Observed result |
| --- | --- |
| Frozen sequence | w1-1 frames 840–899 inclusive, decoded once |
| Format | 1920×1080, 30 fps, YUV420P, BT.709 limited range |
| Frozen input size | 186,624,000 bytes / 60 frames |
| Re-encode count | Exactly two |
| Decoded output frame counts | 60 and 60; all per-frame SHA256s match |
| Output duration | 2 seconds each |
| Output MP4 sizes | 296,344 bytes each |
| Embedded x264 version and option strings | Identical in both retained and both new files |
| Diagnostic wall time | 5.919638 seconds |
| Aggregate diagnostic CPU | 9.559262 seconds, parent plus reaped children |
| Original-file hash checks | All 14 recorded files unchanged |

These timings only show that the correctness diagnostic stayed bounded. They
are not throughput measurements. The tool allows 110 seconds of wall/aggregate
CPU budget, checked before subprocesses; each subprocess has at most 35 seconds
wall time and an RLIMIT_CPU based on the remaining CPU budget.

### Hashes

- Frozen raw input SHA256:
  `81a80320a5cc35aab0b544d966ffe1b7705d6f08e019ab941ac8a651475e72ca`
- Decoded-frame sequence SHA256, identical for both re-encodes:
  `e474a86bfb06198f97cf7374b6b3c2b1ce2b5b29181d8d417ddced555a219e75`
- MP4 file SHA256, identical for both re-encodes:
  `83ab4b863327a40c3e77b7a3fde68f77b85954bdf7216402b7fdda96502febdf`

The decoded-frame aggregate is SHA256 of the concatenated lowercase ASCII
per-frame SHA256 hex strings, in order. It excludes framehash headers and MP4
metadata. It is **not** a hash of concatenated raw pixels. Every underlying
per-frame hash, frame size, timestamp and count is retained separately.

## Settings provenance and metadata

Inspected local source and retained logs:

- `packages/engine/src/services/chunkEncoder.ts:53–57`: draft = ultrafast, quality
  28, H.264; SDR MP4 uses YUV420P.
- `packages/engine/src/services/streamingEncoder.ts:338–374`: software libx264,
  CRF, B-frames disabled, and ultrafast's
  `aq-mode=3:colorprim=bt709:transfer=bt709:colormatrix=bt709`.
- The same file, lines 397–464: BT.709 limited-range tags, pixel format,
  90000 track timescale, and `-avoid_negative_ts make_zero`.
- `packages/engine/src/utils/sdrCaptureColor.ts`: production screenshot
  BT.601/full-range → BT.709/limited-range conversion. This is intentionally
  bypassed for already-decoded BT.709 YUV input; only sample aspect ratio is set.
- `packages/producer/src/services/renderOrchestrator.ts:4610–4627`: streaming
  options and the HLS-only GOP lock.
- `reports/performance-full/workers/w1-{1,2}.{json,log}`: 30 fps, draft, one worker,
  screenshot capture, and streaming encode enabled.

All four files' embedded x264 SEI strings match exactly: x264 core 165,
`threads=6`, `lookahead_threads=1`, `sliced_threads=0`, `bframes=0`,
`keyint=250`, `keyint_min=25`, `scenecut=0`, `rc=crf`, `mbtree=0`, `crf=28.0`,
`aq=3:1.00`, plus the remaining recorded options. No encoder thread, bitexact,
tune, GOP or CPU-feature overrides were added. Decode/rawvideo thread limits
apply only to the extraction/hash commands, not the libx264 encodes.

Both originals and re-encodes probe as Constrained Baseline H.264, level 4.0,
1920×1080, SAR 1:1, 30/1 fps, zero start time, zero B-frames, YUV420P and BT.709
limited range. Original final files have video time base 1/15360, AAC audio and
HyperFrames provenance tags. Re-encodes have 1/90000, video only, and the normal
Lavf/Lavc encoder tags. No creation-time tag is present in the saved probes.
No final audio/provenance/faststart remux was performed. Full probes are retained;
file-hash equality is reported separately from decoded-pixel equality.

Pinned tools, with no PATH fallback or new dependencies:

- `.tools/ffmpeg/ffmpeg`, version `n8.0.1-66-g27b8d1a017-20260228`, SHA256
  `fd87629f4c223d3bbfcba6cda18b5171244e83697a683e4205312b896e2f819f`.
- `.tools/ffmpeg/ffprobe`, same version, SHA256
  `ff60e3aa2f33464ff822bee9a59a0648c0d566f22b901ab09a748959ccd4c974`.
- Run environment: Python 3.11.2, Linux aarch64, four logical CPUs/affinity CPUs.

## Commands and reproduction

Commands actually executed from the workspace root:

```bash
python3 scripts/perf/gta6-encode-repeat.py self-test
python3 scripts/perf/gta6-encode-repeat.py inspect
python3 -B -c 'import ast, pathlib; p = pathlib.Path("scripts/perf/gta6-encode-repeat.py"); compile(ast.parse(p.read_text(), filename=str(p)), str(p), "exec"); print("PASS: Python syntax/AST compile (no bytecode written)")' && python3 -m tabnanny scripts/perf/gta6-encode-repeat.py
python3 scripts/perf/gta6-encode-repeat.py run
```

`run-1/commands.jsonl` records **all 12 exact subprocess argv lists and
shell-quoted commands**, exits, timeouts, CPU limits and elapsed resources.
Every ffprobe command taking an input includes `--` immediately before it.

The extraction command, executed once, uses frame indices rather than seeking:

```bash
.tools/ffmpeg/ffmpeg -hide_banner -nostdin -n -threads 2 -i reports/performance-full/workers/w1-1.mp4 -map 0:v:0 -an -vf trim=start_frame=840:end_frame=900,setpts=PTS-STARTPTS -frames:v 60 -fps_mode passthrough -c:v rawvideo -threads 1 -pix_fmt yuv420p -f rawvideo reports/performance-full/encode-repeat/run-1/fixed-840-899.yuv
```

First encode command (the second differs only in output name `repeat-2.mp4`):

```bash
.tools/ffmpeg/ffmpeg -hide_banner -nostdin -n -f rawvideo -pixel_format yuv420p -video_size 1920x1080 -framerate 30 -i reports/performance-full/encode-repeat/run-1/fixed-840-899.yuv -map 0:v:0 -an -frames:v 60 -r 30 -c:v libx264 -preset ultrafast -crf 28 -bf 0 -x264-params aq-mode=3:colorprim=bt709:transfer=bt709:colormatrix=bt709 -colorspace:v bt709 -color_primaries:v bt709 -color_trc:v bt709 -color_range tv -vf setsar=1 -video_track_timescale 90000 -pix_fmt yuv420p -avoid_negative_ts make_zero reports/performance-full/encode-repeat/run-1/repeat-1.mp4
```

The frozen file is mode 0444; its hash is checked before and after each encode.
Outputs are claimed exclusively; FFmpeg uses `-n`. Repeating the default command
now exits 2 with `Refusing existing output`. To reproduce, choose a **new**
workspace-relative directory inside this evidence tree, for example:

```bash
python3 scripts/perf/gta6-encode-repeat.py run --out reports/performance-full/encode-repeat/run-2
```

That example has not been run. The script locates the workspace from its own
path and runs all child commands there, independently of the caller's cwd.
Absolute, escaping, symlinked and existing output paths are refused.
See [checks.md](checks.md) for the executed syntax, indentation-lint, self-test,
artifact integrity, existing-output and portable-cwd checks.

## Evidence map

Everything below is under `reports/performance-full/encode-repeat/`:

- `run-1/summary.json`: comparisons, hashes, counts, metadata, x264 settings,
  resource accounting, scope and limitations.
- `run-1/fixed-input.json`, `run-1/fixed-840-899.yuv`: retained fixed sequence,
  whole-file and per-frame identities.
- `run-1/repeat-{1,2}.mp4`: two re-encoded video-only outputs.
- `run-1/repeat-{1,2}-framehash.stdout`: decoded SHA256 frame records.
- `run-1/w1-2-window-framehash.stdout`: original comparison window; compared to
  the fixed w1-1 frame hashes without decoding w1-1 again.
- `run-1/retained.json`, `run-1/*-probe.stdout`: input hashes, SEI, complete probes.
- `run-1/encode-{1,2}.stderr`: actual libx264 initialization/options and frame totals.
- `run-1/settings-evidence.json`: line-numbered source/log excerpts.
- `run-1/environment.json`: tool versions/hashes, script hash and runtime details.
- `run-1/commands.jsonl`, `run-1/*.stdout`, `run-1/*.stderr`: executed commands and logs.
- `run-1/preserved-{before,after}.json`: unchanged SHA256s of both originals,
  their logs/metrics, inspected sources, compositions and existing verification report.

## Scope of proof and limitations

This is a repeatability control for identical pixels entering two fresh encoders
with matching draft options. It did not reproduce the observed late-frame drift.
The positive result makes input/capture or full-pipeline state drift a useful
next hypothesis, **not an established cause**.

The fixed sequence is decoded from an already-lossy export, not from original
captured JPEGs. Its first frame starts a fresh GOP/reference/rate-control history;
the original encoder had already processed 840 frames. The experiment covers
two encodes, one input window, one binary/build/CPU environment. It does not replay
browser state, image2pipe/JPEG conversion, streaming delivery pacing, concurrent
load, the full 900-frame history, audio or final mux. It cannot rule out
input/history/pacing-dependent encoder nondeterminism elsewhere.

To attribute the original cause conclusively would require original pre-encode
capture hashes (or separately retained capture sequences) and, if necessary, a
full-sequence replay. This bounded task intentionally stops at the control above.

Only the new diagnostic script and this new evidence tree were created. No
production source, existing script/report, composition, tests or defaults were
edited. The workspace has no Git repository (`git status --short` reported
`fatal: not a git repository`); no Git metadata was created.
