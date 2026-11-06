#!/usr/bin/env python3
"""Bounded, stdlib-only GTA6 encode repeatability diagnostic (no browser).

Run from any cwd: python3 <workspace>/scripts/perf/gta6-encode-repeat.py run
All paths/recorded commands are workspace-relative. Existing output is refused.
Frames are zero-based; only 840..899 are replayed, exactly twice. The retained
w1-1 video is decoded ONCE; both encodes read the same read-only raw YUV file.
"""

import argparse
import hashlib
import json
import math
import mmap
import os
from pathlib import Path
import platform
import re
import resource
import shlex
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = Path("reports/performance-full/encode-repeat")
VIDEOS = [Path(f"reports/performance-full/workers/w1-{n}.mp4") for n in (1, 2)]
FFMPEG = ".tools/ffmpeg/ffmpeg"
FFPROBE = ".tools/ffmpeg/ffprobe"
START, STOP, FPS = 840, 900, 30
COUNT = STOP - START
WIDTH, HEIGHT = 1920, 1080
FRAME_BYTES = WIDTH * HEIGHT * 3 // 2
BUDGET = 110  # Aggregate CPU and wall budgets, not throughput measurements.
FILTER = f"trim=start_frame={START}:end_frame={STOP},setpts=PTS-STARTPTS"
X264 = "aq-mode=3:colorprim=bt709:transfer=bt709:colormatrix=bt709"
SOURCE_FILES = [
    "packages/engine/src/services/chunkEncoder.ts",
    "packages/engine/src/services/streamingEncoder.ts",
    "packages/engine/src/utils/sdrCaptureColor.ts",
    "packages/engine/src/utils/renderProvenance.ts",
    "packages/producer/src/services/renderOrchestrator.ts",
]
PRESERVE = [
    *VIDEOS,
    *(p.with_suffix(ext) for p in VIDEOS for ext in (".log", ".json")),
    *map(Path, SOURCE_FILES),
    Path("gta6_countdown_10min.html"),
    Path("reports/performance-full/workers-input/baseline/index.html"),
    Path("reports/performance-full/verification.json"),
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path, value):
    with path.open("x", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2)
        handle.write("\n")


def output_path(value):
    relative = Path(value)
    require(not relative.is_absolute() and ".." not in relative.parts,
            "Output must be workspace-relative without '..'")
    require(relative == EVIDENCE or EVIDENCE in relative.parents,
            f"Output must be within {EVIDENCE}")
    result = ROOT / relative
    require(result.resolve() == result, "Symlinked output paths are refused")
    require(not result.exists(), f"Refusing existing output: {relative}")
    return result


def probe_args(path):
    # ffprobe treats bare filenames differently from ffmpeg: keep this separator.
    return [FFPROBE, "-v", "error", "-show_streams", "-show_format",
            "-of", "json", "--", str(path)]


def x264_info(path):
    """Read libx264's ASCII unregistered SEI without decoding any frames."""
    with path.open("rb") as handle, mmap.mmap(
            handle.fileno(), 0, access=mmap.ACCESS_READ) as data:
        match = re.search(rb"x264 - core [\x20-\x7e]+", data)
        require(match is not None, f"No x264 SEI found in {path.name}")
        text = match[0].decode("ascii")
    require("options: " in text, "Missing x264 options")
    version, options = text.split("options: ", 1)
    return {"text": text, "version": version.strip(),
            "options": dict(token.split("=", 1) for token in options.split()
                            if "=" in token)}


def framehash_rows(text, expected=COUNT):
    require("#hash: SHA256" in text and "#tb 0: 1/30" in text,
            "Expected SHA256 raw-frame hashes with a 1/30 time base")
    rows = []
    for line in text.splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        fields = [field.strip() for field in line.split(",")]
        require(len(fields) == 6 and re.fullmatch(r"[a-f0-9]{64}", fields[5]),
                f"Invalid framehash row: {line}")
        stream, dts, pts, duration, size = map(int, fields[:5])
        require((stream, dts, pts, duration, size) ==
                (0, len(rows), len(rows), 1, FRAME_BYTES),
                f"Unexpected frame size/timing: {line}")
        rows.append(fields[5])
    require(len(rows) == expected, f"Expected {expected} frames, got {len(rows)}")
    return rows


