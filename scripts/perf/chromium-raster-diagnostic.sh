#!/bin/sh
# Isolated launch-flag experiment. Never select this wrapper by default.
case "${HF_RASTER_DIAGNOSTIC_MODE:-full-raster}" in
  full-raster) set -- --disable-partial-raster "$@" ;;
  main-thread) set -- --disable-threaded-compositing "$@" ;;
  *) exit 2 ;;
esac
exec "${HF_DIAGNOSTIC_CHROMIUM:-/usr/bin/chromium}" "$@"
