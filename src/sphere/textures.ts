import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';

/** 1×1 dark pixel used before a photo texture has arrived. */
export function createPlaceholderTexture(): DataTexture {
  const texture = new DataTexture(new Uint8Array([14, 18, 30, 255]), 1, 1, RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

interface Entry {
  texture: Texture;
  loaded: boolean;
  listeners: Set<(texture: Texture) => void>;
}

/**
 * Downloads photo textures with a small concurrency limit so the globe can
 * build itself progressively instead of blocking on ~200 images at once.
 * Duplicate tiles share a single texture.
 */
export class PhotoTexturePool {
  private readonly loader = new TextureLoader();
  private readonly entries = new Map<string, Entry>();
  private readonly queue: string[] = [];
  private inFlight = 0;
  private loadedCount = 0;

  constructor(
    private readonly maxConcurrent: number,
    private readonly anisotropy: number,
  ) {}

  get loaded(): number {
    return this.loadedCount;
  }

  /** Texture for the URL, or null when it has not been requested yet. */
  peek(url: string): Texture | null {
    return this.entries.get(url)?.texture ?? null;
  }

  request(url: string, onLoaded: (texture: Texture) => void): void {
    const existing = this.entries.get(url);
    if (existing) {
      if (existing.loaded) onLoaded(existing.texture);
      else existing.listeners.add(onLoaded);
      return;
    }

    const entry: Entry = {
      texture: createPlaceholderTexture(),
      loaded: false,
      listeners: new Set([onLoaded]),
    };
    this.entries.set(url, entry);
    this.queue.push(url);
    this.pump();
  }

  private pump(): void {
    while (this.inFlight < this.maxConcurrent && this.queue.length > 0) {
      const url = this.queue.shift();
      if (!url) return;
      const entry = this.entries.get(url);
      if (!entry || entry.loaded) continue;

      this.inFlight += 1;
      this.loader.load(
        url,
        (texture) => {
          texture.colorSpace = SRGBColorSpace;
          texture.anisotropy = this.anisotropy;
          texture.minFilter = LinearMipmapLinearFilter;
          texture.magFilter = LinearFilter;
          texture.generateMipmaps = true;
          texture.needsUpdate = true;

          entry.texture.dispose();
          entry.texture = texture;
          entry.loaded = true;
          this.loadedCount += 1;
          this.inFlight -= 1;

          for (const listener of entry.listeners) listener(texture);
          entry.listeners.clear();
          this.pump();
        },
        undefined,
        () => {
          // Keep the dark placeholder rather than breaking the globe.
          this.inFlight -= 1;
          entry.listeners.clear();
          this.pump();
        },
      );
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.texture.dispose();
    this.entries.clear();
    this.queue.length = 0;
  }
}