def hash_sequence(hashes):
    # Canonical aggregate of decoded per-frame SHA256s, NOT an MP4 file hash.
    return hashlib.sha256("".join(hashes).encode("ascii")).hexdigest()


def compare_frames(left, right, start=0):
    require(len(left) == len(right), "Cannot compare unequal frame counts")
    differences = [start + i for i, pair in enumerate(zip(left, right))
                   if pair[0] != pair[1]]
    return {"frameCount": len(left), "decodedFramesIdentical": not differences,
            "differentFrameIndicesZeroBased": differences}


def raw_identity(path):
    require(path.stat().st_size == FRAME_BYTES * COUNT, "Wrong fixed-input size")
    full = hashlib.sha256()
    frames = []
    with path.open("rb") as handle:
        for _ in range(COUNT):
            frame = handle.read(FRAME_BYTES)
            require(len(frame) == FRAME_BYTES, "Truncated fixed input")
            full.update(frame)
            frames.append(hashlib.sha256(frame).hexdigest())
        require(not handle.read(1), "Unexpected extra input data")
    return {"sha256": full.hexdigest(), "bytes": FRAME_BYTES * COUNT,
            "frameCount": COUNT, "frameSha256": frames,
            "frameHashSequenceSha256": hash_sequence(frames)}


def cpu_seconds():
    usages = [resource.getrusage(kind) for kind in
              (resource.RUSAGE_SELF, resource.RUSAGE_CHILDREN)]
    return sum(usage.ru_utime + usage.ru_stime for usage in usages)


class Runner:
    def __init__(self, output):
        self.output = output
        self.started = time.monotonic()
        self.cpu_started = cpu_seconds()

    def run(self, name, argv):
        wall_remaining = BUDGET - (time.monotonic() - self.started)
        cpu_remaining = BUDGET - (cpu_seconds() - self.cpu_started)
        require(min(wall_remaining, cpu_remaining) > 1, "Diagnostic budget exhausted")
        cpu_limit = max(1, math.floor(cpu_remaining))

        def limit_cpu():
            resource.setrlimit(resource.RLIMIT_CPU, (cpu_limit, cpu_limit))

        started, cpu = time.monotonic(), cpu_seconds()
        record = {"name": name, "cwd": ".", "argv": argv,
                  "command": shlex.join(argv), "timeoutSeconds": min(35, wall_remaining),
                  "cpuLimitSeconds": cpu_limit}
        with (self.output / f"{name}.stdout").open("xb") as stdout, (
                self.output / f"{name}.stderr").open("xb") as stderr:
            try:
                result = subprocess.run(
                    argv, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=stdout,
                    stderr=stderr, timeout=record["timeoutSeconds"], check=False,
                    preexec_fn=limit_cpu,
                )
                record["exitCode"] = result.returncode
            except subprocess.TimeoutExpired:
                record["timedOut"] = True
                raise
            finally:
                record["wallSeconds"] = time.monotonic() - started
                record["cpuSeconds"] = cpu_seconds() - cpu
                with (self.output / "commands.jsonl").open("a", encoding="utf-8") as log:
                    log.write(json.dumps(record) + "\n")
        require(result.returncode == 0, f"{name} failed; see {name}.stderr")
        return (self.output / f"{name}.stdout").read_text()


def video_stream(probe):
    videos = [stream for stream in probe["streams"] if stream["codec_type"] == "video"]
    require(len(videos) == 1, "Expected one video stream")
    return videos[0]


