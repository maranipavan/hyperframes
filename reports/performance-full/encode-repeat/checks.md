# Executed checks

## Script self-test

```bash
python3 scripts/perf/gta6-encode-repeat.py self-test
```

Exit 0:

```text
PASS: hash parsing/count/size/timing guards, frame indexing, output scope, ffprobe --, no encoder-thread/bitexact override, ordered hash aggregation
```

## Syntax and Python indentation lint

```bash
python3 -B -c 'import ast, pathlib; p = pathlib.Path("scripts/perf/gta6-encode-repeat.py"); compile(ast.parse(p.read_text(), filename=str(p)), str(p), "exec"); print("PASS: Python syntax/AST compile (no bytecode written)")' && python3 -m tabnanny scripts/perf/gta6-encode-repeat.py
```

Exit 0; syntax PASS and no tabnanny findings. No bytecode artifacts were written.
Tabnanny is the stdlib indentation checker, not a general Python static analyzer.
No dependencies were installed.

## End-to-end run

```bash
python3 scripts/perf/gta6-encode-repeat.py run
```

Exit 0. Both encodes complete, matching decoded hashes/60-frame counts, matching
file hashes and matching original x264 SEI settings. Twelve child commands all
exited 0. Results and exact argv are in `run-1/summary.json` and
`run-1/commands.jsonl`.

## Portable cwd and existing-output refusal

From working directory `reports/performance-full`:

```bash
python3 ../../scripts/perf/gta6-encode-repeat.py run
```

Expected exit 2:

```text
ERROR: Refusing existing output: reports/performance-full/encode-repeat/run-1
```

## Independent integrity and safety assertions

The following exact command was executed from the workspace root. It performs
no FFmpeg work or writes. Exit 0; stdout follows the command.

```bash
python3 -B -c '
import hashlib, json, pathlib, subprocess, sys
root = pathlib.Path.cwd()
out = root / "reports/performance-full/encode-repeat/run-1"
def digest(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()
def snapshot():
    return {str(p.relative_to(out)): (digest(p), p.stat().st_mtime_ns, p.stat().st_mode) for p in out.rglob("*") if p.is_file()}
summary = json.loads((out / "summary.json").read_text())
fixed = json.loads((out / "fixed-input.json").read_text())
commands = [json.loads(line) for line in (out / "commands.jsonl").read_text().splitlines()]
assert digest(root / fixed["path"]) == fixed["sha256"]
assert (root / fixed["path"]).stat().st_size == 60 * 1920 * 1080 * 3 // 2
assert not (root / fixed["path"]).stat().st_mode & 0o222
encodes = [c for c in commands if c["name"].startswith("encode-")]
assert len(encodes) == 2 and encodes[0]["argv"][:-1] == encodes[1]["argv"][:-1]
assert sum(c["argv"][0].endswith("/ffmpeg") and "reports/performance-full/workers/w1-1.mp4" in c["argv"] for c in commands) == 1
assert all(c["argv"][-2] == "--" for c in commands if c["name"].endswith("-probe"))
for repeat in summary["repeats"]:
    assert digest(root / repeat["path"]) == repeat["fileSha256"]
    assert len(repeat["frameSha256"]) == repeat["frameCount"] == 60
    assert hashlib.sha256("".join(repeat["frameSha256"]).encode("ascii")).hexdigest() == repeat["frameHashSequenceSha256"]
assert summary["repeats"][0]["frameSha256"] == summary["repeats"][1]["frameSha256"]
assert summary["retainedWindowComparison"]["differentFrameIndicesZeroBased"] == list(range(845, 900))
originals = json.loads((out / "preserved-before.json").read_text())
assert originals == json.loads((out / "preserved-after.json").read_text())
assert all(digest(root / name) == value for name, value in originals.items())
assert digest(root / "scripts/perf/gta6-encode-repeat.py") == json.loads((out / "environment.json").read_text())["scriptSha256"]
before = snapshot()
cases = [
    (root, ["scripts/perf/gta6-encode-repeat.py", "run"], "Refusing existing output"),
    (root / "reports/performance-full", ["../../scripts/perf/gta6-encode-repeat.py", "run"], "Refusing existing output"),
    (root, ["scripts/perf/gta6-encode-repeat.py", "run", "--out", "reports/performance-full/encode-repeat/run-1/summary.json"], "Refusing existing output"),
    (root, ["scripts/perf/gta6-encode-repeat.py", "run", "--out", "reports/performance-full/workers"], "Output must be within"),
    (root, ["scripts/perf/gta6-encode-repeat.py", "run", "--out", "reports/performance-full/encode-repeat/../escape"], "without"),
]
for cwd, argv, message in cases:
    result = subprocess.run([sys.executable, *argv], cwd=cwd, capture_output=True, text=True, timeout=5)
    assert result.returncode == 2 and message in result.stderr, (argv, result)
assert snapshot() == before
print("PASS: frozen input, exactly one source decode/two equivalent encodes, ffprobe --, hashes/counts, original-file preservation, five refusal/portable-cwd checks, evidence unchanged")
'
```

```text
PASS: frozen input, exactly one source decode/two equivalent encodes, ffprobe --, hashes/counts, original-file preservation, five refusal/portable-cwd checks, evidence unchanged
```

The snapshot compares run-artifact SHA256s, modification times and modes before
and after all five refusal cases. Original files are checked against their
pre-diagnostic digests again. This verifies that refusing an output does not
rewrite prior evidence, including when called from a different cwd.
