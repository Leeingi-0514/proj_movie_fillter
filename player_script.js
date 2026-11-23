import { getTheme, loadCatalog, formatTime } from './catalog.js?v=media-compat-1';
import { filterLabels, parseSegments, activeSegments, activeWindowKey, skipWindow, MuteController } from './filter-engine.js?v=skip-summary-1';
import './extension/skip-summary.js?v=summary-1';
import { getContentFrame, calculateVideoLayout } from './video-layout.js';

const video = document.querySelector('#video');
const player = document.querySelector('#player');
const videoSurface = document.querySelector('.video-surface');
const badge = document.querySelector('#badge');
const buttons = [...document.querySelectorAll('[data-filter]')];
const stateText = document.querySelector('#stateText');
const seek = document.querySelector('#seek');
const jump = document.querySelector('#jump');
const playToggle = document.querySelector('#playToggle');
const muteToggle = document.querySelector('#muteToggle');
const mute = new MuteController(video);
let segments = [];
let selectedMode = null;
let dataReady = false;
let mediaReady = false;
let failed = false;
let frameId = 0;
let contentFrame = null;
let modeRevision = 0;
let pageActive = true;
const summaryOverlay = document.querySelector('#skipSummary');
const initialPage = location.href;
const skipSummary = new globalThis.MovieGuardSkipSummary.SkipSummaryController({
  onShow(session) {
    summaryOverlay.hidden = false;
    document.querySelector('#skipSummaryText').textContent = session.summary;
    document.querySelector('#skipSummaryHint').textContent = session.error || (session.phase === 'holding'
      ? '약 3초 후 다음 장면으로 이동합니다.' : '다음 장면을 준비하고 있어요.');
    summaryOverlay.dataset.phase = session.phase;
  },
  onHide() {
    summaryOverlay.hidden = true;
    delete summaryOverlay.dataset.phase;
    if (pageActive) queueMicrotask(applyFilters);
  },
  onError(message) {
    document.querySelector('#skipSummaryHint').textContent = message;
  }
});

function updateVideoLayout() {
  const layout = calculateVideoLayout(video.videoWidth, video.videoHeight,
    videoSurface.clientWidth, videoSurface.clientHeight, contentFrame);
  if (!layout) return;
  for (const [property, value] of Object.entries(layout)) video.style[property] = `${value}px`;
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(updateVideoLayout).observe(videoSurface);
}
window.addEventListener('resize', updateVideoLayout);
document.addEventListener('fullscreenchange', updateVideoLayout);

function setMode(mode) {
  selectedMode = mode;
  modeRevision += 1;
  skipSummary.cancel({ resume: true });
  buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === mode)));
  document.querySelector('#filterHint').textContent = mode
    ? mode === 'skip' ? '스킵 선택됨 · 검은 화면에 약 3초간 요약을 보여준 뒤 다음 장면으로 이동해요.' : `${filterLabels[mode]} 선택됨 · 선택한 버튼을 다시 누르면 필터가 꺼져요.`
    : '필터 꺼짐 · 영상을 원본 그대로 재생해요. 버튼을 선택하면 다시 켜져요.';
  applyFilters();
}

function updateProgress() {
  document.querySelector('#currentTime').textContent = formatTime(video.currentTime);
  if (!seek.matches(':active')) seek.value = String(video.currentTime);
  seek.setAttribute('aria-valuetext', `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`);
  const paused = skipSummary.active ? !skipSummary.active.resume : video.paused;
  playToggle.textContent = paused ? '▶ 재생' : 'Ⅱ 일시정지';
  playToggle.setAttribute('aria-label', paused ? '영상 재생' : '영상 일시정지');
  muteToggle.textContent = video.muted ? '소리 켜기' : '소리 끄기';
  muteToggle.setAttribute('aria-label', muteToggle.textContent);
}

function applyFilters() {
  skipSummary.sync(video, modeRevision);
  const ready = pageActive && dataReady && mediaReady && !failed;
  if ((!ready || selectedMode !== 'skip') && skipSummary.active) skipSummary.cancel({ resume: false });
  const active = ready && selectedMode && !video.ended ? activeSegments(segments, video.currentTime) : [];
  if (selectedMode === 'skip' && active.length && !skipSummary.active && !video.seeking) {
    const window = skipWindow(segments, video.currentTime, video.duration);
    if (window && window.end > video.currentTime) skipSummary.start(video, { ...window, contextKey: modeRevision,
      isCurrent: () => pageActive && selectedMode === 'skip' && !failed && location.href === initialPage });
  }
  const showingSummary = Boolean(skipSummary.active);
  const filtering = active.length > 0;
  const shouldMute = showingSummary || filtering && (selectedMode === 'mute' || selectedMode === 'both');
  const shouldBlur = !showingSummary && filtering && (selectedMode === 'blur' || selectedMode === 'both');
  mute.update(shouldMute, showingSummary ? `summary:${modeRevision}` : shouldMute ? activeWindowKey(segments, video.currentTime) : null);
  video.classList.toggle('blurred', shouldBlur);
  badge.hidden = !filtering || showingSummary;
  if (filtering && !showingSummary) {
    const effects = [];
    if (shouldBlur) effects.push('블러');
    if (shouldMute && video.muted) effects.push('음소거');
    if (shouldMute && mute.overridden) effects.push('소리 직접 켬');
    badge.textContent = `MovieGuard · ${effects.join(' + ')}`;
  }
  if (!failed) {
    stateText.textContent = !mediaReady ? '영상 준비 중'
      : showingSummary ? skipSummary.active.phase === 'error' ? '스킵 대기 중' : '장면 요약 중'
      : !selectedMode ? '필터 꺼짐'
      : filtering ? (mute.overridden && shouldMute ? '소리 직접 켬' : '필터 적용 중')
      : video.ended ? '재생 완료' : video.paused ? '재생 준비됨' : '재생 중';
  }
  document.querySelectorAll('.segment-item').forEach(item => {
    item.classList.toggle('active', active.some(segment => segment.id === item.dataset.id));
  });
  updateProgress();
}

