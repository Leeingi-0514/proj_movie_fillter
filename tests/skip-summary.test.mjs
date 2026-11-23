import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../extension/skip-summary.js', import.meta.url), 'utf8');
const context = vm.createContext({ setTimeout, clearTimeout }); vm.runInContext(source, context);
const { SkipSummaryController } = context.MovieGuardSkipSummary;
class Clock {
  constructor() { this.now = 0; this.next = 0; this.timers = new Map(); }
  set = (fn, ms) => { const id = ++this.next; this.timers.set(id, { at: this.now + ms, fn }); return id; };
  clear = id => this.timers.delete(id);
  advance(ms) {
    const end = this.now + ms;
    for (;;) {
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at).find(([, t]) => t.at <= end);
      if (!next) break;
      this.now = next[1].at; this.timers.delete(next[0]); next[1].fn();
    }
    this.now = end;
  }
}
class Media extends EventTarget {
  constructor({ paused = false, duration = 30 } = {}) {
    super(); this.paused = paused; this.duration = duration; this.ended = false;
    this.isConnected = true; this.seeking = false; this.time = 2; this.plays = 0;
    this.seeks = []; this.rejectPlay = false; this.throwSeek = false; this.pendingSeek = false;
  }
  get currentTime() { return this.time; }
  set currentTime(value) {
    if (this.throwSeek) throw new Error('blocked');
    this.seeks.push(value); this.time = value; this.seeking = true;
    this.dispatchEvent(new Event('seeking'));
    if (!this.pendingSeek) this.completeSeek();
  }
  completeSeek() { this.seeking = false; this.dispatchEvent(new Event('seeked')); }
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')); } }
  play() { this.plays++; this.paused = false; this.dispatchEvent(new Event('play')); return this.rejectPlay ? Promise.reject(new Error('denied')) : Promise.resolve(); }
}
function setup(options = {}) {
  const clock = new Clock(), states = [], errors = [];
  const controller = new SkipSummaryController({ setTimer: clock.set, clearTimer: clock.clear,
    onShow: s => states.push(s.phase), onHide: () => states.push('hidden'), onError: e => errors.push(e), ...options });
  const video = new Media();
  return { clock, controller, video, states, errors };
}
const window = { start: 1, end: 5, summary: '중요한 대화가 이어집니다.', contextKey: '101' };
test('skip holds playback for three seconds before seeking and resuming', () => {
  const { clock, controller: c, video: v, states } = setup();
  c.start(v, window); assert.equal(v.paused, true); assert.equal(c.active.summary, window.summary);
  clock.advance(2999); assert.equal(v.currentTime, 2); assert.equal(v.plays, 0);
  clock.advance(1); assert.equal(v.currentTime, 5); assert.equal(v.paused, false); assert.equal(v.plays, 1);
  assert.equal(c.active, null); assert.deepEqual(states, ['holding', 'seeking', 'hidden']); assert.equal(clock.timers.size, 0);
});
test('a video that was already paused remains paused after the summary', () => {
  const { clock, controller: c, video: v } = setup(); v.paused = true;
  c.start(v, window); clock.advance(3000); assert.equal(v.currentTime, 5); assert.equal(v.paused, true); assert.equal(v.plays, 0);
});
test('reentrant pause listeners cannot start multiple summaries', () => {
  const { clock, controller: c, video: v } = setup(); let attempts = 0;
  v.addEventListener('pause', () => { attempts++; assert.equal(c.start(v, window), false); c.sync(v, '101'); });
  assert.equal(c.start(v, window), true); assert.equal(attempts, 1); assert.equal(clock.timers.size, 1);
  clock.advance(3000); assert.deepEqual(v.seeks, [5]); assert.equal(v.plays, 1);
});
test('the black summary stays up until the native seek completes', () => {
  const { clock, controller: c, video: v, states } = setup(); v.pendingSeek = true;
  c.start(v, window); clock.advance(3000);
  assert.equal(c.active.phase, 'seeking'); assert.equal(v.paused, true); assert.ok(!states.includes('hidden'));
  v.completeSeek(); assert.equal(c.active, null); assert.equal(v.plays, 1); assert.equal(clock.timers.size, 0);
});
test('a merged overlapping window uses its supplied final end once', () => {
  const { clock, controller: c, video: v } = setup();
  c.start(v, { ...window, end: 12, summary: '첫 장면 요약\n두 번째 장면 요약' }); clock.advance(3000);
  assert.deepEqual(v.seeks, [12]); assert.equal(c.active, null);
});
test('late completion after a Netflix route change never seeks or resumes the old video', () => {
  let current = true; const { clock, controller: c, video: v } = setup();
  c.start(v, { ...window, isCurrent: () => current }); current = false; clock.advance(3000);
  assert.deepEqual(v.seeks, []); assert.equal(v.plays, 0); assert.equal(c.active, null);
});
test('changing context or replacing video cancels all pending work without autoplay', () => {
  for (const change of ['context', 'video']) {
    const { clock, controller: c, video: v } = setup(); c.start(v, window);
    c.sync(change === 'video' ? new Media() : v, change === 'context' ? '202' : '101'); clock.advance(10000);
    assert.equal(c.active, null); assert.equal(v.plays, 0); assert.deepEqual(v.seeks, []); assert.equal(clock.timers.size, 0);
  }
});
test('manually seeking away cancels the hold and preserves original playing intent', () => {
  const { clock, controller: c, video: v } = setup(); c.start(v, window);
  v.currentTime = 9; assert.equal(c.active, null); assert.equal(v.plays, 1);
  clock.advance(5000); assert.deepEqual(v.seeks, [9]);
});
test('manual seek out of a paused summary does not start playback', () => {
  const { clock, controller: c, video: v } = setup(); v.paused = true; c.start(v, window);
  v.currentTime = 9; clock.advance(5000); assert.equal(v.plays, 0); assert.equal(c.active, null);
});
test('play during the presentation stays paused, then resumes at the skip end', async () => {
  const { clock, controller: c, video: v } = setup(); v.paused = true; c.start(v, window);
  await v.play(); assert.equal(v.paused, true); assert.equal(c.active.resume, true);
  clock.advance(3000); assert.equal(v.currentTime, 5); assert.equal(v.paused, false);
});
test('filter-off cancellation restores original playback but cannot leave a seek timer', () => {
  const { clock, controller: c, video: v } = setup(); c.start(v, window); c.cancel({ resume: true }); clock.advance(10000);
  assert.equal(v.paused, false); assert.deepEqual(v.seeks, []); assert.equal(clock.timers.size, 0);
});
test('destroy cancels listeners and timers and prevents starting again', () => {
  const { clock, controller: c, video: v } = setup(); c.start(v, window); c.destroy(); clock.advance(10000);
  assert.equal(c.active, null); assert.equal(v.plays, 0); assert.equal(c.start(v, window), false);
  v.play(); assert.equal(v.paused, false); assert.equal(clock.timers.size, 0);
});
test('skip to media end remains paused instead of autoplaying credits or replay', () => {
  const { clock, controller: c, video: v } = setup(); v.duration = 4;
  c.start(v, window); clock.advance(3000); assert.equal(v.currentTime, 4); assert.equal(v.plays, 0); assert.equal(v.paused, true);
});
test('seek failure holds a black error state rather than restarting a timer loop', () => {
  const { clock, controller: c, video: v, errors } = setup(); v.throwSeek = true;
  c.start(v, window); clock.advance(3000); assert.equal(c.active.phase, 'error'); assert.equal(v.paused, true); assert.equal(errors.length, 1);
  clock.advance(20000); assert.equal(clock.timers.size, 0); assert.equal(c.start(v, window), false); assert.equal(v.plays, 0);
  c.cancel(); assert.equal(c.active, null);
});
test('a stalled seek fails visibly and never resumes in the wrong scene', () => {
  const { clock, controller: c, video: v, errors } = setup(); v.pendingSeek = true;
  c.start(v, window); clock.advance(8000); assert.equal(c.active.phase, 'error'); assert.equal(errors.length, 1); assert.equal(v.plays, 0);
  clock.advance(20000); assert.equal(errors.length, 1); assert.equal(clock.timers.size, 0);
});
test('rejected native play promises are consumed after completion', async () => {
  const { clock, controller: c, video: v } = setup(); v.rejectPlay = true;
  c.start(v, window); clock.advance(3000); await Promise.resolve(); assert.equal(c.active, null); assert.equal(v.plays, 1);
});
test('invalid windows and disconnected videos cannot complete a delayed skip', () => {
  const { clock, controller: c, video: v } = setup();
  assert.equal(c.start(v, { ...window, end: 1 }), false); c.start(v, window); v.isConnected = false; clock.advance(3000);
  assert.equal(c.active, null); assert.deepEqual(v.seeks, []); assert.equal(v.plays, 0);
});

