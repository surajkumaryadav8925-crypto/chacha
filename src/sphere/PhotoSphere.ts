import {
  Group,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type ShaderMaterial,
  type Texture,
} from 'three';
import { CONFIG } from '../config';
import { mulberry32 } from '../lib/random';
import type { Photo, Rect } from '../types';
import { createDust, type DustField } from './dust';
import { coverScale, fibonacciSphere, tileDimensions } from './layout';
import { createPlanet, type Planet } from './planet';
import { PhotoTexturePool, createPlaceholderTexture } from './textures';
import { createTileMaterial } from './tileMaterial';

type TileMesh = Mesh<PlaneGeometry, ShaderMaterial>;

interface Tile {
  mesh: TileMesh;
  material: ShaderMaterial;
  photoIndex: number;
  basePosition: Vector3;
  width: number;
  height: number;
  hover: number;
  hoverTarget: number;
  reveal: number;
  revealTarget: number;
}

export interface PhotoSphereOptions {
  canvas: HTMLCanvasElement;
  photos: Photo[];
  resolveAsset: (path: string) => string;
  onActivate: (photoIndex: number, rect: Rect | null) => void;
  onProgress?: (loaded: number, total: number) => void;
}

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const tempQuaternion = new Quaternion();
const tempQuaternion2 = new Quaternion();
const tempVector = new Vector3();

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * The photo planet: a Fibonacci sphere of individually lit, raycastable photo
 * cards with custom drag/pinch/inertia controls and no per-frame React work.
 */
export class PhotoSphere {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly world = new Group();
  private readonly raycaster = new Raycaster();
  private readonly pointerNdc = new Vector2();
  private readonly textures: PhotoTexturePool;
  private readonly planet: Planet;
  private readonly dust: DustField;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly placeholder = createPlaceholderTexture();
  private readonly tiles: Tile[] = [];
  private readonly tileMeshes: TileMesh[] = [];
  private readonly tileByObject = new Map<object, Tile>();

  private fitDistance = 4;
  private zoomTarget = 1;
  private introZoom = 1.16;

  private readonly velocity = new Vector2(0, 0);
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragging = false;
  private dragMoved = 0;
  private dragStartTime = 0;
  private lastX = 0;
  private lastY = 0;
  private lastMoveTime = 0;
  private pinchDistance = 0;
  private lastInteraction = 0;
  private autoAmount = 0;

  private pointerInside = false;
  private readonly lastPointer = new Vector2();
  private pendingHover: { x: number; y: number } | null = null;
  private lastPickTime = 0;
  private hovered: Tile | null = null;

  private readonly reducedMotion: boolean;
  private running = false;
  private frameId = 0;
  private lastTime = 0;
  private elapsed = 0;

