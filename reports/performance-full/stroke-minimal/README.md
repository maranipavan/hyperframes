# Minimal outlined-text raster diagnostic

Standalone browser reduction of the held-frame 845 evidence. The script uses
`page.setContent`, one extracted inline normal variable Inter face, the outlined
`01`, and its opacity/scaling ancestors. No composition runtime is loaded.

Commands from the workspace root (existing Node, Puppeteer, Chromium and built
engine helpers are required; no install/build or dependency changes):

```sh
node --check scripts/perf/stroke-raster-repro.mjs
node_modules/.bin/oxlint scripts/perf/stroke-raster-repro.mjs
node_modules/.bin/oxfmt --check scripts/perf/stroke-raster-repro.mjs
node scripts/perf/stroke-raster-repro.mjs self-test
node scripts/perf/stroke-raster-repro.mjs run reports/performance-full/stroke-minimal/run-01
node scripts/perf/stroke-raster-repro.mjs verify reports/performance-full/stroke-minimal/run-01
```

Output must be a **new immediate child** of this evidence directory; existing
output is refused. Set `HYPERFRAMES_BROWSER_PATH` to override browser discovery
on `PATH`. The run is bounded to 290 seconds and at most eight fresh browsers:
two repeats of plain hide/reveal without/with `will-change: transform` on the
**scaling parent**, then (only if plain no-hint is stable) two repeats of the
original target's 830→844 scale/opacity pre-roll without/with that parent hint.
Each browser captures 12 fixed-state samples at frame-845 styles. Harness-only
watchdogs and clock observations are outside the scene.

`run.json` records source/font/script hashes, flags, versions and extraction
provenance. `original-evidence-validation.json` verifies the existing PNGs
offline. Per-case `samples.json` records both sides of each screenshot's DOM
state, browser time, decoded RGBA hash and pixel differences. All setup and held
PNGs are retained; difference PNGs are emitted only when pixels actually change.
`summary.json` is required for a completed run; `failure.json` records incomplete
runs. A completed negative diagnostic exits successfully; it does not claim the
original engine has become deterministic.

## Observations

**Temporal drift was not reproduced in the minimal page.** The single bounded
run completed in **27.622 seconds**, on Linux arm64, Node v22.23.3, Puppeteer
25.8.0 and **Chrome/155.0.8059.79**, matching the browser version in the original
evidence. Each case had 12 screenshots and exactly one DOM-state hash, with
loaded Inter throughout. Every parent/target rectangle exactly matched the
original held-frame measurements (zero coordinate/size deltas). CDP reported two
glyphs from custom Inter; no external network attempts or browser errors occurred.

| History | Scaling-parent hint | Fresh browsers | RGBA hashes per browser | RGBA SHA-256 prefix |
| --- | --- | --- | --- | --- |
| Plain hidden → frame-845 styles | `auto` | 2 | 1, 1 | `6b2e50929054ee77` |
| Plain hidden → frame-845 styles | `transform` | 2 | 1, 1 | `9c9e7b34d54f207c` |
| Frames 830–844 → held 845 | `auto` | 2 | 1, 1 | `9a7efc1086f18c21` |
| Frames 830–844 → held 845 | `transform` | 2 | 1, 1 | `9507b14c4b1943a4` |

Each pair of fresh browsers agreed pixel-for-pixel. Hold observation windows
spanned approximately 1.77–1.94 seconds per browser; 96 held PNGs and 64 setup
PNGs are retained. No temporal-difference images were generated because every
within-case pixel comparison was zero.

### Original evidence remains positive

Offline verification of the existing original screenshots found **two RGBA
hashes and one recorded DOM state in each original browser**. The sequence is
`000011111111`: the change first appears at file label `849`, while `seekFrame`
remains **845**. The change is **5,109 pixels**, maximum channel error **78/255**,
within inclusive bounds **(193, 353)–(567, 641)**. This reconfirms the original
evidence without another engine/GTA6 run.

### Smaller history-dependent effect was reproduced

Although stable over time, the final minimal raster depends on preparation
history even when the final DOM-state hash is identical:

| Comparison, first repeat | Same final DOM state? | Changed pixels | Maximum channel error |
| --- | --- | --- | --- |
| Plain vs pre-roll, no hint | Yes | 5,135 | 78 |
| Plain vs pre-roll, parent hint | Yes | 7,542 | 22 |
| No hint vs parent hint, plain | No: hint changes | 7,511 | 25 |
| No hint vs parent hint, pre-roll | No: hint changes | 10,637 | 78 |

