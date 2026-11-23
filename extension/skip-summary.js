/* A playback pause owned only by the current skip summary, not by later videos. */
(function (global) {
  'use strict';
  const EPSILON = 0.05;
  class SkipSummaryController {
    constructor({ onShow = () => {}, onHide = () => {}, onError = () => {}, delayMs = 3000,
      setTimer = (fn, ms) => global.setTimeout(fn, ms), clearTimer = id => global.clearTimeout(id) } = {}) {
      this.onShow = onShow; this.onHide = onHide; this.onError = onError;
      this.delayMs = delayMs; this.setTimer = setTimer; this.clearTimer = clearTimer;
      this.active = null; this.epoch = 0; this.destroyed = false;
    }
    start(video, { start, end, summary = '', contextKey = null, isCurrent = () => true } = {}) {
      if (this.destroyed || this.active || !video || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
      const session = { video, start, end, summary: String(summary || ''), contextKey, isCurrent,
        phase: 'holding', resume: !video.paused && !video.ended, target: null, error: null,
        holdTimer: null, seekTimer: null, listeners: [] };
      // pause() may synchronously cause the caller's pause listener to run applyFilters again.
      this.active = session; this.epoch++;
      const sync = () => this.sync(video, contextKey);
      const stopPlay = () => {
        if (this.active !== session) return;
        session.resume = true;
        video.pause();
      };
      for (const [name, callback] of [['play', stopPlay], ['seeking', sync], ['seeked', sync], ['timeupdate', sync]]) {
        video.addEventListener(name, callback); session.listeners.push([name, callback]);
      }
      this.onShow(session);
      if (this.active !== session) return true;
      video.pause();
      if (this.active === session) session.holdTimer = this.setTimer(() => this.seek(session), this.delayMs);
      return true;
    }
    isCurrent(session) {
      if (this.active !== session || session.video.isConnected === false) return false;
      try { return session.isCurrent() !== false; } catch { return false; }
    }
    sync(video, contextKey) {
      const session = this.active;
      if (!session) return false;
      if (video !== session.video || contextKey !== session.contextKey || !this.isCurrent(session)) {
        this.cancel(); return false;
      }
      if (session.phase === 'seeking') {
        const overshoot = video.currentTime - session.target;
        // A seek slightly BEFORE end is still inside the filtered scene. Keep it covered.
        if (!video.seeking && overshoot >= 0 && overshoot <= EPSILON) this.finish(session);
      } else {
        const outside = video.currentTime < session.start || video.currentTime >= session.end;
        // A user seek away cancels the presentation. A failed internal seek near target
        // (on either side, including a rounded position before end) stays covered.
        if (outside && (session.phase === 'holding' || Math.abs(video.currentTime - session.target) > EPSILON)) {
          this.cancel({ resume: true }); return false;
        }
      }
      return this.active === session;
    }
    seek(session) {
      session.holdTimer = null;
      if (!this.isCurrent(session)) { if (this.active === session) this.cancel(); return; }
      const video = session.video;
      if (video.currentTime < session.start || video.currentTime >= session.end) { this.cancel({ resume: true }); return; }
      session.phase = 'seeking';
      session.target = Math.min(session.end, Number.isFinite(video.duration) ? video.duration : Infinity);
      this.onShow(session);
      if (this.active !== session) return;
      session.seekTimer = this.setTimer(() => this.fail(session, '스킵하지 못했어요. 재생 위치를 옮기거나 필터를 꺼 주세요.'), 5000);
      try {
        video.currentTime = session.target;
        this.sync(video, session.contextKey);
      } catch {
        this.fail(session, '스킵하지 못했어요. 재생 위치를 옮기거나 필터를 꺼 주세요.');
      }
    }
    fail(session, message) {
      if (this.active !== session) return;
      if (!this.isCurrent(session)) { this.cancel(); return; }
      if (session.seekTimer !== null) this.clearTimer(session.seekTimer);
      session.seekTimer = null; session.phase = 'error'; session.error = message;
      session.video.pause(); this.onShow(session); this.onError(message);
    }
    release(session) {
      for (const timer of [session.holdTimer, session.seekTimer]) if (timer !== null) this.clearTimer(timer);
      for (const [name, callback] of session.listeners) session.video.removeEventListener(name, callback);
      session.listeners = []; this.active = null; this.epoch++;
      const epoch = this.epoch;
      this.onHide();
      return epoch;
    }
    resume(session, epoch) {
      const video = session.video;
      if (!session.resume || this.active || this.epoch !== epoch || video.isConnected === false || video.ended
        || (Number.isFinite(video.duration) && video.currentTime >= video.duration)) return;
      try {
        const promise = video.play();
        if (promise && typeof promise.catch === 'function') promise.catch(() => {});
      } catch { /* Native controls remain available when the browser rejects playback. */ }
    }
    finish(session) {
      if (!this.isCurrent(session)) { if (this.active === session) this.cancel(); return; }
      const epoch = this.release(session);
      this.resume(session, epoch);
    }
    cancel({ resume = false } = {}) {
      const session = this.active;
      if (!session) return;
      const epoch = this.release(session);
      if (resume) this.resume(session, epoch);
    }
    destroy() { this.destroyed = true; this.cancel(); }
  }
  global.MovieGuardSkipSummary = { SkipSummaryController };
})(typeof window !== 'undefined' ? window : globalThis);
