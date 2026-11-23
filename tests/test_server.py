from contextlib import redirect_stdout
from io import StringIO
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

import server


class ServerTests(unittest.TestCase):
    def run_main(self, arguments):
        output = StringIO()
        with patch.object(server, 'ThreadingHTTPServer') as factory, \
                patch.object(server, 'get_lan_addresses', return_value=['192.168.0.160']) as addresses, \
                redirect_stdout(output):
            factory.return_value.__enter__.return_value.serve_forever.side_effect = KeyboardInterrupt
            server.main(arguments)
            return factory.call_args.args, output.getvalue(), addresses.called

    def test_default_accepts_lan_connections_and_prints_connectable_address(self):
        args, output, queried = self.run_main([])
        self.assertEqual(args[0], ('0.0.0.0', 8000))
        self.assertIn('http://192.168.0.160:8000/index.html', output)
        self.assertNotIn('http://0.0.0.0', output)
        self.assertTrue(queried)

    def test_explicit_loopback_and_custom_port_remain_available(self):
        args, output, queried = self.run_main(['8123', '--host', '127.0.0.1'])
        self.assertEqual(args[0], ('127.0.0.1', 8123))
        self.assertIn('http://127.0.0.1:8123/index.html', output)
        self.assertFalse(queried)

    def test_files_are_served_from_project_instead_of_callers_working_directory(self):
        args, _, _ = self.run_main([])
        self.assertEqual(args[1].keywords['directory'], str(server.PROJECT_ROOT))

    def test_address_list_omits_loopback_wildcard_and_invalid_addresses(self):
        values = ['127.0.0.1', '0.0.0.0', 'invalid', '1.1.1.1', '169.254.1.2', '192.168.0.160', '192.168.0.160']
        records = [(0, 0, 0, '', (value, 0)) for value in values]
        with patch.object(server.sys, 'platform', 'linux'), \
                patch.object(server.socket, 'getaddrinfo', return_value=records):
            self.assertEqual(server.get_lan_addresses(), ['192.168.0.160'])

    def test_mac_wifi_address_is_found_even_when_hostname_lookup_fails(self):
        with patch.object(server.sys, 'platform', 'darwin'), \
                patch.object(server.socket, 'if_nameindex', return_value=[(1, 'lo0'), (2, 'en0')]), \
                patch.object(server.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='192.168.0.160\n')), \
                patch.object(server.socket, 'getaddrinfo', side_effect=OSError):
            self.assertEqual(server.get_lan_addresses(), ['192.168.0.160'])

    def test_hidden_project_files_are_not_exposed_over_lan(self):
        for path in ['/.git/config', '/%2Egit/config', '/assets/.DS_Store']:
            handler = object.__new__(server.VideoRequestHandler)
            handler.path = path
            handler.send_error = MagicMock()
            self.assertIsNone(handler.send_head())
            self.assertEqual(handler.send_error.call_args.args[0], 404)

    def test_only_application_assets_are_public(self):
        for path in ['index.html', 'player_script.js', 'video-layout.js', 'extension/skip-summary.js', 'assets/videos.json',
                     'assets/horror/quiet-place.mp4', 'assets/posters/quiet place_poster.jpeg',
                     'assets/segments/quiet-place.json', 'assets/themes/horror.png']:
            self.assertTrue(server.is_public_path(path), path)
        for path in ['server.py', 'README.md', 'package.json', 'prepare_videos.py',
                     'tests/test_server.py', '.git/config', 'extension/content.js', 'extension/popup.js', 'assets/private.json',
                     'assets/posters/secret.txt', 'assets/horror/../../server.py', 'assets/horror']:
            self.assertFalse(server.is_public_path(path), path)


if __name__ == '__main__':
    unittest.main()
