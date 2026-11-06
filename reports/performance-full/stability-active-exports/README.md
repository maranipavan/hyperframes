# Active-window capture-stability exports

Final scoped hook candidate: `../stability-active-30/`.
Unlike the earlier prototype, the hook resets only the chapter whose authored
half-open time window contains the seek time. Hidden opacity-zero scenes keep
layout boxes, so client rects alone cannot determine activity.

Four complete 900-frame exports: order 1, 3, 3, 1 workers; same screenshot/draft
settings as the earlier matrix. Exact decoded-video/audio verification lives
in `verification.json`, produced by `scripts/perf/gta6-stability-verify.py`.
