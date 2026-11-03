"use client";

/**
 * Liquid Glass JS — Core WebGL Refraction, Blur & Masking Engine
 * Based on https://github.com/dashersw/liquid-glass-js by Armagan Amcalar (MIT License)
 *
 * Implements:
 * - Container class (rounded, circle, pill shapes; multi-layer WebGL refraction & 13x13 Gaussian blur)
 * - Button class (extends Container; standalone or nested glass sampling parent Container's canvas)
 * - Global glassControls & live uniform updates (updateAllGlassInstances, randomizeGlassEffects)
 * - Fast DOM + Image snapshotter compatible with Tailwind CSS v4 (oklch-safe) & React lifecycle
 */

export type GlassShapeType = "rounded" | "circle" | "pill";

export type GlassThemePreset =
  | "light"
  | "dark"
  | "emerald"
  | "cyan"
  | "amber"
  | "crimson";

export interface GlassControlsState {
  edgeIntensity: number;
  rimIntensity: number;
  baseIntensity: number;
  edgeDistance: number;
  rimDistance: number;
  baseDistance: number;
  cornerBoost: number;
  rippleEffect: number;
  blurRadius: number;
  tintOpacity: number;
  warp: boolean;
  hideButtons: boolean;
}

export const DEFAULT_GLASS_CONTROLS: GlassControlsState = {
  edgeIntensity: 0.012,
  rimIntensity: 0.055,
  baseIntensity: 0.01,
  edgeDistance: 0.15,
  rimDistance: 0.8,
  baseDistance: 0.1,
  cornerBoost: 0.024,
  rippleEffect: 0.08,
  blurRadius: 5.0,
  tintOpacity: 0.22,
  warp: false,
  hideButtons: false,
};

declare global {
  interface Window {
    glassControls?: GlassControlsState;
    controlsContainer?: Container;
    html2canvas?: (
      element: HTMLElement,
      options?: Record<string, unknown>
    ) => Promise<HTMLCanvasElement>;
  }
}

export const glassControls: GlassControlsState = { ...DEFAULT_GLASS_CONTROLS };

if (typeof window !== "undefined") {
  window.glassControls = glassControls;
}

export const THEME_TINT_COLORS: Record<
  GlassThemePreset,
  { top: [number, number, number]; bottom: [number, number, number] }
> = {
  light: {
    top: [1.0, 1.0, 1.0],
    bottom: [0.88, 0.92, 0.97],
  },
  dark: {
    top: [0.06, 0.11, 0.22],
    bottom: [0.03, 0.06, 0.14],
  },
  emerald: {
    top: [0.85, 0.98, 0.93],
    bottom: [0.68, 0.93, 0.84],
  },
  cyan: {
    top: [0.88, 0.96, 1.0],
    bottom: [0.74, 0.9, 0.99],
  },
  amber: {
    top: [1.0, 0.96, 0.86],
    bottom: [0.98, 0.89, 0.68],
  },
  crimson: {
    top: [1.0, 0.91, 0.91],
    bottom: [0.98, 0.79, 0.79],
  },
};

export interface ContainerOptions {
  borderRadius?: number;
  type?: GlassShapeType;
  tintOpacity?: number;
  warp?: boolean;
  theme?: GlassThemePreset;
  mountElement?: HTMLElement | null;
}

export interface ButtonOptions extends ContainerOptions {
  text?: string;
  size?: number | string;
  onClick?: ((text: string) => void) | null;
}

interface GLRefs {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  texture: WebGLTexture | null;
  positionLoc: number;
  texcoordLoc: number;
  resolutionLoc: WebGLUniformLocation | null;
  textureSizeLoc: WebGLUniformLocation | null;
  scrollYLoc: WebGLUniformLocation | null;
  pageHeightLoc: WebGLUniformLocation | null;
  viewportHeightLoc: WebGLUniformLocation | null;
  blurRadiusLoc: WebGLUniformLocation | null;
  borderRadiusLoc: WebGLUniformLocation | null;
  containerPositionLoc: WebGLUniformLocation | null;
  buttonPositionLoc?: WebGLUniformLocation | null;
  containerSizeLoc?: WebGLUniformLocation | null;
  warpLoc: WebGLUniformLocation | null;
  edgeIntensityLoc: WebGLUniformLocation | null;
  rimIntensityLoc: WebGLUniformLocation | null;
  baseIntensityLoc: WebGLUniformLocation | null;
  edgeDistanceLoc: WebGLUniformLocation | null;
  rimDistanceLoc: WebGLUniformLocation | null;
  baseDistanceLoc: WebGLUniformLocation | null;
  cornerBoostLoc: WebGLUniformLocation | null;
  rippleEffectLoc: WebGLUniformLocation | null;
  tintOpacityLoc: WebGLUniformLocation | null;
  topTintLoc: WebGLUniformLocation | null;
  bottomTintLoc: WebGLUniformLocation | null;
  imageLoc: WebGLUniformLocation | null;
  positionBuffer: WebGLBuffer | null;
  texcoordBuffer: WebGLBuffer | null;
}

const VERTEX_SHADER_SOURCE = `
  attribute vec2 a_position;
  attribute vec2 a_texcoord;
  varying vec2 v_texcoord;

  void main() {
    gl_Position = vec4(a_position, 0, 1);
    v_texcoord = a_texcoord;
  }
`;

