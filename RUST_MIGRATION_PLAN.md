# HyperFrames Rust Migration Plan

**Audit scope:** TASK.md Phase 1 and Phase 2 only  
**Audit date:** 2026-10-19  
**Workspace:** `/home/ubuntu/hyperframes-main`  
**Current implementation status:** TypeScript/TSX/JavaScript monorepo with an isolated, opt-in Rust alpha-blit kernel prototype

## 1. Executive summary

HyperFrames is an open-source framework that turns HTML, CSS, media, and
seekable browser animations into deterministic video. Its product surface is
larger than a single renderer: it includes a composition contract and browser
runtime, parsers and linter, a Chrome/FFmpeg capture engine, a producer and
distributed-render protocol, a React Studio editor, a web-component player, a
headless editing SDK, a CLI, cloud adapters, a registry, documentation, and
agent skills.

The technically sound target is a **hybrid architecture**, not a wholesale
rewrite. Rust should own measured, browser-independent, CPU- or I/O-intensive
kernels and security-sensitive data boundaries. TypeScript should continue to
own browser behavior, authored JavaScript compatibility, UI, cloud SDK
integration, and orchestration until a replacement has demonstrated exact
contract parity.

The first migration candidates are:

1. versioned protocol and pure timing/math utilities;
2. distributed render planning, manifest construction, hashing, and artifact
   bookkeeping;
3. safe archive extraction and filesystem capability helpers;
4. pixel-buffer operations such as alpha blitting and selected image kernels;
5. narrowly scoped MP4 box parsing and chunk stitching;
6. later, bounded subprocess supervision where it measurably improves
   cancellation and resource accounting.

The browser runtime, Chrome/CDP capture, GSAP/source rewriting, Studio, Player,
shader transitions, CLI command surface, and cloud-specific adapters should
remain in their current languages for the foreseeable future. Replacing those
surfaces first would increase compatibility risk without addressing the main
performance bottlenecks.

No broad application rewrite was attempted. The follow-up implementation adds
only an isolated Rust media-kernel prototype and an opt-in Node boundary;
render behavior remains unchanged unless the native path is explicitly enabled.
This document remains the Phase 1/2 audit and migration plan, while
`RUST_BENCHMARKS.md` records the measured prototype result.

## 2. Safety boundary and repository state

### 2.1 Workspace and sandbox confirmation

The current working directory was confirmed with `pwd` as:

```text
/home/ubuntu/hyperframes-main
```

The command also verified that the shell's current path exactly matched the
requested project path. All inspection and validation commands were run with
that directory as their working directory. No commands were run against other
projects, SSH configuration, system configuration, cloud infrastructure, or
production services.

### 2.2 Git checkpoint limitation

This directory is **not a Git worktree**. `git status`, `git rev-parse`, and
other Git discovery commands fail with `fatal: not a git repository`. There is
no `.git` directory in the workspace listing.

Consequences:

- The pre-change branch, commit, history, tracked-file set, and uncommitted
  user changes cannot be established.
- A Git checkpoint cannot be created from this checkout.
- Git-dependent checks such as tracked-artifact validation and repository-wide
  test reachability cannot produce their normal verdicts.
- The audit itself did not alter source, dependency manifests, lockfiles, or
  deployment files. A later follow-up added only the isolated Rust kernel,
  benchmark harness, optional native wrapper, and related documentation; those
  files are listed in the final handoff rather than treated as a Git checkpoint.

Before implementation begins, restore a proper Git checkout or provide the
repository metadata in this directory. The first implementation action should
then be a clean-worktree check and a conventional-commit checkpoint. Do not
assume this source snapshot is clean until that has been verified.

### 2.3 Secret handling

The audit did not print environment values, credentials, tokens, passwords,
keys, cloud payloads, or private service responses. `.env.example` contains
documentation only and no secret value. No external service or production
endpoint was accessed.

## 3. Repository inventory

### 3.1 Top-level layout

| Path                              | Role                                                                    | Language/data form                                           |
| --------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `packages/`                       | Bun workspace packages making up the framework                          | TypeScript, TSX, JavaScript, CSS, HTML                       |
| `registry/`                       | Installable blocks, components, examples, manifests, and catalog source | HTML, CSS, JavaScript, JSON, Markdown                        |
| `skills/`                         | Published AI-agent router, workflows, and domain skills                 | Markdown, MJS, TypeScript, Python, shell, bundled media      |
| `.agents/`, `.claude/`            | Repository-native mirrored agent skills                                 | Markdown and skill assets                                    |
| `docs/`                           | Mintlify documentation, references, schemas, and snippets               | MDX, Markdown, JSX/TSX, JSON, CSS                            |
| `examples/`                       | AWS Lambda, GCP Cloud Run, Kubernetes and reference projects            | TypeScript, shell, YAML, Dockerfile, Terraform/HCL, Markdown |
| `scripts/`                        | Build, catalog, release, schema, CI, skill, and test tooling            | TypeScript, MJS, shell                                       |
| `themes/`                         | Theme token packs and their contract                                    | JSON, Markdown                                               |
| `plans/`, `releases/`, `updates/` | Design, release, and project update material                            | Markdown and assets                                          |
| `.github/`                        | CI, release, CodeQL, issue, and deployment automation                   | YAML, shell, JavaScript                                      |
| Root manifests                    | Workspace, lockfile, formatter/linter, hooks, and policy                | JSON, YAML, JavaScript, Markdown                             |

The root lockfile is `bun.lock`. The repository explicitly instructs
contributors to use Bun for workspace operations and not to create a
`pnpm-lock.yaml`.

### 3.2 Languages and source forms

The repository is overwhelmingly JavaScript-family code:

- **TypeScript (`.ts`)** — package implementations, scripts, schemas,
  protocol types, tests, and build tools.
- **TSX/JSX** — the React Studio UI, SDK playground, and documentation
  snippets.
- **MJS/JS/CJS** — CLI launchers, build scripts, browser helpers, test
  harnesses, and compatibility modules.
- **HTML/CSS** — HyperFrames compositions, registry items, examples, demos,
  templates, and browser styling.
- **Markdown/MDX** — user documentation, API references, skills, plans, and
  contributor guidance.
- **Shell** — CI helpers, media/build utilities, and deployment scripts.
- **Python** — a small number of media or asset utilities.
- **YAML/JSON** — CI, Workflows, package/configuration, registry metadata,
  schemas, fixtures, and generated catalog data.
