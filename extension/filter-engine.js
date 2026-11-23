/* Shared by the isolated Netflix content script and the extension popup. */
(function (global) {
  'use strict';
  const KEY = 'movieGuardNetflix';
  const TYPES = ['blur', 'mute', 'both', 'skip'];
  function parseTime(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string' || !/^\d+(?:\.\d+)?(?::\d{1,2}(?:\.\d+)?){0,2}$/.test(value.trim())) return NaN;
    const parts = value.trim().split(':').map(Number);
    if (parts.slice(1).some(v => v >= 60) || parts.slice(0, -1).some(v => !Number.isInteger(v))) return NaN;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }
  function normalizeSegment(segment, index = 0) {
    if (!segment || typeof segment !== 'object') throw new Error(`${index + 1}번째 구간이 올바르지 않습니다.`);
    const start = parseTime(segment.start), end = parseTime(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error(`${index + 1}번째 구간의 시작·종료 시간을 확인해 주세요.`);
    if (!TYPES.includes(segment.type)) throw new Error(`${index + 1}번째 구간의 type은 blur, mute, both, skip 중 하나여야 합니다.`);
    if (segment.summary !== undefined && typeof segment.summary !== 'string') throw new Error(`${index + 1}번째 구간의 summary는 문자열이어야 합니다.`);
    return { id: String(segment.id || `scene-${index + 1}`), start, end, type: segment.type, reason: String(segment.reason || ''), summary: segment.summary ?? '' };
  }
  function normalizePayload(payload) {
    const list = Array.isArray(payload) ? payload : payload?.segments;
    if (!Array.isArray(list)) throw new Error('segments 배열이 포함된 JSON이 필요합니다.');
    if (list.length > 5000) throw new Error('한 작품에 최대 5,000개 구간을 등록할 수 있습니다.');
    const items = list.map(normalizeSegment);
    if (new Set(items.map(s => s.id)).size !== items.length) throw new Error('구간 id가 중복되었습니다.');
    return items.sort((a, b) => a.start - b.start || a.end - b.end);
  }
  function normalizeProfile(payload) {
    const offset = payload.offset === undefined ? 0 : Number(payload.offset);
    if (!Number.isFinite(offset)) throw new Error('시간 보정은 초 단위 숫자로 입력해 주세요.');
    const mode = payload.mode ?? 'segments';
    if (!['segments', ...TYPES].includes(mode)) throw new Error('필터 방식이 올바르지 않습니다.');
    return { title: String(payload.title || '이름 없는 구간'), offset, mode,
      mask: payload.mask === 'cover' ? 'cover' : 'blur', segments: normalizePayload(payload),
      duration: Number.isFinite(payload.duration) && payload.duration > 0 ? payload.duration : null };
  }
  function watchId(url) {
    try { const parsed = new URL(url); return /^\/watch\/(\d+)(?:\/|$)/.exec(parsed.pathname)?.[1] || null; } catch { return null; }
  }
  function readSettings(raw) {
    const profiles = Object.create(null);
    for (const [id, profile] of Object.entries(raw?.profiles || {})) {
      if (!/^\d+$/.test(id)) continue;
      try { profiles[id] = normalizeProfile(profile); } catch { /* Invalid imported/stored profiles never run. */ }
    }
    return { enabled: raw?.enabled !== false, profiles };
  }
  function intervals(segments, predicate) {
    const result = [];
    for (const item of segments.filter(predicate).sort((a, b) => a.start - b.start)) {
      const last = result[result.length - 1];
      if (last && item.start <= last.end) { last.end = Math.max(last.end, item.end); last.segments.push(item); }
      else result.push({ start: item.start, end: item.end, segments: [item] });
    }
    return result;
  }
  function summaryFor(segments) {
    return [...new Set(segments.map(s => (s.summary || '').trim()).filter(Boolean))].join('\n') || '이 구간의 장면을 건너뜁니다.';
  }
  function compile(profile) {
    const segments = profile.segments.map(s => ({ ...s, type: profile.mode === 'segments' ? s.type : profile.mode }));
    return { segments,
      muteWindows: intervals(segments, s => s.type === 'mute' || s.type === 'both'),
      skipWindows: intervals(segments, s => s.type === 'skip').map(w => ({ ...w, summary: summaryFor(w.segments) })) };
  }
  function stateAt(compiled, time) {
    const active = compiled.segments.filter(s => time >= s.start && time < s.end);
    const mute = compiled.muteWindows.find(s => time >= s.start && time < s.end);
    return { active, mute: Boolean(mute), muteKey: mute ? `${mute.start}:${mute.end}` : null,
      blur: active.some(s => s.type === 'blur' || s.type === 'both'),
      skip: compiled.skipWindows.find(s => time >= s.start && time < s.end) || null };
  }
  class MuteController {
    constructor(video) {
      this.video = video; this.userMuted = video.muted; this.lastKnownMuted = video.muted;
      this.filterActive = false; this.windowKey = null; this.overridden = false;
      this.onVolume = () => this.readUserChange();
      video.addEventListener('volumechange', this.onVolume);
    }
    readUserChange() {
      const muted = this.video.muted;
      if (muted === this.lastKnownMuted) return;
      this.userMuted = muted; this.lastKnownMuted = muted;
      if (this.filterActive) this.overridden = !muted;
    }
    update(active, key = null) {
      this.readUserChange();
      if (this.filterActive !== active || (active && this.windowKey !== key)) this.overridden = false;
      this.filterActive = active; this.windowKey = active ? key : null;
      const muted = this.userMuted || (active && !this.overridden);
      this.lastKnownMuted = muted;
      if (this.video.muted !== muted) this.video.muted = muted;
      return muted;
    }
    unmute() {
      this.userMuted = false; this.overridden = this.filterActive; this.lastKnownMuted = false;
      this.video.muted = false;
    }
    destroy() { this.update(false); this.video.removeEventListener('volumechange', this.onVolume); }
  }
  function formatTime(time) {
    if (!Number.isFinite(time)) return '—';
    const tenths = Math.round(Math.abs(time) * 10), seconds = Math.floor(tenths / 10);
    return `${time < 0 ? '-' : ''}${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${tenths % 10}`;
  }
  global.MovieGuardEngine = { KEY, TYPES, parseTime, normalizeSegment, normalizePayload, normalizeProfile, watchId, readSettings, compile, stateAt, summaryFor, MuteController, formatTime };
})(typeof window !== 'undefined' ? window : globalThis);
