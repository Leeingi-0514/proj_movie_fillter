(() => {
  'use strict';
  const E = MovieGuardEngine, CLASS = 'movieguard-netflix-blur';
  const subtitles = new MovieGuardSubtitles();
  let settings = E.readSettings(), id = null, video = null, mute = null, profile = null, compiled = null;
  let frame = null, timer = null, stopped = false, updatingSettings = false;
  const style = document.createElement('style');
  style.textContent = `video.${CLASS}{filter:blur(32px)!important}#movieguard-netflix-cover{position:fixed!important;background:#000!important;z-index:2147483646!important;pointer-events:none!important}#movieguard-netflix-badge{position:fixed!important;top:20px!important;left:20px!important;z-index:2147483647!important;padding:9px 12px!important;border-radius:8px!important;background:#10251fee!important;color:#e1f797!important;font:600 12px/1.4 system-ui!important;pointer-events:none!important}`;
  document.documentElement.appendChild(style);
  const badge = document.createElement('div'); badge.id = 'movieguard-netflix-badge';
  const cover = document.createElement('div'); cover.id = 'movieguard-netflix-cover';
  cover.setAttribute('aria-hidden', 'true');

  const summaryScreen = document.createElement('div'); summaryScreen.id = 'movieguard-netflix-skip-summary';
  summaryScreen.setAttribute('role', 'status'); summaryScreen.setAttribute('aria-live', 'polite');
  summaryScreen.style.cssText = 'position:fixed!important;z-index:2147483647!important;background:#000!important;color:#fff!important;display:flex!important;align-items:center!important;justify-content:center!important;pointer-events:none!important;overflow:hidden!important;box-sizing:border-box!important;';
  const summaryShadow = summaryScreen.attachShadow({ mode: 'open' });
  summaryShadow.innerHTML = `<style>:host{font-family:system-ui,sans-serif}section{box-sizing:border-box;width:100%;max-height:100%;padding:6%;text-align:center}small{color:#d9f568;font-size:12px;letter-spacing:.12em}h2{font-size:clamp(16px,3vw,24px);margin:14px 0}p{font-size:clamp(16px,2.6vw,23px);line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;max-height:45vh;overflow:auto;pointer-events:auto}footer{color:#aaa;font-size:12px;margin-top:18px}</style><section><small>MOVIEGUARD · SKIP</small><h2>건너뛸 장면의 요약</h2><p></p><footer></footer></section>`;
  function renderSummary(session) {
    if (!session || session.video !== video) return;
    const rect = video.getBoundingClientRect(), parent = document.fullscreenElement || document.documentElement;
    if (summaryScreen.parentNode !== parent) parent.appendChild(summaryScreen);
    for (const [property, value] of Object.entries({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })) summaryScreen.style.setProperty(property, `${value}px`, 'important');
    summaryShadow.querySelector('p').textContent = session.summary;
    summaryShadow.querySelector('footer').textContent = session.error || (session.phase === 'seeking' ? '구간 끝으로 이동 중입니다.' : '약 3초 뒤 구간 끝으로 이동합니다.');
  }
  const skipSummary = new MovieGuardSkipSummary.SkipSummaryController({ onShow: renderSummary, onHide: () => summaryScreen.remove() });

  function showBadge(text) {
    if (!text) { badge.remove(); return; }
    const parent = document.fullscreenElement || document.documentElement;
    if (badge.parentNode !== parent) parent.appendChild(badge);
    const value = `MovieGuard · ${text}`;
    if (badge.textContent !== value) badge.textContent = value;
  }
  function clearEffects({ resumeSummary = true } = {}) {
    skipSummary.cancel({ resume: resumeSummary }); subtitles.clear(); video?.classList.remove(CLASS); cover.remove(); mute?.update(false); showBadge('');
  }
  const events = ['timeupdate', 'seeking', 'seeked', 'loadedmetadata', 'durationchange', 'play', 'pause', 'ended'];
  function detach() {
    clearEffects({ resumeSummary: false });
    if (video) for (const event of events) video.removeEventListener(event, apply);
    mute?.destroy(); mute = null; video = null;
  }
  function attach(next) {
    if (next === video) return;
    detach(); video = next;
    if (!video) return;
    mute = new E.MuteController(video);
    for (const event of events) video.addEventListener(event, apply);
  }
  function chooseVideo() {
    return [...document.querySelectorAll('video')].filter(v => {
      const rect = v.getBoundingClientRect(), css = getComputedStyle(v);
      return v.isConnected && rect.width > 100 && rect.height > 60 && css.display !== 'none' && css.visibility !== 'hidden';
    }).sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    })[0] || null;
  }
  function updateProfile() {
    profile = id ? settings.profiles[id] || null : null;
    compiled = profile ? E.compile(profile) : null;
  }
  function scan() {
    const nextId = E.watchId(location.href);
    if (nextId !== id) { detach(); id = nextId; updateProfile(); }
    attach(id ? chooseVideo() : null);
    apply();
  }
  function durationMatches() {
    return !profile?.duration || !Number.isFinite(video?.duration) || Math.abs(profile.duration - video.duration) <= 3;
  }
  function apply() {
    if (updatingSettings) return;
    // Do not keep a previous episode's effects during a single-page navigation.
    const currentId = E.watchId(location.href);
    if (currentId !== id) { detach(); id = currentId; updateProfile(); attach(id ? chooseVideo() : null); }
    if (video && !video.isConnected) attach(id ? chooseVideo() : null);
    if (!video || !id || !settings.enabled || !profile || !compiled || !durationMatches()) {
      clearEffects();
      if (id && video) showBadge(!settings.enabled ? '꺼짐' : !profile ? '이 작품의 구간을 연결해 주세요' : '영상 길이가 달라 필터 대기 중');
      return;
    }
    skipSummary.sync(video, id);
    const state = E.stateAt(compiled, video.currentTime - profile.offset);
    if (!skipSummary.active && state.skip && video.readyState > 0 && !video.seeking) {
      const currentVideo = video, currentProfile = profile, currentId = id;
      skipSummary.start(video, { start: state.skip.start + profile.offset,
        end: Math.min(state.skip.end + profile.offset, Number.isFinite(video.duration) ? video.duration : Infinity),
        summary: state.skip.summary, contextKey: id,
        isCurrent: () => video === currentVideo && E.watchId(location.href) === currentId && settings.enabled && profile === currentProfile && durationMatches() });
    }
    if (skipSummary.active) {
      video.classList.remove(CLASS); cover.remove(); subtitles.clear(); mute.update(false);
      renderSummary(skipSummary.active); showBadge('스킵 · 내용 요약'); return;
    }
    // Also obscure/mute the scene while a skip is being processed.
    const hide = state.blur || Boolean(state.skip), silence = state.mute || Boolean(state.skip);
    mute.update(silence, state.skip ? `skip:${state.skip.start}:${state.skip.end}` : state.muteKey);
    video.classList.toggle(CLASS, hide && profile.mask !== 'cover');
    if (hide && profile.mask === 'cover') {
      const rect = video.getBoundingClientRect(), parent = document.fullscreenElement || document.documentElement;
      if (cover.parentNode !== parent) parent.appendChild(cover);
      Object.assign(cover.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    } else cover.remove();
    subtitles.update(video, hide);
    const labels = [];
    if (hide) labels.push(profile.mask === 'cover' ? '화면 가림' : '블러');
    if (silence) labels.push(mute.overridden ? '소리 직접 켬' : '음소거');
    showBadge(labels.join(' + ') || `준비됨 · ${profile.segments.length}개 구간`);
  }
  function tick() { if (stopped) return; apply(); frame = requestAnimationFrame(tick); }
  function status() {
    scan();
    return { watchId: id, videoFound: Boolean(video), currentTime: video?.currentTime || 0,
      duration: Number.isFinite(video?.duration) ? video.duration : null, title: document.title.replace(/\s*[-|]\s*Netflix.*$/i, ''),
      connected: Boolean(profile), durationMatches: !video || durationMatches(), enabled: settings.enabled,
      muted: Boolean(video?.muted), message: badge.textContent || '' };
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'MOVIEGUARD_STATUS') respond(status());
    if (message.type === 'MOVIEGUARD_UNMUTE') { mute?.unmute(); apply(); respond(status()); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[E.KEY]) return;
    updatingSettings = true;
    settings = E.readSettings(changes[E.KEY].newValue); updateProfile(); clearEffects();
    updatingSettings = false; scan();
  });
  function start() {
    stopped = false; scan(); cancelAnimationFrame(frame); tick(); clearInterval(timer); timer = setInterval(scan, 250);
  }
  window.addEventListener('pagehide', () => { stopped = true; cancelAnimationFrame(frame); clearInterval(timer); detach(); badge.remove(); });
  window.addEventListener('pageshow', () => { if (stopped) start(); });
  document.addEventListener('fullscreenchange', apply);
  chrome.storage.local.get(E.KEY).then(result => { settings = E.readSettings(result[E.KEY]); updateProfile(); start(); }).catch(() => showBadge('설정을 불러오지 못했습니다. 새로고침해 주세요.'));
})();
