"""Serve the real web player against a local, synthetic summary fixture."""
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import json
import shutil
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def main():
    project = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='movieguard-web-summary-qa-') as temporary:
        root = Path(temporary)
        for name in ['player.html', 'player_style.css', 'player_script.js', 'catalog.js', 'filter-engine.js', 'video-layout.js']:
            shutil.copyfile(project / name, root / name)
        (root / 'extension').mkdir()
        shutil.copyfile(project / 'extension/skip-summary.js', root / 'extension/skip-summary.js')
        (root / 'assets/horror').mkdir(parents=True)
        (root / 'assets/segments').mkdir()
        shutil.copyfile(project / 'assets/demo-video.mp4', root / 'assets/horror/qa.mp4')
        (root / 'assets/videos.json').write_text(json.dumps({'videos': [{'id': 'qa', 'theme': 'horror', 'title': '스킵 요약 테스트', 'src': 'assets/horror/qa.mp4', 'segments': 'assets/segments/qa.json'}]}, ensure_ascii=False))
        (root / 'assets/segments/qa.json').write_text(json.dumps({'segments': [
            {'id': 'a', 'start': 1, 'end': 2.5, 'type': 'blur', 'summary': '첫 번째 장면 요약'},
            {'id': 'b', 'start': 2, 'end': 3.5, 'type': 'blur', 'summary': '두 번째 장면 요약'},
            {'id': 'c', 'start': 6, 'end': 7, 'type': 'blur', 'summary': ''}
        ]}, ensure_ascii=False))
        shutil.copyfile(project / 'tests/fixtures/web-summary-browser.html', root / 'index.html')
        shutil.copyfile(project / 'tests/fixtures/web-summary-browser-tests.js', root / 'web-summary-tests.js')
        server.PUBLIC_FILES = {file.relative_to(root).as_posix() for file in root.rglob('*') if file.is_file()}
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 8021
        with ThreadingHTTPServer(('127.0.0.1', port), partial(server.VideoRequestHandler, directory=str(root))) as httpd:
            print(f'Web summary test: http://127.0.0.1:{port}/index.html', flush=True)
            httpd.serve_forever()


if __name__ == '__main__':
    main()