- **Terraform/HCL and Dockerfiles** — cloud infrastructure and reproducible
  rendering/test environments.

The initial Phase 1 inventory found no Rust (`.rs`), `Cargo.toml`, `Cargo.lock`,
or Rust toolchain file. The follow-up prototype now adds an isolated Rust
workspace under `rust/`; there is still no repository-level `.nvmrc`,
`.node-version`, `.bun-version`, or equivalent runtime pin.

An approximate source-form scan performed by the architecture audit, excluding
hidden directories, dependencies, build output, and caches, found roughly
3,400 TypeScript files, 560 TSX files, 430 MJS files, 75 JS files, 20 CJS
files, 1,180 HTML files, 850 Markdown files, and 600 MDX files. These counts
are inventory estimates, not a source-of-truth metric; the migration must use
the tracked Git file set once repository metadata is restored.

### 3.3 Runtime architecture

The main execution path is:

```text
HTML/CSS/media + seekable JavaScript animation
        │
        ├── CLI / Studio / SDK / Player author, edit, preview, or embed it
        │
        ├── parsers + compiler + linter inspect the composition
        │
        ├── browser runtime exposes deterministic seek-by-frame behavior
        │       └── window.__hf and window.__timelines
        │
        ├── engine launches Chrome/CDP and captures frames/media
        │       └── FFmpeg encodes/muxes and processes audio
        │
        └── producer orchestrates local or distributed rendering
                ├── plan / renderChunk / assemble
                ├── AWS Lambda adapter
                └── GCP Cloud Run adapter
```

The shared artifact is an editable HTML composition. Timing is expressed with
`data-*` attributes, timed visual elements use `class="clip"`, and seekable
animation is registered through the runtime/timeline contract. Determinism
rules prohibit render-time clocks, unseeded randomness, and render-time network
fetches.

## 4. Package and entry-point audit

### 4.1 Core authoring and validation

| Package                | Important entry points                                                                                                                 | Responsibility                                                                                                                                                          | Rust disposition                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `@hyperframes/core`    | `packages/core/src/index.ts`; `src/runtime/entry.ts`; `src/runtime/protocol.ts`; compiler, audio, variables, font, and safety subpaths | Shared types, composition contracts, HTML generation, timing compilation, browser runtime, variables, media/audio models, frame adapters, registry types, and utilities | Keep browser runtime and authoring contract in TypeScript. Consider extracting only pure protocol/math/hash kernels after fixtures exist. |
| `@hyperframes/parsers` | `src/index.ts`; GSAP parser/writer exports; composition/slideshow/asset modules                                                        | HTML metadata and timing parsing, stable IDs, asset resolution, media duration, GSAP AST analysis and source writing                                                    | Keep source-preserving JS/HTML parsing initially. A narrow Rust parser is conditional on measured bottlenecks and golden-file parity.     |
| `@hyperframes/lint`    | `src/index.ts`; `src/browser.ts`                                                                                                       | Static HyperFrames HTML/project linter for structure, media, GSAP, captions, compositions, adapters, fonts, shaders, determinism, and slideshows                        | Keep rules and diagnostics in TypeScript until parser contracts are stable.                                                               |

### 4.2 Rendering and production

| Package                           | Important entry points                                                                               | Responsibility                                                                                                                  | Rust disposition                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `@hyperframes/engine`             | `src/index.ts`; browser manager; frame capture; streaming encoder; media and alpha-blit utilities    | Chrome/Puppeteer lifecycle, CDP/BeginFrame capture, seek protocol, media extraction, audio, FFmpeg invocation, parallel capture | Keep Chrome/CDP and orchestration. Candidate for Rust pixel kernels and later process supervision.                       |
| `@hyperframes/producer`           | `src/index.ts`; `src/server.ts`; `src/distributed.ts`; `services/distributed/plan*.ts`; MP4 stitcher | Local render jobs, file serving, compile/capture/encode/audio pipeline, HTTP server, distributed plan/chunk/assemble APIs       | Keep orchestration and HTTP server. Migrate deterministic plan/artifact/media helpers behind stable TypeScript wrappers. |
| `@hyperframes/shader-transitions` | `src/index.ts` and capture/compositor modules                                                        | Browser-side WebGL shader transitions and page compositing                                                                      | Keep in TypeScript/browser JavaScript.                                                                                   |

### 4.3 Editing, playback, and inspection

| Package                      | Important entry points                                               | Responsibility                                                                                                                                         | Rust disposition                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `@hyperframes/studio-server` | `src/index.ts`; `src/createStudioApi.ts`; `src/routes/files.ts`      | Hono API for project discovery, safe file access, source/GSAP mutations, preview bundles, lint/render, media, history, thumbnails, waveforms, and jobs | Keep HTTP routes and source mutation semantics. A Rust capability layer may later enforce path/archive/resource policies. |
| `@hyperframes/studio`        | `src/main.tsx`; `src/App.tsx`; player/editor hooks and components    | React editor, iframe preview, timeline, selection chrome, properties, captions, blocks, render queue, undo/redo, WebMCP tools                          | Keep in TSX/TypeScript; it is browser/UI dominated.                                                                       |
| `@hyperframes/player`        | `src/hyperframes-player.ts`; `src/slideshow/`                        | `<hyperframes-player>` web component, sandboxed iframe loading, postMessage bridge, controls/events, media proxying, slideshow playback                | Keep in TypeScript/browser JavaScript.                                                                                    |
| `@hyperframes/sdk`           | `src/index.ts`; `src/session.ts`; memory/fs/headless/iframe adapters | Framework-neutral editing session, stable IDs, typed edits, JSON patches, undo/redo, variables, persistence, preview adapters                          | Keep public JS API and document serialization. A pure patch/model core is a possible later extraction.                    |
| `@hyperframes/inspector`     | `src/server.ts`; `src/service.ts`                                    | Local Chrome inspection service, runtime observations, source mapping, `/info`, `/inspect`, `/timeline`, and `/element-map`                            | Keep browser automation and source mapping in TypeScript.                                                                 |

### 4.4 CLI and deployment integrations

