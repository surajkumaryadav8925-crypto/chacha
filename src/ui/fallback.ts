import type { Photo } from '../types';

/**
 * If WebGL is unavailable the photographs are still viewable — as a quiet
 * gallery — instead of a blank page.
 */
export function showFallback(
  photos: Photo[],
  resolveAsset: (path: string) => string,
): void {
  const section = document.getElementById('fallback');
  const grid = document.getElementById('fallback-grid');
  if (!section || !grid) return;

  const canvas = document.getElementById('scene');
  if (canvas) canvas.style.display = 'none';
  document.getElementById('loading')?.remove();
  document.querySelector('.intro')?.remove();

  grid.replaceChildren();
  for (const photo of photos) {
    const image = document.createElement('img');
    image.src = resolveAsset(photo.thumb);
    image.alt = 'परिवार की तस्वीर';
    image.loading = 'lazy';
    image.decoding = 'async';
    grid.appendChild(image);
  }

  section.hidden = false;
}
