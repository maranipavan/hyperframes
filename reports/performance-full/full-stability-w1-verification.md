# Full stability-hook export verification

## Render

- Input: `reports/performance-full/texture-stability-full/`
- Output: `reports/performance-full/full-stability-w1.mp4`
- Command evidence: `full-stability-w1.json`
- Browser: system Chromium 155.0.8059.79, software GPU, screenshot capture
- 1920×1080, 30 fps, draft MP4, one worker
- Exit code: 0; timed out: false
- Wall time: **2,491.270335 s = 41m31.3s**
- Sampled peak RSS sum: 1,630.5 MiB (shared-page double counting caveat)
- Sampled process-tree CPU lower bound: 4,512.27 s

## Media checks

`full-stability-w1.ffprobe.json` reports:

- H.264, 1920×1080, 30/1, **18,000 decoded frames**, start 0, duration 600 s.
- AAC, 48 kHz stereo, start 0, duration 600 s, 28,125 decoded audio frames.
- MP4 size: 69,360,038 bytes.

Using system FFmpeg 5.1.9 to decode PCM audio, the output matches the earlier
baseline and SVG-grid full exports:

```text
7ce0a94728439d6ee1b6313a7a8bc01255d23eb78b6b84cb4f1c0cf4c1197143
```

The project-local FFmpeg 8 raw-audio decode gives the same hash for all three
full outputs:

```text
88680f6a81afa23bd00499c61330dd8de0f106ae47ad58684865a3db0404c24c
```

The local FFmpeg 8 raw-video hash for this output is recorded in
`full-stability-w1.video.sha256`:

```text
SHA256=2d2db6fb5e409dd859f1f8069b0c50f6f5bde28a0719d16784bcda2eeaf173d5
```

## Performance comparison

| Full export                        |                  Wall time |
| ---------------------------------- | -------------------------: |
| Original animated CSS gradients    |     3,068.212 s / 51m08.2s |
| Animated SVG grid                  |     2,487.828 s / 41m27.8s |
| Animated SVG grid + stability hook | **2,491.270 s / 41m31.3s** |

The retained optimization is therefore **576.942 s / 18.80% faster than the
fresh original rerun**. The stability hook adds 3.442 s, or 0.138%, relative to
the SVG-grid candidate. This is one run, not a median or confidence interval.
It remains slower than the operator-supplied 36m19s result because its settings
are unknown.

Not yet proven: a second full stability-hook repeat, complete frame-by-frame
visual comparison against the earlier SVG-grid export, human approval of subtle
grid/stroke differences, historical-settings equivalence, and real multi-VPS
throughput.