| Package                       | Important entry points                            | Responsibility                                                                                                                           | Rust disposition                                                                                                   |
| ----------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `@hyperframes/cli`            | `bin/hyperframes.mjs`; `src/cli.ts`; `src/api.ts` | User CLI for init/catalog/media/preview/render/lint/check/snapshot/timeline/keyframes/browser/cloud/auth/TTS/transcription and packaging | Keep command surface and Node integrations. A future Rust CLI is not a first-stage goal.                           |
| `@hyperframes/aws-lambda`     | `src/handler.ts`; SDK/CDK/transport modules       | Lambda distributed-render handler, S3 transport, Step Functions types, Chrome/FFmpeg resolution, SDK, cost accounting, CDK               | Keep AWS SDK/CDK/event integration; share Rust artifact/protocol crates only through a narrow wrapper if valuable. |
| `@hyperframes/gcp-cloud-run`  | `src/server.ts`; SDK/Terraform/transport modules  | Cloud Run HTTP handler, GCS/Workflows integration, distributed plan publishing, SDK, cost accounting, Terraform                          | Keep GCP SDK and infrastructure integration; share only versioned pure contracts/artifact helpers.                 |
| `@hyperframes/sdk-playground` | `src/main.ts` and Vite config                     | Private development/demo app for the SDK                                                                                                 | Keep in Vite/TypeScript.                                                                                           |

### 4.5 Non-package source

- `registry/` items are user-facing HTML/CSS/JavaScript compositions and
  should remain browser-native.
- `skills/`, `.agents/`, and `.claude/` are agent instructions and assets;
  Rust does not improve their portability or runtime.
- `docs/` is Mintlify content and documentation components; retain MDX/JSX.
- `examples/` intentionally demonstrates deployment stacks and should retain
  the relevant cloud, shell, YAML, Dockerfile, and Terraform forms.
- `scripts/` can use Rust for a measured bulk-data helper, but most scripts
  are release/catalog/CI glue and should remain Node/Bun.

## 5. Public contracts that must not change

The migration must preserve these contracts unless a separately approved
versioned breaking change is made:

1. **Composition HTML contract** — `data-start`, `data-duration`, `data-end`,
   track attributes, `class="clip"`, sub-composition attributes, variables,
   media attributes, and root dimensions.
2. **Seek protocol** — browser-side `window.__hf`, runtime readiness, finite
   duration, deterministic seek behavior, frame/rational-FPS metadata, and
   error behavior.
3. **Timeline contract** — one paused GSAP root timeline per composition on
   `window.__timelines`; manually attached scene timelines must remain
   seekable and not be incorrectly paused.
4. **Published package exports** — all `package.json` subpaths and Node/Bun/
   browser condition behavior.
5. **CLI behavior** — command names, flags, exit codes, output formats,
   project layout, and generated templates.
6. **Studio/API behavior** — route paths, JSON/multipart shapes, source
   mutation semantics, atomic writes, edit history, file-version tokens, and
   preview reload behavior.
7. **Player behavior** — custom-element attributes, events, iframe bridge,
   origin/sandbox policy, media autoplay behavior, and slideshow API.
8. **Producer HTTP API** — `POST /render`, `POST /render/stream`,
   `GET /render/queue`, `POST /lint`, `GET /health`, and artifact access under
   `/outputs/:token`, including SSE and error shapes.
9. **Distributed rendering protocol** — `plan`, `renderChunk`, `assemble`,
   Plan v1/v2 manifest shapes, content-addressed artifacts, hashes, chunk
   math, retry/idempotency behavior, and cloud handler envelopes.
10. **Media output semantics** — FFmpeg remains authoritative for encoding and
    muxing until byte-level or explicitly documented perceptual parity is
    demonstrated.
11. **Determinism** — identical inputs, runtime versions, and assets must
    produce equivalent timing and output within existing regression thresholds.

Rust functions must be treated as an implementation detail behind a stable
TypeScript façade at first. The façade owns input validation, feature flags,
fallback selection, error translation, and compatibility telemetry.

## 6. Build, dependency, and test audit

### 6.1 Declared toolchain

The repository declares Node.js `>=22` in the rendering/cloud packages and
documents Bun as the workspace package manager. The root `package.json` has 15
workspace packages under `packages/*`, and `bun.lock` is the lockfile.

The normal root build order is dependency-sensitive:

```text
parsers + lint + studio-server
        ↓
core
        ↓
engine + producer + player + studio + shader-transitions
        + aws-lambda + gcp-cloud-run + sdk + inspector
        ↓
cli
        ↓
sdk-playground
```

The documented commands are:

```bash
bun install
bun run build
bun run test
```

Before package tests or typechecks in a fresh checkout, the repository
instructions require a build because Node resolves several package exports from
`dist/`. Core also generates browser runtime artifacts that are ignored by
Git. A dependent package must be rebuilt after changing a package it imports.

### 6.2 Test and quality lanes

- Most package unit tests use Vitest.
- AWS Lambda and GCP Cloud Run use Bun's test runner.
- Producer classifies tests into Bun and Vitest lanes and has separate unit,
  integration, distributed, parity, performance, HDR, and regression harnesses.
- Studio has a large Vitest suite plus browser/e2e, edit-accuracy, timeline,
  WebMCP, and performance tests. Its package instructions explicitly warn not
  to use bare `bun test` for Studio.
- Root script tests are an explicit list in `package.json` and run through
  `bun run test:scripts`.
- Skills tests run through `bun run test:skills` with a test-home bootstrap.
- CI has an explicit reachability checker that models `.github/workflows/ci.yml`.
- Rendering/regression tests additionally require Chrome/headless shell,
  FFmpeg/FFprobe, fonts, and in some cases Docker and Git LFS.
- Linting uses `oxlint`; formatting uses `oxfmt`; the repository does not use
  ESLint, Prettier, or Biome as its primary gates.

The root `bun run test` is the package unit-test aggregation. It is not a
substitute for the full CI matrix, script tests, skill tests, browser gates,
producer integration/regression lanes, or cloud/container checks.

### 6.3 Reproducibility observations

The audit found these risks to address before a large migration:

1. Fourteen workspace package manifests report `0.8.177`, while the matching
   workspace entries inspected in `bun.lock` report `0.8.169`. This should be
   resolved and verified with a frozen install before Rust integration.
2. There is no root runtime pin for Bun or Node. Dockerfiles use different Bun
   versions, most CI jobs use Node 22, and the publish workflow uses Node 24.
3. The normal workspace manager is Bun, but release/packaging paths also invoke
   pnpm. Local and CI pnpm versions are not represented by one root pin.
