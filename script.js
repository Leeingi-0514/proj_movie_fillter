document.querySelectorAll('.movie-card[data-theme]').forEach(button => {
  button.addEventListener('click', () => {
    window.location.href = `videos.html?theme=${encodeURIComponent(button.dataset.theme)}`;
  });
});

