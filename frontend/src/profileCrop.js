export function getCropRect(width, height, zoom, position = { x: .5, y: .5 }) {
  const size = Math.min(width, height) / Math.max(1, Math.min(4, zoom));
  const clamp = (value, max) => Math.max(0, Math.min(max, value));
  return { x: clamp(position.x * width - size / 2, width - size), y: clamp(position.y * height - size / 2, height - size), size };
}
