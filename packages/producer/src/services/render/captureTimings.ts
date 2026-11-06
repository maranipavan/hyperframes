import type { CapturePerfSummary } from "@hyperframes/engine";

/**
 * Summarize worker capture timings per captured frame. Worker measurements
 * overlap in wall time, so these averages must not be added to render time.
 * Reused frames are excluded by the engine's `frames` counter.
 */
export function aggregateCaptureTimings(perfs: readonly CapturePerfSummary[]) {
  const active = perfs.filter((perf) => perf.frames > 0);
  const frames = active.reduce((sum, perf) => sum + perf.frames, 0);
  if (frames === 0) return undefined;

  const weightedAverage = (
    field: "avgTotalMs" | "avgSeekMs" | "avgBeforeCaptureMs" | "avgScreenshotMs",
  ) => Math.round(active.reduce((sum, perf) => sum + perf[field] * perf.frames, 0) / frames);

  return {
    sessions: active.length,
    capturedFrames: frames,
    avgTotalMs: weightedAverage("avgTotalMs"),
    avgSeekMs: weightedAverage("avgSeekMs"),
    avgBeforeCaptureMs: weightedAverage("avgBeforeCaptureMs"),
    avgScreenshotMs: weightedAverage("avgScreenshotMs"),
  };
}