async function playVideo() {
  if (skipSummary.active) { skipSummary.active.resume = true; updateProgress(); return; }
  try {
    await video.play();
  } catch (error) {
    if (error.name === 'AbortError') return;
    document.querySelector('#pageMessage').textContent = '재생 버튼을 눌러 영상을 다시 시작해 주세요.';
    document.querySelector('#pageMessage').hidden = false;
  }
}

function seekTo(time, play = false) {
  if (!mediaReady || failed) return;
  video.currentTime = Math.max(0, Math.min(time, video.duration));
  applyFilters();
  if (play) playVideo();
}

function renderSegments() {
  document.querySelector('#segmentCount').textContent = `${segments.length}개`;
  const empty = document.querySelector('#emptySegments');
  empty.hidden = segments.length > 0;
  empty.textContent = '이 영상에는 등록된 필터 구간이 없어요.';
  const list = document.querySelector('#segmentList');
  list.replaceChildren(...segments.map((segment, index) => {
    const item = document.createElement('li');
    item.className = 'segment-item';
    item.dataset.id = segment.id;
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = !mediaReady;
    const number = document.createElement('span');
    number.className = 'segment-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const time = document.createElement('span');
    time.className = 'segment-time';
    time.textContent = `${formatTime(segment.start)} — ${formatTime(segment.end)}`;
    const reason = document.createElement('span');
    reason.className = 'segment-reason';
    reason.textContent = segment.reason || '등록된 필터 구간';
    const arrow = document.createElement('span');
    arrow.className = 'segment-arrow';
    arrow.textContent = '↗';
    arrow.setAttribute('aria-hidden', 'true');
    button.append(number, time, reason, arrow);
    button.setAttribute('aria-label', `${time.textContent} 구간 2초 전부터 재생`);
    button.addEventListener('click', () => seekTo(segment.start - 2, true));
    item.append(button);
    return item;
  }));
  renderTrack();
}

function renderTrack() {
  const track = document.querySelector('#segmentTrack');
  track.replaceChildren();
  if (!mediaReady || !Number.isFinite(video.duration) || video.duration <= 0) return;
  for (const segment of segments) {
    if (segment.start >= video.duration) continue;
    const mark = document.createElement('i');
    mark.style.left = `${segment.start / video.duration * 100}%`;
    mark.style.width = `${(Math.min(segment.end, video.duration) - segment.start) / video.duration * 100}%`;
    track.append(mark);
  }
}

function showError(message) {
  failed = true;
  selectedMode = null;
  skipSummary.cancel({ resume: false });
  buttons.forEach(button => {
    button.disabled = true;
    button.setAttribute('aria-pressed', 'false');
  });
  jump.disabled = true;
  playToggle.disabled = true;
  seek.disabled = true;
  document.querySelectorAll('.segment-item button').forEach(button => { button.disabled = true; });
  video.pause();
  applyFilters();
  document.querySelector('#pageMessage').textContent = message;
  document.querySelector('#pageMessage').hidden = false;
  document.querySelector('#playerPlaceholder').textContent = '영상을 준비하지 못했어요.';
  document.querySelector('#playerPlaceholder').hidden = false;
  document.querySelector('#filterHint').textContent = '영상과 필터 데이터를 불러온 뒤 사용할 수 있어요.';
  document.querySelector('#emptySegments').textContent = '필터 구간을 표시할 수 없어요.';
  stateText.textContent = '불러오기 실패';
}