4. Some Docker/CI paths use rolling browser channels or installers while
   rendering golden media depends on pixel-stable Chrome.
5. Docs, catalog, browser, dependency, and some asset workflows are network
   dependent. An offline test command is not currently established for the
   whole repository.
6. Important checks rely on Git metadata, which is absent from this snapshot.

These are audit findings, not changes made by this task. Lockfile regeneration,
runtime pinning, or package-manager policy changes should be separate,
reviewable changes rather than incidental Rust-migration edits.

## 7. Safe baseline established

### 7.1 Environment observed

The following values were observed without reading secrets or environment
payloads:

| Tool              | Result                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------- |
| Working directory | `/home/ubuntu/hyperframes-main`; path check passed                                      |
| Node              | `v22.23.3`                                                                              |
| npm               | `10.9.9`                                                                                |
| Bun               | unavailable: `bun: command not found`                                                   |
| Cargo             | unavailable in the original audit shell; the pinned prototype toolchain is now required |
| Rust compiler     | unavailable in the original audit shell; the pinned prototype toolchain is now required |
| FFmpeg            | unavailable                                                                             |
| FFprobe           | unavailable                                                                             |
| Docker            | unavailable                                                                             |
| Git worktree      | unavailable; directory is not a Git repository                                          |

No dependency tree or build output was present for this snapshot, so no
dependency installation was attempted. Installing dependencies would modify
the workspace and could not establish a trustworthy baseline without Bun.

### 7.2 Commands run and results

These read-only or self-contained checks completed successfully:

```text
node scripts/check-workspace-contracts.mjs
  Workspace contracts verified: build, typecheck, and test are explicit.

node scripts/check-package-cycles.mjs
  Passed; one explicitly allowed compatibility cycle remains.

node scripts/package-subpaths.mjs
  Passed; 14 public workspaces are synchronized.

node --test scripts/check-test-reachability.test.mjs
  Passed; 28 tests, 0 failures.

node --test scripts/ci/resolve-workflow-pr.test.mjs \
  packages/gcp-cloud-run/check-dockerfile-workspaces.test.mjs
  Passed; 11 tests, 0 failures.

node --check <selected CLI/build/CI JavaScript entry points>
  Passed; exit code 0.
```

These are focused static/configuration checks only. They do **not** establish
that the full application builds or renders.

### 7.3 Checks blocked or intentionally not run

The following were blocked in the original baseline environment:

