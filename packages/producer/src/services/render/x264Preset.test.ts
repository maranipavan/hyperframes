import { describe, expect, it } from "vitest";
import { resolveX264PresetOverride } from "./x264Preset.js";

const softwareMp4 = { format: "mp4", codec: "h264", useGpu: false };

describe("resolveX264PresetOverride", () => {
  it("keeps the existing default when no override is set", () => {
    expect(resolveX264PresetOverride(undefined, softwareMp4)).toBeUndefined();
    expect(resolveX264PresetOverride("  ", softwareMp4)).toBeUndefined();
  });

  it("accepts a valid preset for software H.264 MP4", () => {
    expect(resolveX264PresetOverride(" veryfast ", softwareMp4)).toBe("veryfast");
    expect(resolveX264PresetOverride("medium", softwareMp4)).toBe("medium");
  });

  it("rejects invalid presets", () => {
    expect(() => resolveX264PresetOverride("not-a-preset", softwareMp4)).toThrow(
      /Invalid HYPERFRAMES_X264_PRESET/,
    );
  });

  it.each([
    { format: "webm", codec: "vp9", useGpu: false },
    { format: "mp4", codec: "h265", useGpu: false },
    { format: "mp4", codec: "h264", useGpu: true },
    { format: "hls", codec: "h264", useGpu: false },
  ])("rejects unsupported output configurations: $format $codec GPU=$useGpu", (context) => {
    expect(() => resolveX264PresetOverride("veryfast", context)).toThrow(/only local software/);
  });
});
