// contentFrame uses source-video pixels; absent or invalid settings display the full source.
export function getContentFrame(sourceWidth, sourceHeight, contentFrame) {
  if (![sourceWidth, sourceHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  const fullFrame = { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  if (!contentFrame) return fullFrame;
  const { x, y, width, height } = contentFrame;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0
    || width <= 0 || height <= 0 || x + width > sourceWidth || y + height > sourceHeight) return fullFrame;
  return { x, y, width, height };
}

export function calculateVideoLayout(sourceWidth, sourceHeight, containerWidth, containerHeight, contentFrame) {
  const frame = getContentFrame(sourceWidth, sourceHeight, contentFrame);
  if (!frame || ![containerWidth, containerHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.max(containerWidth / frame.width, containerHeight / frame.height);
  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
    left: (containerWidth - frame.width * scale) / 2 - frame.x * scale,
    top: (containerHeight - frame.height * scale) / 2 - frame.y * scale
  };
}
