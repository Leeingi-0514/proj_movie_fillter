const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const frame = document.querySelector('#playerFrame');
const check = (name, pass) => {
  const li = document.createElement('li'); li.textContent = `${pass ? 'PASS' : 'FAIL'} ${name}`;
  document.querySelector('#results').appendChild(li);
  if (!pass) throw new Error(name);
};
document.querySelector('#run').onclick = async () => {
  document.querySelector('#run').disabled = true;
  try {
    const doc = frame.contentDocument, video = doc.querySelector('#video'), overlay = doc.querySelector('#skipSummary');
    if (!video.readyState) await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, { once: true }));
    const skip = doc.querySelector('[data-filter="skip"]');
    const blur = doc.querySelector('[data-filter="blur"]');
    video.muted = true;
    await video.play(); video.currentTime = 1.2; await wait(180); skip.click(); await wait(150);
    check('playing video pauses beneath black summary', !overlay.hidden && video.paused && getComputedStyle(overlay).backgroundColor === 'rgb(0, 0, 0)');
    check('overlapping summaries display once as text', doc.querySelector('#skipSummaryText').textContent === '첫 번째 장면 요약\n\n두 번째 장면 요약');
    const before = video.currentTime; await wait(2400);
    check('skip waits approximately three seconds before seeking', video.paused && Math.abs(video.currentTime - before) < .1 && !overlay.hidden);
    await wait(850);
    check('skip reaches union end then resumes original playback', overlay.hidden && video.currentTime >= 3.5 && !video.paused);
    video.pause(); blur.click(); video.currentTime = 1.3; await wait(180); skip.click(); await wait(180);
    check('paused source also shows summary', !overlay.hidden && video.paused);
    await wait(3150);
    check('paused source stays paused after summary', overlay.hidden && video.paused && Math.abs(video.currentTime - 3.5) < .1);
    blur.click(); video.currentTime = .2; await video.play(); video.currentTime = 1.2; await wait(180); skip.click(); await wait(180);
    skip.click(); await wait(200);
    check('turning filter off cancels summary and restores playback', overlay.hidden && !video.paused);
    blur.click(); video.currentTime = .2; await wait(120); skip.click(); video.currentTime = 1.3; await wait(180);
    video.currentTime = 9; await wait(250);
    check('manual seek outside summary cancels it without stale timer', overlay.hidden && video.currentTime >= 9 && !video.paused);
    video.pause(); blur.click(); video.currentTime = 6.2; await wait(180); skip.click(); await wait(180);
    check('missing summary has a readable fallback', !overlay.hidden && doc.querySelector('#skipSummaryText').textContent.includes('다음 장면'));
    skip.click(); await wait(150); check('cancel preserves originally paused state', overlay.hidden && video.paused);
    const count = document.querySelectorAll('#results li').length;
    document.querySelector('#result').textContent = `${count} / ${count} PASS`;
  } catch (error) { document.querySelector('#result').textContent = `FAIL: ${error.message}`; console.error(error); }
};
