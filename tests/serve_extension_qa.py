"""Serve a Netflix-free browser test harness on this computer only."""
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import shutil
import sys
import tempfile
from urllib.parse import urlsplit
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def main():
    project = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='movieguard-extension-qa-') as temporary:
        root = Path(temporary)
        shutil.copytree(project / 'extension', root / 'extension')
        for source, dest in [('extension-browser.html', 'index.html'),
                             ('extension-chrome-stub.js', 'chrome-stub.js'),
                             ('extension-browser-tests.js', 'browser-tests.js')]:
            shutil.copyfile(project / 'tests/fixtures' / source, root / dest)
        shutil.copyfile(project / 'assets/demo-video.mp4', root / 'demo.mp4')
        popup = root / 'extension/popup.html'
        popup.write_text(popup.read_text().replace('<script src="filter-engine.js">', '<script src="/chrome-stub.js"></script><script src="filter-engine.js">'))
        server.PUBLIC_FILES = {file.relative_to(root).as_posix() for file in root.rglob('*') if file.is_file()}

        class Handler(server.VideoRequestHandler):
            def do_GET(self):
                if urlsplit(self.path).path.startswith('/watch/') or urlsplit(self.path).path == '/browse':
                    self.path = '/index.html'
                super().do_GET()

        port = int(sys.argv[1]) if len(sys.argv) > 1 else 8018
        with ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=str(root))) as httpd:
            print(f'Browser test: http://127.0.0.1:{port}/watch/101', flush=True)
            httpd.serve_forever()


if __name__ == '__main__':
    main()