  constructor(private readonly options: PhotoSphereOptions) {
    const { canvas, photos } = options;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.renderer = new WebGLRenderer({
      canvas,
      // the photo cards antialias their own rounded edges in the shader, so
      // MSAA only adds fill-rate cost on high-DPI screens
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;

    this.camera = new PerspectiveCamera(
      CONFIG.camera.fov,
      1,
      CONFIG.camera.near,
      CONFIG.camera.far,
    );
    this.camera.position.set(0, 0, this.fitDistance);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(this.world);

    this.planet = createPlanet(CONFIG.sphere.radius);
    this.world.add(this.planet.core);

    this.dust = createDust(
      CONFIG.dust.count,
      CONFIG.dust.innerRadius,
      CONFIG.dust.outerRadius,
      this.renderer.getPixelRatio(),
    );
    this.scene.add(this.dust.points);
    this.scene.add(this.planet.halo);

    this.textures = new PhotoTexturePool(
      CONFIG.reveal.textureConcurrency,
      Math.min(4, this.renderer.capabilities.getMaxAnisotropy()),
    );

    this.buildTiles(photos);
    this.bindEvents();
    this.resize();

    this.lastInteraction = performance.now();
    this.start();

    // paint once straight away so the globe exists even before the first rAF
    this.renderer.render(this.scene, this.camera);

    // textures stream in on a timer so a hidden/background tab still loads them
    window.setTimeout(() => this.loadTextures(), 40);
  }

  // ── construction ──────────────────────────────────────────────

  private buildTiles(photos: Photo[]): void {
    const unique = Math.max(photos.length, 1);
    const copies = Math.max(1, Math.ceil(CONFIG.sphere.targetTiles / unique));
    const total = unique * copies;

    const { width, height } = tileDimensions(
      total,
      CONFIG.sphere.radius,
      CONFIG.sphere.tileAspect,
      CONFIG.sphere.coverage,
    );
    const slots = fibonacciSphere(total, CONFIG.sphere.radius);

    // Spread every photo across the whole sphere, one shuffled pass per copy,
    // so repeats of the same picture never sit next to each other.
    const rng = mulberry32(0x5eed1e);
    const order: number[] = [];
    for (let copy = 0; copy < copies; copy += 1) {
      const pool = Array.from({ length: unique }, (_, index) => index);
      for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        const value = pool[i] ?? i;
        pool[i] = pool[j] ?? j;
        pool[j] = value;
      }
      order.push(...pool);
    }

    for (let i = 0; i < total; i += 1) {
      const slot = slots[i];
      const photoIndex = order[i] ?? i % unique;
      const photo = photos[photoIndex];
      if (!slot || !photo) continue;

      const material = createTileMaterial(this.placeholder, width, height);

      // Cover-crop, then gently vary the framing between repeats of a photo.
      const cover = coverScale(photo.aspect, CONFIG.sphere.tileAspect);
      const variant = (i * 7 + photoIndex * 3) % 3;
      const crop = variant === 0 ? 1 : variant === 1 ? 0.88 : 0.78;
      material.uniforms.uUvScale?.value.set(cover.x * crop, cover.y * crop);
      if (variant > 0) material.uniforms.uUvOffset?.value.set(0, -0.018);

      const mesh = new Mesh(this.geometry, material);
      mesh.position.copy(slot.position);
      mesh.quaternion.copy(slot.quaternion);
      mesh.scale.set(width, height, 1);

      const tile: Tile = {
        mesh,
        material,
        photoIndex,
        basePosition: slot.position.clone(),
        width,
        height,
        hover: 0,
        hoverTarget: 0,
        reveal: 0,
        revealTarget: 0,
      };

      this.tiles.push(tile);
      this.tileMeshes.push(mesh);
      this.tileByObject.set(mesh, tile);
      this.world.add(mesh);
    }
  }

  private loadTextures(): void {
    const byPhoto = new Map<number, Tile[]>();
    for (const tile of this.tiles) {
      const list = byPhoto.get(tile.photoIndex);
      if (list) list.push(tile);
      else byPhoto.set(tile.photoIndex, [tile]);
    }

    // Front-facing photos first, so the globe fills in where the eye looks.
    const facing = new Map<number, number>();
    for (const tile of this.tiles) {
      const dot = tile.basePosition.clone().normalize().z;
      facing.set(tile.photoIndex, Math.max(facing.get(tile.photoIndex) ?? -1, dot));
    }
    const ordered = [...byPhoto.keys()].sort(
      (a, b) => (facing.get(b) ?? 0) - (facing.get(a) ?? 0),
    );

    const total = ordered.length;
    let loaded = 0;

    for (const photoIndex of ordered) {
      const photo = this.options.photos[photoIndex];
      const photoTiles = byPhoto.get(photoIndex) ?? [];
      if (!photo) continue;

      this.textures.request(this.options.resolveAsset(photo.thumb), (texture: Texture) => {
        for (const tile of photoTiles) {
          tile.material.uniforms.uMap!.value = texture;
          tile.material.uniforms.uHasMap!.value = 1;
          tile.revealTarget = 1;
        }
        loaded += 1;
        this.options.onProgress?.(loaded, total);
      });
    }
  }

  // ── public API ────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.frameId = requestAnimationFrame(this.tick);
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.velocity.set(0, 0);
    this.setHovered(null);
  }

