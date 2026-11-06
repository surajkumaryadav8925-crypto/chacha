import { counterLabel } from '../lib/hindi';
import type { Photo, Rect } from '../types';

const ICONS = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" /></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>',
};

const CLOSE_MS = 520;

/**
 * Full-screen, keyboard friendly photograph viewer. Opening animates from the
 * projected screen box of the clicked tile, closing animates back to it.
 */
export class PhotoViewer {
  private readonly root: HTMLDivElement;
  private readonly img: HTMLImageElement;
  private readonly counter: HTMLParagraphElement;
  private readonly closeButton: HTMLButtonElement;

  private index = 0;
  private opened = false;
  private origin: Rect | null = null;
  private previousFocus: HTMLElement | null = null;
  private closeTimer = 0;
  private swapTimer = 0;

  onClose?: () => void;

  constructor(
    private readonly photos: Photo[],
    private readonly resolveAsset: (path: string) => string,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'viewer';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'तस्वीर देखें');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.innerHTML = `
      <div class="viewer__backdrop"></div>
      <div class="viewer__stage"><img class="viewer__img" alt="" draggable="false" /></div>
      <button class="viewer__nav viewer__prev" type="button" aria-label="पिछली तस्वीर" title="पिछली तस्वीर">${ICONS.prev}</button>
      <button class="viewer__nav viewer__next" type="button" aria-label="अगली तस्वीर" title="अगली तस्वीर">${ICONS.next}</button>
      <button class="viewer__close" type="button" aria-label="बंद करें" title="बंद करें">${ICONS.close}</button>
      <p class="viewer__counter" aria-hidden="true"></p>
    `;

    const img = this.root.querySelector<HTMLImageElement>('.viewer__img');
    const counter = this.root.querySelector<HTMLParagraphElement>('.viewer__counter');
    const prev = this.root.querySelector<HTMLButtonElement>('.viewer__prev');
    const next = this.root.querySelector<HTMLButtonElement>('.viewer__next');
    const close = this.root.querySelector<HTMLButtonElement>('.viewer__close');
    if (!img || !counter || !prev || !next || !close) {
      throw new Error('Viewer markup could not be created');
    }
    this.img = img;
    this.counter = counter;
    this.closeButton = close;

