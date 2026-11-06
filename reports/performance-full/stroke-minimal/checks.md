# Checks performed

All commands ran from the workspace root on 2026-10-20, with Node v22.23.3.
No dependency install or package build was needed; existing built engine helpers
and Puppeteer 25.8.0 were used.

| Command | Result |
| --- | --- |
| `node --check scripts/perf/stroke-raster-repro.mjs` | Exit 0 |
| `node_modules/.bin/oxlint scripts/perf/stroke-raster-repro.mjs` | Exit 0; 0 warnings, 0 errors |
| `node_modules/.bin/oxfmt --check scripts/perf/stroke-raster-repro.mjs` | Exit 0; correctly formatted |
| `node scripts/perf/stroke-raster-repro.mjs self-test` | Exit 0; RGBA/alpha difference, bounds, PNG roundtrip, extraction, static page, history, output scope and drift-classification checks passed |
| `node scripts/perf/stroke-raster-repro.mjs run reports/performance-full/stroke-minimal/run-01` | Exit 0; 8 fresh browsers, 96 held screenshots, 64 setup screenshots, 27.622 seconds |
| `node scripts/perf/stroke-raster-repro.mjs verify reports/performance-full/stroke-minimal/run-01` | Exit 0; all 8 cases, setup/held PNGs, decoded pixel metrics, states and source hashes verified |
| Same `run` command against `run-01` again | Expected exit 1, `EEXIST` at `mkdir`; prior evidence refused before writes or browser launch |

The initial formatting check identified formatting differences; the workspace's
existing `oxfmt` formatted only the new script, and all final checks above passed.

The run verifies hashes of the compiled input, original report JSONs, built
helpers, package manifest and lockfile before/after. The original 24 PNGs were
decoded and checked against their retained capture/RGBA hashes without launching
the original composition. No existing source, script, composition, report or
default was edited by this diagnostic.

`git status --short` reports that this workspace is not a Git repository. No
commit was created. The standalone static diagnostic page is not a Hyperframes
composition, so composition lint/check and video builds are not applicable.