```bash
bun install --frozen-lockfile
bun run build
bun run test
bun run --filter '*' typecheck
bun run lint
bun run format:check
cargo fmt --all -- --check
cargo check --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Reasons are respectively missing Bun, missing installed dependencies and
rendering prerequisites, missing Bun/dependencies, missing Bun/dependencies,
missing Bun/dependencies, and the absence of the Rust workspace/toolchain at
the time of the original audit. Full Chrome/FFmpeg/Docker/LFS regression tests
are also blocked by missing system tools in that baseline.

The Git-dependent commands for tracked artifacts and repository-wide test
reachability could not establish their normal verdict because `git ls-files`
cannot run outside a Git worktree. No result above should be read as a pass for
those blocked checks.

## 8. Security, reliability, and performance audit

This is a static review. Findings below identify code paths and risk; exact
exploitability and severity should be reproduced in an isolated test harness
before remediation. No external endpoint was probed.

### 8.1 High-priority findings

| ID   | Finding and evidence                                                                                                                                                                                                                                                                                    | Impact                                                                                                                                                                                                   | Recommended mitigation                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H-01 | The standalone producer server registers render/lint/output routes in `packages/producer/src/server.ts` without authentication. `projectDir`, `entryFile`, and `outputPath` flow into file operations without one consistent canonical containment policy.                                              | A reachable server may read other directories, select an entry file outside a project, create output directories, or write to unintended paths. Successful responses can expose an absolute output path. | Keep the service loopback-only by default and authenticate any non-loopback mode. Require project and output roots, canonicalize and enforce containment, reject traversal/symlink escapes, and return opaque artifact IDs rather than absolute paths. |
| H-02 | `packages/producer/src/server.ts` fetches `previewUrl` directly with `fetch` and no visible timeout, response-size cap, redirect revalidation, or private-network policy.                                                                                                                               | SSRF, hangs, and unbounded response buffering are possible for a caller able to reach the server.                                                                                                        | Reuse or strengthen the bounded URL downloader policy; enforce an allowlist, timeout/abort, maximum decoded bytes, redirect limit, and private-address checks on every hop. Disable remote preview URLs where not required.                            |
| H-03 | Browser launch paths in `packages/engine/src/services/browserManager.ts` disable Chrome sandbox flags; frame capture does not show a general outbound request policy. The Cloud Run image does not set a non-root user.                                                                                 | Untrusted composition HTML has a wider blast radius and can reach network resources; browser compromise or malicious content is more dangerous.                                                          | Run workers as non-root, retain the Chrome sandbox where supported, isolate untrusted renders, restrict egress/metadata access, and add explicit browser request interception for restricted modes.                                                    |
| H-04 | AWS/GCP transports stream archives before applying an explicit compressed/uncompressed size, file-count, path, hardlink, and symlink policy (`packages/aws-lambda/src/s3Transport.ts`, `packages/gcp-cloud-run/src/gcsTransport.ts`). Plan copying later enables symlink dereferencing in the producer. | Archive expansion, excessive file counts, traversal, or symlink copying can exhaust resources or include unintended host data. Exact `tar` behavior needs a runtime fixture.                             | Enforce byte/file/path limits before and during extraction; reject absolute/parent paths, symlinks, and hardlinks unless explicitly needed; canonicalize every destination and avoid unrestricted dereferencing.                                       |

### 8.2 Medium-priority findings

| ID   | Finding and evidence                                                                                                                                                                                                                                            | Impact                                                                                             | Recommended mitigation                                                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-01 | Producer JSON handlers call `c.req.json()` without a visible body cap; the semaphore limits active work but not queued requests; request/socket timeouts are disabled; expired artifact records do not remove output files (`packages/producer/src/server.ts`). | Memory pressure, unbounded queue growth, long-lived connections, and disk exhaustion.              | Add body limits, bounded queues with `429`, per-render deadlines/cancellation, disk admission checks, and cleanup that deletes expired artifacts.  |
| M-02 | Multipart uploads have a limit, but raw file create/overwrite paths in `packages/studio-server/src/routes/files.ts` buffer `arrayBuffer()` without the same consistent limit. The API is unauthenticated by default and LAN exposure is an explicit trust mode. | LAN-exposed Studio can be pressured with large writes or unauthorized project operations.          | Apply one body-limit middleware to every write route and use a local-session token/authentication for LAN mode.                                    |
| M-03 | Cloud handlers cast parsed input to event types at the boundary and do not visibly apply the complete shared distributed-config schema before dispatch.                                                                                                         | Malformed values can become 500/retry loops, invalid plans, or unexpected resource use.            | Validate runtime schemas at Lambda/Cloud Run boundaries, including action-specific shapes and all dimension/FPS/chunk/worker/variable limits.      |
| M-04 | AWS may skip bucket validation when its configured bucket is absent; GCP warns and continues. Even with bucket checks, object prefixes are not necessarily scoped.                                                                                              | Custom deployments can broaden storage trust and allow arbitrary object keys in an allowed bucket. | Fail closed in production, validate bucket and prefix, generate job-scoped output keys, and use write-once/conditional publication where possible. |
| M-05 | `packages/engine/src/utils/urlDownloader.ts` blocks literal private IPs and host patterns but does not visibly resolve DNS and validate every resolved address before connection.                                                                               | DNS rebinding or a hostname resolving to a private address can bypass hostname-only checks.        | Resolve A/AAAA records, reject loopback/link-local/private/multicast/metadata ranges, re-check redirects, and consider a centralized egress proxy. |
| M-06 | `packages/studio-server/src/helpers/peakMap.ts` gives `ffprobe` a timeout but the decoding FFmpeg process has no visible equivalent timeout/process tracker.                                                                                                    | Pathological media can leave CPU, file descriptors, or child processes running beyond the request. | Use the managed child-process helper, propagate cancellation, cap duration/sample output, and guarantee stderr/process cleanup.                    |

### 8.3 Existing controls to preserve

The codebase already contains useful controls that a Rust migration must not
weaken:

- Studio path-safety and no-follow tests;
- atomic file writes and file-version/write-token coordination;
- FFmpeg argument construction and child-process helpers;
- bounded proxy-transcoder concurrency;
- producer worker sizing based on CPU, memory, heap, frame count, and
  composition cost;
- streaming FFmpeg backpressure;
- internal loopback file-server behavior and range support;
- distributed plan size caps and cloud temporary-directory cleanup;
- cloud artifact/hash validation and Terraform/IAM deployment controls;
- player iframe sandbox/origin tests;
- linter/runtime determinism and security test suites.

### 8.4 Performance hotspots

The likely dominant costs are not TypeScript parsing alone:

1. Chrome process/page/compositor memory and CPU for parallel frame capture.
2. Extracting source video frames to disk for long or high-resolution media.
3. FFmpeg probing, audio processing, encoding, muxing, and MP4 assembly.
4. Repeated project signature walks and media metadata scans.
5. Large render queues and retained outputs under the current server lifecycle.
6. Cloud archive download/extraction before complete resource admission checks.
7. Pixel-buffer copies and per-pixel alpha/format conversion in frame helpers.

Rust should target items 4, 6, and 7 first only where benchmarks show that
they matter; moving Chrome or FFmpeg itself to Rust would not remove either
external engine and is unlikely to improve the dominant cost.

## 9. Rust target architecture

### 9.1 Proposed workspace shape

The proposed Rust workspace layout is now present as an isolated prototype.
Production rollout still requires restoring the Git baseline and proving
platform packaging:

```text
rust/
  Cargo.toml                 # workspace resolver and shared policy
  crates/
    hf-contracts/            # serde wire types and versioned protocol data
    hf-plan/                 # deterministic chunk/plan/manifests
    hf-artifacts/            # hashes, path capabilities, archive validation
    hf-media-kernels/        # bounded pixel/image operations
    hf-mp4/                  # narrow MP4 box parsing/stitch helpers
    hf-process/              # later supervised subprocess primitives
    hf-node/                 # optional napi-rs bindings, added after parity
  fixtures/                  # JSON/binary golden fixtures owned by tests
```

The initial Rust crates should be libraries, not a replacement CLI or server.
The public JavaScript packages remain the compatibility layer:

```text
TypeScript API → validated N-API binding (optional) → Rust implementation
              ↘ existing TypeScript implementation (parity fallback)
