import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { MuteController, parseSegments, activeSegments, activeWindowKey, skipTarget, skipWindow } from '../filter-engine.js';
import { loadCatalog } from '../catalog.js';

class FakeVideo extends EventTarget {
  constructor(muted = false) {
    super();
    this.value = muted;
    this.pendingEvents = 0;
  }
  get muted() { return this.value; }
  set muted(value) {
    if (this.value === value) return;
    this.value = value;
    this.pendingEvents += 1;
  }
  flushVolumeEvents() {
    while (this.pendingEvents > 0) {
      this.pendingEvents -= 1;
      this.dispatchEvent(new Event('volumechange'));
    }
  }
}

test('asynchronous filter volumechange does not become a permanent user mute', async () => {
  const video = new FakeVideo();
  const controller = new MuteController(video);
  controller.update(true);
  assert.equal(video.muted, true);
  await Promise.resolve();
  video.flushVolumeEvents();
  controller.update(false);
  video.flushVolumeEvents();
  assert.equal(video.muted, false);
  assert.equal(controller.userMuted, false);
});

test('manual unmute stays effective for the rest of the current interval', () => {
  const video = new FakeVideo();
  const controller = new MuteController(video);
  controller.update(true);
  video.flushVolumeEvents();
  video.muted = false;
  video.flushVolumeEvents();
  for (let frame = 0; frame < 120; frame += 1) controller.update(true);
  assert.equal(video.muted, false);
  assert.equal(controller.overridden, true);
  controller.update(false);
  assert.equal(video.muted, false);
});

test('manual unmute is respected even before the browser delivers volumechange', () => {
  const video = new FakeVideo();
  const controller = new MuteController(video);
  controller.update(true);
  video.muted = false;
  controller.update(true);
  video.flushVolumeEvents();
  controller.update(true);
  assert.equal(video.muted, false);
});

test('a new filter interval mutes again after the prior interval was overridden', () => {
  const video = new FakeVideo();
  const controller = new MuteController(video);
  controller.update(true);
  video.muted = false;
  controller.update(true);
  controller.update(false);
  controller.update(true);
  assert.equal(video.muted, true);
  controller.update(false);
  assert.equal(video.muted, false);
});

test('disabling filters before queued events arrive releases automatic mute', () => {
  const video = new FakeVideo();
  const controller = new MuteController(video);
  controller.update(true);
  controller.update(false);
  video.flushVolumeEvents();
  controller.update(false);
  assert.equal(video.muted, false);
  assert.equal(controller.userMuted, false);
});

test('seeking straight from an overridden interval to another interval applies mute again', () => {
  const video = new FakeVideo();
  const controller = new MuteController(video);
  controller.update(true, '6:10');
  video.muted = false;
  controller.update(true, '6:10');
  assert.equal(video.muted, false);
  controller.update(true, '24:28');
  assert.equal(video.muted, true);
  controller.update(false);
  assert.equal(video.muted, false);
});

test('mute set by the user before a filter interval is preserved after it', () => {
  const video = new FakeVideo();
  const controller = new MuteController(video);
  video.muted = true;
  video.flushVolumeEvents();
  controller.update(true);
  controller.update(false);
  assert.equal(video.muted, true);
});

test('destroy releases filter-owned mute', () => {
  const video = new FakeVideo();
  const controller = new MuteController(video);
  controller.update(true);
  controller.destroy();
  assert.equal(video.muted, false);
});

const intervals = parseSegments({ segments: [
  { id: 'b', start: 18, end: 25, type: 'both' },
  { id: 'a', start: 16, end: 22, type: 'both' },
  { id: 'c', start: 25, end: 28, type: 'skip' }
] });

test('interval start is inclusive and its end is exclusive', () => {
  assert.deepEqual(activeSegments(intervals, 15.99), []);
  assert.deepEqual(activeSegments(intervals, 16).map(segment => segment.id), ['a']);
  assert.deepEqual(activeSegments(intervals, 22).map(segment => segment.id), ['b']);
  assert.deepEqual(activeSegments(intervals, 28), []);
});

test('skip crosses overlapping and adjacent intervals and respects video duration', () => {
  assert.equal(skipTarget(intervals, 17), 28);
  assert.equal(skipTarget(intervals, 17, 26), 26);
  assert.equal(skipTarget(intervals, 15), 15);
  assert.equal(skipTarget(intervals, 28), 28);
});

test('overlapping and adjacent intervals share one manual-unmute window', () => {
  assert.equal(activeWindowKey(intervals, 17), '16:28');
  assert.equal(activeWindowKey(intervals, 23), '16:28');
  assert.equal(activeWindowKey(intervals, 26), '16:28');
  assert.equal(activeWindowKey(intervals, 15), null);
  assert.equal(activeWindowKey(intervals, 28), null);
});

