import { getTheme, loadCatalog } from './catalog.js?v=media-compat-1';

const themeId = new URLSearchParams(window.location.search).get('theme');
const theme = getTheme(themeId);
const list = document.querySelector('#videoList');
const message = document.querySelector('#listMessage');
const content = document.querySelector('#catalogContent');

function createVideoCard(video) {
  const card = document.createElement('a');
  card.className = 'video-card';
  card.href = `player.html?video=${encodeURIComponent(video.id)}`;
  const image = document.createElement('div');
  image.className = 'movie-image';
  if (video.poster) {
    const poster = document.createElement('img');
    poster.className = 'video-poster';
    poster.src = video.poster;
    poster.alt = '';
    poster.loading = 'lazy';
    poster.decoding = 'async';
    image.append(poster);
  }
  const tag = document.createElement('span');
  tag.className = 'video-tag';
  tag.textContent = video.demo ? '필터 체험용' : theme.title;
  const play = document.createElement('span');
  play.className = 'play-icon';
  play.textContent = '▶';
  play.setAttribute('aria-hidden', 'true');
  image.append(tag, play);
  const title = document.createElement('h3');
  title.textContent = video.title;
  const description = document.createElement('p');
  description.textContent = video.description || '영상을 선택해 필터와 함께 감상하세요.';
  const action = document.createElement('span');
  action.className = 'video-action';
  action.textContent = '영상 보러 가기 →';
  card.append(image, title, description, action);
  return card;
}

async function init() {
  if (!theme) {
    message.textContent = '위에서 공포·폭력성·선정성 중 원하는 테마를 선택해 주세요.';
    content.setAttribute('aria-busy', 'false');
    return;
  }
  document.title = `${theme.title} 영상 — 무비가드`;
  document.querySelector('#themeTitle').textContent = `${theme.title} 테마`;
  document.querySelector('#themeEnglish').textContent = theme.english;
  document.querySelector('#themeDescription').textContent = theme.description;
  document.querySelector('#listTitle').textContent = `${theme.title} 테마의 영상`;
  document.querySelector(`.theme-tabs [data-theme="${themeId}"]`).setAttribute('aria-current', 'page');
  try {
    const videos = (await loadCatalog()).filter(video => video.theme === themeId);
    document.querySelector('#videoCount').textContent = `${videos.length}개의 영상`;
    list.replaceChildren(...videos.map(createVideoCard));
    message.hidden = videos.length > 0;
    message.textContent = '아직 등록된 영상이 없어요. 새로운 영상이 준비되면 이곳에서 볼 수 있어요.';
    document.querySelector('#demoNote').hidden = !videos.some(video => video.demo);
  } catch (error) {
    message.textContent = window.location.protocol === 'file:'
      ? 'Live Server 또는 로컬 웹 서버로 페이지를 열어 주세요.'
      : error instanceof SyntaxError ? '영상 목록 파일의 형식을 확인해 주세요.' : error.message;
  } finally {
    content.setAttribute('aria-busy', 'false');
  }
}

init();