// Exact Fragment Shader from dashersw/liquid-glass-js/container.js with customizable top/bottom tint support
const CONTAINER_FRAGMENT_SHADER_SOURCE = `
  precision mediump float;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform vec2 u_textureSize;
  uniform float u_scrollY;
  uniform float u_pageHeight;
  uniform float u_viewportHeight;
  uniform float u_blurRadius;
  uniform float u_borderRadius;
  uniform vec2 u_containerPosition;
  uniform float u_warp;
  uniform float u_edgeIntensity;
  uniform float u_rimIntensity;
  uniform float u_baseIntensity;
  uniform float u_edgeDistance;
  uniform float u_rimDistance;
  uniform float u_baseDistance;
  uniform float u_cornerBoost;
  uniform float u_rippleEffect;
  uniform float u_tintOpacity;
  uniform vec3 u_topTint;
  uniform vec3 u_bottomTint;
  varying vec2 v_texcoord;

  // Function to calculate distance from rounded rectangle edge
  float roundedRectDistance(vec2 coord, vec2 size, float radius) {
    vec2 center = size * 0.5;
    vec2 pixelCoord = coord * size;
    vec2 toCorner = abs(pixelCoord - center) - (center - radius);
    float outsideCorner = length(max(toCorner, 0.0));
    float insideCorner = min(max(toCorner.x, toCorner.y), 0.0);
    return (outsideCorner + insideCorner - radius);
  }

  // Function to calculate distance from circle edge (negative inside, positive outside)
  float circleDistance(vec2 coord, vec2 size, float radius) {
    vec2 center = vec2(0.5, 0.5);
    vec2 pixelCoord = coord * size;
    vec2 centerPixel = center * size;
    float distFromCenter = length(pixelCoord - centerPixel);
    return distFromCenter - radius;
  }

  // Check if this is a pill (border radius is approximately 50% of height AND width > height)
  bool isPill(vec2 size, float radius) {
    float heightRatioDiff = abs(radius - size.y * 0.5);
    bool radiusMatchesHeight = heightRatioDiff < 2.0;
    bool isWiderThanTall = size.x > size.y + 4.0;
    return radiusMatchesHeight && isWiderThanTall;
  }

  // Check if this is a circle (border radius is approximately 50% of smaller dimension AND roughly square)
  bool isCircle(vec2 size, float radius) {
    float minDim = min(size.x, size.y);
    bool radiusMatchesMinDim = abs(radius - minDim * 0.5) < 1.0;
    bool isRoughlySquare = abs(size.x - size.y) < 4.0;
    return radiusMatchesMinDim && isRoughlySquare;
  }

  // Function to calculate distance from pill edge (capsule shape)
  float pillDistance(vec2 coord, vec2 size, float radius) {
    vec2 center = size * 0.5;
    vec2 pixelCoord = coord * size;
    vec2 capsuleStart = vec2(radius, center.y);
    vec2 capsuleEnd = vec2(size.x - radius, center.y);
    vec2 capsuleAxis = capsuleEnd - capsuleStart;
    float capsuleLength = length(capsuleAxis);

    if (capsuleLength > 0.0) {
      vec2 toPoint = pixelCoord - capsuleStart;
      float t = clamp(dot(toPoint, capsuleAxis) / dot(capsuleAxis, capsuleAxis), 0.0, 1.0);
      vec2 closestPointOnAxis = capsuleStart + t * capsuleAxis;
      return length(pixelCoord - closestPointOnAxis) - radius;
    } else {
      return length(pixelCoord - center) - radius;
    }
  }

  void main() {
    vec2 coord = v_texcoord;

    float scrollY = u_scrollY;
    vec2 containerSize = max(u_resolution, vec2(1.0));
    vec2 textureSize = max(u_textureSize, vec2(1.0));

    // Container position in viewport coordinates
    vec2 containerCenter = u_containerPosition + vec2(0.0, scrollY);

    // Convert container coordinates to page coordinates
    vec2 containerOffset = (coord - 0.5) * containerSize;
    vec2 pagePixel = containerCenter + containerOffset;

    // Convert to texture coordinate (0 to 1)
    vec2 textureCoord = pagePixel / textureSize;

    // Glass refraction effects
    float distFromEdgeShape;
    vec2 shapeNormal;

    if (isPill(containerSize, u_borderRadius)) {
      distFromEdgeShape = -pillDistance(coord, containerSize, u_borderRadius);
      vec2 center = vec2(0.5, 0.5);
      vec2 pixelCoord = coord * containerSize;
      vec2 capsuleStart = vec2(u_borderRadius, center.y * containerSize.y);
      vec2 capsuleEnd = vec2(containerSize.x - u_borderRadius, center.y * containerSize.y);
      vec2 capsuleAxis = capsuleEnd - capsuleStart;
      float capsuleLength = length(capsuleAxis);

      if (capsuleLength > 0.0) {
        vec2 toPoint = pixelCoord - capsuleStart;
        float t = clamp(dot(toPoint, capsuleAxis) / dot(capsuleAxis, capsuleAxis), 0.0, 1.0);
        vec2 closestPointOnAxis = capsuleStart + t * capsuleAxis;
        vec2 normalDir = pixelCoord - closestPointOnAxis;
        shapeNormal = length(normalDir) > 0.0 ? normalize(normalDir) : vec2(0.0, 1.0);
      } else {
        vec2 diff = coord - center;
        shapeNormal = length(diff) > 0.0 ? normalize(diff) : vec2(0.0, 1.0);
      }
    } else if (isCircle(containerSize, u_borderRadius)) {
      distFromEdgeShape = -circleDistance(coord, containerSize, u_borderRadius);
      vec2 center = vec2(0.5, 0.5);
      vec2 diff = coord - center;
      shapeNormal = length(diff) > 0.0 ? normalize(diff) : vec2(0.0, 1.0);
    } else {
      distFromEdgeShape = -roundedRectDistance(coord, containerSize, u_borderRadius);
      vec2 center = vec2(0.5, 0.5);
      vec2 diff = coord - center;
      shapeNormal = length(diff) > 0.0 ? normalize(diff) : vec2(0.0, 1.0);
    }
    distFromEdgeShape = max(distFromEdgeShape, 0.0);

    float distFromLeft = coord.x;
    float distFromRight = 1.0 - coord.x;
    float distFromTop = coord.y;
    float distFromBottom = 1.0 - coord.y;
    float minRes = max(min(containerSize.x, containerSize.y), 1.0);
    float distFromEdge = distFromEdgeShape / minRes;

    // Smooth glass refraction using shape-aware normal
    float normalizedDistance = distFromEdge * minRes;
    float baseIntensity = 1.0 - exp(-normalizedDistance * u_baseDistance);
    float edgeIntensity = exp(-normalizedDistance * u_edgeDistance);
    float rimIntensity = exp(-normalizedDistance * u_rimDistance);

    float baseComponent = u_warp > 0.5 ? baseIntensity * u_baseIntensity : 0.0;
    float totalIntensity = baseComponent + edgeIntensity * u_edgeIntensity + rimIntensity * u_rimIntensity;

    vec2 baseRefraction = shapeNormal * totalIntensity;

    float cornerProximityX = min(distFromLeft, distFromRight);
    float cornerProximityY = min(distFromTop, distFromBottom);
    float cornerDistance = max(cornerProximityX, cornerProximityY);
    float cornerNormalized = cornerDistance * minRes;

    float cornerBoost = exp(-cornerNormalized * 0.3) * u_cornerBoost;
    vec2 cornerRefraction = shapeNormal * cornerBoost;

    vec2 perpendicular = vec2(-shapeNormal.y, shapeNormal.x);
    float rippleEffect = sin(distFromEdge * 25.0) * u_rippleEffect * rimIntensity;
    vec2 textureRefraction = perpendicular * rippleEffect;

    vec2 totalRefraction = baseRefraction + cornerRefraction + textureRefraction;
    textureCoord += totalRefraction;

    // 13x13 Gaussian blur
    vec4 color = vec4(0.0);
    vec2 texelSize = 1.0 / textureSize;
    float sigma = max(u_blurRadius / 2.0, 0.5);
    vec2 blurStep = texelSize * sigma;

    float totalWeight = 0.0;

    for (float i = -6.0; i <= 6.0; i += 1.0) {
      for (float j = -6.0; j <= 6.0; j += 1.0) {
        float distance = length(vec2(i, j));
        if (distance > 6.0) continue;

        float weight = exp(-(distance * distance) / (2.0 * sigma * sigma));
        vec2 offset = vec2(i, j) * blurStep;
        vec2 sampleUV = clamp(textureCoord + offset, vec2(0.001), vec2(0.999));
        color += texture2D(u_image, sampleUV) * weight;
        totalWeight += weight;
      }
    }

    color /= max(totalWeight, 0.0001);

    // Vertical gradient tint
    float gradientPosition = coord.y;
    vec3 gradientTint = mix(u_topTint, u_bottomTint, gradientPosition);
    vec3 tintedColor = mix(color.rgb, gradientTint, u_tintOpacity);
    color = vec4(tintedColor, color.a);

    // Sampled gradient from page texture
    vec2 viewportCenter = containerCenter;
    float topY = clamp((viewportCenter.y - containerSize.y * 0.4) / textureSize.y, 0.01, 0.99);
    float midY = clamp(viewportCenter.y / textureSize.y, 0.01, 0.99);
    float bottomY = clamp((viewportCenter.y + containerSize.y * 0.4) / textureSize.y, 0.01, 0.99);

    vec3 topColor = vec3(0.0);
    vec3 midColor = vec3(0.0);
    vec3 bottomColor = vec3(0.0);

    float sampleCount = 0.0;
    for (float x = 0.1; x < 0.9; x += 0.1) {
      for (float yOffset = -2.0; yOffset <= 2.0; yOffset += 1.0) {
        vec2 topSample = vec2(x, clamp(topY + yOffset * texelSize.y, 0.01, 0.99));
        vec2 midSample = vec2(x, clamp(midY + yOffset * texelSize.y, 0.01, 0.99));
        vec2 bottomSample = vec2(x, clamp(bottomY + yOffset * texelSize.y, 0.01, 0.99));

        topColor += texture2D(u_image, topSample).rgb;
        midColor += texture2D(u_image, midSample).rgb;
        bottomColor += texture2D(u_image, bottomSample).rgb;
        sampleCount += 1.0;
      }
    }

    topColor /= max(sampleCount, 1.0);
    midColor /= max(sampleCount, 1.0);
    bottomColor /= max(sampleCount, 1.0);

    vec3 sampledGradient;
    if (gradientPosition < 0.1) {
      sampledGradient = topColor;
    } else if (gradientPosition > 0.9) {
      sampledGradient = bottomColor;
    } else {
      float transitionPos = (gradientPosition - 0.1) / 0.8;
      if (transitionPos < 0.5) {
        float t = transitionPos * 2.0;
        sampledGradient = mix(topColor, midColor, t);
      } else {
        float t = (transitionPos - 0.5) * 2.0;
        sampledGradient = mix(midColor, bottomColor, t);
      }
    }

    vec3 finalTinted = mix(color.rgb, sampledGradient, u_tintOpacity * 0.25);

    // Subtle specular rim highlight at the shape boundary
    float specularRim = exp(-normalizedDistance * 0.45) * 0.18;
    finalTinted = clamp(finalTinted + vec3(specularRim), 0.0, 1.0);

    // Shape mask (rounded rectangle, circle, or pill)
    float maskDistance;
    if (isPill(containerSize, u_borderRadius)) {
      maskDistance = pillDistance(coord, containerSize, u_borderRadius);
    } else if (isCircle(containerSize, u_borderRadius)) {
      maskDistance = circleDistance(coord, containerSize, u_borderRadius);
    } else {
      maskDistance = roundedRectDistance(coord, containerSize, u_borderRadius);
    }
    float mask = 1.0 - smoothstep(-1.0, 1.0, maskDistance);

    gl_FragColor = vec4(finalTinted, mask);
  }
`;

