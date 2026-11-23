const sleep = ms => new Promise(r => setTimeout(r, ms));
const seek = async (v, time) => { v.currentTime = time; await sleep(250); };
const report = (name, pass) => { const li = document.createElement('li'); li.textContent = `${pass ? 'PASS' : 'FAIL'} ${name}`; li.dataset.pass = String(pass); document.querySelector('#results').appendChild(li); if (!pass) throw new Error(name); };
const settings = { enabled: true, profiles: { 101: { title: 'Test', offset: 1, mode: 'segments', segments: [
  { id: 'a', start: 2, end: 4, type: 'both' }, { id: 'b', start: 6, end: 8, type: 'mute' },
  { id: 's1', start: 10, end: 12, type: 'skip', summary: '첫 장면의 요약' }, { id: 's2', start: 11.5, end: 14, type: 'skip', summary: '<b>다음 장면의 요약</b>' }
] } } };
const save = async () => { await chrome.storage.local.set({ movieGuardNetflix: settings }); await sleep(150); };
document.querySelector('#open-popup').onclick = () => { const iframe = document.querySelector('#popup'); iframe.hidden = false; iframe.src = '/extension/popup.html'; };
document.querySelector('#run').onclick = async () => {
  document.querySelector('#run').disabled = true; const result = document.querySelector('#result');
  try {
    history.pushState({}, '', '/watch/101'); let video = document.querySelector('video'); video.pause();
    if (!video.readyState) await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, { once: true }));
    await save(); await seek(video, 3.2);
    report('offset + both filter starts', video.classList.contains('movieguard-netflix-blur') && video.muted);
    await seek(video, 5); report('end boundary releases blur and automatic mute', !video.classList.contains('movieguard-netflix-blur') && !video.muted);
    await seek(video, 3.4); video.muted = false; await sleep(200);
    report('native manual unmute persists inside segment', !video.muted && video.classList.contains('movieguard-netflix-blur'));
    await seek(video, 7.1); report('seeking directly to next mute window mutes again', video.muted);
    await seek(video, 11.2);
    const summaryScreen = () => document.querySelector('#movieguard-netflix-skip-summary');
    report('skip pauses and shows safe combined summary on black screen', video.paused && Math.abs(video.currentTime - 11.2) < .01 && summaryScreen()?.shadowRoot.textContent.includes('첫 장면의 요약') && summaryScreen().shadowRoot.textContent.includes('<b>다음 장면의 요약</b>') && !summaryScreen().shadowRoot.querySelector('b'));
    await sleep(2000); report('skip keeps video frozen before three seconds', Math.abs(video.currentTime - 11.2) < .01 && Boolean(summaryScreen()));
    await sleep(1100); report('overlapping skips seek to union end + offset after summary', Math.abs(video.currentTime - 15) < .01 && !summaryScreen() && video.paused);
    await seek(video, 11.2); settings.enabled = false; await save(); await seek(video, 1); await sleep(3100);
    report('turning off skip cancels delayed seek and summary', Math.abs(video.currentTime - 1) < .01 && !summaryScreen());
    settings.enabled = true; await save();
    await seek(video, 11.2); history.pushState({}, '', '/watch/202'); await sleep(3200);
    report('episode change cancels pending summary timer', !summaryScreen() && Math.abs(video.currentTime - 11.2) < .01);
    history.pushState({}, '', '/watch/101'); await seek(video, 3.5); await sleep(300);

    await seek(video, 3.5); settings.enabled = false; await save();
    report('disable clears active effects', !video.muted && !video.classList.contains('movieguard-netflix-blur'));
    settings.enabled = true; await save(); report('enable resumes active effects', video.muted && video.classList.contains('movieguard-netflix-blur'));
    const caption = document.querySelector('.player-timedtext');
    const mirroredText = () => document.querySelector('#movieguard-netflix-subtitles')?.shadowRoot.textContent || '';
    caption.hidden = false; await sleep(180);
    report('Netflix DOM captions are sharp above blur', mirroredText().includes('자막은 선명') && getComputedStyle(caption).opacity === '0');
    caption.querySelector('span').textContent = 'English subtitles after language change'; await sleep(180);
    report('subtitle language and text changes update the overlay', mirroredText().includes('English subtitles'));
    caption.style.opacity = '0'; await sleep(180);
    report('CSS-only subtitle hiding removes stale captions', !document.querySelector('#movieguard-netflix-subtitles'));
    caption.style.opacity = ''; await sleep(180);
    settings.profiles[101].mask = 'cover'; await save();
    const captionHost = document.querySelector('#movieguard-netflix-subtitles'), coverHost = document.querySelector('#movieguard-netflix-cover');
    report('captions stack above opaque cover', mirroredText().includes('English subtitles') && Number(captionHost.style.zIndex) > Number(getComputedStyle(coverHost).zIndex));
    settings.enabled = false; await save();
    report('disabling filter restores original caption styling', !document.querySelector('#movieguard-netflix-subtitles') && getComputedStyle(caption).opacity === '1');
    settings.enabled = true; settings.profiles[101].mask = 'blur'; await save();
    caption.hidden = true; await sleep(180);
    report('turning off DOM captions removes the mirror without stale text', !document.querySelector('#movieguard-netflix-subtitles') && !caption.classList.contains('movieguard-caption-original'));
    const korean = video.addTextTrack('subtitles', '한국어', 'ko'); korean.addCue(new VTTCue(3, 4, '기본 영상 자막')); korean.mode = 'showing';
    await seek(video, 3.5);
    report('native text track captions are lifted above video blur', mirroredText().includes('기본 영상 자막') && video.classList.contains('movieguard-native-captions-hidden') && korean.mode === 'showing');
    await seek(video, 4.5);
    report('expired native cue clears while blur remains active', !document.querySelector('#movieguard-netflix-subtitles') && video.classList.contains('movieguard-netflix-blur'));
    await seek(video, 3.5); korean.mode = 'disabled';
    const english = video.addTextTrack('subtitles', 'English', 'en'); english.addCue(new VTTCue(3, 4, 'Native English captions')); english.mode = 'showing'; await sleep(180);
    report('native track language change follows user selection', mirroredText().includes('Native English captions') && !mirroredText().includes('기본 영상 자막'));
    english.mode = 'disabled'; await sleep(180);
    report('turning native captions off removes overlay and cue override', !document.querySelector('#movieguard-netflix-subtitles') && !video.classList.contains('movieguard-native-captions-hidden'));
    caption.hidden = false; await sleep(120);
    const old = video, next = document.createElement('video'); next.src = '/demo.mp4'; next.controls = true;
    old.replaceWith(next); video = next; await new Promise(resolve => next.addEventListener('loadedmetadata', resolve, { once: true })); await seek(next, 3.5); await sleep(300);
    report('video replacement restores detached video', !old.muted && !old.classList.contains('movieguard-netflix-blur') && !old.classList.contains('movieguard-native-captions-hidden'));
    report('video replacement filters new element', next.muted && next.classList.contains('movieguard-netflix-blur'));
    history.pushState({}, '', '/watch/202'); await sleep(300);
    report('next episode has no leaked profile, mute or subtitles', !next.muted && !next.classList.contains('movieguard-netflix-blur') && !document.querySelector('#movieguard-netflix-subtitles') && !caption.classList.contains('movieguard-caption-original'));
    history.pushState({}, '', '/watch/101'); await sleep(300);
    settings.profiles[101].mask = 'cover'; await save();
    report('opaque cover fallback covers the video', Boolean(document.querySelector('#movieguard-netflix-cover')) && !next.classList.contains('movieguard-netflix-blur'));
    await chrome.tabs.sendMessage(1, { type: 'MOVIEGUARD_UNMUTE' }); await sleep(100);
    report('extension unmute works under opaque cover', !next.muted);
    settings.profiles[101].duration = video.duration + 30; await save();
    report('duration mismatch suspends profile and releases mute', !next.muted && !document.querySelector('#movieguard-netflix-cover'));
    delete settings.profiles[101].duration; settings.profiles[101].mask = 'blur'; await save();
    history.pushState({}, '', '/browse'); await sleep(300);
    report('browse navigation removes all effects and badge', !next.muted && !next.classList.contains('movieguard-netflix-blur') && !document.querySelector('#movieguard-netflix-badge'));
    history.pushState({}, '', '/watch/101'); await sleep(300);
    await seek(next, 1); next.muted = true; await next.play(); await seek(next, 11.2);
    report('playing video pauses for skip summary', next.paused && Boolean(document.querySelector('#movieguard-netflix-skip-summary')));
    await sleep(3200);
    report('playing video automatically resumes after summary and skip', !next.paused && next.currentTime >= 15 && !document.querySelector('#movieguard-netflix-skip-summary'));
    next.pause(); next.muted = false; await seek(next, 3.5);
    const count = document.querySelectorAll('#results li').length; result.textContent = `${count} / ${count} PASS`; result.dataset.pass = 'true';
  } catch (error) { result.textContent = `FAIL: ${error.message}`; result.dataset.pass = 'false'; console.error(error); }
};

async function previewCaptions(event) {
  history.pushState({}, '', '/watch/101');
  settings.enabled = true; delete settings.profiles[101].duration; settings.profiles[101].mask = event.currentTarget.dataset.mask || 'cover';
  const caption = document.querySelector('.player-timedtext'); caption.hidden = false;
  caption.querySelector('span').textContent = '블러 위에서도 자막은 선명하게 보여요.';
  await save(); await seek(document.querySelector('video'), 3.5);
}
document.querySelector('#captions-preview').onclick = previewCaptions;
document.querySelector('#captions-blur-preview').onclick = previewCaptions;

document.querySelector('#summary-preview').onclick = async () => {
  history.pushState({}, '', '/watch/101'); settings.enabled = true; delete settings.profiles[101].duration;
  document.querySelector('.player-timedtext').hidden = false;
  settings.profiles[101].segments[2].summary = '필터로 지정된 장면을 건너뛰고 다음 장면으로 이어집니다.';
  settings.profiles[101].segments[3].summary = '';
  await save(); await seek(document.querySelector('video'), 11.2);
};