def check_stream(stream, count):
    expected = {"codec_name": "h264", "width": WIDTH, "height": HEIGHT,
                "pix_fmt": "yuv420p", "avg_frame_rate": "30/1",
                "r_frame_rate": "30/1", "nb_frames": str(count),
                "start_time": "0.000000", "has_b_frames": 0,
                "color_range": "tv", "color_space": "bt709",
                "color_transfer": "bt709", "color_primaries": "bt709"}
    for key, value in expected.items():
        require(stream.get(key) == value, f"Unexpected {key}: {stream.get(key)}")


def encode_args(raw, output):
    # No encoder thread, bitexact, tune, GOP or CPU-feature overrides: these
    # would change the repeatability question. Raw input is already BT.709 YUV;
    # applying the production BT.601 JPEG -> BT.709 conversion again is wrong.
    return [FFMPEG, "-hide_banner", "-nostdin", "-n", "-f", "rawvideo",
            "-pixel_format", "yuv420p", "-video_size", f"{WIDTH}x{HEIGHT}",
            "-framerate", str(FPS), "-i", str(raw), "-map", "0:v:0", "-an",
            "-frames:v", str(COUNT), "-r", str(FPS), "-c:v", "libx264",
            "-preset", "ultrafast", "-crf", "28", "-bf", "0",
            "-x264-params", X264, "-colorspace:v", "bt709",
            "-color_primaries:v", "bt709", "-color_trc:v", "bt709",
            "-color_range", "tv", "-vf", "setsar=1",
            "-video_track_timescale", "90000", "-pix_fmt", "yuv420p",
            "-avoid_negative_ts", "make_zero", str(output)]


def decode_hash_args(path, window=False):
    args = [FFMPEG, "-hide_banner", "-v", "error", "-nostdin", "-threads", "2",
            "-i", str(path), "-map", "0:v:0", "-an"]
    if window:
        args += ["-vf", FILTER]
    # Do not cap output decoding: an extra encoded frame must fail the count check.
    return args + ["-fps_mode", "passthrough", "-c:v", "rawvideo", "-threads", "1",
                   "-pix_fmt", "yuv420p", "-f", "framehash", "-hash", "sha256", "-"]


def self_test():
    a, b = "a" * 64, "b" * 64
    sample = f"#hash: SHA256\n#tb 0: 1/30\n0, 0, 0, 1, {FRAME_BYTES}, {a}\n"
    require(framehash_rows(sample, 1) == [a], "Framehash parser")
    require(compare_frames([a, a], [a, b], START)["differentFrameIndicesZeroBased"]
            == [841], "Difference indexing")
    require(compare_frames([a], [a])["decodedFramesIdentical"], "Equal frames")
    for malformed in (sample.replace(a, "invalid"), sample.replace("0, 0, 0", "0, 0, 1"),
                      sample.replace(str(FRAME_BYTES), "1"), sample + sample.splitlines()[-1]):
        try:
            framehash_rows(malformed, 1)
        except ValueError:
            pass
        else:
            raise ValueError("Malformed framehash accepted")
    for invalid in ("/tmp/escape", "reports/performance-full/workers",
                    str(EVIDENCE / "../escape")):
        try:
            output_path(invalid)
        except ValueError:
            pass
        else:
            raise ValueError("Unsafe output accepted")
    probe = probe_args(VIDEOS[0])
    require(probe[-2] == "--", "ffprobe input separator")
    args = encode_args("fixed.yuv", "repeat.mp4")
    require("-n" in args and "-y" not in args and "-threads" not in args
            and "-bitexact" not in args, "Encode isolation flags")
    require(hash_sequence([a, b]) != hash_sequence([b, a]), "Hash must preserve order")
    print("PASS: hash parsing/count/size/timing guards, frame indexing, output scope, "
          "ffprobe --, no encoder-thread/bitexact override, ordered hash aggregation")