// Exact Nested Button Fragment Shader from dashersw/liquid-glass-js/button.js
const NESTED_BUTTON_FRAGMENT_SHADER_SOURCE = `
  precision mediump float;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform vec2 u_textureSize;
  uniform float u_blurRadius;
  uniform float u_borderRadius;
  uniform vec2 u_buttonPosition;
  uniform vec2 u_containerPosition;
  uniform vec2 u_containerSize;
  uniform float u_warp;
  uniform float u_edgeIntensity;
  uniform float u_rimIntensity;
  uniform float u_baseIntensity;
  uniform float u_edgeDistance;
  uniform float u_rimDistance;
  uniform float u_baseDistance;
  uniform float u_cornerBoost;
  uniform float u_rippleEffect;
  uniform float u_tintOpacity;
  uniform vec3 u_topTint;
  uniform vec3 u_bottomTint;
  varying vec2 v_texcoord;

  float roundedRectDistance(vec2 coord, vec2 size, float radius) {
    vec2 center = size * 0.5;
    vec2 pixelCoord = coord * size;
    vec2 toCorner = abs(pixelCoord - center) - (center - radius);
    float outsideCorner = length(max(toCorner, 0.0));
    float insideCorner = min(max(toCorner.x, toCorner.y), 0.0);
    return (outsideCorner + insideCorner - radius);
  }

  float circleDistance(vec2 coord, vec2 size, float radius) {
    vec2 center = vec2(0.5, 0.5);
    vec2 pixelCoord = coord * size;
    vec2 centerPixel = center * size;
    float distFromCenter = length(pixelCoord - centerPixel);
    return distFromCenter - radius;
  }

  bool isPill(vec2 size, float radius) {
    float heightRatioDiff = abs(radius - size.y * 0.5);
    bool radiusMatchesHeight = heightRatioDiff < 2.0;
    bool isWiderThanTall = size.x > size.y + 4.0;
    return radiusMatchesHeight && isWiderThanTall;
  }

  bool isCircle(vec2 size, float radius) {
    float minDim = min(size.x, size.y);
    bool radiusMatchesMinDim = abs(radius - minDim * 0.5) < 1.0;
    bool isRoughlySquare = abs(size.x - size.y) < 4.0;
    return radiusMatchesMinDim && isRoughlySquare;
  }

  float pillDistance(vec2 coord, vec2 size, float radius) {
    vec2 center = size * 0.5;
    vec2 pixelCoord = coord * size;
    vec2 capsuleStart = vec2(radius, center.y);
    vec2 capsuleEnd = vec2(size.x - radius, center.y);
    vec2 capsuleAxis = capsuleEnd - capsuleStart;
    float capsuleLength = length(capsuleAxis);

    if (capsuleLength > 0.0) {
      vec2 toPoint = pixelCoord - capsuleStart;
      float t = clamp(dot(toPoint, capsuleAxis) / dot(capsuleAxis, capsuleAxis), 0.0, 1.0);
      vec2 closestPointOnAxis = capsuleStart + t * capsuleAxis;
      return length(pixelCoord - closestPointOnAxis) - radius;
    } else {
      return length(pixelCoord - center) - radius;
    }
  }

  void main() {
    vec2 coord = v_texcoord;
    vec2 buttonSize = max(u_resolution, vec2(1.0));
    vec2 containerSize = max(u_containerSize, vec2(1.0));

    vec2 containerTopLeft = u_containerPosition - containerSize * 0.5;
    vec2 buttonTopLeft = u_buttonPosition - buttonSize * 0.5;
    vec2 buttonRelativePos = buttonTopLeft - containerTopLeft;
    vec2 buttonPixel = coord * buttonSize;
    vec2 containerPixel = buttonRelativePos + buttonPixel;
    vec2 baseTextureCoord = containerPixel / containerSize;

    float distFromEdgeShape;
    vec2 shapeNormal;

    if (isPill(buttonSize, u_borderRadius)) {
      distFromEdgeShape = -pillDistance(coord, buttonSize, u_borderRadius);
      vec2 center = vec2(0.5, 0.5);
      vec2 pixelCoord = coord * buttonSize;
      vec2 capsuleStart = vec2(u_borderRadius, center.y * buttonSize.y);
      vec2 capsuleEnd = vec2(buttonSize.x - u_borderRadius, center.y * buttonSize.y);
      vec2 capsuleAxis = capsuleEnd - capsuleStart;
      float capsuleLength = length(capsuleAxis);

      if (capsuleLength > 0.0) {
        vec2 toPoint = pixelCoord - capsuleStart;
        float t = clamp(dot(toPoint, capsuleAxis) / dot(capsuleAxis, capsuleAxis), 0.0, 1.0);
        vec2 closestPointOnAxis = capsuleStart + t * capsuleAxis;
        vec2 normalDir = pixelCoord - closestPointOnAxis;
        shapeNormal = length(normalDir) > 0.0 ? normalize(normalDir) : vec2(0.0, 1.0);
      } else {
        vec2 diff = coord - center;
        shapeNormal = length(diff) > 0.0 ? normalize(diff) : vec2(0.0, 1.0);
      }
    } else if (isCircle(buttonSize, u_borderRadius)) {
      distFromEdgeShape = -circleDistance(coord, buttonSize, u_borderRadius);
      vec2 center = vec2(0.5, 0.5);
      vec2 diff = coord - center;
      shapeNormal = length(diff) > 0.0 ? normalize(diff) : vec2(0.0, 1.0);
    } else {
      distFromEdgeShape = -roundedRectDistance(coord, buttonSize, u_borderRadius);
      vec2 center = vec2(0.5, 0.5);
      vec2 diff = coord - center;
      shapeNormal = length(diff) > 0.0 ? normalize(diff) : vec2(0.0, 1.0);
    }
    distFromEdgeShape = max(distFromEdgeShape, 0.0);

    float distFromLeft = coord.x;
    float distFromRight = 1.0 - coord.x;
    float distFromTop = coord.y;
    float distFromBottom = 1.0 - coord.y;
    float minRes = max(min(buttonSize.x, buttonSize.y), 1.0);
    float distFromEdge = distFromEdgeShape / minRes;

    float normalizedDistance = distFromEdge * minRes;
    float baseIntensity = 1.0 - exp(-normalizedDistance * u_baseDistance);
    float edgeIntensity = exp(-normalizedDistance * u_edgeDistance);
    float rimIntensity = exp(-normalizedDistance * u_rimDistance);

    float baseComponent = u_warp > 0.5 ? baseIntensity * u_baseIntensity : 0.0;
    float totalIntensity = baseComponent + edgeIntensity * u_edgeIntensity + rimIntensity * u_rimIntensity;

    vec2 baseRefraction = shapeNormal * totalIntensity;

    float cornerProximityX = min(distFromLeft, distFromRight);
    float cornerProximityY = min(distFromTop, distFromBottom);
    float cornerDistance = max(cornerProximityX, cornerProximityY);
    float cornerNormalized = cornerDistance * minRes;

    float cornerBoost = exp(-cornerNormalized * 0.3) * u_cornerBoost;
    vec2 cornerRefraction = shapeNormal * cornerBoost;

    vec2 perpendicular = vec2(-shapeNormal.y, shapeNormal.x);
    float rippleEffect = sin(distFromEdge * 30.0) * u_rippleEffect * rimIntensity;
    vec2 textureRefraction = perpendicular * rippleEffect;

    vec2 totalRefraction = baseRefraction + cornerRefraction + textureRefraction;
    vec2 textureCoord = baseTextureCoord + totalRefraction;

    // 9x9 blur for nested buttons
    vec4 color = vec4(0.0);
    vec2 texelSize = 1.0 / containerSize;
    float sigma = max(u_blurRadius / 3.0, 0.5);
    vec2 blurStep = texelSize * sigma;

    float totalWeight = 0.0;
    for (float i = -4.0; i <= 4.0; i += 1.0) {
      for (float j = -4.0; j <= 4.0; j += 1.0) {
        float distance = length(vec2(i, j));
        if (distance > 4.0) continue;

        float weight = exp(-(distance * distance) / (2.0 * sigma * sigma));
        vec2 offset = vec2(i, j) * blurStep;
        vec2 sampleUV = clamp(textureCoord + offset, vec2(0.001), vec2(0.999));
        color += texture2D(u_image, sampleUV) * weight;
        totalWeight += weight;
      }
    }

    color /= max(totalWeight, 0.0001);

    float gradientPosition = coord.y;
    vec3 gradientTint = mix(u_topTint, u_bottomTint, gradientPosition);
    vec3 tintedColor = mix(color.rgb, gradientTint, u_tintOpacity * 0.7);
    color = vec4(tintedColor, color.a);

    // SECOND BUTTON GRADIENT - sampling from container's texture for variation
    vec2 viewportCenter = u_buttonPosition - containerTopLeft;
    float topY = clamp((viewportCenter.y - buttonSize.y * 0.4) / containerSize.y, 0.01, 0.99);
    float midY = clamp(viewportCenter.y / containerSize.y, 0.01, 0.99);
    float bottomY = clamp((viewportCenter.y + buttonSize.y * 0.4) / containerSize.y, 0.01, 0.99);

    vec3 topColor = texture2D(u_image, vec2(0.5, topY)).rgb;
    vec3 midColor = texture2D(u_image, vec2(0.5, midY)).rgb;
    vec3 bottomColor = texture2D(u_image, vec2(0.5, bottomY)).rgb;

    vec3 sampledGradient;
    if (gradientPosition < 0.1) {
      sampledGradient = topColor;
    } else if (gradientPosition > 0.9) {
      sampledGradient = bottomColor;
    } else {
      float transitionPos = (gradientPosition - 0.1) / 0.8;
      if (transitionPos < 0.5) {
        float t = transitionPos * 2.0;
        sampledGradient = mix(topColor, midColor, t);
      } else {
        float t = (transitionPos - 0.5) * 2.0;
        sampledGradient = mix(midColor, bottomColor, t);
      }
    }

    vec3 secondTinted = mix(color.rgb, sampledGradient, u_tintOpacity * 0.4);

    // Button highlighting/shadow system
    vec3 buttonTopTint = vec3(1.08, 1.08, 1.08);
    vec3 buttonBottomTint = vec3(0.92, 0.92, 0.92);
    vec3 buttonGradient = mix(buttonTopTint, buttonBottomTint, gradientPosition);
    vec3 finalTinted = clamp(secondTinted * buttonGradient, 0.0, 1.0);

    float maskDistance;
    if (isPill(buttonSize, u_borderRadius)) {
      maskDistance = pillDistance(coord, buttonSize, u_borderRadius);
    } else if (isCircle(buttonSize, u_borderRadius)) {
      maskDistance = circleDistance(coord, buttonSize, u_borderRadius);
    } else {
      maskDistance = roundedRectDistance(coord, buttonSize, u_borderRadius);
    }
    float mask = 1.0 - smoothstep(-1.0, 1.0, maskDistance);

    gl_FragColor = vec4(finalTinted, mask);
  }
`;

