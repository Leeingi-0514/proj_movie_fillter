import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../extension/filter-engine.js', import.meta.url), 'utf8');
const context = vm.createContext({ URL }); vm.runInContext(source, context);
const E = context.MovieGuardEngine;
const segment = (start, end, type = 'both', id = `${start}-${end}`) => ({ id, start, end, type });
class Video extends EventTarget {
  constructor(muted = false) { super(); this.value = muted; this.pending = 0; }
  get muted() { return this.value; }
  set muted(value) { if (this.value !== value) { this.value = value; this.pending++; } }
  flush() { while (this.pending) { this.pending--; this.dispatchEvent(new Event('volumechange')); } }
}
test('extension reads tenth-second and hour timestamps, rejects malformed times', () => {
  assert.equal(E.parseTime('1:02.3'), 62.3); assert.equal(E.parseTime('1:02:03.4'), 3723.4);
  assert.equal(E.parseTime(0.1), .1);
  for (const value of ['', null, '1:60', '1.2:30', '-1', true]) assert.ok(Number.isNaN(E.parseTime(value)));
  assert.throws(() => E.normalizePayload({ segments: [segment(1, 1)] }));
  assert.throws(() => E.normalizePayload([segment(1, 2, 'bad')]));
  assert.throws(() => E.normalizePayload([segment(1, 2, 'blur', 'a'), segment(2, 3, 'blur', 'a')]));
});
test('extension boundaries, offsets and mixed types have precise semantics', () => {
  const p = E.normalizeProfile({ offset: 100.1, segments: [segment(.1, .3, 'blur'), segment(.2, .4, 'mute')] });
  const c = E.compile(p);
  assert.equal(E.stateAt(c, .099).blur, false); assert.equal(E.stateAt(c, .1).blur, true);
  assert.equal(E.stateAt(c, .3).blur, false); assert.equal(E.stateAt(c, .3).mute, true);
  assert.equal(E.stateAt(c, .4).mute, false);
  const state = E.stateAt(c, 100.35 - p.offset); assert.equal(state.blur, true); assert.equal(state.mute, true);
});
test('override mode and chained skip intervals work', () => {
  const c = E.compile(E.normalizeProfile({ mode: 'skip', segments: [segment(1, 3, 'blur'), segment(2, 4, 'mute'), segment(4, 5), segment(7, 8)] }));
  assert.equal(E.stateAt(c, 2).skip.end, 5); assert.equal(E.stateAt(c, 5).skip, null);
});
test('only touching mute windows share a manual-unmute override', () => {
  const c = E.compile(E.normalizeProfile({ segments: [segment(1, 3, 'mute'), segment(2, 4, 'both'), segment(3, 9, 'blur'), segment(8, 10, 'mute')] }));
  assert.equal(E.stateAt(c, 2).muteKey, '1:4'); assert.equal(E.stateAt(c, 9).muteKey, '8:10');
});
test('settings are scoped to exact numeric Netflix episode IDs and invalid profiles are ignored', () => {
  const s = E.readSettings({ profiles: { 101: { segments: [segment(1, 2)] }, 102: { segments: [segment(2, 1)] }, title: { segments: [] } } });
  assert.ok(s.profiles['101']); assert.equal(s.profiles['102'], undefined); assert.equal(s.profiles.title, undefined);
  assert.equal(E.watchId('https://www.netflix.com/watch/101?x=1'), '101');
  assert.equal(E.watchId('https://www.netflix.com/browse'), null);
  assert.equal(E.watchId('https://www.netflix.com/watch/101abc'), null);
  assert.equal(E.normalizeProfile({ segments: [], offset: -2.1 }).offset, -2.1);
  assert.throws(() => E.normalizeProfile({ segments: [], offset: 'bad' }));
});
test('extension mute releases after asynchronously delivered engine volume events', () => {
  const v = new Video(), m = new E.MuteController(v);
  m.update(true, '1:2'); v.flush(); assert.equal(v.muted, true);
  m.update(false); v.flush(); assert.equal(v.muted, false); m.destroy();
});
test('manual unmute lasts in current window and resets on a direct seek to another', () => {
  const v = new Video(), m = new E.MuteController(v);
  m.update(true, '1:2'); v.flush(); v.muted = false; v.flush();
  m.update(true, '1:2'); assert.equal(v.muted, false);
  m.update(true, '4:5'); assert.equal(v.muted, true);
  m.unmute(); m.update(true, '4:5'); assert.equal(v.muted, false);
  m.update(false); m.update(true, '4:5'); assert.equal(v.muted, true);
  m.destroy(); v.flush(); assert.equal(v.muted, false);
});
test('existing user mute survives filter exit and destroy', () => {
  const v = new Video(true), m = new E.MuteController(v);
  m.update(true, '1:2'); m.update(false); m.destroy(); assert.equal(v.muted, true);
});
test('all seven bundled presets validate; no movie data is shipped', async () => {
  const data = JSON.parse(await readFile(new URL('../extension/data/library.json', import.meta.url)));
  assert.equal(data.profiles.length, 7);
  for (const p of data.profiles) { assert.ok(E.normalizeProfile(p).segments.length); assert.equal(p.src, undefined); for (const s of p.segments) assert.ok(typeof s.summary === 'string' && s.summary.trim()); }
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url)));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab']);
  assert.ok(manifest.content_scripts.every(s => s.matches.every(url => url.startsWith('https://') && url.includes('netflix.com/'))));
});

test('subtitle runtime loads before the content script and all manifest scripts exist', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url)));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.indexOf('skip-summary.js') >= 0 && scripts.indexOf('skip-summary.js') < scripts.indexOf('content.js'));
  assert.ok(scripts.indexOf('subtitles.js') >= 0 && scripts.indexOf('subtitles.js') < scripts.indexOf('content.js'));
  for (const script of scripts) assert.ok((await readFile(new URL(`../extension/${script}`, import.meta.url))).length);
});

test('summary is preserved through Netflix normalization and profile storage; old files remain compatible', () => {
  const text = '<b>이 문장은 태그가 아닌 요약입니다.</b>\n두 번째 줄';
  const item = { ...segment(1, 3, 'skip'), summary: text };
  const p = E.normalizeProfile({ segments: [item] });
  assert.equal(p.segments[0].summary, text);
  assert.equal(E.readSettings({ profiles: { 101: p } }).profiles[101].segments[0].summary, text);
  assert.equal(E.normalizePayload([segment(1, 2)])[0].summary, '');
  assert.throws(() => E.normalizePayload([{ ...item, summary: 1 }]), /summary/);
});
test('merged skip windows combine summary in order without duplicate text', () => {
  const c = E.compile(E.normalizeProfile({ mode: 'skip', segments: [
    { ...segment(1, 3, 'blur', 'a'), summary: '첫 장면' },
    { ...segment(2, 4, 'mute', 'b'), summary: '다음 장면' },
    { ...segment(4, 5, 'blur', 'c'), summary: '첫 장면' }
  ] }));
  assert.equal(E.stateAt(c, 2).skip.summary, '첫 장면\n다음 장면');
  assert.equal(E.stateAt(c, 2).skip.end, 5);
  assert.ok(E.compile(E.normalizeProfile({ mode: 'skip', segments: [segment(1, 2)] })).skipWindows[0].summary.length);
});
