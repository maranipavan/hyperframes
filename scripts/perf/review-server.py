"""Local-only review server with byte ranges, needed for seeking long MP4s."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2] / "reports/performance-full"


class Handler(SimpleHTTPRequestHandler):
    remaining = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        self.remaining = None
        path = Path(self.translate_path(self.path))
        if not path.resolve().is_relative_to(ROOT.resolve()):
            self.send_error(404)
            return None
        header = self.headers.get("Range")
        if not header or not path.is_file():
            return super().send_head()
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", header)
        size = path.stat().st_size
        if not match or not any(match.groups()) or not size:
            self.send_error(416)
            return None
        first, last = match.groups()
        if first:
            start, end = int(first), min(int(last) if last else size - 1, size - 1)
        else:
            start, end = max(0, size - int(last)), size - 1
        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None
        source = path.open("rb")
        source.seek(start)
        self.remaining = end - start + 1
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(self.remaining))
        self.end_headers()
        return source

    def end_headers(self):
        if self.remaining is None:
            self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def copyfile(self, source, outputfile):
        try:
            if self.remaining is None:
                return super().copyfile(source, outputfile)
            while self.remaining:
                data = source.read(min(self.remaining, 256 * 1024))
                if not data:
                    break
                outputfile.write(data)
                self.remaining -= len(data)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Browser cancelled a seek/download.


if __name__ == "__main__":
    print("Review: http://localhost:8765/review.html", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
