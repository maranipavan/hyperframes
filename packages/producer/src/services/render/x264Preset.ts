const X264_PRESETS = new Set([
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow",
]);

/** Resolve an opt-in preset for local software H.264 MP4 renders. */
export function resolveX264PresetOverride(
  raw: string | undefined,
  context: { format: string; codec: string; useGpu: boolean },
): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (!X264_PRESETS.has(value)) {
    throw new Error(
      "Invalid HYPERFRAMES_X264_PRESET. Expected an x264 preset from ultrafast to veryslow.",
    );
  }
  if (context.format !== "mp4" || context.codec !== "h264" || context.useGpu) {
    throw new Error(
      "HYPERFRAMES_X264_PRESET supports only local software H.264 MP4 renders; " +
        "unset it for GPU, HDR, HLS, or other output formats.",
    );
  }
  return value;
}