```

The native path must be opt-in during development, then enabled per operation
only after parity. A fallback is the complete existing implementation, not a
stub. Failures must be observable and must not silently produce partial output.

For operations that need stronger isolation or long-running cancellation,
evaluate a small Rust sidecar/local protocol after the in-process N-API kernels
are stable. Do not introduce both boundaries at once.

### 9.2 Suggested crates

Use the smallest dependency set that preserves current formats:

| Need                  | Candidate crates                                                                 | Notes                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Data contracts        | `serde`, `serde_json`, `thiserror`                                               | Preserve field names, optionality, numeric representation, and error codes.                                                       |
| Hashing               | `sha2` initially; `hex`/`base64` only as needed                                  | Existing SHA-256/content-addressed formats must remain exact. Do not change hash algorithms for speed without a protocol version. |
| Paths/files           | `camino`, `tempfile`, `walkdir`, standard `std::fs` APIs                         | Canonical containment and no-follow behavior must be explicit; consider OS-specific open flags.                                   |
| Archives              | `tar`, `flate2`, optional `zstd`/format-specific decoder                         | Enforce compressed/uncompressed byte, entry, depth, symlink, and path limits while streaming.                                     |
| Buffers/concurrency   | `bytes`, `rayon`                                                                 | Prefer bounded ownership and avoid unnecessary copies; benchmark parallelism against Chrome/FFmpeg contention.                    |
| Image/PNG kernels     | `png` or a deliberately scoped image decoder; `half` if needed                   | Match current color/depth/alpha semantics before optimizing.                                                                      |
| Binary media          | `bytes` plus a narrow explicit MP4 box parser; `nom` only if it improves clarity | Keep FFmpeg authoritative until fixture parity is complete.                                                                       |
| N-API                 | `napi`, `napi-derive`, `napi-build`                                              | Package prebuilt artifacts per supported Node ABI/platform or build locally in a documented path.                                 |
| Async/process (later) | `tokio`, `tokio-util`, `tracing`                                                 | Add only when process supervision is a committed stage; do not make pure crates async unnecessarily.                              |
| Tests                 | `proptest`, `insta` or checked-in golden files                                   | Prefer checked-in JSON/binary fixtures and property tests for path/chunk/box boundaries.                                          |

Crate versions must be pinned through `Cargo.lock` for applications and
reviewed through the repository's future Rust supply-chain policy. `cargo
deny`/`cargo audit` can be added as a later CI gate after the workspace exists.

### 9.3 Boundary rules

1. Rust APIs accept owned, validated data and return explicit result/error
   types; never expose internal Rust representation directly to JavaScript.
2. JSON and binary formats are versioned at the boundary. Unknown fields must
   follow current compatibility rules rather than being silently discarded.
3. Filesystem functions receive a capability/root object, not arbitrary paths
   from an HTTP request.
4. Archive extraction is streaming and bounded; a caller cannot disable safety
   limits through an untrusted manifest.
5. Buffer APIs document stride, pixel format, alpha convention, endianness,
   ownership, and whether mutation is in place.
6. Errors carry stable machine-readable codes and sanitized human messages;
   absolute paths, credentials, and full remote URLs are not leaked by default.
7. Native loading is optional until platform packaging and parity are proven.
8. The TypeScript implementation remains a complete rollback path during each
   stage.

## 10. Staged migration plan

Every stage is independently testable and should land as a small change. The
next stage must not begin until the prior stage has a reproducible baseline,
passing parity tests, and a documented rollback switch.

### Stage 0 — Restore the engineering baseline

**Goal:** make the repository verifiable before adding Rust.

**Prerequisites and work:**

- Restore `.git` metadata and verify the branch and working tree.
- Create a checkpoint before implementation; preserve any user changes.
- Install the declared/pinned Node and Bun toolchain without creating a pnpm
  lockfile.
- Run `bun install --frozen-lockfile` and determine whether the workspace
  lockfile is stale relative to package manifests.
- Install or provide the documented Chrome/headless shell, FFmpeg/FFprobe,
  fonts, and Docker/Git LFS where the selected tests require them.
- Record baseline build times, unit-test results, representative render
  hashes/PSNR, memory, and disk usage.

**Exit criteria:** Git state is known; the original build and relevant tests
run; failures are classified rather than hidden; baseline artifacts are
identified and not overwritten accidentally.

**Rollback:** no source change; restore the clean checkpoint.

### Stage 1 — Add a Rust workspace and contract fixtures

**Goal:** introduce Rust infrastructure with no runtime behavior change.

**Work:**

- Add `rust/Cargo.toml`, a pinned toolchain policy, and the initial
  `hf-contracts` crate.
- Add checked-in fixtures for distributed manifests, rational FPS, runtime
  protocol metadata, chunk windows, hashes, error codes, and representative
  pixel buffers.
- Add scripts/CI jobs that run Rust formatting/check/clippy/test, but keep them
  separate from the production path until they pass.
- Do not add a native dependency to published packages yet.

**Tests:** fixture deserialization/serialization, unknown-field behavior,
malformed input cases, and all required Cargo checks.

**Exit criteria:** empty or minimal Rust workspace builds reproducibly; fixtures
are derived from current behavior; no JS output changes.

### Stage 2 — Migrate pure protocol, timing, and math helpers

**Goal:** move deterministic, browser-independent calculations with the lowest
compatibility risk.

**Candidate functions:**

- rational FPS normalization and frame/time conversion;
- distributed chunk boundaries and inclusive/exclusive window rules;
- runtime protocol metadata validation;
- stable hash/encoding helpers where the existing bytes are specified;
- bounded numeric/config validation.

**Integration:** expose a narrow TypeScript façade. Start with a test-only
native call or command-line fixture runner; add `hf-node` only after the data
model is stable. Keep the existing TypeScript implementation as the default
and compare both paths on every fixture.

**Tests:** exhaustive small-range frame/time cases, property tests around zero,
one-frame, duration boundaries and rational reductions, JSON golden tests, and
original core/producer tests.

**Exit criteria:** exact contract parity, stable error codes, no timing drift,
and benchmark evidence that the boundary overhead does not erase the benefit.

### Stage 3 — Migrate distributed plan and manifest construction

**Goal:** move deterministic Plan v1/v2 construction and validation while
leaving Chrome capture, FFmpeg, HTTP handling, and cloud SDKs in TypeScript.

**Candidate areas:**

- `packages/producer/src/services/distributed/plan.ts` and related Plan v2
  manifest/artifact modules;
- content-addressed artifact inventory and digest verification;
- render chunk assignment, dimensions/FPS/worker limits, and assemble metadata;
- deterministic ordering and canonical serialization.

**Integration:** TypeScript validates the request and calls a Rust library or
test harness. Cloud adapters continue to consume the same JSON manifests.
Version the boundary only if an existing field cannot be represented exactly.

**Tests:** current producer plan/parity fixtures, AWS/GCP handler tests,
snapshot tests, randomized chunk partitions, large/small manifest cases,
retries/idempotency, and cross-language JSON round trips.

**Exit criteria:** Plan v1/v2 wire output is identical for the fixture corpus;
all original distributed tests pass; the native path can be disabled with one
feature flag; no cloud deployment changes are required.

### Stage 4 — Add a capability-based filesystem and archive layer

**Goal:** improve safety and bounded resource handling at artifact boundaries,
without moving the HTTP server or cloud SDKs.

**Candidate areas:**

- canonical project-root and output-root enforcement;
- no-follow/symlink-safe file reads and atomic publication;
- streaming archive extraction with compressed/uncompressed byte, entry,
  depth, file-size, path, hardlink, and symlink policies;
- project signatures and content-addressed materialization;
- cleanup and disk-admission bookkeeping.

**Integration:** expose operations through a narrow local API and make current
server/cloud routes call it only after parity tests. Do not allow arbitrary
request paths to reach a generic Rust filesystem function.

**Tests:** traversal and symlink fixtures, absolute/parent paths, Unicode and
long paths, duplicate entries, sparse/large files, archive bombs, interrupted
extraction, atomic write races, cleanup failures, and Windows/Linux path
semantics where CI supports them.

**Exit criteria:** security tests prove containment and limits; errors are
sanitized; successful files and manifests match current behavior; resource
limits are visible in configuration and cannot be bypassed by input.

### Stage 5 — Migrate measured pixel and image kernels

**Goal:** improve CPU-heavy buffer operations without changing browser or
encoding semantics.

**Candidate areas:**

- `packages/engine/src/utils/alphaBlit.ts`;
- PNG decode/defiltering or selected image transforms;
- RGB/RGB48/alpha conversions;
- PSNR and frame comparison helpers;
- other verified tight loops identified by profiling.

**Integration:** pass typed buffers with explicit dimensions, stride, format,
and alpha convention. Prefer one allocation and in-place operations where the
current contract permits it. Do not move GPU/WebGL/WebGPU rendering.

**Tests:** byte equality for deterministic integer operations, PSNR threshold
parity for floating-point operations, transparent/opaque/odd-size frames,
stride and channel-order cases, malformed buffers, fuzz/property tests, and
producer regression fixtures.

**Exit criteria:** no visual regression, no memory-safety or ownership issue,
and a benchmark demonstrates a meaningful improvement on the real frame sizes
that dominate production. Otherwise retain the TypeScript path.

### Stage 6 — Evaluate MP4 parsing and chunk stitching

**Goal:** reduce repeated binary parsing/copying in distributed assembly while
keeping FFmpeg as the authoritative encoder/muxer.

**Candidate areas:**

- narrow ISO-BMFF/MP4 box inspection;
- range validation and chunk ordering;
- content-length/duration metadata;
- deterministic concatenation/stitch bookkeeping in
  `packages/producer/src/services/distributed/mp4Stitch.ts`.

**Integration:** Rust must reject malformed/ambiguous boxes conservatively and
return a stable error. It must not attempt to reinterpret every codec or
replace FFmpeg.

**Tests:** existing stitch fixtures, box size/version/64-bit boundaries,
truncated/malformed files, non-zero offsets, empty/single/multiple chunks,
random ordering, and byte-for-byte output comparison.

**Exit criteria:** exact output parity and a measured I/O/CPU benefit. If
codec/container coverage becomes broader than the current use case, stop and
keep FFmpeg/TypeScript authoritative.

### Stage 7 — Introduce bounded process supervision only if needed

**Goal:** improve cancellation, deadlines, and resource accounting for external
media processes after the pure layers are stable.

**Candidate areas:** FFmpeg/FFprobe command supervision, timeout propagation,
stdout/stderr caps, exit-code mapping, cancellation, and process cleanup.

**Integration options:** first expose a small Rust local process helper behind
the existing TypeScript process interface; use a sidecar only if N-API cannot
provide the required lifecycle isolation. Keep command construction and
security policy in the caller until parity is established.

**Tests:** success, non-zero exit, signal termination, timeout, cancellation,
huge stderr, missing binary, Windows process cleanup, concurrent jobs, and
producer/Studio request cancellation.

**Exit criteria:** no orphan processes, deterministic error translation, no
changed FFmpeg arguments, and measurable reduction in leaked work or timeout
cost. Otherwise do not introduce a second process runtime.

### Stage 8 — Measure before considering parser/SDK extraction

**Goal:** evaluate higher-risk HTML/JavaScript migration only with evidence.

**Candidates:** narrow HTML metadata extraction, stable ID scanning, or pure
timing analysis. Do **not** start with the GSAP writer or full source parser.

**Why this is late:** HyperFrames depends on malformed-HTML tolerance,
source spans, Recast/Acorn formatting, stable IDs, browser-compatible DOM
behavior, and source-preserving Studio mutations. A new parser that accepts
the same syntax can still corrupt user-authored source.

**Tests required before any replacement:** a large golden corpus of registry,
template, Studio, and user fixture files; exact source-span and stable-ID
comparisons; mutation/formatting snapshots; malformed-input behavior; and
browser/runtime parity.

**Exit criteria:** demonstrated bottleneck, complete corpus parity, and a
narrow opt-in path. If any condition is absent, keep the existing parser.

### Stage 9 — Packaging, rollout, and retirement

**Goal:** make the selected Rust implementation portable and maintainable.

**Work:**

- package prebuilt N-API artifacts for every supported OS/CPU/Node ABI, or
  document a reliable local build path;
- add a source-build fallback for development and CI;
- pin Rust/Node/Bun versions and keep Cargo/Bun lockfiles synchronized;
- publish native packages only when platform failure modes are documented;
- run original JS tests plus Rust tests in required CI lanes;
- collect parity, fallback, performance, and error metrics;
- remove a TypeScript path only after a full release cycle with no regression.

**Exit criteria:** clean install, package exports, CLI, Studio, player,
distributed adapters, render regressions, browser tests, and supported cloud
packaging all pass with the native path enabled and disabled.

## 11. Validation and parity strategy

### 11.1 Required Rust checks per stage

The Rust workspace now exists under `rust/`; every Rust change must run:

```bash
cargo fmt --manifest-path rust/Cargo.toml --all -- --check
cargo check --manifest-path rust/Cargo.toml --workspace --locked
cargo clippy --manifest-path rust/Cargo.toml --workspace --all-targets --locked -- -D warnings
cargo test --manifest-path rust/Cargo.toml --workspace --locked
```

The original Phase 1 baseline could not run these commands because the Rust
workspace and toolchain were not present at that time. The current prototype
has a pinned toolchain and a separate CI job for these checks.

### 11.2 JavaScript and rendering checks

The original checks remain mandatory throughout migration:

```bash
bun run build
bun run --filter '*' typecheck
bun run lint
bun run format:check
bun run test
bun run test:scripts
bun run test:skills
```

Run focused package tests after each changed package, rebuilding dependency
packages first as required by `AGENTS.md`. Keep producer unit/integration,
parity, distributed, and regression lanes; keep Studio/browser/player and
cloud tests for affected surfaces. Composition changes additionally require
the HyperFrames lint and browser check gates.

### 11.3 Fixture and differential testing

For every migrated function, maintain:

- an input fixture and expected output/error fixture;
- a differential test that invokes TypeScript and Rust on the same input;
- property tests for boundaries and malformed values;
- an explicit compatibility test for serialization field order/number form
  where the format depends on it;
- a rollback test proving the TypeScript path remains complete;
- sanitized error-message tests;
- a benchmark on representative production sizes.

Use byte equality when the existing behavior is byte-defined. Use the current
PSNR/perceptual threshold only where rendering or floating-point behavior
makes bytes inappropriate. Never relax a regression threshold merely to make a
Rust port pass.

### 11.4 Performance evidence

Record before/after values for the same input and toolchain:

- plan construction latency and peak memory;
- manifest/hash throughput;
- archive extraction throughput and peak disk usage;
- pixel-kernel frames/second and allocations;
- MP4 stitch latency and bytes copied;
- render wall time, Chrome worker count, FFmpeg CPU, RSS, and disk I/O;
- fallback rate, native-load failures, and error/retry counts.

Do not claim a performance improvement without a repeatable workload, warm-up
policy, sample count, variance, and an explanation of whether the bottleneck
moved to the N-API or sidecar boundary.

## 12. Migration risks and mitigations

| Risk                | Why it matters                                                                                          | Mitigation                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Native packaging    | A Rust library can work on one Linux host but fail on macOS, Windows, ARM64, or the supported Node ABI. | Delay native package publication; build a platform matrix in CI; retain source/TS fallback; document compiler prerequisites. |
| Contract drift      | JSON number formatting, optional fields, hashes, errors, and ordering can change distributed behavior.  | Golden fixtures, differential tests, versioned schemas, and no silent fallback on partial output.                            |
| Rendering parity    | Pixel/color/alpha differences can change golden MP4 results.                                            | Byte/PSNR fixtures, pinned Chrome/FFmpeg, transparent-frame cases, and no threshold relaxation.                              |
| Browser semantics   | Rust cannot reproduce DOM, GSAP, fonts, media events, or postMessage behavior.                          | Keep browser runtime/UI/player/Studio in TypeScript and treat Rust as a data/kernel layer.                                   |
| ABI/boundary cost   | Copying buffers or serializing JSON may erase a kernel speedup.                                         | Benchmark buffer ownership and use N-API only after measuring; avoid crossing the boundary for tiny operations.              |
| Security regression | A faster path can accidentally remove path, archive, or origin controls.                                | Capability-based APIs, fail-closed defaults, adversarial fixtures, and security review for each boundary.                    |
| Toolchain drift     | Bun/Node/Chrome/FFmpeg/Rust differences make failures non-reproducible.                                 | Pin toolchains, keep both lockfiles, checksum external binaries, and align Docker/CI versions.                               |
| Incomplete rollback | Removing the TS path too early can block users when native loading fails.                               | Feature flag, complete TS implementation, explicit telemetry, and one-release deprecation window before removal.             |
| Scope expansion     | Rewriting the CLI, Studio, or all parsers can consume the project without improving render time.        | Require a measured bottleneck and stage exit criteria before approving each new target.                                      |

## 13. Components that should remain legacy-language code

The following are deliberate non-migration decisions, not missed work:

- **Browser runtime and composition execution:** requires DOM, media elements,
  fonts, GSAP, CSS, WebGL/WebGPU, and `postMessage` semantics.
- **Chrome/Puppeteer/CDP capture:** depends on browser lifecycle, BeginFrame,
  page readiness, GPU flags, and existing Puppeteer APIs.
- **Studio:** React, CodeMirror, iframe overlays, DOM geometry, Zustand,
  WebMCP, and browser events dominate its behavior.
- **Player:** Web Components, Shadow DOM, iframe security, autoplay policy,
  and media events are browser-native.
- **Shader transitions and registry compositions:** execute in WebGL,
  WebGPU, Three.js, or authored browser JavaScript.
- **GSAP parser/writer and source-preserving mutations:** formatting, source
  spans, AST tolerance, and user-authored code preservation are compatibility
  contracts; they are not safe early optimization targets.
- **CLI orchestration:** depends on Node package ecosystem tools, Puppeteer,
  Sharp, ONNX Runtime, cloud SDKs, templates, prompts, and filesystem UX.
- **AWS/GCP adapters and IaC:** cloud SDKs, event envelopes, CDK/Terraform,
  and provider semantics are already expressed in their native ecosystems.
- **Docs, skills, Markdown/MDX, and deployment scripts:** Rust adds no
  meaningful runtime benefit.
- **FFmpeg itself:** it is already a native, optimized media engine; a Rust
  wrapper can improve supervision but does not replace the codec implementation.

## 14. Recommended next actions after this audit

1. Restore Git metadata and verify the working tree before more implementation.
2. Install/pin the existing Bun/Node/Rust toolchains and resolve the manifest/lockfile
   version mismatch in a separate, reviewable change.
3. Establish the original build/test/render baseline with the required
   Chrome/FFmpeg/Docker/LFS prerequisites.
4. Address or explicitly accept the producer-server path, SSRF, body/queue,
   archive, and sandbox risks before exposing a new native boundary.
5. Keep the current alpha-blit boundary opt-in while adding CI, package/build
   verification, stable native status/error reporting, and cross-runtime parity.
6. Select the next measured pure kernel only after end-to-end profiling shows
   that the N-API boundary does not erase its benefit.
7. After every stage, report changed files, migrated behavior, actual checks,
   remaining legacy code, known issues, and the next stage as required by
   TASK.md.

## 15. Audit completion statement

Phase 1 (inspection and baseline) and Phase 2 (Rust migration planning) are
complete to the extent possible in this source snapshot. The working directory
was confirmed, safety boundaries were respected, the repository architecture,
languages, packages, entry points, contracts, tests, build system, security
risks, technical debt, and performance hotspots were inspected, and the safe
static baseline was recorded above.

During the follow-up implementation, Stage 1/5 was started as a deliberately
narrow prototype: `hf-media-kernels` implements the HDR RGBA8-over-RGB48LE
kernel, `hf-node` exposes it through an opt-in N-API boundary, and the
TypeScript compositor keeps a complete fallback. The boundary now caches LUTs,
reports native-versus-fallback status, exposes stable native error prefixes,
and has CI, differential, and 1,000-repeat stress checks. Rust
format/check/clippy/test checks, native parity, and reproducible 1080p/4K
benchmarks passed; see `RUST_BENCHMARKS.md`. Platform packaging, full
HyperFrames build/test coverage, and production-default native enablement
remain outstanding.

The checkout still lacks Git metadata and the original Bun/Chrome/FFmpeg/Docker
toolchain. The next production stage must begin from a verified Git checkpoint,
preserve the native opt-in flag, and expand only after platform packaging and
full renderer parity are established.
