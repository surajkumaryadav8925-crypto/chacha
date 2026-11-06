import {
  AdditiveBlending,
  CanvasTexture,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from 'three';

const coreVertexShader = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPosition.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const coreFragmentShader = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uRim;

  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    float facing = clamp(dot(normalize(vWorldNormal), normalize(vViewDir)), 0.0, 1.0);
    float rim = pow(1.0 - facing, 3.5);
    vec3 color = uDeep + uRim * rim * 0.85;
    gl_FragColor = vec4(color, 1.0);

    #include <colorspace_fragment>
  }
`;

/** Soft radial sprite that gives the globe a faint atmosphere. */
function createHaloTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(96, 128, 255, 0.30)');
    gradient.addColorStop(0.42, 'rgba(78, 104, 232, 0.13)');
    gradient.addColorStop(0.72, 'rgba(58, 76, 180, 0.04)');
    gradient.addColorStop(1, 'rgba(40, 52, 130, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export interface Planet {
  core: Mesh;
  halo: Sprite;
  dispose: () => void;
}

/**
 * The opaque body of the globe (which also hides the far side of the sphere)
 * plus a barely-there atmospheric halo.
 */
export function createPlanet(radius: number): Planet {
  const geometry = new SphereGeometry(radius * 0.984, 64, 48);
  const material = new ShaderMaterial({
    vertexShader: coreVertexShader,
    fragmentShader: coreFragmentShader,
    uniforms: {
      uDeep: { value: [0.014, 0.019, 0.042] },
      uRim: { value: [0.05, 0.075, 0.17] },
    },
  });

  const core = new Mesh(geometry, material);
  core.renderOrder = 0;

  const haloTexture = createHaloTexture();
  const haloMaterial = new SpriteMaterial({
    map: haloTexture,
    transparent: true,
    // depth tested so the globe itself hides the middle of the halo
    depthTest: true,
    depthWrite: false,
    blending: AdditiveBlending,
    opacity: 0.55,
  });
  const halo = new Sprite(haloMaterial);
  halo.scale.setScalar(radius * 3.1);
  halo.renderOrder = -1;

  return {
    core,
    halo,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      haloTexture.dispose();
      haloMaterial.dispose();
    },
  };
}
