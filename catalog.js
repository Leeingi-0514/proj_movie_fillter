export const themes = Object.freeze({
  horror: { title: '공포', english: 'HORROR', description: '갑작스러운 놀람과 긴장되는 장면, 나에게 맞는 필터로 편안하게 감상하세요.', crop: 'crop-one' },
  violence: { title: '폭력성', english: 'VIOLENCE', description: '거친 액션과 폭력적인 장면, 원하는 보호 방식을 선택해 감상하세요.', crop: 'crop-two' },
  sexual: { title: '선정성', english: 'SEXUAL CONTENT', description: '노출과 성적인 표현이 있는 장면, 필요한 구간에만 필터를 적용하세요.', crop: 'crop-three' }
});

export function getTheme(id) {
  return Object.hasOwn(themes, id) ? themes[id] : null;
}

export async function loadCatalog() {
  const response = await fetch('assets/videos.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('영상 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  const data = await response.json();
  if (!Array.isArray(data.videos)) throw new Error('영상 목록의 형식을 확인해 주세요.');
  const ids = new Set();
  for (const video of data.videos) {
    if (!video || typeof video.id !== 'string' || !video.id || ids.has(video.id)
      || !getTheme(video.theme) || typeof video.title !== 'string' || !video.title
      || typeof video.src !== 'string' || !video.src
      || typeof video.segments !== 'string' || !video.segments) {
      throw new Error('영상 목록의 필수 항목과 중복 ID를 확인해 주세요.');
    }
    ids.add(video.id);
  }
  return data.videos;
}

export function formatTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const parts = [Math.floor(seconds / 60) % 60, seconds % 60];
  if (seconds >= 3600) parts.unshift(Math.floor(seconds / 3600));
  return parts.map(part => String(part).padStart(2, '0')).join(':');
}