/**
 * Synthesizes a rich, high-speed Canvas 2D snapshot of the current page
 * (ambient meshes, structural panels, headers, cards, and loaded document images)
 * so WebGL shaders have real page content to refract in < 4ms without crashing on Tailwind v4 oklch().
 */
export function buildFastPageSnapshotCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const vw = Math.max(window.innerWidth || 1280, 320);
  const fullH = Math.max(
    document.body?.scrollHeight || 900,
    document.documentElement?.scrollHeight || 900,
    window.innerHeight || 900
  );
  // Clamp height to 3600px so it always fits inside WebGL MAX_TEXTURE_SIZE
  const vh = Math.min(fullH, 3600);
  canvas.width = vw;
  canvas.height = vh;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;

  // 1. Base surface fill (#F8FAFC)
  ctx.fillStyle = "#F8FAFC";
  ctx.fillRect(0, 0, vw, vh);

  // 2. Ambient Liquid Glass refraction color blooms (Cyan, Emerald, Obsidian, Amber)
  const blooms = [
    { x: vw * 0.14, y: 120, r: 340, color: "rgba(56, 189, 248, 0.24)" },
    { x: vw * 0.86, y: 110, r: 340, color: "rgba(16, 185, 129, 0.22)" },
    { x: vw * 0.28, y: 460, r: 420, color: "rgba(14, 165, 233, 0.15)" },
    { x: vw * 0.74, y: 520, r: 420, color: "rgba(16, 185, 129, 0.16)" },
    { x: vw * 0.5, y: 980, r: 480, color: "rgba(56, 189, 248, 0.14)" },
    { x: vw * 0.35, y: 1450, r: 420, color: "rgba(245, 158, 11, 0.12)" },
    { x: vw * 0.75, y: 1550, r: 440, color: "rgba(16, 185, 129, 0.15)" },
  ];

  for (const b of blooms) {
    const grad = ctx.createRadialGradient(b.x, b.y, 10, b.x, b.y, b.r);
    grad.addColorStop(0, b.color);
    grad.addColorStop(1, "rgba(248, 250, 252, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, vw, vh);
  }

  // 3. Top header obsidian band
  const headerGrad = ctx.createLinearGradient(0, 0, vw, 96);
  headerGrad.addColorStop(0, "#0B132B");
  headerGrad.addColorStop(0.5, "#0F172A");
  headerGrad.addColorStop(1, "#0B132B");
  ctx.fillStyle = headerGrad;
  ctx.fillRect(0, 0, vw, 86);

  // Subtle emerald/cyan accent line under header
  const lineGrad = ctx.createLinearGradient(0, 84, vw, 84);
  lineGrad.addColorStop(0, "#38BDF8");
  lineGrad.addColorStop(0.5, "#10B981");
  lineGrad.addColorStop(1, "#38BDF8");
  ctx.fillStyle = lineGrad;
  ctx.fillRect(0, 84, vw, 3);

  // 4. Composite visible cards, sections, and loaded images at their real page coordinates
  const sections = document.querySelectorAll(
    "section, article, table, textarea, img"
  );
  sections.forEach((el) => {
    if (
      el.classList.contains("glass-container") ||
      el.classList.contains("glass-button")
    ) {
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    const top = rect.top + scrollY;
    const left = rect.left;
    if (top > vh || top + rect.height < 0) return;

    if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0) {
      try {
        ctx.drawImage(el, left, top, rect.width, rect.height);
      } catch {
        // Cross-origin or tainted image fallback
        ctx.fillStyle = "#E2E8F0";
        ctx.fillRect(left, top, rect.width, rect.height);
      }
      return;
    }

    if (el.tagName === "TEXTAREA") {
      ctx.fillStyle = "#0B132B";
      ctx.fillRect(left, top, rect.width, rect.height);
      return;
    }

    if (el.tagName === "SECTION") {
      ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
      ctx.fillRect(left, top, rect.width, rect.height);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(left, top, rect.width, rect.height);
    }
  });

  return canvas;
}