The no-hint history difference has the same bounding rectangle as the original
temporal difference. This is a **history-sensitive rasterization observation**,
not a reproduction of the original spontaneous held-state transition. The
parent hint changes pixels but demonstrates **no temporal-stability improvement**
here because both arms were already stable. The smaller maximum history error
under the hint alone is not proof of a fix or improved rendering accuracy.

## Exact artifacts

Paths are workspace-relative:

- Script: `scripts/perf/stroke-raster-repro.mjs`
- This report: `reports/performance-full/stroke-minimal/README.md`
- Checks: `reports/performance-full/stroke-minimal/checks.md`
- Aggregate: `reports/performance-full/stroke-minimal/run-01/summary.json`
- Commands, source hashes and flags: `reports/performance-full/stroke-minimal/run-01/run.json`
- Static extracted page: `reports/performance-full/stroke-minimal/run-01/minimal.html`
- Original PNG verification: `reports/performance-full/stroke-minimal/run-01/original-evidence-validation.json`
- Offline cross-case metrics: `reports/performance-full/stroke-minimal/cross-case-comparison.json`
- Example held image: `reports/performance-full/stroke-minimal/run-01/plain-no-hint-1/sample-00.png`
- Per-case details: `reports/performance-full/stroke-minimal/run-01/<case>/samples.json`

The eight `<case>` directories are `plain-no-hint-1`, `plain-parent-hint-1`,
`plain-no-hint-2`, `plain-parent-hint-2`, `preroll-no-hint-1`,
`preroll-parent-hint-1`, `preroll-no-hint-2`, `preroll-parent-hint-2`.
Each contains `sample-00.png` through `sample-11.png`. Plain cases retain
`setup-830.png`; pre-roll cases retain `setup-830.png` through `setup-844.png`.

## Caveats

- The reduction removes other painted content, the wipe, gradients, invisible
  siblings, full layer-tree history, runtime seeking and engine scheduling.
  Pre-roll values are derived from source FI/PUSH easing and GSAP's four-decimal
  style rounding; they do not replay the full original compositor history.
- The parent height is frozen from the original measurement to retain geometry
  after removing siblings. Only the normal variable Inter face needed by the
  target is extracted; the rest of the source's font CSS is omitted.
- A scene clock does not exist. `845 / 30` (28.166666… seconds) is a reference
  label; browser/wall clocks advance and are recorded separately from state.
- State observations before/after each screenshot, decoding and file writes
  affect scheduling. This bounded sample cannot exclude a later transition or
  establish that the parent hint helps the real scene.
- Full engine helpers and original input hashes are recorded. Chrome memory
  flags are host-derived by `buildChromeArgs`; the actual Puppeteer-added launch
  arguments are retained in each case, including ephemeral profile paths.
- The browser version matches the original; hardware-GPU, alternate-browser and
  production capture paths were not tested. No production fix is proposed.

## Recheck the offline cross-case metrics

The following command reads only retained artifacts and compares decoded RGBA,
including alpha. It also verifies final DOM-state equality for each pair:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { decodePng } from './packages/engine/dist/utils/alphaBlit.js';
const report = JSON.parse(await readFile('reports/performance-full/stroke-minimal/cross-case-comparison.json'));
for (const item of report.comparisons) {
  const a = decodePng(await readFile(item.a)), b = decodePng(await readFile(item.b));
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  let changedPixels = 0, maxChannelError = 0, squared = 0;
  let left = a.width, top = a.height, right = -1, bottom = -1;
  for (let i = 0; i < a.data.length; i += 4) {
    let changed = false;
    for (let c = 0; c < 4; c++) {
      const error = Math.abs(a.data[i + c] - b.data[i + c]);
      changed ||= error !== 0;
      maxChannelError = Math.max(maxChannelError, error);
      squared += error * error;
    }
    if (!changed) continue;
    changedPixels++;
    const x = (i / 4) % a.width, y = Math.floor(i / 4 / a.width);
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  assert.equal(changedPixels, item.changedPixels);
  assert.equal(maxChannelError, item.maxChannelError);
  assert.equal(squared / a.data.length, item.mseRgba);
  assert.deepEqual(changedPixels ? { left, top, right, bottom } : null, item.bounds);
  const x = JSON.parse(await readFile(dirname(item.a) + '/samples.json'));
  const y = JSON.parse(await readFile(dirname(item.b) + '/samples.json'));
  assert.equal(x.rows[0].beforeStateSha256 === y.rows[0].beforeStateSha256, item.stateEqual);
}
console.log('PASS: four offline cross-case comparisons');
JS
```
