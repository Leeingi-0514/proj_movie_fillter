"""Exercise the untouched subfilter package and MovieGuard's actual JSON loaders.

Run: PYTHONDONTWRITEBYTECODE=1 python3 artifacts/subfilter-validation-2026-11-17/verify.py
No network API calls, package installation, or edits to either product are made.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent.parent
SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else '/Users/lee/Downloads/subfilter 2').resolve()
sys.path.insert(0, str(SOURCE))

from subfilter import web
from subfilter.analyzers import AnthropicAnalyzer, MockAnalyzer, validate_findings
from subfilter.exporter import to_movieguard
from subfilter.parsers import parse_subtitle
from subfilter.pipeline import Settings, run

logging.basicConfig(filename=ROOT / 'logs' / 'pipeline.log', level=logging.WARNING, force=True)
RESULTS = []
OUTPUTS = []
ENV = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONPATH=str(SOURCE))
# Explicitly avoid consuming any configured credentials during these checks.
ENV.pop('ANTHROPIC_API_KEY', None)


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def check(name, expected, actual, *, mode='offline', detail=None, kind='required'):
    passed = expected == actual
    status = 'PASS' if passed else 'NOTE' if kind == 'behavior_note' else 'FAIL'
    RESULTS.append(dict(name=name, passed=passed, status=status, kind=kind, mode=mode,
                        expected=expected, actual=actual, detail=detail))
    print(status + ' ' + name, flush=True)
    return passed


def snapshot():
    return {str(p.relative_to(SOURCE)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(SOURCE.rglob('*')) if p.is_file()}


def ts(ms):
    h, rem = divmod(ms, 3600000)
    m, rem = divmod(rem, 60000)
    s, f = divmod(rem, 1000)
    return f'{h:02d}:{m:02d}:{s:02d},{f:03d}'


def srt(rows):
    return '\n\n'.join(f'{i}\n{ts(a)} --> {ts(b)}\n{text}'
                        for i, (a, b, text) in enumerate(rows, 1)) + '\n'


def fixture(name, rows, encoding='utf-8'):
    path = ROOT / 'fixtures' / name
    path.write_bytes(srt(rows).encode(encoding))
    return path


def cli(name, path, *args, mock=True):
    out = ROOT / 'outputs' / f'{name}.json'
    out.unlink(missing_ok=True)
    command = [sys.executable, '-m', 'subfilter', str(path), '-o', str(out), '--cache-dir', '']
    if mock:
        command.append('--mock')
    command.extend(args)
    proc = subprocess.run(command, env=ENV, cwd=ROOT, capture_output=True, text=True, timeout=30)
    (ROOT / 'logs' / f'{name}.txt').write_text(
        json.dumps(command, ensure_ascii=False) + '\nexit=' + str(proc.returncode)
        + '\nSTDOUT\n' + proc.stdout + '\nSTDERR\n' + proc.stderr, encoding='utf-8')
    data = json.loads(out.read_text(encoding='utf-8')) if out.exists() else None
    if data is not None:
        OUTPUTS.append(out)
    return proc, data


def times(data):
    return [[s['start'], s['end']] for s in data['segments']]


def loaders(paths):
    proc = subprocess.run(['node', str(ROOT / 'verify_loaders.mjs')], input=json.dumps([str(p) for p in paths]),
                          capture_output=True, text=True, cwd=WORKSPACE, timeout=30)
    if proc.returncode:
        raise RuntimeError(proc.stderr)
    return json.loads(proc.stdout)


class ScriptedAnalyzer:
    """Deterministic findings exercise downstream logic; this is not an AI evaluation."""
    model = 'scripted-fixture'
    effort = None

    def __init__(self, findings=(), fail_indices=()):
        self.findings = list(findings)
        self.fail_indices = set(fail_indices)
        self.calls = []

    def summarize(self, cues):
        self.calls.append('context')
        return dict(genre_guess=['fixture'], synopsis='결정적 검증 데이터', notes='실제 AI 분석 결과가 아님')

    def analyze(self, chunk, context):
        self.calls.append(chunk.index)
        if chunk.index in self.fail_indices:
            raise RuntimeError('intentional fixture failure')
        return validate_findings(self.findings, chunk)


def finding(a, b, cat='violence', media='both', severity=2, confidence=0.9):
    return dict(cue_start=a, cue_end=b, category=cat, subcategory='other', severity=severity,
                confidence=confidence, reason='결정적 검증용 판단 근거', media=media, summary='결정적 검증용 장면 요약')


def pipeline_output(name, path, analyzer, settings):
    report = run(str(path), analyzer, settings)
    out = ROOT / 'outputs' / f'{name}.json'
    payload = to_movieguard(report, name)
    save(ROOT / 'outputs' / f'{name}.internal-report.json', report)
    save(out, payload)
    OUTPUTS.append(out)
    return report, payload, out


original_hashes = snapshot()
mixed_rows = [
    (0, 2000, '오늘 같이 산책할까?'),
    (10250, 12750, '<i>[비명]</i> 누구야!'),
    (40100, 43900, '옷을 벗어. 침대로 가자.'),
    (80999, 83001, '[총성] 칼을 내려놔!'),
    (120000, 122000, '내일 다시 만나자.'),
]
mixed = fixture('mixed_scenes.srt', mixed_rows)
neutral = fixture('neutral.srt', [(0, 1500, '안녕하세요.'), (10000, 12000, '내일 다시 만나요.')])
long_rows = [((i-1)*5000+250, (i-1)*5000+1750,
              '[총성]' if i in (99, 100, 101, 200, 201) else f'일상 대화 {i}') for i in range(1, 206)]
long_file = fixture('long_205_cues.srt', long_rows)
overlap = fixture('overlap_range.srt', [(10000, 30000, '폭행이 계속되는 장면의 대사'), (15000, 16000, '[타격음]')])
media_file = fixture('media_modes.srt', [(10000, 12000, '소리 분기 검증용 대사'),
                                      (40000, 42000, '화면 분기 검증용 대사'),
                                      (70000, 72000, '동시 분기 검증용 대사'),
                                      (100000, 102000, '중립적인 마지막 대사')])
empty = ROOT / 'fixtures' / 'empty.srt'
empty.write_text('', encoding='utf-8')
malformed = ROOT / 'fixtures' / 'malformed.srt'
malformed.write_text('1\nthis is not a timestamp\n[비명]\n', encoding='utf-8')

# All four shipped sample formats through the actual CLI.
shipped = [('srt', 11, [[43, 50], [151, 156], [248, 256]]),
           ('vtt', 2, [[3610, 3614]]), ('ass', 2, [[250, 254]]), ('smi', 2, [[43, 47]])]
for ext, cue_count, expected_times in shipped:
    path = SOURCE / 'samples' / ('sample_cp949.smi' if ext == 'smi' else f'sample.{ext}')
    cues, meta = parse_subtitle(path)
    proc, data = cli('shipped_' + ext, path)
    check(f'shipped {ext}: CLI returns success', 0, proc.returncode, mode='mock')
    check(f'shipped {ext}: parser cue count', cue_count, len(cues))
    if expected_times is not None and data is not None:
        check(f'shipped {ext}: second-based boundaries', expected_times, times(data), mode='mock')
    save(ROOT / 'outputs' / f'shipped_{ext}.parsed.json', dict(meta=meta, cues=[vars(c) for c in cues]))

proc, mixed_data = cli('mixed_scenes', mixed, '--title', '합성 장면 테스트')
check('mixed SRT: CLI/title', [0, '합성 장면 테스트'], [proc.returncode, mixed_data['title']], mode='mock')
check('mixed SRT: padding and floor/ceil', [[8, 14], [38, 45], [78, 85]], times(mixed_data), mode='mock')
proc, data = cli('neutral', neutral)
check('neutral SRT: valid empty result', [0, []], [proc.returncode, data['segments']], mode='mock')
proc, data = cli('violence_only', mixed, '--categories', 'violence')
check('category filter', [[78, 85]], times(data), mode='mock')
proc, data = cli('severity_3', mixed, '--min-severity', '3')
check('severity filter for separated scenes', [[38, 45], [78, 85]], times(data), mode='mock')
proc, data = cli('confidence_06', mixed, '--min-confidence', '0.6')
check('confidence filter', [], data['segments'], mode='mock')
proc, data = cli('long_205_cues', long_file)
check('205 cues: chunk boundaries and merging', [[488, 503], [993, 1003]], times(data), mode='mock')

for enc, name in [('utf-8-sig', 'utf8_bom'), ('utf-16', 'utf16'), ('cp949', 'cp949')]:
    path = fixture(name + '.srt', mixed_rows, enc)
    cues, meta = parse_subtitle(path)
    proc, data = cli(name, path)
    check(f'{name}: Korean text survives decoding', [r[2].replace('<i>', '').replace('</i>', '') for r in mixed_rows],
          [c.text for c in cues])
    check(f'{name}: exported boundaries', [[8, 14], [38, 45], [78, 85]], times(data), mode='mock')

for name, path, extra in [('empty', empty, ()), ('malformed', malformed, ()),
                          ('missing_file', ROOT / 'fixtures' / 'absent.srt', ()),
                          ('bad_categories', mixed, ('--categories', 'unknown')),
                          ('bad_chunk_size', mixed, ('--chunk-size', '0'))]:
    proc, data = cli('error_' + name, path, *extra)
    check(f'error {name}: rejects without output', [2 if name in ('bad_categories', 'bad_chunk_size') else 1, None],
          [proc.returncode, data], mode='mock')
proc, data = cli('missing_api_key', mixed, mock=False)
check('real mode without API key: explicit failure', [1, None, True],
      [proc.returncode, data, 'API 키가 설정되지 않았습니다' in proc.stderr])

# Controlled analysis findings expose paths that --mock (always both) cannot cover.
media_findings = [finding(1, 1, 'sexual', 'audio'), finding(2, 2, 'horror', 'video'), finding(3, 3)]
media_report, media_data, media_path = pipeline_output('media_modes', media_file, ScriptedAnalyzer(media_findings), Settings())
for result in loaders([media_path]):
    save(ROOT / 'outputs' / 'media_modes.loader-results.json', result)
    for name in ('web', 'extension'):
        check(f'{name}: audio/video/both output accepted', True, result[name]['accepted'], mode='scripted', detail=result)

_, overlap_data, _ = pipeline_output('overlap_range', overlap, ScriptedAnalyzer([finding(1, 2)]),
                                   Settings(pre_roll_ms=0, post_roll_ms=0, duration_ms=40000))
check('overlapping subtitles: entire detected cue range covered', [[10, 30]], times(overlap_data), mode='scripted')

# Applying severity after category merging can retain a lower-severity neighbouring scene.
adjacent = fixture('adjacent_severity.srt', [(10000, 12000, '약한 장면'), (14000, 16000, '강한 장면'),
                                          (30000, 32000, '중립 장면')])
adj_report, _, _ = pipeline_output('adjacent_severity', adjacent,
                                 ScriptedAnalyzer([finding(1, 1, severity=1), finding(2, 2, severity=3)]),
                                 Settings(pre_roll_ms=0, post_roll_ms=0))
adj_filtered = to_movieguard(adj_report, '심각도 3만', min_severity=3)
save(ROOT / 'outputs' / 'adjacent_severity_3.json', adj_filtered)
check('severity 3 filter excludes adjacent severity 1 cue', [[14, 16]], times(adj_filtered), mode='scripted',
      detail='Category-level merging assigns max severity before the export filter. This is a behavior note: the merged scene can intentionally inherit its highest severity.',
      kind='behavior_note')

# Cache reuse, partial failure and recovery, plus total failure.
with tempfile.TemporaryDirectory(prefix='subfilter_validation_cache_') as cache:
    first = ScriptedAnalyzer(media_findings)
    report = run(str(media_file), first, Settings(chunk_size=1), cache_dir=cache)
    second = ScriptedAnalyzer(media_findings)
    run(str(media_file), second, Settings(chunk_size=1), cache_dir=cache)
    check('cache: repeated run avoids analyzer calls', [5, 0], [len(first.calls), len(second.calls)], mode='scripted')
with tempfile.TemporaryDirectory(prefix='subfilter_validation_retry_') as cache:
    failed = ScriptedAnalyzer(media_findings, fail_indices=(1,))
    report = run(str(media_file), failed, Settings(chunk_size=1), cache_dir=cache)
    check('partial failure: incomplete report identifies missing chunk', [False, [1]],
          [report['analysis']['complete'], [c['chunk_index'] for c in report['analysis']['failed_chunks']]], mode='scripted')
    recovered = ScriptedAnalyzer(media_findings)
    report = run(str(media_file), recovered, Settings(chunk_size=1), cache_dir=cache)
    check('partial failure: retry calls only failed chunk', [True, [1]],
          [report['analysis']['complete'], recovered.calls], mode='scripted')
try:
    run(str(media_file), ScriptedAnalyzer(fail_indices=(0,)), Settings())
    total_failure = False
except RuntimeError:
    total_failure = True
check('total failure: raises instead of exporting empty success', True, total_failure, mode='scripted')

# Exercise actual API response decoding with a fake client; no external request.
class FixtureAPIError(Exception):
    pass

api_calls = []
def fake_create(**kwargs):
    api_calls.append(kwargs)
    data = dict(genre_guess=['fixture'], synopsis='검증 데이터', notes='') if len(api_calls) == 1 else {'findings': media_findings}
    return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='thinking'),
                          SimpleNamespace(type='text', text=json.dumps(data, ensure_ascii=False))])

api = object.__new__(AnthropicAnalyzer)
api._anthropic = SimpleNamespace(RateLimitError=FixtureAPIError, APIConnectionError=FixtureAPIError, InternalServerError=FixtureAPIError)
api.client = SimpleNamespace(messages=SimpleNamespace(create=fake_create))
api.model, api.effort, api.max_retries, api.max_tokens = 'fixture-no-network', 'medium', 0, 16000
_, api_data, _ = pipeline_output('api_response_replay', media_file, api, Settings())
check('API response replay: two passes decode and validate', [2, ['audio', 'video', 'both']],
      [len(api_calls), [s['type'] for s in api_data['segments']]], mode='fake-api')
save(ROOT / 'outputs' / 'api_request_shapes.json', [{k: v for k, v in call.items() if k != 'system'} for call in api_calls])

# HTTP upload -> job polling -> JSON download against the actual local server.
web.CACHE_DIR = None
web.LAN_MODE = False
web.JOBS.clear()
server = web.ThreadingHTTPServer(('127.0.0.1', 0), web.Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
base = f'http://127.0.0.1:{server.server_port}'

def http(path, data=None, filename=None):
    headers = {'X-File-Name': quote(filename)} if filename else {}
    request = Request(base + path, data=data, headers=headers)
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, dict(response.headers), response.read()
    except HTTPError as error:
        return error.code, dict(error.headers), error.read()

try:
    status, _, body = http('/api/config')
    check('HTTP configuration', 200, status, mode='http-mock')
    status, _, body = http('/api/jobs?mock=1', mixed.read_bytes(), '한글 영화.srt')
    check('HTTP SRT upload', 202, status, mode='http-mock')
    job_id = json.loads(body)['job_id']
    for _ in range(100):
        _, _, body = http('/api/jobs/' + job_id)
        job = json.loads(body)
        if job['status'] in ('done', 'error'):
            break
        time.sleep(0.02)
    save(ROOT / 'outputs' / 'web-job.json', job)
    check('HTTP job completes', 'done', job['status'], mode='http-mock')
    prefix = '/api/jobs/' + job_id + '/download'
    status, headers, body = http(prefix + '?title=' + quote('웹 검증 영화'))
    web_data = json.loads(body)
    save(ROOT / 'outputs' / 'web-download.json', web_data)
    OUTPUTS.append(ROOT / 'outputs' / 'web-download.json')
    check('HTTP download: title, times, attachment', [200, '웹 검증 영화', [[8, 14], [38, 45], [78, 85]], True],
          [status, web_data['title'], times(web_data), 'attachment' in headers.get('Content-Disposition', '')], mode='http-mock')
    _, _, body = http(prefix + '?cats=violence&minsev=3')
    check('HTTP category/severity filter', [[78, 85]], times(json.loads(body)), mode='http-mock')
    _, _, body = http(prefix + '?cats=&minsev=1')
    web_empty = json.loads(body)
    save(ROOT / 'outputs' / 'web-no-categories.json', web_empty)
    check('HTTP deselecting every category yields empty segments', [], web_empty['segments'], mode='http-mock')
    status, _, body = http('/api/jobs?mock=1', b'', 'empty.srt')
    check('HTTP empty upload rejected', 400, status, mode='http-mock')
    status, _, body = http('/api/jobs?mock=0', mixed.read_bytes(), 'mixed.srt')
    check('HTTP missing API key rejected', 400, status, mode='http-mock')
    status, _, body = http('/api/jobs?mock=1', mixed.read_bytes(), 'mixed.txt')
    check('HTTP unsupported extension rejected', 400, status, mode='http-mock')
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=3)

all_loader_results = loaders(OUTPUTS)
save(ROOT / 'outputs' / 'all-loader-results.json', all_loader_results)
mock_loader_results = [r for r in all_loader_results if not any(t in ('audio', 'video') for t in r['types'])]
check('all mock and both-only outputs: actual web/extension loaders accept', True,
      all(r['web']['accepted'] and r['extension']['accepted'] for r in mock_loader_results), mode='integration')
check('source files unchanged', original_hashes, snapshot())
save(ROOT / 'source-sha256.json', original_hashes)
summary = dict(source=str(SOURCE), python=sys.version, workspace=str(WORKSPACE),
               live_api_tested=False, live_api_reason='ANTHROPIC_API_KEY is absent; anthropic SDK is not installed.',
               counts=dict(total=len(RESULTS), passed=sum(r['status'] == 'PASS' for r in RESULTS),
                           failed=sum(r['status'] == 'FAIL' for r in RESULTS),
                           notes=sum(r['status'] == 'NOTE' for r in RESULTS)), results=RESULTS)
save(ROOT / 'results.json', summary)
print(json.dumps(summary['counts']), flush=True)
sys.exit(1 if summary['counts']['failed'] else 0)