export class Container {
  static instances: Container[] = [];
  static pageSnapshot: HTMLCanvasElement | null = null;
  static isCapturing = false;
  static waitingForSnapshot: Container[] = [];

  width = 0;
  height = 0;
  borderRadius: number;
  type: GlassShapeType;
  tintOpacity: number;
  warp: boolean;
  theme: GlassThemePreset;
  canvas!: HTMLCanvasElement;
  element!: HTMLElement;
  ownsElement: boolean;
  gl: WebGLRenderingContext | null = null;
  gl_refs: Partial<GLRefs> = {};
  webglInitialized = false;
  children: Container[] = [];
  parent: Container | null = null;
  render?: () => void;
  private scrollHandler?: () => void;
  private rafId?: number;
  private destroyed = false;

  constructor(options: ContainerOptions = {}) {
    this.borderRadius =
      options.borderRadius !== undefined ? options.borderRadius : 24;
    this.type = options.type || "rounded";
    this.tintOpacity =
      options.tintOpacity !== undefined ? options.tintOpacity : 0.22;
    this.warp = options.warp !== undefined ? options.warp : false;
    this.theme = options.theme || "light";
    this.ownsElement = !options.mountElement;

    Container.instances.push(this);
    this.init(options.mountElement || null);
  }

  addChild(child: Container): Container {
    this.children.push(child);
    child.parent = this;

    if (child.element && this.element && child.ownsElement) {
      this.element.appendChild(child.element);
    }

    if (child instanceof Button) {
      child.setupAsNestedGlass();
    }

    this.updateSizeFromDOM();
    return child;
  }

  removeChild(child: Container): void {
    const index = this.children.indexOf(child);
    if (index > -1) {
      this.children.splice(index, 1);
      child.parent = null;

      if (
        child.element &&
        child.ownsElement &&
        this.element.contains(child.element)
      ) {
        this.element.removeChild(child.element);
      }

      this.updateSizeFromDOM();
    }
  }

