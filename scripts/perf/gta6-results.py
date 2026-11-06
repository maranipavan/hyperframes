"""Verify GTA6 worker artifacts and summarize retained full-export evidence."""
import hashlib
import json
import math
from pathlib import Path
import re
import statistics
import subprocess

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "reports/performance-full"


def decoded_hash(path, kind):
    args = (["-map", "0:v:0", "-pix_fmt", "rgb24", "-f", "framemd5"]
            if kind == "video" else ["-map", "0:a:0", "-f", "s16le"])
    process = subprocess.Popen(["ffmpeg", "-v", "error", "-nostdin", "-i", str(path),
                                *args, "-"], stdout=subprocess.PIPE)
    digest = hashlib.sha256()
    length = 0
    for data in iter(lambda: process.stdout.read(1024 * 1024), b""):
        digest.update(data)
        length += len(data)
    if process.wait() != 0:
        raise RuntimeError(f"Decode failed: {path}")
    return {"sha256": digest.hexdigest(), "bytes": length}


def main():
    rows = []
    for path in sorted((EVIDENCE / "workers").glob("w?-?.json")):
        run = json.loads(path.read_text())
        assert run["exitCode"] == 0 and not run["timedOut"]
        log = path.with_suffix(".log").read_text()
        ids = re.findall(r'"renderJobId":"([a-f0-9-]+)"', log)
        perf = json.loads((ROOT / "packages/.debug" / ids[-1] / "perf-summary.json").read_text())
        video = path.with_suffix(".mp4")
        probe = json.loads(subprocess.check_output([
            "ffprobe", "-v", "error", "-count_frames", "-show_streams", "-show_format",
            "-of", "json", "--", str(video)], text=True))
        stream = next(s for s in probe["streams"] if s["codec_type"] == "video")
        assert int(stream["nb_read_frames"]) == 900
        assert stream["width"] == 1920 and stream["height"] == 1080
        assert stream["avg_frame_rate"] == "30/1"
        assert float(probe["format"]["duration"]) == 30
        row = {
            "run": path.stem,
            "wallSeconds": run["wallSeconds"],
            "workers": perf["workers"],
            "stages": perf["stages"],
            "peakRssSumMiB": run["sampledPeakRssSumMiB"],
            "accountedCpuPercentOneCore": run["reapedCpuPercentOneCore"],
            "sampledCpuSecondsLowerBound": run["sampledProcessCpuSecondsLowerBound"],
            "alphaBlit": perf["alphaBlit"],
            "drawElement": perf.get("drawElement"),
            "videoFramemd5": decoded_hash(video, "video"),
            "audioPcm": decoded_hash(video, "audio"),
            "videoStart": stream["start_time"],
            "audioStart": next(s["start_time"] for s in probe["streams"] if s["codec_type"] == "audio"),
        }
        rows.append(row)
        print(json.dumps(row), flush=True)
    assert len(rows) == 8
    video_equal = len({r["videoFramemd5"]["sha256"] for r in rows}) == 1
    audio_equal = len({r["audioPcm"]["sha256"] for r in rows}) == 1
    full = {}
    for name, field in [("psnr", "psnr_avg"), ("ssim", "All")]:
        values = []
        for line in (EVIDENCE / f"gta6-full-{name}.log").read_text().splitlines():
            values.append(float(re.search(rf"{field}:([^ ]+)", line)[1]))
        assert len(values) == 18000
        finite = [value for value in values if math.isfinite(value)]
        full[name] = {"frames": len(values), "finiteFrames": len(finite),
                      "meanFinite": statistics.mean(finite), "minimum": min(finite),
                      "worstFrameZeroBased": values.index(min(values))}
    result = {"workerRuns": rows, "workersDecodedVideoIdentical": video_equal,
              "workersDecodedAudioIdentical": audio_equal, "fullExportQuality": full}
    (EVIDENCE / "verification.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "workerRuns"}))
    assert video_equal and audio_equal, "Worker output differs: investigate before selecting worker count"


if __name__ == "__main__":
    main()
