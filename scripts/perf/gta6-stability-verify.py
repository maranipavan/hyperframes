#!/usr/bin/env python3
"""Verify frozen 900-frame candidate exports, including every decoded frame/audio."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = (ROOT / (sys.argv[1] if len(sys.argv) > 1 else "reports/performance-full/stability-exports")).resolve()
assert (ROOT / "reports/performance-full").resolve() in OUT.parents
FFMPEG = ROOT / ".tools/ffmpeg/ffmpeg"
FFPROBE = ROOT / ".tools/ffmpeg/ffprobe"


def execute(argv):
    return subprocess.run(list(map(str, argv)), check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, timeout=120).stdout


def main():
    records = []
    for name in ("w1-1", "w3-1", "w3-2", "w1-2"):
        path = OUT / f"{name}.mp4"
        probe = json.loads(execute([FFPROBE, "-v", "error", "-count_frames",
                                   "-show_streams", "-show_format", "-of", "json", "--", path]))
        video = next(s for s in probe["streams"] if s["codec_type"] == "video")
        audio = next(s for s in probe["streams"] if s["codec_type"] == "audio")
        assert (video["width"], video["height"], video["avg_frame_rate"], int(video["nb_read_frames"])) == (1920, 1080, "30/1", 900)
        assert float(video["start_time"]) == float(audio["start_time"]) == 0
        assert float(video["duration"]) == float(audio["duration"]) == 30
        assert (int(audio["sample_rate"]), audio["channels"]) == (48000, 2)
        framehash = execute([FFMPEG, "-v", "error", "-i", path, "-map", "0:v:0",
                             "-c:v", "rawvideo", "-pix_fmt", "yuv420p", "-f", "framehash", "-hash", "sha256", "-"]).decode()
        rows = [line.split(",") for line in framehash.splitlines() if line and not line.startswith("#")]
        assert len(rows) == 900
        for frame, row in enumerate(rows):
            assert tuple(int(v) for v in row[:5]) == (0, frame, frame, 1, 1920 * 1080 * 3 // 2)
        hashes = [row[-1].strip() for row in rows]
        pcm = execute([FFMPEG, "-v", "error", "-i", path, "-map", "0:a:0", "-c:a", "pcm_s16le", "-f", "s16le", "-"])
        # AAC decoder padding can exceed nominal duration; compare exact decoded bytes
        # across repeats and against the prior original, not a silently trimmed mix.
        assert len(pcm) >= 30 * 48000 * 4
        records.append({"name": name, "metadata": probe, "frames": hashes,
                        "audioBytes": len(pcm), "audioSha256": hashlib.sha256(pcm).hexdigest(),
                        "measurement": json.loads((OUT / f"{name}.json").read_text())})
    original_pcm = execute([FFMPEG, "-v", "error", "-i", ROOT / "reports/performance-full/workers/w1-1.mp4",
                            "-map", "0:a:0", "-c:a", "pcm_s16le", "-f", "s16le", "-"])
    original_audio = hashlib.sha256(original_pcm).hexdigest()
    frames_equal = all(r["frames"] == records[0]["frames"] for r in records)
    audio_equal = all(r["audioSha256"] == original_audio for r in records)
    summary = {"framesEqual": frames_equal, "audioEqualIncludingOriginal": audio_equal,
               "originalAudioSha256": original_audio, "records": records}
    with (OUT / "verification.json").open("x") as handle:
        json.dump(summary, handle, indent=2)
        handle.write("\n")
    print(json.dumps({"framesEqual": frames_equal, "audioEqualIncludingOriginal": audio_equal,
                      "exports": len(records), "framesPerExport": 900,
                      "audioSha256": original_audio,
                      "wallSeconds": {r["name"]: r["measurement"]["wallSeconds"] for r in records}}))
    assert frames_equal and audio_equal, "Do not approve non-identical repeats"


if __name__ == "__main__":
    main()