def diagnose(output):
    runner = Runner(output)
    before = {str(path): sha256(ROOT / path) for path in PRESERVE}
    write_json(output / "preserved-before.json", before)
    tool_info = {}
    for tool in (FFMPEG, FFPROBE):
        tool_info[tool] = {"sha256": sha256(ROOT / tool),
                           "version": runner.run(Path(tool).name + "-version", [tool, "-version"])}
    write_json(output / "environment.json", {
        "python": platform.python_version(), "platform": platform.system(),
        "machine": platform.machine(), "logicalCpuCount": os.cpu_count(),
        "cpuAffinity": sorted(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else None,
        "tools": tool_info, "scriptSha256": sha256(Path(__file__)),
    })
    snippets = {}
    relevant = re.compile(r"draft:|aq-mode|colorprim|video_track_timescale|"
                          r"avoid_negative_ts|args.push\(\"-bf\"|streaming-encode gate|"
                          r"capture_strategy|Pipeline started|SDR_.*FILTER|streamingEncoderOptions")
    for path in [*map(Path, SOURCE_FILES), *(p.with_suffix(".log") for p in VIDEOS)]:
        snippets[str(path)] = [f"{i}: {line}" for i, line in enumerate(
            (ROOT / path).read_text().splitlines(), 1) if relevant.search(line)]
    write_json(output / "settings-evidence.json", snippets)
    retained = []
    for path in VIDEOS:
        probe = json.loads(runner.run(path.stem + "-probe", probe_args(path)))
        check_stream(video_stream(probe), STOP)
        sei = x264_info(ROOT / path)
        require(sei["options"].get("crf") == "28.0" and sei["options"].get("bframes") == "0"
                and sei["options"].get("aq", "").startswith("3:"),
                "Retained x264 SEI does not match expected draft settings")
        retained.append({"path": str(path), "fileSha256": before[str(path)],
                         "probe": probe, "x264": sei})
    write_json(output / "retained.json", retained)

    relative = output.relative_to(ROOT)
    raw = relative / "fixed-840-899.yuv"
    # Exact decoded-frame trim rather than timestamp/keyframe seeking. This is
    # the only decode of w1-1, including the preceding reference frames.
    runner.run("extract-once", [
        FFMPEG, "-hide_banner", "-nostdin", "-n", "-threads", "2", "-i", str(VIDEOS[0]),
        "-map", "0:v:0", "-an", "-vf", FILTER, "-frames:v", str(COUNT),
        "-fps_mode", "passthrough", "-c:v", "rawvideo", "-threads", "1",
        "-pix_fmt", "yuv420p", "-f", "rawvideo", str(raw),
    ])
    (ROOT / raw).chmod(0o444)
    fixed = raw_identity(ROOT / raw)
    write_json(output / "fixed-input.json", {"path": str(raw), "pixelFormat": "yuv420p",
               "width": WIDTH, "height": HEIGHT, "fps": FPS,
               "sourceFramesZeroBasedInclusive": [START, STOP - 1], **fixed})

    repeats = []
    checkpoints = []
    for number in (1, 2):
        require(sha256(ROOT / raw) == fixed["sha256"], "Fixed input changed before encode")
        encoded = relative / f"repeat-{number}.mp4"
        runner.run(f"encode-{number}", encode_args(raw, encoded))
        after_hash = sha256(ROOT / raw)
        require(after_hash == fixed["sha256"], "Fixed input changed during encode")
        checkpoints.append({"repeat": number, "beforeSha256": fixed["sha256"],
                            "afterSha256": after_hash})
        probe = json.loads(runner.run(f"repeat-{number}-probe", probe_args(encoded)))
        check_stream(video_stream(probe), COUNT)
        hashes = framehash_rows(runner.run(f"repeat-{number}-framehash", decode_hash_args(encoded)))
        repeats.append({"path": str(encoded), "fileSha256": sha256(ROOT / encoded),
                        "frameCount": len(hashes), "frameSha256": hashes,
                        "frameHashSequenceSha256": hash_sequence(hashes),
                        "probe": probe, "x264": x264_info(ROOT / encoded)})

    # Independently confirm the reported boundary in the retained pair using
    # w1-1's already-frozen frames, never decoding w1-1 a second time.
    second_hashes = framehash_rows(runner.run("w1-2-window-framehash",
                                             decode_hash_args(VIDEOS[1], window=True)))
    retained_comparison = compare_frames(fixed["frameSha256"], second_hashes, START)
    replay_comparison = compare_frames(repeats[0]["frameSha256"], repeats[1]["frameSha256"])
    after = {str(path): sha256(ROOT / path) for path in PRESERVE}
    write_json(output / "preserved-after.json", after)
    require(before == after, "An original source/evidence file changed during diagnosis")
    sei_match = all(item["x264"] == retained[0]["x264"] for item in retained[1:] + repeats)
    summary = {
        "status": "complete", "fixedInputIdentity": checkpoints,
        "retainedWindowComparison": retained_comparison,
        "repeatComparison": {**replay_comparison,
                             "mp4FilesIdentical": repeats[0]["fileSha256"] == repeats[1]["fileSha256"],
                             "allRetainedAndReplayX264SettingsIdentical": sei_match},
        "repeats": repeats, "originalFilesUnchanged": before == after,
        "wallSeconds": time.monotonic() - runner.started,
        "aggregateCpuSeconds": cpu_seconds() - runner.cpu_started,
        "budgetsSeconds": {"wall": BUDGET, "aggregateCpu": BUDGET, "perCommandWall": 35},
        "hashDefinition": "frameHashSequenceSha256 = SHA256(concatenated lowercase ASCII "
                          "per-frame SHA256 hex strings); headers/container metadata excluded",
        "scope": "Two fresh libx264 processes, identical 60-frame 1080p/30 YUV420P input, "
                 "draft ultrafast CRF28 bf0 AQ3 BT709, default encoder threading.",
        "limitations": [
            "Lossy retained-video decode is not the original captured JPEG sequence.",
            "Only frames 840..899 are replayed; encoder state starts fresh at frame 840, "
            "not with the original 840-frame GOP/reference/rate-control history.",
            "Original image2pipe JPEG decoding/BT601-to-BT709 conversion, browser capture, "
            "frame delivery pacing, concurrent load, and audio/final remux are not replayed.",
            "Raw input already has BT709 pixels; only SAR is set, no JPEG color conversion.",
            "Source code currently sets 90000 video timescale; retained final MP4s have "
            "15360 after muxing. Replay uses 90000 and omits provenance and faststart remux.",
            "Matching twice supports repeatability here, not universal encoder determinism "
            "or proof of captured-frame drift. Frame hashes of original pre-encode captures "
            "would be needed to attribute that cause.",
            "The retained comparison checks only 840..899; frames 0..839 are not re-compared.",
        ],
    }
    write_json(output / "summary.json", summary)
    print(json.dumps({key: value for key, value in summary.items() if key not in
                      ("repeats", "limitations", "hashDefinition", "fixedInputIdentity")}, indent=2))
    return 0 if replay_comparison["decodedFramesIdentical"] and sei_match else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("self-test", "inspect", "run"))
    parser.add_argument("--out", default=str(EVIDENCE / "run-1"),
                        help="new output directory within reports/performance-full/encode-repeat")
    args = parser.parse_args()
    if args.command == "self-test":
        self_test()
        return 0
    if args.command == "inspect":
        print(json.dumps({str(path): x264_info(ROOT / path) for path in VIDEOS}, indent=2))
        return 0
    output = output_path(args.out)
    for path in [*PRESERVE, Path(FFMPEG), Path(FFPROBE)]:
        require((ROOT / path).is_file(), f"Missing required workspace file: {path}")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.mkdir()  # Exclusive claim; a concurrent/existing run is never reused.
    try:
        return diagnose(output)
    except Exception as error:
        write_json(output / "failure.json", {"status": "failed", "error": str(error)})
        raise


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(2)
