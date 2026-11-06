import { ShaderMaterial, Vector2, type Texture } from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldNormal = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
    vViewDir = normalize(cameraPosition - worldPosition.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uUvScale;
  uniform vec2 uUvOffset;
  uniform vec2 uTileSize;
  uniform float uHover;
  uniform float uReveal;
  uniform float uHasMap;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  float roundedBox(vec2 point, vec2 halfSize, float radius) {
    vec2 q = abs(point) - halfSize + radius;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
  }

  void main() {
    vec2 halfSize = uTileSize * 0.5;
    vec2 p = (vUv - 0.5) * uTileSize;
    float cornerRadius = min(uTileSize.x, uTileSize.y) * 0.06;
    float dist = roundedBox(p, halfSize, cornerRadius);

    // antialiased rounded-card mask
    float aa = max(fwidth(dist) * 1.15, 0.0004);
    float alpha = 1.0 - smoothstep(-aa, aa, dist);
    if (alpha < 0.01) discard;

    vec2 uv = (vUv - 0.5) * uUvScale + 0.5 + uUvOffset;
    vec3 color = texture2D(uMap, uv).rgb;

    // dark card while the texture is still streaming in
    if (uHasMap < 0.5) {
      color = mix(vec3(0.05, 0.065, 0.115), vec3(0.085, 0.11, 0.2), vUv.y);
    }

    // soft planet lighting: cards turn away from the viewer near the rim
    float facing = clamp(dot(normalize(vWorldNormal), normalize(vViewDir)), 0.0, 1.0);
    float key = clamp(dot(normalize(vWorldNormal), normalize(vec3(-0.4, 0.66, 0.62))), 0.0, 1.0);
    float shade = mix(0.4, 1.0, smoothstep(0.02, 0.92, facing));
    shade *= 0.9 + 0.16 * key;
    color *= shade;

    // gentle per-photo vignette, keeps the mosaic from feeling flat
    vec2 centred = vUv - 0.5;
    color *= 1.0 - 0.2 * dot(centred, centred) * 4.0;

    // fine dark edge + warm rim that lights up on hover
    float edgeWidth = max(0.006, min(uTileSize.x, uTileSize.y) * 0.032);
    float edge = 1.0 - smoothstep(0.0, edgeWidth, -dist);
    color = mix(color, color * 0.6, edge * 0.5);
    color += vec3(1.0, 0.79, 0.52) * edge * (0.05 + 0.85 * uHover);
    color *= 1.0 + 0.14 * uHover;

    gl_FragColor = vec4(color, alpha * uReveal);

    #include <colorspace_fragment>
  }
`;

export function createTileMaterial(
  map: Texture,
  width: number,
  height: number,
): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    uniforms: {
      uMap: { value: map },
      uUvScale: { value: new Vector2(1, 1) },
      uUvOffset: { value: new Vector2(0, 0) },
      uTileSize: { value: new Vector2(width, height) },
      uHover: { value: 0 },
      uReveal: { value: 0 },
      uHasMap: { value: 0 },
    },
  });
}
