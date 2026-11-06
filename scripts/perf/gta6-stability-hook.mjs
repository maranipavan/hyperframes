// Composition-specific, experimental capture hook. Not a renderer default.
// This function is serialized into the isolated candidate's local script.
export function installGta6CaptureStability() {
  if (window.__gta6CaptureStability) return;
  const stats = { seeks: 0, resets: 0 };
  window.__gta6CaptureStability = stats;
  window.addEventListener("hf-seek", (event) => {
    if (!window.__HF_RENDER_CAPTURE_MODE) return;
    if (typeof event.detail?.waitUntil !== "function") {
      throw new Error("GTA6 capture stability requires hf-seek waitUntil support");
    }
    const time = event.detail.time;
    if (typeof time !== "number" || !Number.isFinite(time)) {
      throw new Error("GTA6 capture stability requires a finite seek time");
    }
    // Run after synchronous timeline AND clip-visibility updates, but before
    // the engine's seek-completion gate. No timers, extra rAF or frozen motion.
    event.detail.waitUntil(
      Promise.resolve().then(() => {
        stats.seeks++;
        const elements = [...document.querySelectorAll(".scene-inner.chapter")].filter(
          (element) => {
            // GTA6's scenes remain laid out at opacity:0 outside their windows;
            // client rects alone incorrectly reset all eight chapters every frame.
            const scene = element.parentElement;
            const start = Number(scene.getAttribute("data-start"));
            const duration = Number(scene.getAttribute("data-duration"));
            return time >= start && time < start + duration && element.getClientRects().length > 0;
          },
        );
        if (!elements.length) return;
        // These are static HTML/text chapter containers, not media/custom elements.
        // Keep node identities and exact style attributes; do NOT remove/reinsert
        // DOM nodes or clear the authored transform/opacity to achieve stability.
        const styles = elements.map((element) => element.getAttribute("style"));
        try {
          for (const element of elements) element.style.setProperty("display", "none", "important");
          void document.body.offsetWidth;
        } finally {
          elements.forEach((element, index) => {
            if (styles[index] === null) element.removeAttribute("style");
            else element.setAttribute("style", styles[index]);
          });
        }
        stats.resets += elements.length;
      }),
    );
  });
}

export const gta6CaptureStabilitySource = `(${installGta6CaptureStability.toString()})();\n`;