  resume(): void {
    this.lastInteraction = performance.now();
    this.start();
  }

  /** Lightweight introspection used by the automated checks. */
  getDebugInfo(): {
    tiles: number;
    textures: number;
    drawCalls: number;
    zoom: number;
    cameraZ: number;
    rotation: [number, number, number, number];
    hovered: number | null;
    triangles: number;
  } {
    const q = this.world.quaternion;
    return {
      tiles: this.tiles.length,
      textures: this.textures.loaded,
      drawCalls: this.renderer.info.render.calls,
      zoom: this.zoomTarget,
      cameraZ: +this.camera.position.z.toFixed(4),
      rotation: [+q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4), +q.w.toFixed(4)],
      hovered: this.hovered ? this.hovered.photoIndex : null,
      triangles: this.renderer.info.render.triangles,
    };
  }

  dispose(): void {
    this.pause();
    this.unbindEvents();
    for (const tile of this.tiles) {
      tile.material.dispose();
      this.world.remove(tile.mesh);
    }
    this.tiles.length = 0;
    this.tileMeshes.length = 0;
    this.tileByObject.clear();
    this.geometry.dispose();
    this.placeholder.dispose();
    this.textures.dispose();
    this.planet.dispose();
    this.dust.dispose();
    this.world.clear();
    this.renderer.dispose();
  }

  // ── loop ──────────────────────────────────────────────────────

  private tick = (now: number): void => {
    if (!this.running) return;
    this.frameId = requestAnimationFrame(this.tick);

    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.elapsed += dt;

    this.update(dt, now);
    this.renderer.render(this.scene, this.camera);
  };

  private update(dt: number, now: number): void {
    // cinematic push-in on load
    if (this.introZoom > 1.0005) {
      this.introZoom += (1 - this.introZoom) * (1 - Math.exp(-dt * 1.9));
    } else {
      this.introZoom = 1;
    }

    if (!this.dragging) {
      const speed = Math.hypot(this.velocity.x, this.velocity.y);
      if (speed > 0.002) {
        this.applyRotation(this.velocity.x * dt, this.velocity.y * dt);
        this.velocity.multiplyScalar(Math.exp(-CONFIG.interaction.inertiaDamping * dt));
      } else {
        this.velocity.set(0, 0);
      }

      const idle = now - this.lastInteraction;
      const shouldSpin =
        !this.reducedMotion && idle > CONFIG.interaction.idleDelayMs && speed < 0.02;
      this.autoAmount = clamp(this.autoAmount + (shouldSpin ? dt * 0.7 : -dt * 2.2), 0, 1);

      if (this.autoAmount > 0.001) {
        this.applyRotation(CONFIG.interaction.autoRotateSpeed * this.autoAmount * dt, 0);
      }
    }

    this.updateCamera(dt);

    // hover picking: on movement, and a few times a second while the globe drifts
    if (!this.dragging && this.pointers.size === 0 && this.pointerInside) {
      const due = now - this.lastPickTime > 90;
      if (this.pendingHover || (due && this.autoAmount > 0.02)) {
        const point = this.pendingHover ?? { x: this.lastPointer.x, y: this.lastPointer.y };
        this.pendingHover = null;
        this.lastPickTime = now;
        this.setHovered(this.pick(point.x, point.y));
      }
    }

    for (const tile of this.tiles) {
      if (tile.hover !== tile.hoverTarget) {
        tile.hover += (tile.hoverTarget - tile.hover) * (1 - Math.exp(-dt * 12));
        if (Math.abs(tile.hoverTarget - tile.hover) < 0.002) tile.hover = tile.hoverTarget;
        const scale = 1 + (CONFIG.interaction.hoverScale - 1) * tile.hover;
        tile.mesh.scale.set(tile.width * scale, tile.height * scale, 1);
        tile.mesh.position
          .copy(tile.basePosition)
          .multiplyScalar(1 + CONFIG.interaction.hoverLift * tile.hover);
        tile.material.uniforms.uHover!.value = tile.hover;
      }

      if (tile.reveal !== tile.revealTarget) {
        tile.reveal +=
          (tile.revealTarget - tile.reveal) *
          (1 - Math.exp(-dt * CONFIG.reveal.speed * 1.8));
        if (Math.abs(tile.revealTarget - tile.reveal) < 0.004) tile.reveal = tile.revealTarget;
        tile.material.uniforms.uReveal!.value = tile.reveal;
      }
    }

    const drift = this.reducedMotion ? 0.25 : 1;
    this.dust.material.uniforms.uTime!.value = this.elapsed * drift;
    this.dust.points.rotation.y = this.elapsed * 0.008 * drift;

    const haloMaterial = this.planet.halo.material;
    haloMaterial.opacity = 0.5 + Math.sin(this.elapsed * 0.6) * 0.05;
  }

  private updateCamera(dt: number): void {
    const target = this.fitDistance * this.zoomTarget * this.introZoom;
    const smoothing = 1 - Math.exp(-dt * CONFIG.camera.smoothing);
    this.camera.position.z += (target - this.camera.position.z) * smoothing;
  }

  // ── interaction ───────────────────────────────────────────────

  private applyRotation(yaw: number, pitch: number): void {
    if (yaw === 0 && pitch === 0) return;
    tempQuaternion.setFromAxisAngle(AXIS_Y, yaw);
    tempQuaternion2.setFromAxisAngle(AXIS_X, pitch);
    this.world.quaternion
      .premultiply(tempQuaternion2)
      .premultiply(tempQuaternion)
      .normalize();
  }

  private pick(clientX: number, clientY: number): Tile | null {
    const bounds = this.options.canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;

    this.pointerNdc.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -(((clientY - bounds.top) / bounds.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const hits = this.raycaster.intersectObjects(this.tileMeshes, false);
    for (const hit of hits) {
      const tile = this.tileByObject.get(hit.object);
      if (tile && tile.reveal > 0.35) return tile;
    }
    return null;
  }

  private setHovered(tile: Tile | null): void {
    if (this.hovered === tile) return;
    if (this.hovered) this.hovered.hoverTarget = 0;
    this.hovered = tile;
    if (tile) tile.hoverTarget = 1;
    this.options.canvas.classList.toggle('is-pointing', tile !== null);
  }

  /** Projected on-screen box of a tile, used for the zoom-in transition. */
  private screenRect(tile: Tile): Rect | null {
    const width = window.innerWidth;
    const height = window.innerHeight;
    tile.mesh.updateWorldMatrix(true, false);
    this.camera.updateMatrixWorld();

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const [cx, cy] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ] as const) {
      tempVector.set(cx, cy, 0).applyMatrix4(tile.mesh.matrixWorld).project(this.camera);
      if (tempVector.z > 1) return null;
      const px = (tempVector.x * 0.5 + 0.5) * width;
      const py = (-tempVector.y * 0.5 + 0.5) * height;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }

    if (!Number.isFinite(minX) || maxX - minX < 2 || maxY - minY < 2) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  private pointerDistance(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.running) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    event.preventDefault();
    this.lastInteraction = performance.now();
    this.velocity.set(0, 0);
    this.autoAmount = 0;

    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      this.options.canvas.setPointerCapture(event.pointerId);
    } catch {
      // some environments refuse capture for synthetic pointers — dragging still works
    }

    if (this.pointers.size === 1) {
      this.dragging = true;
      this.dragMoved = 0;
      this.dragStartTime = performance.now();
      this.lastMoveTime = this.dragStartTime;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.options.canvas.classList.add('is-dragging');
      this.setHovered(null);
    } else if (this.pointers.size === 2) {
      this.dragging = false;
      this.pinchDistance = this.pointerDistance();
      this.options.canvas.classList.remove('is-dragging');
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    const tracked = this.pointers.get(event.pointerId);

    if (!tracked) {
      if (event.pointerType === 'mouse') {
        this.pointerInside = true;
        this.lastPointer.set(event.clientX, event.clientY);
        this.pendingHover = { x: event.clientX, y: event.clientY };
      }
      return;
    }

    tracked.x = event.clientX;
    tracked.y = event.clientY;
    this.lastInteraction = performance.now();

    if (this.pointers.size >= 2) {
      const distance = this.pointerDistance();
      if (this.pinchDistance > 0 && distance > 0) {
        this.zoomTarget = clamp(
          this.zoomTarget * (this.pinchDistance / distance),
          CONFIG.camera.zoomMin,
          CONFIG.camera.zoomMax,
        );
      }
      this.pinchDistance = distance;
      return;
    }

    if (!this.dragging) return;

    const now = performance.now();
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    const dt = Math.max(now - this.lastMoveTime, 8) / 1000;

    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.lastMoveTime = now;
    this.dragMoved += Math.abs(dx) + Math.abs(dy);

    const yaw = dx * CONFIG.interaction.rotateSpeed;
    const pitch = dy * CONFIG.interaction.rotateSpeed;
    this.applyRotation(yaw, pitch);

    const max = CONFIG.interaction.maxVelocity;
    this.velocity.x += (clamp(yaw / dt, -max, max) - this.velocity.x) * 0.4;
    this.velocity.y += (clamp(pitch / dt, -max, max) - this.velocity.y) * 0.4;
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.delete(event.pointerId);
    try {
      if (this.options.canvas.hasPointerCapture(event.pointerId)) {
        this.options.canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // ignore — nothing to release
    }

    if (this.pointers.size > 0) {
      this.pinchDistance = this.pointers.size === 2 ? this.pointerDistance() : 0;
      return;
    }

    const wasDragging = this.dragging;
    const moved = this.dragMoved;
    const elapsed = performance.now() - this.dragStartTime;

    this.dragging = false;
    this.pinchDistance = 0;
    this.lastInteraction = performance.now();
    this.options.canvas.classList.remove('is-dragging');

    if (
      wasDragging &&
      moved <= CONFIG.interaction.clickSlopPx &&
      elapsed <= CONFIG.interaction.clickMaxMs &&
      event.type === 'pointerup'
    ) {
      const tile = this.pick(event.clientX, event.clientY);
      if (tile) {
        this.velocity.set(0, 0);
        this.options.onActivate(tile.photoIndex, this.screenRect(tile));
      }
    }
  };

  private onPointerCancel = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    this.dragging = false;
    this.pinchDistance = 0;
    this.velocity.set(0, 0);
    this.options.canvas.classList.remove('is-dragging');
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    this.zoomTarget = clamp(
      this.zoomTarget * Math.exp(delta * 0.0011),
      CONFIG.camera.zoomMin,
      CONFIG.camera.zoomMax,
    );
    this.lastInteraction = performance.now();
  };

  private onPointerEnter = (): void => {
    this.pointerInside = true;
  };

  private onPointerLeave = (): void => {
    this.pointerInside = false;
    this.pendingHover = null;
    if (!this.dragging) this.setHovered(null);
  };

  private onResize = (): void => {
    this.resize();
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.frameId);
    } else if (this.running) {
      this.lastTime = performance.now();
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private bindEvents(): void {
    const canvas = this.options.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('pointerenter', this.onPointerEnter);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private unbindEvents(): void {
    const canvas = this.options.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('pointerenter', this.onPointerEnter);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Cap the drawing buffer instead of the DPR alone: a 5K window at DPR 2
    // would otherwise rasterise ~15M pixels and drop well below 60fps.
    const maxPixels = 5_000_000;
    const pixelRatio = Math.max(
      1,
      Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(maxPixels / Math.max(width * height, 1))),
    );

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.fitDistance = this.computeFitDistance();
    this.updateCamera(1);

    this.dust.material.uniforms.uPixelRatio!.value = pixelRatio;
  }

  /** Distance at which the whole globe fits the viewport with a little air. */
  private computeFitDistance(): number {
    const vFov = (CONFIG.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const vertical = CONFIG.sphere.radius / Math.sin(vFov / 2);
    const horizontal = CONFIG.sphere.radius / Math.sin(hFov / 2);
    return Math.max(vertical, horizontal) * CONFIG.camera.fitMargin;
  }
}
