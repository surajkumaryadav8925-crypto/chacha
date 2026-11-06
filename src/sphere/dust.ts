import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  ShaderMaterial,
} from 'three';
import { mulberry32 } from '../lib/random';

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  attribute vec3 aColor;

  uniform float uTime;
  uniform float uPixelRatio;

  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec3 p = position;
    float wobble = uTime * 0.16 + aSeed * 6.28318;
    p.x += cos(wobble) * 0.22;
    p.y += sin(wobble * 0.8) * 0.26;
    p.z += sin(wobble * 0.55) * 0.18;

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float size = aSize * uPixelRatio * (220.0 / max(-mvPosition.z, 0.001));
    gl_PointSize = clamp(size, 0.6, 7.0 * uPixelRatio);
    gl_Position = projectionMatrix * mvPosition;

    vAlpha = 0.28 + 0.5 * (0.5 + 0.5 * sin(uTime * 0.5 + aSeed * 24.0));
    vColor = aColor;
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.0, d);
    alpha *= alpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor, alpha * vAlpha * 0.6);

    #include <colorspace_fragment>
  }
`;

export interface DustField {
  points: Points;
  material: ShaderMaterial;
  dispose: () => void;
}

/**
 * A slow drift of tiny illuminated specks around the globe — kept deliberately
 * faint so the sphere stays the subject.
 */
export function createDust(
  count: number,
  innerRadius: number,
  outerRadius: number,
  pixelRatio: number,
): DustField {
  const rng = mulberry32(0x9e3779b9);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const seeds = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  const palette = [
    [0.55, 0.68, 1.0],
    [1.0, 0.82, 0.62],
    [0.72, 0.86, 1.0],
  ];

  for (let i = 0; i < count; i += 1) {
    const u = rng() * 2 - 1;
    const theta = rng() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(1 - u * u, 0));
    const radius = innerRadius + (outerRadius - innerRadius) * Math.cbrt(rng());

    positions[i * 3] = Math.cos(theta) * ring * radius;
    positions[i * 3 + 1] = u * radius;
    positions[i * 3 + 2] = Math.sin(theta) * ring * radius;

    sizes[i] = 0.7 + rng() * 2.1;
    seeds[i] = rng();

    const colour = palette[Math.floor(rng() * palette.length)] ?? palette[0];
    colors[i * 3] = colour[0];
    colors[i * 3 + 1] = colour[1];
    colors[i * 3 + 2] = colour[2];
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3));

  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
    },
  });

  const points = new Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    material,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
