import './styles.css';
import photoData from './data/photos.json';
import { isWebGLAvailable } from './lib/webgl';
import { PhotoSphere } from './sphere/PhotoSphere';
import type { Photo } from './types';
import { showFallback } from './ui/fallback';
import { PhotoViewer } from './viewer/PhotoViewer';

const photos = (photoData as { photos: Photo[] }).photos;
const resolveAsset = (path: string): string => `${import.meta.env.BASE_URL}${path}`;

function boot(): void {
  const canvas = document.getElementById('scene');
  const loading = document.getElementById('loading');
  let loadingHidden = false;
  const hideLoading = (): void => {
    if (loadingHidden || !loading) return;
    loadingHidden = true;
    loading.classList.add('is-hidden');
    window.setTimeout(() => loading.remove(), 1200);
  };

  if (!(canvas instanceof HTMLCanvasElement) || photos.length === 0 || !isWebGLAvailable()) {
    showFallback(photos, resolveAsset);
    return;
  }

  const viewer = new PhotoViewer(photos, resolveAsset);
  let sphere: PhotoSphere | null = null;

  try {
    sphere = new PhotoSphere({
      canvas,
      photos,
      resolveAsset,
      onActivate: (photoIndex, rect) => {
        sphere?.pause();
        viewer.open(photoIndex, rect);
      },
      onProgress: (loaded) => {
        if (loaded >= 1) hideLoading();
      },
    });
  } catch (error) {
    console.error('3D दृश्य शुरू नहीं हो सका:', error);
    showFallback(photos, resolveAsset);
    return;
  }

  viewer.onClose = () => sphere?.resume();

  if (import.meta.env.DEV) {
    // handy for tuning and for the automated checks
    Object.assign(window, { __sphere: sphere, __viewer: viewer, __photos: photos });
  }

  // never leave the loading line hanging if something is slow
  window.setTimeout(hideLoading, 2600);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