test('malformed intervals are rejected instead of silently disabling protection', () => {
  const valid = { id: 'a', start: 16, end: 22, type: 'both' };
  for (const change of [{ end: 16 }, { start: -1 }, { start: '16' }, { type: 'invalid' }, { end: Infinity }]) {
    assert.throws(() => parseSegments({ segments: [{ ...valid, ...change }] }));
  }
  assert.throws(() => parseSegments({ segments: [valid, valid] }));
  assert.throws(() => parseSegments({}));
  assert.throws(() => parseSegments(null));
  assert.throws(() => parseSegments({ segments: 'invalid' }));
  assert.deepEqual(parseSegments({ segments: [] }), []);
});

test('unversioned segment files and legacy metadata both load without changing filter defaults', () => {
  const segment = { id: 'scene', start: 16, end: 22, type: 'mute', reason: '민감한 소리' };
  const current = parseSegments({ segments: [segment] });
  const legacy = parseSegments({ version: 1, segments: [{ ...segment, category: 'horror' }] });
  assert.equal(current[0].type, 'mute');
  assert.equal(legacy[0].type, 'mute');
  assert.deepEqual(activeSegments(current, 17).map(({ start, end }) => ({ start, end })),
    activeSegments(legacy, 17).map(({ start, end }) => ({ start, end })));
});

test('unversioned video catalogs load and preserve the demo display flag', async t => {
  const videos = [
    { id: 'demo', theme: 'horror', title: '체험 영상', src: 'assets/demo-video.mp4', segments: 'assets/sample-segments.json', demo: true },
    { id: 'regular', theme: 'horror', title: '일반 영상', src: 'assets/demo-video.mp4', segments: 'assets/sample-segments.json' }
  ];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'assets/videos.json');
    assert.equal(options.cache, 'no-store');
    return { ok: true, json: async () => ({ videos }) };
  });
  const loaded = await loadCatalog();
  assert.equal(loaded[0].demo, true);
  assert.equal(Boolean(loaded[1].demo), false);
});

test('every catalog entry has an existing video and its own sample-compatible JSON', async () => {
  const root = new URL('../', import.meta.url);
  const catalog = JSON.parse(await readFile(new URL('assets/videos.json', root), 'utf8'));
  const ids = new Set();
  const files = new Set();
  for (const video of catalog.videos) {
    assert.ok(!ids.has(video.id), 'video IDs must be unique');
    ids.add(video.id);
    assert.ok(['horror', 'violence', 'sexual'].includes(video.theme));
    assert.ok(!files.has(video.segments), 'each video needs its own intervals');
    files.add(video.segments);
    await access(new URL(video.src, root));
    const data = JSON.parse(await readFile(new URL(video.segments, root), 'utf8'));
    assert.ok(parseSegments(data).length > 0);
  }
  assert.deepEqual(new Set(catalog.videos.map(video => video.theme)), new Set(['horror', 'violence', 'sexual']));
  const sample = JSON.parse(await readFile(new URL('assets/sample-segments.json', root), 'utf8'));
  assert.equal(parseSegments(sample)[0].start, 16);
});


test('summary text survives parsing and legacy files get an empty default', () => {
  const valid = { id: 'a', start: 1.1, end: 2.3, type: 'skip', summary: '첫 줄\n둘째 줄 <b>요약</b>' };
  assert.equal(parseSegments({ segments: [valid] })[0].summary, valid.summary);
  assert.equal(parseSegments({ segments: [{ ...valid, summary: undefined }] })[0].summary, '');
  for (const summary of [null, 1, {}, []]) assert.throws(() => parseSegments({ segments: [{ ...valid, summary }] }));
});

test('skip summaries combine touching windows in chronological order without duplicates', () => {
  const items = parseSegments({ segments: [
    { id: 'c', start: 4, end: 6, type: 'blur', summary: '둘째 장면' },
    { id: 'a', start: 1, end: 3, type: 'skip', summary: ' 첫째 장면 ' },
    { id: 'b', start: 2, end: 4, type: 'mute', summary: '첫째 장면' },
    { id: 'd', start: 8, end: 9, type: 'skip', summary: '별도 구간' }
  ] });
  assert.deepEqual(skipWindow(items, 2), { start: 1, end: 6, summary: '첫째 장면\n\n둘째 장면' });
  assert.deepEqual(skipWindow(items, 4.5, 5), { start: 1, end: 5, summary: '첫째 장면\n\n둘째 장면' });
  assert.equal(skipWindow(items, .9), null);
  assert.equal(skipWindow(items, 6), null);
  assert.deepEqual(skipWindow(items, 8), { start: 8, end: 9, summary: '별도 구간' });
  assert.match(skipWindow([{ start: 1, end: 2, summary: '' }], 1).summary, /다음 장면/);
});
