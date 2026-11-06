#!/bin/sh
# Diagnostic only. Do not set this as the renderer default. Unlike
# --deterministic-mode this deliberately does NOT enable BeginFrame control.
exec "${HF_DIAGNOSTIC_CHROMIUM:-/usr/bin/chromium}" \
  --run-all-compositor-stages-before-draw \
  --disable-new-content-rendering-timeout \
  --disable-threaded-animation \
  --disable-threaded-scrolling \
  --disable-checker-imaging \
  "$@"
