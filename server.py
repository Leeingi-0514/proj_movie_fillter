"""Local static server with byte-range support for browser video seeking."""

import argparse
from functools import partial
import ipaddress
import os
from pathlib import Path, PurePosixPath
import re
import socket
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit


PROJECT_ROOT = Path(__file__).resolve().parent
PUBLIC_FILES = {
    'index.html', 'videos.html', 'player.html', 'style.css', 'player_style.css',
    'script.js', 'videos_script.js', 'catalog.js', 'player_script.js',
    'filter-engine.js', 'video-layout.js', 'extension/skip-summary.js', 'assets/videos.json', 'assets/movieguard-city.png'
}


def is_public_path(path):
    parts = PurePosixPath(path).parts
    if any(part.startswith('.') for part in parts):
        return False
    if path in PUBLIC_FILES:
        return True
    if len(parts) != 3 or parts[0] != 'assets':
        return False
    extension = PurePosixPath(path).suffix.lower()
    return ((parts[1] in {'horror', 'violence', 'sexual'} and extension == '.mp4')
            or (parts[1] == 'segments' and extension == '.json')
            or (parts[1] in {'posters', 'themes'} and extension in {'.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif'}))


def get_lan_addresses():
    candidates = []
    if sys.platform == 'darwin':
        for _, name in socket.if_nameindex():
            if name.startswith(('en', 'bridge')):
                try:
                    result = subprocess.run(['/usr/sbin/ipconfig', 'getifaddr', name],
                                            capture_output=True, text=True, timeout=2)
                    if result.returncode == 0:
                        candidates.append(result.stdout.strip())
                except (OSError, subprocess.TimeoutExpired):
                    pass
    if not candidates:
        try:
            candidates.extend(address[4][0] for address in socket.getaddrinfo(
                socket.gethostname(), None, socket.AF_INET, socket.SOCK_STREAM))
        except OSError:
            pass
    addresses = set()
    for candidate in candidates:
        try:
            address = ipaddress.IPv4Address(candidate)
            if (address.is_private and not address.is_loopback and not address.is_unspecified
                    and not address.is_multicast and not address.is_link_local):
                addresses.add(str(address))
        except ipaddress.AddressValueError:
            pass
    return sorted(addresses)


class VideoRequestHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        self.byte_range = None
        request_path = unquote(urlsplit(self.path).path).lstrip('/') or 'index.html'
        if not is_public_path(request_path):
            self.send_error(404, 'File not found')
            return None
        path = self.translate_path('/' + request_path)
        try:
            resolved = Path(path).resolve().relative_to(Path(self.directory).resolve()).as_posix()
        except ValueError:
            self.send_error(404, 'File not found')
            return None
        if not is_public_path(resolved):
            self.send_error(404, 'File not found')
            return None
        if not os.path.isfile(path):
            return super().send_head()
        try:
            stream = open(path, 'rb')
        except OSError:
            self.send_error(404, 'File not found')
            return None

        stat = os.fstat(stream.fileno())
        size = stat.st_size
        requested = re.fullmatch(r'bytes=(\d*)-(\d*)', self.headers.get('Range', '').strip())
        if requested and (requested[1] or requested[2]):
            if requested[1]:
                start = int(requested[1])
                end = min(int(requested[2]) if requested[2] else size - 1, size - 1)
            else:
                start = max(0, size - int(requested[2]))
                end = size - 1
            if start > end or start >= size:
                stream.close()
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return None
            self.byte_range = (start, end)
            stream.seek(start)

        self.send_response(206 if self.byte_range else 200)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Last-Modified', self.date_time_string(stat.st_mtime))
        if self.byte_range:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.send_header('Content-Length', str(end - start + 1))
        else:
            self.send_header('Content-Length', str(size))
        self.end_headers()
        return stream

    def list_directory(self, path):
        self.send_error(404, 'File not found')
        return None

    def copyfile(self, source, destination):
        if self.byte_range is None:
            return super().copyfile(source, destination)
        remaining = self.byte_range[1] - self.byte_range[0] + 1
        while remaining > 0:
            block = source.read(min(65536, remaining))
            if not block:
                break
            destination.write(block)
            remaining -= len(block)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('port', nargs='?', type=int, default=8000)
    parser.add_argument('--host', default='0.0.0.0', help='접속을 받을 주소 (기본: 0.0.0.0)')
    args = parser.parse_args(argv)
    handler = partial(VideoRequestHandler, directory=str(PROJECT_ROOT))
    with ThreadingHTTPServer((args.host, args.port), handler) as server:
        if args.host == '0.0.0.0':
            print(f'이 컴퓨터: http://127.0.0.1:{args.port}/index.html', flush=True)
            for address in get_lan_addresses():
                print(f'같은 Wi-Fi의 다른 기기: http://{address}:{args.port}/index.html', flush=True)
        else:
            print(f'MovieGuard: http://{args.host}:{args.port}/index.html', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