    prev.addEventListener('click', () => this.step(-1));
    next.addEventListener('click', () => this.step(1));
    close.addEventListener('click', () => this.close());

    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target === this.img || target.closest('button')) return;
      this.close();
    });

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);

    document.getElementById('viewer-root')?.appendChild(this.root);
  }

  open(index: number, origin: Rect | null): void {
    window.clearTimeout(this.closeTimer);
    this.opened = true;
    this.index = index;
    this.origin = origin;
    this.previousFocus = document.activeElement as HTMLElement | null;

    document.getElementById('app')?.classList.add('is-viewing');
    this.root.classList.add('is-open');
    this.root.setAttribute('aria-hidden', 'false');
    this.closeButton.focus({ preventScroll: true });

    this.layout(index);
    this.animateIn(origin);
    this.preloadOriginal();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    window.clearTimeout(this.swapTimer);
    this.root.classList.remove('is-open');
    this.root.setAttribute('aria-hidden', 'true');
    document.getElementById('app')?.classList.remove('is-viewing');

    const width = this.img.offsetWidth;
    const height = this.img.offsetHeight;
    const rect = this.origin;

    if (rect && width > 0 && height > 0) {
      const scale = Math.max(rect.width / width, rect.height / height);
      const dx = rect.x + rect.width / 2 - window.innerWidth / 2;
      const dy = rect.y + rect.height / 2 - window.innerHeight / 2;
      this.img.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      this.img.style.borderRadius = '10px';
      this.img.style.opacity = '0.3';
    } else {
      this.img.style.transform = 'scale(0.94)';
      this.img.style.opacity = '0';
    }

    this.closeTimer = window.setTimeout(() => {
      this.img.style.opacity = '1';
      this.img.style.transform = '';
      this.previousFocus?.focus?.({ preventScroll: true });
      this.onClose?.();
    }, CLOSE_MS);
  }

  private step(direction: number): void {
    if (!this.opened) return;
    const total = this.photos.length;
    if (total === 0) return;
    const index = (this.index + direction + total) % total;
    this.index = index;

    const photo = this.photos[index];
    if (!photo) return;

    const size = this.finalSize(photo);
    this.counter.textContent = counterLabel(index, total);
    this.img.classList.add('is-swapping');

    window.clearTimeout(this.swapTimer);
    this.swapTimer = window.setTimeout(() => {
      this.img.style.width = `${size.width}px`;
      this.img.style.height = `${size.height}px`;
      this.img.style.left = `${(window.innerWidth - size.width) / 2}px`;
      this.img.style.top = `${(window.innerHeight - size.height) / 2}px`;
      this.img.src = this.resolveAsset(photo.thumb);
      this.img.classList.remove('is-swapping');
      this.preloadOriginal();
    }, 140);
  }

  /** Position and size the image for a photo, without animating. */
  private layout(index: number): void {
    const photo = this.photos[index];
    if (!photo) return;

    const size = this.finalSize(photo);
    this.counter.textContent = counterLabel(index, this.photos.length);
    this.img.style.width = `${size.width}px`;
    this.img.style.height = `${size.height}px`;
    this.img.style.left = `${(window.innerWidth - size.width) / 2}px`;
    this.img.style.top = `${(window.innerHeight - size.height) / 2}px`;
    this.img.style.transition = 'none';
    this.img.style.transform = '';
    this.img.style.borderRadius = '16px';
    this.img.style.opacity = '';
    // force a reflow so the next style change animates cleanly
    void this.img.offsetWidth;
    this.img.style.transition = '';

    this.img.src = this.resolveAsset(photo.thumb);
    this.img.alt = 'परिवार की तस्वीर';
  }

  private animateIn(origin: Rect | null): void {
    const width = this.img.offsetWidth;
    const height = this.img.offsetHeight;

    if (origin && width > 0 && height > 0) {
      const scale = Math.max(origin.width / width, origin.height / height);
      const dx = origin.x + origin.width / 2 - window.innerWidth / 2;
      const dy = origin.y + origin.height / 2 - window.innerHeight / 2;

      this.img.style.transition = 'none';
      this.img.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      this.img.style.borderRadius = '9px';
      this.img.style.opacity = '0.55';
      void this.img.offsetWidth;
      this.img.style.transition = '';

      requestAnimationFrame(() => {
        this.img.style.transform = 'translate(0px, 0px) scale(1)';
        this.img.style.borderRadius = '16px';
        this.img.style.opacity = '1';
      });
      return;
    }

    this.img.style.transition = 'none';
    this.img.style.transform = 'scale(0.94)';
    this.img.style.opacity = '0';
    void this.img.offsetWidth;
    this.img.style.transition = '';
    requestAnimationFrame(() => {
      this.img.style.transform = 'scale(1)';
      this.img.style.opacity = '1';
    });
  }

  /** Swap the thumbnail for the untouched original once it is decoded. */
  private preloadOriginal(): void {
    const photo = this.photos[this.index];
    if (!photo) return;

    const target = this.resolveAsset(photo.original);
    const request = new Image();
    request.decoding = 'async';
    request.onload = () => {
      if (!this.opened || this.photos[this.index]?.original !== photo.original) return;
      this.img.src = target;
    };
    request.src = target;
  }

  private finalSize(photo: Photo): { width: number; height: number } {
    const small = window.innerWidth < 720;
    const maxWidth = window.innerWidth * (small ? 0.92 : 0.82);
    const maxHeight = window.innerHeight * (small ? 0.72 : 0.8);
    const aspect = photo.width / photo.height;

    let width = maxWidth;
    let height = width / aspect;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspect;
    }
    return { width: Math.round(width), height: Math.round(height) };
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.opened) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.step(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.step(1);
    }
  };

  private onResize = (): void => {
    if (!this.opened) return;
    const photo = this.photos[this.index];
    if (!photo) return;
    const size = this.finalSize(photo);
    this.img.style.transition = 'none';
    this.img.style.width = `${size.width}px`;
    this.img.style.height = `${size.height}px`;
    this.img.style.left = `${(window.innerWidth - size.width) / 2}px`;
    this.img.style.top = `${(window.innerHeight - size.height) / 2}px`;
    void this.img.offsetWidth;
    this.img.style.transition = '';
  };

  dispose(): void {
    window.clearTimeout(this.closeTimer);
    window.clearTimeout(this.swapTimer);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }
}
