import test from 'node:test';
import assert from 'node:assert/strict';
import { getContentFrame, calculateVideoLayout } from '../video-layout.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.001, `${actual} != ${expected}`);
const portrait = { x: 0, y: 734, width: 1080, height: 452 };

test('portrait recording displays the movie area instead of the large recorded black margins', () => {
  const layout = calculateVideoLayout(1080, 1920, 1080, 452, portrait);
  assert.deepEqual(layout, { width: 1080, height: 1920, left: 0, top: -734 });
});

test('the visible movie fills desktop, mobile, and fullscreen without stretching', () => {
  for (const [width, height] of [[1038, 434.4], [360, 150.7], [1920, 1080], [390, 844]]) {
    const layout = calculateVideoLayout(1080, 1920, width, height, portrait);
    const scale = layout.width / 1080;
    close(layout.height / 1920, scale);
    assert.ok(layout.left + portrait.x * scale <= 0.001);
    assert.ok(layout.top + portrait.y * scale <= 0.001);
    assert.ok(layout.left + (portrait.x + portrait.width) * scale >= width - 0.001);
    assert.ok(layout.top + (portrait.y + portrait.height) * scale >= height - 0.001);
  }
});

test('ordinary widescreen video also fills fullscreen while preserving its ratio', () => {
  const layout = calculateVideoLayout(1920, 1080, 1024, 768);
  close(layout.height, 768);
  close(layout.width / layout.height, 1920 / 1080);
  assert.ok(layout.left < 0);
  close(layout.top, 0);
});

test('letterboxed widescreen video can remove its encoded top and bottom margins', () => {
  const layout = calculateVideoLayout(1280, 720, 1280, 540, { x: 0, y: 90, width: 1280, height: 540 });
  close(layout.top, -90);
  close(layout.width, 1280);
  close(layout.height, 720);
});

test('invalid crop data falls back to the full source instead of moving the picture out of view', () => {
  for (const frame of [{ ...portrait, y: -1 }, { ...portrait, height: 0 }, { ...portrait, width: 2000 },
    { ...portrait, x: NaN }, {}, { ...portrait, width: '1080' }]) {
    assert.deepEqual(getContentFrame(1080, 1920, frame), { x: 0, y: 0, width: 1080, height: 1920 });
  }
});

test('layout waits for media metadata and a nonzero player size', () => {
  assert.equal(calculateVideoLayout(0, 0, 1040, 585), null);
  assert.equal(calculateVideoLayout(1920, 1080, 0, 0), null);
  assert.equal(getContentFrame(Infinity, 1080), null);
});
