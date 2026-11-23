'use strict';
const E = MovieGuardEngine, $ = selector => document.querySelector(selector);
const labels = { blur: '블러', mute: '음소거', both: '블러 + 음소거', skip: '스킵' };
let settings = E.readSettings(), targetId = null, tabId = null, status = null, library = [];
let segments = [], mode = 'segments', importId = null, busy = false;
function message(text = '') { $('#message').textContent = text; }
function modeButtons() { document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode))); }
function render() {
  $('#segmentList').replaceChildren(); $('#count').textContent = String(segments.length); $('#empty').hidden = segments.length > 0;
  for (const segment of segments) {
    const li = document.createElement('li'); li.className = 'segment';
    const text = document.createElement('div'), time = document.createElement('b'), desc = document.createElement('small'), remove = document.createElement('button');
    time.textContent = `${E.formatTime(segment.start)} – ${E.formatTime(segment.end)}`;
    desc.textContent = `${labels[segment.type]}${segment.reason ? ` · ${segment.reason}` : ''}`;
    const summaryLabel = document.createElement('label'), summary = document.createElement('textarea');
    summaryLabel.textContent = '스킵 요약'; summary.value = segment.summary || ''; summary.rows = 2;
    summary.setAttribute('aria-label', `${E.formatTime(segment.start)} 구간 요약`);
    summary.oninput = () => { segment.summary = summary.value; message('요약을 수정했습니다. 저장·적용을 눌러 주세요.'); };
    summaryLabel.appendChild(summary); text.append(time, desc, summaryLabel); remove.textContent = '삭제'; remove.type = 'button';
    remove.setAttribute('aria-label', `${E.formatTime(segment.start)} 구간 삭제`);
    remove.onclick = () => { segments = segments.filter(s => s.id !== segment.id); render(); message('변경 후 저장·적용을 눌러 주세요.'); };
    li.append(text, remove); $('#segmentList').appendChild(li);
  }
  modeButtons(); preview();
}
function preview() {
  const offset = Number($('#offset').value), first = segments[0];
  $('#preview').textContent = first && Number.isFinite(offset) ? `첫 구간 적용 위치: ${E.formatTime(first.start + offset)} – ${E.formatTime(first.end + offset)}` : '';
}
async function ask(type = 'MOVIEGUARD_STATUS') {
  if (!tabId) return null;
  try { return await chrome.tabs.sendMessage(tabId, { type }); } catch { return null; }
}
function paintStatus() {
  const available = Boolean(status?.watchId && status.videoFound);
  const same = available && targetId === status.watchId;
  $('#apply').disabled = !same || busy;
  $('#align').disabled = !same || busy;
  $('#unmute').disabled = !available || busy;
  $('#disconnect').disabled = !same || !settings.profiles[targetId] || busy;
  $('#toggle').setAttribute('aria-pressed', String(settings.enabled));
  $('#toggle').textContent = settings.enabled ? '필터 켜짐' : '필터 꺼짐';
  $('#status').textContent = !status ? '넷플릭스 본편 재생 화면을 열어 주세요.\n설치 직후라면 넷플릭스를 새로고침해 주세요.' : !available ? '넷플릭스 본편을 재생해 주세요.' :
    `작품 ID ${status.watchId} · ${E.formatTime(status.currentTime)}\n${!same ? '작품이 바뀌었습니다. 현재 작품 불러오기를 눌러 주세요.' : status.connected ? status.durationMatches ? status.message || '구간 연결됨' : '영상 길이가 달라 대기 중입니다. 본편에서 다시 저장해 주세요.' : '아직 구간이 연결되지 않았습니다.'}`;
}
async function refresh() { status = await ask(); paintStatus(); return status; }
function loadDraft(payload, sourceId = null) {
  const draft = E.normalizeProfile(payload);
  segments = draft.segments; mode = draft.mode; importId = sourceId;
  $('#title').value = draft.title; $('#offset').value = String(draft.offset); $('#mask').value = draft.mask; render();
}
async function loadCurrent() {
  await refresh(); targetId = status?.watchId || null;
  const raw = await chrome.storage.local.get(E.KEY); settings = E.readSettings(raw[E.KEY]);
  const saved = settings.profiles[targetId];
  loadDraft(saved || { title: status?.title || '', segments: [] }, saved ? targetId : null);
  $('#library').value = ''; message(saved ? '저장된 구간을 불러왔습니다.' : 'JSON을 불러오거나 기존 클립 구간을 선택해 주세요.');
  paintStatus();
}
async function mutate(update) {
  const raw = await chrome.storage.local.get(E.KEY), next = E.readSettings(raw[E.KEY]);
  update(next); await chrome.storage.local.set({ [E.KEY]: next }); settings = next; paintStatus();
}
function safely(fn) { return async () => { if (busy) return; busy = true; paintStatus(); try { await fn(); } catch (error) { message(error.message || '작업에 실패했습니다.'); } finally { busy = false; paintStatus(); } }; }
$('#reload').onclick = safely(loadCurrent);
$('#toggle').onclick = safely(async () => { await mutate(s => { s.enabled = !s.enabled; }); await refresh(); });
$('#unmute').onclick = safely(async () => { status = await ask('MOVIEGUARD_UNMUTE'); paintStatus(); message('현재 구간에서 소리를 켰습니다. 다음 음소거 구간부터 다시 적용됩니다.'); });
$('#offset').oninput = preview;
$('#align').onclick = safely(async () => {
  await refresh(); if (!status?.videoFound || status.watchId !== targetId) throw new Error('현재 작품을 다시 불러와 주세요.');
  $('#offset').value = String(Math.round(status.currentTime * 10) / 10); preview(); message('클립 시작 위치를 맞췄습니다. 저장·적용을 눌러 주세요.');
});
$('#modes').onclick = event => { const value = event.target.closest('[data-mode]')?.dataset.mode; if (value) { mode = value; modeButtons(); message('저장·적용을 눌러 변경을 적용하세요.'); } };
$('#library').onchange = () => {
  const item = library.find(p => p.id === $('#library').value); if (!item) return;
  loadDraft({ ...item, offset: 0 }); message('클립 기준 구간입니다. 본편에서 클립 시작 위치를 맞춘 뒤 저장해 주세요.');
};
$('#jsonFile').onchange = safely(async () => {
  const file = $('#jsonFile').files[0]; if (!file) return;
  if (file.size > 2 * 1024 * 1024) throw new Error('2MB 이하의 구간 JSON을 선택해 주세요.');
  const payload = JSON.parse(await file.text());
  loadDraft(Array.isArray(payload) ? { segments: payload } : payload, payload.netflixId ? String(payload.netflixId) : null);
  $('#library').value = ''; message(importId && importId !== targetId ? '다른 넷플릭스 작품 ID의 JSON입니다. 해당 작품에서 불러와 주세요.' : 'JSON을 불러왔습니다. 시간 보정을 확인한 뒤 저장·적용을 눌러 주세요.');
  $('#jsonFile').value = '';
});
$('#add').onclick = safely(async () => {
  segments = E.normalizePayload([...segments, { id: crypto.randomUUID(), start: $('#start').value, end: $('#end').value, type: $('#type').value, reason: $('#reason').value, summary: $('#summary').value }]);
  $('#start').value = ''; $('#end').value = ''; $('#reason').value = ''; $('#summary').value = ''; render(); message('구간을 추가했습니다. 저장·적용을 눌러 주세요.');
});
function draft() { return E.normalizeProfile({ title: $('#title').value, offset: $('#offset').value, mode, mask: $('#mask').value, segments }); }
$('#apply').onclick = safely(async () => {
  await refresh();
  if (!status?.videoFound || status.watchId !== targetId) throw new Error('작품이 바뀌었습니다. 현재 작품을 다시 불러와 주세요.');
  if (importId && importId !== targetId) throw new Error(`이 JSON은 작품 ID ${importId}에 연결되어 있습니다. 해당 작품에서 적용해 주세요.`);
  const profile = draft();
  if (!profile.segments.length) throw new Error('먼저 필터 구간을 추가해 주세요.');
  if (!status.duration || profile.segments.some(s => s.start + profile.offset < 0 || s.end + profile.offset > status.duration)) throw new Error('모든 구간이 본편 재생 시간 안에 들어오도록 시간 보정을 확인해 주세요.');
  profile.duration = status.duration;
  await mutate(s => { s.profiles[targetId] = profile; }); importId = targetId;
  message(`이 작품에 ${segments.length}개 구간을 저장했습니다.${settings.enabled ? '' : ' 현재 필터는 꺼져 있습니다.'}`); await refresh();
});
$('#disconnect').onclick = safely(async () => { await mutate(s => { delete s.profiles[targetId]; }); importId = null; message('이 작품의 연결을 해제했습니다.'); await refresh(); });
$('#exportJson').onclick = safely(async () => {
  const profile = draft(), data = { title: profile.title, ...(importId ? { netflixId: importId } : {}), offset: profile.offset, mode: profile.mode, mask: profile.mask, segments: profile.segments };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `movieguard-${importId || 'segments'}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
(async () => {
  try {
    const [tabs, data] = await Promise.all([chrome.tabs.query({ active: true, currentWindow: true }), fetch('data/library.json').then(r => { if (!r.ok) throw new Error(); return r.json(); }).catch(() => ({ profiles: [] }))]);
    const active = tabs[0];
    if (active?.url && /^https:\/\/(?:[\w-]+\.)*netflix\.com\//.test(active.url)) tabId = active.id;
    library = data.profiles || [];
    const themes = { horror: '공포', violence: '폭력성', sexual: '선정성' };
    for (const item of library) { const option = document.createElement('option'); option.value = item.id; option.textContent = `${themes[item.theme] || ''} · ${item.title}`; $('#library').appendChild(option); }
    await loadCurrent(); setInterval(refresh, 1000);
  } catch (error) { message(`설정을 읽지 못했습니다: ${error.message}`); }
})();
