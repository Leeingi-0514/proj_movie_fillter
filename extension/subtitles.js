/* Render visible captions above the video effect without changing the selected language. */
(() => {
  'use strict';
  const ORIGINAL = 'movieguard-caption-original', NATIVE = 'movieguard-native-captions-hidden';
  const PROPERTIES = ['display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'box-sizing',
    'margin', 'padding', 'border', 'border-radius', 'font-family', 'font-size', 'font-weight', 'font-style',
    'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-decoration', 'text-shadow',
    'white-space', 'color', 'background-color', 'direction', 'writing-mode', 'vertical-align',
    'transform', 'transform-origin', 'opacity', 'visibility', 'min-width', 'max-width', 'min-height', 'max-height',
    'overflow', 'overflow-wrap', 'word-break', 'text-transform', 'text-indent', 'align-items', 'justify-content',
    'flex-direction', 'flex-wrap', 'gap', 'align-content', 'align-self', 'flex', 'grid-template-columns'];
  const TAGS = new Set(['DIV', 'SPAN', 'P', 'B', 'I', 'U', 'BR', 'RUBY', 'RT']);
  function copyTextTree(node, styled = true) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createTextNode('');
    const copy = document.createElement(TAGS.has(node.tagName) ? node.tagName.toLowerCase() : 'span');
    if (styled) {
      const css = getComputedStyle(node);
      for (const property of PROPERTIES) copy.style.setProperty(property, css.getPropertyValue(property));
    }
    for (const child of node.childNodes) copy.appendChild(copyTextTree(child, styled));
    return copy;
  }
  class SubtitleLayer {
    constructor() {
      this.video = null; this.source = null; this.signature = ''; this.updated = 0;
      this.host = document.createElement('div'); this.host.id = 'movieguard-netflix-subtitles';
      this.host.setAttribute('aria-hidden', 'true'); // The original captions remain the accessible source.
      this.host.style.cssText = 'position:fixed!important;z-index:2147483647!important;pointer-events:none!important;overflow:hidden!important;filter:none!important;opacity:1!important;';
      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.style = document.createElement('style');
      this.style.textContent = `.${ORIGINAL}{opacity:0!important}video.${NATIVE}::cue{color:transparent!important;background:transparent!important;text-shadow:none!important}`;
      document.documentElement.appendChild(this.style);
    }
    clear() {
      this.source?.classList.remove(ORIGINAL); this.video?.classList.remove(NATIVE);
      this.source = null; this.video = null; this.signature = ''; this.updated = 0;
      this.host.remove(); this.shadow.replaceChildren();
    }
    findSource(video, rect) {
      const scope = video.closest('.watch-video, .nf-player-container, [data-uia="player"]') || document;
      for (const source of scope.querySelectorAll('.player-timedtext, .player-timedtext-text-container')) {
        if (!source.textContent.trim()) continue;
        const box = source.getBoundingClientRect();
        let hidden = false;
        for (let ancestor = source; ancestor; ancestor = ancestor.parentElement) {
          const css = getComputedStyle(ancestor);
          if (css.display === 'none' || css.visibility === 'hidden' || css.opacity === '0') { hidden = true; break; }
        }
        if (hidden) continue;
        if (box.width > 0 && box.height > 0 && box.right > rect.left && box.left < rect.right && box.bottom > rect.top && box.top < rect.bottom) return source;
      }
      return null;
    }
    update(video, active) {
      if (!active || !video?.isConnected) { if (this.video || this.host.isConnected) this.clear(); return; }
      if (this.video && this.video !== video) this.clear();
      const now = performance.now();
      if (this.video === video && now - this.updated < 50) return;
      this.updated = now; this.video = video;
      const rect = video.getBoundingClientRect();
      if (!rect.width || !rect.height) { this.clear(); return; }
      // Read the service's current visibility, including CSS-only subtitle-off changes.
      // The class is restored before the browser paints, so the original never flashes.
      this.source?.classList.remove(ORIGINAL);
      const source = this.findSource(video, rect);
      const tracks = [...video.textTracks].filter(track => track.mode === 'showing' && ['subtitles', 'captions'].includes(track.kind));
      const cues = source ? [] : tracks.flatMap(track => [...(track.activeCues || [])]);
      if (!source && !cues.length) { this.clear(); return; }
      if (source !== this.source) { this.source?.classList.remove(ORIGINAL); this.source = source; this.signature = ''; }
      const parent = document.fullscreenElement || document.documentElement;
      if (this.host.parentNode !== parent) parent.appendChild(this.host);
      for (const [property, value] of Object.entries({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })) this.host.style.setProperty(property, `${value}px`, 'important');
      if (source) {
        video.classList.remove(NATIVE);
        const box = source.getBoundingClientRect(), css = getComputedStyle(source);
        const signature = [source.innerHTML, source.getAttribute('style'), box.left, box.top, box.width, box.height,
          rect.left, rect.top, css.fontSize, css.fontFamily, css.color, css.lineHeight].join('|');
        if (signature !== this.signature) {
          const copy = copyTextTree(source);
          // Use the source's final viewport position; its ancestor transforms are already accounted for.
          Object.assign(copy.style, { position: 'absolute', left: `${box.left - rect.left}px`, top: `${box.top - rect.top}px`,
            right: 'auto', bottom: 'auto', width: `${box.width}px`, height: `${box.height}px`, margin: '0', transform: 'none', opacity: '1', visibility: 'visible' });
          this.shadow.replaceChildren(copy); this.signature = signature;
        }
        // Keep the original layout intact and avoid drawing the same caption twice.
        source.classList.add(ORIGINAL); this.host.dataset.source = 'netflix';
      } else {
        const signature = cues.map(cue => `${cue.startTime}|${cue.endTime}|${cue.text}`).join('\n') + `|${rect.height}`;
        if (signature !== this.signature) {
          const group = document.createElement('div');
          group.style.cssText = `position:absolute;left:5%;right:5%;bottom:8%;text-align:center;color:white;font:600 ${Math.max(16, Math.min(48, rect.height * .045))}px/1.4 system-ui;white-space:pre-line;text-shadow:0 2px 3px black,0 0 4px black;`;
          for (const cue of cues) {
            const line = document.createElement('div');
            if (typeof cue.getCueAsHTML === 'function') {
              for (const node of cue.getCueAsHTML().childNodes) line.appendChild(copyTextTree(node, false));
            } else line.textContent = cue.text;
            group.appendChild(line);
          }
          this.shadow.replaceChildren(group); this.signature = signature;
        }
        video.classList.add(NATIVE); this.host.dataset.source = 'track';
      }
    }
  }
  window.MovieGuardSubtitles = SubtitleLayer;
})();