  updateSizeFromDOM(): void {
    if (this.destroyed || typeof window === "undefined") return;
    requestAnimationFrame(() => {
      if (this.destroyed || !this.element || !this.canvas) return;
      const rect = this.element.getBoundingClientRect();
      let newWidth = Math.max(Math.ceil(rect.width), 2);
      let newHeight = Math.max(Math.ceil(rect.height), 2);

      if (this.type === "circle") {
        const size = Math.max(newWidth, newHeight);
        newWidth = size;
        newHeight = size;
        this.borderRadius = size / 2;
        if (this.ownsElement) {
          this.element.style.width = `${size}px`;
          this.element.style.height = `${size}px`;
        }
        this.element.style.borderRadius = `${this.borderRadius}px`;
      } else if (this.type === "pill") {
        this.borderRadius = newHeight / 2;
        this.element.style.borderRadius = `${this.borderRadius}px`;
      } else {
        this.element.style.borderRadius = `${this.borderRadius}px`;
      }

      if (newWidth !== this.width || newHeight !== this.height) {
        this.width = newWidth;
        this.height = newHeight;

        this.canvas.width = newWidth;
        this.canvas.height = newHeight;
        this.canvas.style.borderRadius = `${this.borderRadius}px`;

        if (this.gl_refs.gl && this.gl_refs.program) {
          const gl = this.gl_refs.gl;
          gl.useProgram(this.gl_refs.program);
          gl.viewport(0, 0, newWidth, newHeight);
          if (this.gl_refs.resolutionLoc) {
            gl.uniform2f(this.gl_refs.resolutionLoc, newWidth, newHeight);
          }
          if (this.gl_refs.borderRadiusLoc) {
            gl.uniform1f(this.gl_refs.borderRadiusLoc, this.borderRadius);
          }
          if (this.render) {
            this.render();
          }
        }

        // Update any nested glass children when container size changes
        this.children.forEach((child) => {
          if (
            child instanceof Button &&
            child.isNestedGlass &&
            child.gl_refs.gl &&
            child.gl_refs.texture
          ) {
            const gl = child.gl_refs.gl;
            gl.useProgram(child.gl_refs.program!);
            gl.bindTexture(gl.TEXTURE_2D, child.gl_refs.texture);
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              gl.RGBA,
              newWidth,
              newHeight,
              0,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              null
            );
            if (child.gl_refs.textureSizeLoc) {
              gl.uniform2f(child.gl_refs.textureSizeLoc, newWidth, newHeight);
            }
            if (child.gl_refs.containerSizeLoc) {
              gl.uniform2f(child.gl_refs.containerSizeLoc, newWidth, newHeight);
            }
          }
        });
      }
    });
  }

  init(mountElement: HTMLElement | null = null): void {
    if (typeof window === "undefined") return;
    this.createElement(mountElement);
    this.setupCanvas();
    this.updateSizeFromDOM();

    if (Container.pageSnapshot) {
      this.initWebGL();
    } else if (Container.isCapturing) {
      Container.waitingForSnapshot.push(this);
    } else {
      Container.isCapturing = true;
      Container.waitingForSnapshot.push(this);
      this.capturePageSnapshot();
    }
  }

  createElement(mountElement: HTMLElement | null = null): void {
    if (mountElement) {
      this.element = mountElement;
    } else {
      this.element = document.createElement("div");
    }

    this.element.classList.add("glass-container");
    if (this.theme === "dark") {
      this.element.classList.add("glass-container-dark");
    }
    if (this.type === "circle") {
      this.element.classList.add("glass-container-circle");
    } else if (this.type === "pill") {
      this.element.classList.add("glass-container-pill");
    }

    this.element.style.borderRadius = `${this.borderRadius}px`;

    this.canvas = document.createElement("canvas");
    this.canvas.className = "glass-webgl-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.style.borderRadius = `${this.borderRadius}px`;

    this.element.insertBefore(this.canvas, this.element.firstChild);
  }

  setupCanvas(): void {
    try {
      this.gl =
        (this.canvas.getContext("webgl", {
          preserveDrawingBuffer: true,
          alpha: true,
          premultipliedAlpha: false,
        }) as WebGLRenderingContext | null) ||
        (this.canvas.getContext(
          "experimental-webgl"
        ) as WebGLRenderingContext | null);
    } catch {
      this.gl = null;
    }

    if (!this.gl && this.element) {
      this.element.classList.add("glass-fallback");
    }
  }

  getPosition(): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  capturePageSnapshot(): void {
    try {
      const snapshot = buildFastPageSnapshotCanvas();
      Container.pageSnapshot = snapshot;
      Container.isCapturing = false;

      const waitingContainers = Container.waitingForSnapshot.slice();
      Container.waitingForSnapshot = [];

      waitingContainers.forEach((container) => {
        if (!container.webglInitialized && !container.destroyed) {
          container.initWebGL();
        }
      });
    } catch (error) {
      console.error("LiquidGlass snapshot error:", error);
      Container.isCapturing = false;
      Container.waitingForSnapshot = [];
    }
  }

  initWebGL(): void {
    if (!Container.pageSnapshot || !this.gl || this.destroyed) return;
    this.setupShader(Container.pageSnapshot);
    this.webglInitialized = true;
  }

  setupShader(image: TexImageSource & { width: number; height: number }): void {
    const gl = this.gl;
    if (!gl) return;

    const program = this.createProgram(
      gl,
      VERTEX_SHADER_SOURCE,
      CONTAINER_FRAGMENT_SHADER_SOURCE
    );
    if (!program) return;

    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const texcoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]),
      gl.STATIC_DRAW
    );

    const positionLoc = gl.getAttribLocation(program, "a_position");
    const texcoordLoc = gl.getAttribLocation(program, "a_texcoord");
    const resolutionLoc = gl.getUniformLocation(program, "u_resolution");
    const textureSizeLoc = gl.getUniformLocation(program, "u_textureSize");
    const scrollYLoc = gl.getUniformLocation(program, "u_scrollY");
    const pageHeightLoc = gl.getUniformLocation(program, "u_pageHeight");
    const viewportHeightLoc = gl.getUniformLocation(program, "u_viewportHeight");
    const blurRadiusLoc = gl.getUniformLocation(program, "u_blurRadius");
    const borderRadiusLoc = gl.getUniformLocation(program, "u_borderRadius");
    const containerPositionLoc = gl.getUniformLocation(
      program,
      "u_containerPosition"
    );
    const warpLoc = gl.getUniformLocation(program, "u_warp");
    const edgeIntensityLoc = gl.getUniformLocation(program, "u_edgeIntensity");
    const rimIntensityLoc = gl.getUniformLocation(program, "u_rimIntensity");
    const baseIntensityLoc = gl.getUniformLocation(program, "u_baseIntensity");
    const edgeDistanceLoc = gl.getUniformLocation(program, "u_edgeDistance");
    const rimDistanceLoc = gl.getUniformLocation(program, "u_rimDistance");
    const baseDistanceLoc = gl.getUniformLocation(program, "u_baseDistance");
    const cornerBoostLoc = gl.getUniformLocation(program, "u_cornerBoost");
    const rippleEffectLoc = gl.getUniformLocation(program, "u_rippleEffect");
    const tintOpacityLoc = gl.getUniformLocation(program, "u_tintOpacity");
    const topTintLoc = gl.getUniformLocation(program, "u_topTint");
    const bottomTintLoc = gl.getUniformLocation(program, "u_bottomTint");
    const imageLoc = gl.getUniformLocation(program, "u_image");

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.gl_refs = {
      gl,
      program,
      texture,
      textureSizeLoc,
      scrollYLoc,
      positionLoc,
      texcoordLoc,
      resolutionLoc,
      pageHeightLoc,
      viewportHeightLoc,
      blurRadiusLoc,
      borderRadiusLoc,
      containerPositionLoc,
      warpLoc,
      edgeIntensityLoc,
      rimIntensityLoc,
      baseIntensityLoc,
      edgeDistanceLoc,
      rimDistanceLoc,
      baseDistanceLoc,
      cornerBoostLoc,
      rippleEffectLoc,
      tintOpacityLoc,
      topTintLoc,
      bottomTintLoc,
      imageLoc,
      positionBuffer,
      texcoordBuffer,
    };

    const w = Math.max(this.canvas.width, 2);
    const h = Math.max(this.canvas.height, 2);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
    gl.enableVertexAttribArray(texcoordLoc);
    gl.vertexAttribPointer(texcoordLoc, 2, gl.FLOAT, false, 0, 0);

    const ctrl = window.glassControls || glassControls;
    const tintPalette =
      THEME_TINT_COLORS[this.theme] || THEME_TINT_COLORS.light;

    gl.uniform2f(resolutionLoc, w, h);
    gl.uniform2f(textureSizeLoc, image.width, image.height);
    gl.uniform1f(blurRadiusLoc, ctrl.blurRadius);
    gl.uniform1f(borderRadiusLoc, this.borderRadius);
    gl.uniform1f(warpLoc, this.warp || ctrl.warp ? 1.0 : 0.0);
    gl.uniform1f(edgeIntensityLoc, ctrl.edgeIntensity);
    gl.uniform1f(rimIntensityLoc, ctrl.rimIntensity);
    gl.uniform1f(baseIntensityLoc, ctrl.baseIntensity);
    gl.uniform1f(edgeDistanceLoc, ctrl.edgeDistance);
    gl.uniform1f(rimDistanceLoc, ctrl.rimDistance);
    gl.uniform1f(baseDistanceLoc, ctrl.baseDistance);
    gl.uniform1f(cornerBoostLoc, ctrl.cornerBoost);
    gl.uniform1f(rippleEffectLoc, ctrl.rippleEffect);
    gl.uniform1f(tintOpacityLoc, this.tintOpacity);
    gl.uniform3f(
      topTintLoc,
      tintPalette.top[0],
      tintPalette.top[1],
      tintPalette.top[2]
    );
    gl.uniform3f(
      bottomTintLoc,
      tintPalette.bottom[0],
      tintPalette.bottom[1],
      tintPalette.bottom[2]
    );

    const position = this.getPosition();
    gl.uniform2f(containerPositionLoc, position.x, position.y);

    const pageHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    const viewportHeight = window.innerHeight;
    gl.uniform1f(pageHeightLoc, pageHeight);
    gl.uniform1f(viewportHeightLoc, viewportHeight);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(imageLoc, 0);

    this.startRenderLoop();
  }

  startRenderLoop(): void {
    const render = () => {
      if (this.destroyed || !this.gl_refs.gl || !this.gl_refs.program) return;

      const gl = this.gl_refs.gl;
      gl.useProgram(this.gl_refs.program);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const scrollY =
        window.pageYOffset || document.documentElement.scrollTop || 0;
      if (this.gl_refs.scrollYLoc) {
        gl.uniform1f(this.gl_refs.scrollYLoc, scrollY);
      }

      const position = this.getPosition();
      if (this.gl_refs.containerPositionLoc) {
        gl.uniform2f(this.gl_refs.containerPositionLoc, position.x, position.y);
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Re-render any nested glass child buttons so they sample the updated parent canvas
      this.children.forEach((child) => {
        if (child instanceof Button && child.isNestedGlass && child.render) {
          child.render();
        }
      });
    };

    render();

    this.scrollHandler = () => render();
    window.addEventListener("scroll", this.scrollHandler, { passive: true });
    this.render = render;
  }

  createProgram(
    gl: WebGLRenderingContext,
    vsSource: string,
    fsSource: string
  ): WebGLProgram | null {
    const vs = this.compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Program link error:", gl.getProgramInfoLog(program));
      return null;
    }

    return program;
  }

  compileShader(
    gl: WebGLRenderingContext,
    type: number,
    source: string
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Shader compile error:", gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.scrollHandler && typeof window !== "undefined") {
      window.removeEventListener("scroll", this.scrollHandler);
    }
    if (this.rafId !== undefined && typeof window !== "undefined") {
      cancelAnimationFrame(this.rafId);
    }
    const idx = Container.instances.indexOf(this);
    if (idx > -1) {
      Container.instances.splice(idx, 1);
    }
    const waitIdx = Container.waitingForSnapshot.indexOf(this);
    if (waitIdx > -1) {
      Container.waitingForSnapshot.splice(waitIdx, 1);
    }
    if (this.gl) {
      try {
        if (this.gl_refs.texture) this.gl.deleteTexture(this.gl_refs.texture);
        if (this.gl_refs.positionBuffer)
          this.gl.deleteBuffer(this.gl_refs.positionBuffer);
        if (this.gl_refs.texcoordBuffer)
          this.gl.deleteBuffer(this.gl_refs.texcoordBuffer);
        if (this.gl_refs.program) this.gl.deleteProgram(this.gl_refs.program);
        const loseContextExt = this.gl.getExtension("WEBGL_lose_context");
        if (loseContextExt) loseContextExt.loseContext();
      } catch {
        // Ignore cleanup errors
      }
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}

export class Button extends Container {
  text: string;
  fontSize: number;
  onClick: ((text: string) => void) | null;
  isNestedGlass = false;
  textElement?: HTMLDivElement;

  constructor(options: ButtonOptions = {}) {
    const text = options.text || "Button";
    const fontSize =
      typeof options.size === "number"
        ? options.size
        : parseInt(String(options.size || 16), 10) || 16;
    const onClick = options.onClick || null;
    const type = options.type || "rounded";
    const warp = options.warp !== undefined ? options.warp : false;
    const tintOpacity =
      options.tintOpacity !== undefined ? options.tintOpacity : 0.22;

    super({
      borderRadius: fontSize,
      type,
      tintOpacity,
      warp,
      theme: options.theme || "light",
      mountElement: options.mountElement || null,
    });

    this.text = text;
    this.fontSize = fontSize;
    this.onClick = onClick;

    this.element.classList.add("glass-button");
    if (this.type === "circle") {
      this.element.classList.add("glass-button-circle");
    }

    if (this.ownsElement) {
      this.createTextElement();
      this.setupClickHandler();
      this.setSizeFromText();
    } else {
      this.updateSizeFromDOM();
    }
  }

