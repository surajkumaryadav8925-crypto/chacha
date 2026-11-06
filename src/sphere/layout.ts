import { Matrix4, Quaternion, Vector3 } from 'three';

export interface SphereSlot {
  position: Vector3;
  quaternion: Quaternion;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const WORLD_UP = new Vector3(0, 1, 0);
const FALLBACK_AXIS = new Vector3(0, 0, 1);

/**
 * Evenly distributes `count` tiles over a sphere using the golden-angle
 * (Fibonacci) spiral, and gives each tile a tangent frame that faces outward.
 */
export function fibonacciSphere(count: number, radius: number): SphereSlot[] {
  const slots: SphereSlot[] = [];
  const basis = new Matrix4();
  const right = new Vector3();
  const up = new Vector3();

  for (let i = 0; i < count; i += 1) {
    const y = 1 - (2 * i + 1) / count;
    const ring = Math.sqrt(Math.max(1 - y * y, 0));
    const theta = i * GOLDEN_ANGLE;

    const position = new Vector3(Math.cos(theta) * ring, y, Math.sin(theta) * ring)
      .normalize()
      .multiplyScalar(radius);

    const normal = position.clone().normalize();
    const reference = Math.abs(normal.y) > 0.999 ? FALLBACK_AXIS : WORLD_UP;
    right.crossVectors(reference, normal).normalize();
    up.crossVectors(normal, right).normalize();

    basis.makeBasis(right, up, normal);

    slots.push({
      position,
      quaternion: new Quaternion().setFromRotationMatrix(basis),
    });
  }

  return slots;
}

/**
 * Tile size that fills `coverage` of the sphere surface with `count` cards of
 * the given aspect ratio. Neighbouring cards keep a visible gap.
 */
export function tileDimensions(
  count: number,
  radius: number,
  aspect: number,
  coverage: number,
): { width: number; height: number } {
  const area = coverage * 4 * Math.PI * radius * radius;
  const height = Math.sqrt(area / (Math.max(count, 1) * aspect));
  return { width: height * aspect, height };
}

/**
 * UV scale that makes a photo of `photoAspect` *cover* a tile of `tileAspect`
 * (the photo keeps its proportions, the overflow is cropped evenly).
 */
export function coverScale(
  photoAspect: number,
  tileAspect: number,
): { x: number; y: number } {
  return photoAspect >= tileAspect
    ? { x: tileAspect / photoAspect, y: 1 }
    : { x: 1, y: photoAspect / tileAspect };
}