buttons.forEach(button => button.addEventListener('click', () => {
  setMode(selectedMode === button.dataset.filter ? null : button.dataset.filter);
}));
jump.addEventListener('click', () => { if (segments.length) seekTo(segments[0].start - 2, true); });
function togglePlayback() {
  if (skipSummary.active) { skipSummary.active.resume = !skipSummary.active.resume; updateProgress(); }
  else video.paused ? playVideo() : video.pause();
}
playToggle.addEventListener('click', togglePlayback);
video.addEventListener('click', () => { if (mediaReady && !failed) togglePlayback(); });
seek.addEventListener('input', () => seekTo(Number(seek.value)));
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || !mediaReady || failed || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable
    || target.closest('textarea, select, [role="textbox"], [role="combobox"], [role="spinbutton"]')
    || (target instanceof HTMLInputElement && target !== seek && target.type !== 'checkbox'))) return;
  // Handle the seek slider too, so its native 0.1-second step does not run alongside this shortcut.
  event.preventDefault();
  seekTo(video.currentTime + (event.key === 'ArrowLeft' ? -5 : 5));
});
muteToggle.addEventListener('click', () => {
  video.muted = !video.muted;
  applyFilters();
});
document.querySelector('#fullscreenToggle').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (player.requestFullscreen) await player.requestFullscreen();
  } catch {
    document.querySelector('#pageMessage').textContent = '이 브라우저에서는 전체 화면을 사용할 수 없어요.';
    document.querySelector('#pageMessage').hidden = false;
  }
});
if (!player.requestFullscreen) document.querySelector('#fullscreenToggle').hidden = true;

video.addEventListener('loadedmetadata', () => {
  mediaReady = Number.isFinite(video.duration) && video.duration > 0;
  if (!mediaReady) { showError('재생 가능한 영상 파일인지 확인해 주세요.'); return; }
  const frame = getContentFrame(video.videoWidth, video.videoHeight, contentFrame);
  if (frame) videoSurface.style.setProperty('--video-aspect', `${frame.width}/${frame.height}`);
  updateVideoLayout();
  document.querySelector('#duration').textContent = formatTime(video.duration);
  seek.max = String(video.duration);
  seek.disabled = false;
  playToggle.disabled = false;
  jump.disabled = !segments.length;
  document.querySelector('#playerPlaceholder').hidden = true;
  document.querySelectorAll('.segment-item button').forEach(button => { button.disabled = false; });
  renderTrack();
  applyFilters();
});
video.addEventListener('error', () => {
  if (dataReady) showError('영상 파일을 불러오지 못했어요. 파일 경로와 브라우저에서 지원하는 형식인지 확인해 주세요.');
});
['timeupdate', 'seeking', 'seeked', 'volumechange', 'ended'].forEach(event => video.addEventListener(event, applyFilters));
function animate() {
  applyFilters();
  frameId = requestAnimationFrame(animate);
}
video.addEventListener('play', () => {
  cancelAnimationFrame(frameId);
  animate();
});
video.addEventListener('pause', () => {
  cancelAnimationFrame(frameId);
  applyFilters();
});
window.addEventListener('pagehide', () => {
  pageActive = false;
  skipSummary.cancel({ resume: false });
  cancelAnimationFrame(frameId);
  mute.update(false);
  video.classList.remove('blurred');
});
window.addEventListener('pageshow', () => {
  pageActive = true;
  applyFilters();
  if (!video.paused) { cancelAnimationFrame(frameId); animate(); }
});

async function init() {
  try {
    const videos = await loadCatalog();
    const id = new URLSearchParams(window.location.search).get('video');
    const entry = id === null ? videos[0] : videos.find(item => item.id === id);
    if (!entry) throw new Error('선택한 영상을 찾을 수 없어요. 테마 목록에서 다시 선택해 주세요.');
    const theme = getTheme(entry.theme);
    contentFrame = entry.contentFrame || null;
    document.title = `${entry.title} — 무비가드`;
    document.querySelector('#videoTitle').textContent = entry.title;
    document.querySelector('#videoDescription').textContent = entry.description || '';
    document.querySelector('#themeLabel').textContent = `MOVIEGUARD · ${theme.english}`;
    const back = document.querySelector('#backToList');
    back.href = `videos.html?theme=${encodeURIComponent(entry.theme)}`;
    back.textContent = `← ${theme.title} 영상 목록`;
    const response = await fetch(entry.segments, { cache: 'no-store' });
    if (!response.ok) throw new Error('이 영상의 필터 구간을 불러오지 못했어요. 구간 파일을 확인해 주세요.');
    segments = parseSegments(await response.json());
    dataReady = true;
    renderSegments();
    buttons.forEach(button => { button.disabled = !segments.length; });
    setMode(segments[0]?.type || null);
    if (!segments.length) document.querySelector('#filterHint').textContent = '등록된 구간이 없어 원본 그대로 재생해요.';
    document.querySelector('#demoNote').hidden = !entry.demo;
    video.setAttribute('aria-label', entry.title);
    video.controls = false;
    document.querySelector('#mediaControls').hidden = false;
    video.src = entry.src;
    video.load();
  } catch (error) {
    showError(window.location.protocol === 'file:'
      ? 'Live Server 또는 로컬 웹 서버로 페이지를 열어 주세요.'
      : error instanceof SyntaxError ? '영상 또는 필터 구간 파일의 형식을 확인해 주세요.' : error.message);
  }
}

init();