test('a seek landing just before the target stays covered until the actual end is reached', () => {
  const { clock, controller: c, video: v, states } = setup(); v.pendingSeek = true;
  c.start(v, { ...window, end: 15 }); clock.advance(3000);
  v.time = 14.98; v.completeSeek();
  assert.equal(c.active.phase, 'seeking'); assert.equal(v.paused, true); assert.equal(v.plays, 0);
  assert.ok(!states.includes('hidden'));
  clock.advance(1000); assert.equal(c.active.phase, 'seeking');
  v.time = 15; v.completeSeek();
  assert.equal(c.active, null); assert.equal(v.currentTime, 15); assert.equal(v.plays, 1);
  assert.equal(clock.timers.size, 0);
});
test('a provider refusing to reach the end fails covered and cannot cancel through rounding', () => {
  const { clock, controller: c, video: v, states, errors } = setup(); v.pendingSeek = true; v.time = 14.995;
  c.start(v, { ...window, start: 14.99, end: 15 }); clock.advance(3000);
  v.time = 14.98; v.completeSeek(); clock.advance(5000);
  assert.equal(c.active.phase, 'error'); assert.equal(errors.length, 1); assert.equal(v.plays, 0);
  assert.equal(c.sync(v, '101'), true); assert.equal(c.active.phase, 'error');
  assert.ok(!states.includes('hidden')); assert.equal(clock.timers.size, 0);
});