  static measureText(text: string, fontSize: number): TextMetrics {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
    return ctx.measureText(text);
  }

  setSizeFromText(): void {
    let width: number;
    let height: number;

    if (this.type === "circle") {
      const circleSize = Math.ceil(this.fontSize * 2.2);
      width = circleSize;
      height = circleSize;
      this.borderRadius = circleSize / 2;
      this.element.style.width = `${width}px`;
      this.element.style.height = `${height}px`;
    } else if (this.type === "pill") {
      const textMetrics = Button.measureText(this.text, this.fontSize);
      width = Math.ceil(textMetrics.width + this.fontSize * 1.8);
      height = Math.ceil(this.fontSize * 2.1);
      this.borderRadius = height / 2;
      this.element.style.minWidth = `${width}px`;
      this.element.style.minHeight = `${height}px`;
    } else {
      const textMetrics = Button.measureText(this.text, this.fontSize);
      width = Math.ceil(textMetrics.width + this.fontSize * 1.8);
      height = Math.ceil(this.fontSize * 2.2);
      this.borderRadius = Math.min(this.fontSize, 14);
      this.element.style.minWidth = `${width}px`;
      this.element.style.minHeight = `${height}px`;
    }

    this.element.style.borderRadius = `${this.borderRadius}px`;
    if (this.canvas) {
      this.canvas.style.borderRadius = `${this.borderRadius}px`;
    }
    this.updateSizeFromDOM();
  }

  createTextElement(): void {
    this.textElement = document.createElement("div");
    this.textElement.className = "glass-button-text";
    this.textElement.textContent = this.text;
    this.textElement.style.fontSize = `${this.fontSize}px`;
    this.element.appendChild(this.textElement);
  }

  setupClickHandler(): void {
    if (this.onClick && this.element) {
      this.element.addEventListener("click", (e) => {
        e.preventDefault();
        if (this.onClick) this.onClick(this.text);
      });
    }
  }

  setupAsNestedGlass(): void {
    if (this.parent && !this.isNestedGlass) {
      this.isNestedGlass = true;
      if (this.webglInitialized) {
        this.initWebGL();
      }
    }
  }

  override initWebGL(): void {
    if (!Container.pageSnapshot || !this.gl) return;
    if (this.parent && this.isNestedGlass) {
      this.initNestedGlass();
    } else {
      super.initWebGL();
    }
  }

  initNestedGlass(): void {
    if (!this.parent || !this.parent.webglInitialized) {
      setTimeout(() => this.initNestedGlass(), 80);
      return;
    }
    this.setupDynamicNestedShader();
    this.webglInitialized = true;
  }

  setupDynamicNestedShader(): void {
    const gl = this.gl;
    if (!gl || !this.parent) return;

    const program = this.createProgram(
      gl,
      VERTEX_SHADER_SOURCE,
      NESTED_BUTTON_FRAGMENT_SHADER_SOURCE
    );
    if (!program) return;

    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const texcoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]),
      gl.STATIC_DRAW
    );

    const positionLoc = gl.getAttribLocation(program, "a_position");
    const texcoordLoc = gl.getAttribLocation(program, "a_texcoord");
    const resolutionLoc = gl.getUniformLocation(program, "u_resolution");
    const textureSizeLoc = gl.getUniformLocation(program, "u_textureSize");
    const blurRadiusLoc = gl.getUniformLocation(program, "u_blurRadius");
    const borderRadiusLoc = gl.getUniformLocation(program, "u_borderRadius");
    const buttonPositionLoc = gl.getUniformLocation(
      program,
      "u_buttonPosition"
    );
    const containerPositionLoc = gl.getUniformLocation(
      program,
      "u_containerPosition"
    );
    const containerSizeLoc = gl.getUniformLocation(program, "u_containerSize");
    const warpLoc = gl.getUniformLocation(program, "u_warp");
    const edgeIntensityLoc = gl.getUniformLocation(program, "u_edgeIntensity");
    const rimIntensityLoc = gl.getUniformLocation(program, "u_rimIntensity");
    const baseIntensityLoc = gl.getUniformLocation(program, "u_baseIntensity");
    const edgeDistanceLoc = gl.getUniformLocation(program, "u_edgeDistance");
    const rimDistanceLoc = gl.getUniformLocation(program, "u_rimDistance");
    const baseDistanceLoc = gl.getUniformLocation(program, "u_baseDistance");
    const cornerBoostLoc = gl.getUniformLocation(program, "u_cornerBoost");
    const rippleEffectLoc = gl.getUniformLocation(program, "u_rippleEffect");
    const tintOpacityLoc = gl.getUniformLocation(program, "u_tintOpacity");
    const topTintLoc = gl.getUniformLocation(program, "u_topTint");
    const bottomTintLoc = gl.getUniformLocation(program, "u_bottomTint");
    const imageLoc = gl.getUniformLocation(program, "u_image");

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    const containerCanvas = this.parent.canvas;
    const cw = Math.max(containerCanvas.width, 2);
    const ch = Math.max(containerCanvas.height, 2);

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      cw,
      ch,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.gl_refs = {
      gl,
      program,
      texture,
      textureSizeLoc,
      positionLoc,
      texcoordLoc,
      resolutionLoc,
      blurRadiusLoc,
      borderRadiusLoc,
      buttonPositionLoc,
      containerPositionLoc,
      containerSizeLoc,
      warpLoc,
      edgeIntensityLoc,
      rimIntensityLoc,
      baseIntensityLoc,
      edgeDistanceLoc,
      rimDistanceLoc,
      baseDistanceLoc,
      cornerBoostLoc,
      rippleEffectLoc,
      tintOpacityLoc,
      topTintLoc,
      bottomTintLoc,
      imageLoc,
      positionBuffer,
      texcoordBuffer,
    };

    const w = Math.max(this.canvas.width, 2);
    const h = Math.max(this.canvas.height, 2);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
    gl.enableVertexAttribArray(texcoordLoc);
    gl.vertexAttribPointer(texcoordLoc, 2, gl.FLOAT, false, 0, 0);

    const ctrl = window.glassControls || glassControls;
    const tintPalette =
      THEME_TINT_COLORS[this.theme] || THEME_TINT_COLORS.light;

    gl.uniform2f(resolutionLoc, w, h);
    gl.uniform2f(textureSizeLoc, cw, ch);
    gl.uniform1f(blurRadiusLoc, ctrl.blurRadius);
    gl.uniform1f(borderRadiusLoc, this.borderRadius);
    gl.uniform1f(warpLoc, this.warp || ctrl.warp ? 1.0 : 0.0);
    gl.uniform1f(edgeIntensityLoc, ctrl.edgeIntensity);
    gl.uniform1f(rimIntensityLoc, ctrl.rimIntensity);
    gl.uniform1f(baseIntensityLoc, ctrl.baseIntensity);
    gl.uniform1f(edgeDistanceLoc, ctrl.edgeDistance);
    gl.uniform1f(rimDistanceLoc, ctrl.rimDistance);
    gl.uniform1f(baseDistanceLoc, ctrl.baseDistance);
    gl.uniform1f(cornerBoostLoc, ctrl.cornerBoost);
    gl.uniform1f(rippleEffectLoc, ctrl.rippleEffect);
    gl.uniform1f(tintOpacityLoc, this.tintOpacity);
    gl.uniform3f(
      topTintLoc,
      tintPalette.top[0],
      tintPalette.top[1],
      tintPalette.top[2]
    );
    gl.uniform3f(
      bottomTintLoc,
      tintPalette.bottom[0],
      tintPalette.bottom[1],
      tintPalette.bottom[2]
    );

    const buttonPosition = this.getPosition();
    const containerPosition = this.parent.getPosition();
    gl.uniform2f(buttonPositionLoc, buttonPosition.x, buttonPosition.y);
    gl.uniform2f(
      containerPositionLoc,
      containerPosition.x,
      containerPosition.y
    );
    gl.uniform2f(
      containerSizeLoc,
      Math.max(this.parent.width, 2),
      Math.max(this.parent.height, 2)
    );

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(imageLoc, 0);

    this.startNestedRenderLoop();
  }

  startNestedRenderLoop(): void {
    const render = () => {
      if (!this.gl_refs.gl || !this.gl_refs.program || !this.parent) return;

      const gl = this.gl_refs.gl;
      gl.useProgram(this.gl_refs.program);

      const containerCanvas = this.parent.canvas;
      if (containerCanvas.width > 0 && containerCanvas.height > 0) {
        gl.bindTexture(gl.TEXTURE_2D, this.gl_refs.texture!);
        try {
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            containerCanvas
          );
        } catch {
          // Ignore transient resize errors
        }
      }

      gl.clear(gl.COLOR_BUFFER_BIT);

      const buttonPosition = this.getPosition();
      const containerPosition = this.parent.getPosition();
      if (this.gl_refs.buttonPositionLoc) {
        gl.uniform2f(
          this.gl_refs.buttonPositionLoc,
          buttonPosition.x,
          buttonPosition.y
        );
      }
      if (this.gl_refs.containerPositionLoc) {
        gl.uniform2f(
          this.gl_refs.containerPositionLoc,
          containerPosition.x,
          containerPosition.y
        );
      }
      if (this.gl_refs.containerSizeLoc) {
        gl.uniform2f(
          this.gl_refs.containerSizeLoc,
          Math.max(this.parent.width, 2),
          Math.max(this.parent.height, 2)
        );
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Re-render any nested glass child buttons so they sample the updated parent canvas
      this.children.forEach((child) => {
        if (child instanceof Button && child.isNestedGlass && child.render) {
          child.render();
        }
      });
    };

    render();
    this.render = render;
  }
}

