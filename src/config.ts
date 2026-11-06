/**
 * All tunable numbers for the experience live here.
 * Change `targetTiles` to make the globe denser or lighter.
 */
export const CONFIG = {
  sphere: {
    radius: 1,
    /** How many photo tiles the globe should be made of. */
    targetTiles: 200,
    /** Tile width / tile height (a soft portrait card). */
    tileAspect: 0.94,
    /** Share of the sphere surface covered by tiles (rest is breathing room). */
    coverage: 0.78,
  },
  camera: {
    fov: 42,
    near: 0.1,
    far: 80,
    /** Breathing room around the globe when fully zoomed out. */
    fitMargin: 1.16,
    zoomMin: 0.44,
    zoomMax: 1.38,
    smoothing: 7,
  },
  interaction: {
    /** Radians of rotation per pixel dragged. */
    rotateSpeed: 0.0052,
    inertiaDamping: 2.1,
    maxVelocity: 6.5,
    autoRotateSpeed: 0.062,
    idleDelayMs: 2400,
    hoverScale: 1.075,
    hoverLift: 0.016,
    clickSlopPx: 7,
    clickMaxMs: 600,
  },
  reveal: {
    /** How quickly the fade-in approaches its target, per second. */
    speed: 3.6,
    textureConcurrency: 5,
  },
  dust: {
    count: 900,
    innerRadius: 2.4,
    outerRadius: 17,
  },
} as const;
