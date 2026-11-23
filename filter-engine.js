export const filterLabels = Object.freeze({ blur: '블러', mute: '음소거', both: '블러 + 음소거', skip: '스킵' });

export function parseSegments(data) {
  if (!data || !Array.isArray(data.segments)) {
    throw new Error('필터 구간 파일의 형식을 확인해 주세요.');
  }
  const ids = new Set();
  const segments = data.segments.map(segment => {
    if (!segment || typeof segment.id !== 'string' || !segment.id || ids.has(segment.id)
      || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)
      || segment.start < 0 || segment.end <= segment.start
      || !Object.hasOwn(filterLabels, segment.type)
      || (segment.summary !== undefined && typeof segment.summary !== 'string')) {
      throw new Error('필터 구간의 ID, 시작·종료 시간, 필터 종류와 요약 문자열을 확인해 주세요.');
    }
    ids.add(segment.id);
    return { ...segment, summary: segment.summary ?? '' };
  });
  return segments.sort((a, b) => a.start - b.start);
}

export function activeSegments(segments, time) {
  return segments.filter(segment => time >= segment.start && time < segment.end);
}

// A manual unmute belongs to one continuous interval, including its overlaps.
export function activeWindowKey(segments, time) {
  let window = null;
  for (const segment of segments) {
    if (!window || segment.start > window.end) {
      if (window && time >= window.start && time < window.end) return `${window.start}:${window.end}`;
      window = { start: segment.start, end: segment.end };
    } else {
      window.end = Math.max(window.end, segment.end);
    }
  }
  return window && time >= window.start && time < window.end ? `${window.start}:${window.end}` : null;
}

// Include overlapping and adjacent intervals so skipping never lands in another filtered interval.
export function skipTarget(segments, time, duration = Infinity) {
  let target = time;
  for (const segment of segments) {
    if (segment.start <= target && segment.end > target) target = segment.end;
  }
  return Math.min(target, Number.isFinite(duration) ? duration : Infinity);
}

// One summary card covers the complete continuous skip window, including adjacent intervals.
export function skipWindow(segments, time, duration = Infinity) {
  let window = null;
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    if (!window || segment.start > window.end) {
      if (window && time >= window.start && time < window.end) break;
      window = { start: segment.start, end: segment.end, segments: [segment] };
    } else {
      window.end = Math.max(window.end, segment.end);
      window.segments.push(segment);
    }
  }
  if (!window || time < window.start || time >= window.end) return null;
  const summary = [...new Set(window.segments.map(segment => segment.summary?.trim()).filter(Boolean))].join('\n\n');
  return { start: window.start, end: Math.min(window.end, Number.isFinite(duration) ? duration : Infinity),
    summary: summary || '이 구간을 건너뛰고 다음 장면으로 이동합니다.' };
}

export class MuteController {
  constructor(video) {
    this.video = video;
    this.userMuted = video.muted;
    this.lastKnownMuted = video.muted;
    this.filterActive = false;
    this.windowKey = null;
    this.overridden = false;
    this.onVolumeChange = () => this.readUserChange();
    video.addEventListener('volumechange', this.onVolumeChange);
  }

  readUserChange() {
    const muted = this.video.muted;
    if (muted === this.lastKnownMuted) return;
    this.userMuted = muted;
    this.lastKnownMuted = muted;
    if (this.filterActive) this.overridden = !muted;
  }

  update(shouldMute, windowKey = null) {
    // Also read before every update: a native control may change muted before its event is delivered.
    this.readUserChange();
    if (this.filterActive !== shouldMute || (shouldMute && this.windowKey !== windowKey)) {
      this.filterActive = shouldMute;
      this.overridden = false;
    }
    this.windowKey = shouldMute ? windowKey : null;
    const muted = this.userMuted || (shouldMute && !this.overridden);
    // volumechange is asynchronous. Remember the value, rather than clearing a flag in a microtask.
    this.lastKnownMuted = muted;
    if (this.video.muted !== muted) this.video.muted = muted;
    return muted;
  }

  destroy() {
    this.update(false);
    this.video.removeEventListener('volumechange', this.onVolumeChange);
  }
}