/**
 * Updates all active Container & Button WebGL uniforms in real time
 * (Ported from dashersw/liquid-glass-js/controls.js)
 */
export function updateAllGlassInstances(): void {
  const ctrl =
    (typeof window !== "undefined" && window.glassControls) || glassControls;

  Container.instances.forEach((instance) => {
    if (instance.gl_refs && instance.gl_refs.gl && instance.gl_refs.program) {
      const gl = instance.gl_refs.gl;
      gl.useProgram(instance.gl_refs.program);

      if (instance.gl_refs.blurRadiusLoc) {
        gl.uniform1f(instance.gl_refs.blurRadiusLoc, ctrl.blurRadius);
      }
      if (instance.gl_refs.edgeIntensityLoc) {
        gl.uniform1f(instance.gl_refs.edgeIntensityLoc, ctrl.edgeIntensity);
      }
      if (instance.gl_refs.rimIntensityLoc) {
        gl.uniform1f(instance.gl_refs.rimIntensityLoc, ctrl.rimIntensity);
      }
      if (instance.gl_refs.baseIntensityLoc) {
        gl.uniform1f(instance.gl_refs.baseIntensityLoc, ctrl.baseIntensity);
      }
      if (instance.gl_refs.edgeDistanceLoc) {
        gl.uniform1f(instance.gl_refs.edgeDistanceLoc, ctrl.edgeDistance);
      }
      if (instance.gl_refs.rimDistanceLoc) {
        gl.uniform1f(instance.gl_refs.rimDistanceLoc, ctrl.rimDistance);
      }
      if (instance.gl_refs.baseDistanceLoc) {
        gl.uniform1f(instance.gl_refs.baseDistanceLoc, ctrl.baseDistance);
      }
      if (instance.gl_refs.cornerBoostLoc) {
        gl.uniform1f(instance.gl_refs.cornerBoostLoc, ctrl.cornerBoost);
      }
      if (instance.gl_refs.rippleEffectLoc) {
        gl.uniform1f(instance.gl_refs.rippleEffectLoc, ctrl.rippleEffect);
      }
      if (instance.gl_refs.warpLoc) {
        gl.uniform1f(
          instance.gl_refs.warpLoc,
          instance.warp || ctrl.warp ? 1.0 : 0.0
        );
      }
      if (instance.gl_refs.tintOpacityLoc) {
        gl.uniform1f(instance.gl_refs.tintOpacityLoc, ctrl.tintOpacity);
      }

      if (instance.render) {
        instance.render();
      }
    }
  });
}

/**
 * Randomizes glass shader parameters within creative ranges
 * (Ported from dashersw/liquid-glass-js/controls.js)
 */
export function randomizeGlassEffects(): GlassControlsState {
  const randomValues: Partial<GlassControlsState> = {
    edgeIntensity: Number((0.005 + Math.random() * 0.025).toFixed(3)),
    rimIntensity: Number((0.02 + Math.random() * 0.13).toFixed(3)),
    baseIntensity: Number((0.005 + Math.random() * 0.025).toFixed(3)),
    edgeDistance: Number((0.1 + Math.random() * 0.3).toFixed(2)),
    rimDistance: Number((0.3 + Math.random() * 1.2).toFixed(2)),
    baseDistance: Number((0.08 + Math.random() * 0.17).toFixed(2)),
    cornerBoost: Number((0.01 + Math.random() * 0.05).toFixed(3)),
    rippleEffect: Number((0.05 + Math.random() * 0.25).toFixed(2)),
    blurRadius: Number((2 + Math.random() * 10).toFixed(1)),
    tintOpacity: Number((0.12 + Math.random() * 0.45).toFixed(2)),
    warp: Math.random() < 0.3,
  };

  Object.assign(glassControls, randomValues);
  if (typeof window !== "undefined" && window.glassControls) {
    Object.assign(window.glassControls, randomValues);
  }
  updateAllGlassInstances();
  return { ...glassControls };
}

/**
 * Resets glass shader parameters back to PackMatch calibrated defaults
 */
export function resetGlassEffects(): GlassControlsState {
  Object.assign(glassControls, DEFAULT_GLASS_CONTROLS);
  if (typeof window !== "undefined" && window.glassControls) {
    Object.assign(window.glassControls, DEFAULT_GLASS_CONTROLS);
  }
  updateAllGlassInstances();
  return { ...glassControls };
}

/**
 * Re-captures the page snapshot and updates all active Container textures
 * (e.g., on window resize or shipment case change)
 */
export function refreshGlassSnapshot(): void {
  if (typeof window === "undefined") return;
  const snapshot = buildFastPageSnapshotCanvas();
  Container.pageSnapshot = snapshot;

  Container.instances.forEach((instance) => {
    instance.updateSizeFromDOM();
    if (
      instance.gl_refs &&
      instance.gl_refs.gl &&
      instance.gl_refs.program &&
      instance.gl_refs.texture
    ) {
      const gl = instance.gl_refs.gl;
      gl.useProgram(instance.gl_refs.program);

      if (
        instance instanceof Button &&
        instance.parent &&
        instance.isNestedGlass
      ) {
        const containerCanvas = instance.parent.canvas;
        if (containerCanvas.width > 0 && containerCanvas.height > 0) {
          gl.bindTexture(gl.TEXTURE_2D, instance.gl_refs.texture);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            containerCanvas
          );
          if (instance.gl_refs.textureSizeLoc) {
            gl.uniform2f(
              instance.gl_refs.textureSizeLoc,
              containerCanvas.width,
              containerCanvas.height
            );
          }
        }
      } else {
        gl.bindTexture(gl.TEXTURE_2D, instance.gl_refs.texture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          snapshot
        );
        if (instance.gl_refs.textureSizeLoc) {
          gl.uniform2f(
            instance.gl_refs.textureSizeLoc,
            snapshot.width,
            snapshot.height
          );
        }
      }

      if (instance.render) {
        instance.render();
      }
    }
  });
}
