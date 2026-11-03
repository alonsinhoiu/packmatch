"use client";

import React from "react";

/**
 * PackMatch — Glassmorphism nativo por CSS (ZERO-WEBGL).
 *
 * Refactor operativo: los componentes anteriores inicializaban un <canvas>
 * WebGL por instancia (Container/Button de liquid-glass-js), superando el
 * límite de contextos de Chromium/WebKit (8–16) con 15+ instancias en
 * pantalla: WebGLContextLost, cajas grises/negras y <30fps.
 *
 * Esta versión NO crea ningún contexto WebGL. Todo el efecto se logra con:
 * - backdrop-filter: blur(14px) saturate(150%)
 * - borde translúcido rgba(255,255,255,0.2)
 * - sombras suaves por GPU-compositing del navegador
 *
 * API pública preservada (type/theme/tintOpacity/warp/nested se aceptan pero
 * se ignoran visualmente salvo theme) para no romper llamadas existentes.
 * El motor legacy en @/lib/liquid-glass/index.ts queda sin importar y por
 * tanto fuera del bundle (tree-shaken) → 0 overhead WebGL.
 */

export type GlassShapeType = "rounded" | "circle" | "pill";
export type GlassThemePreset =
  | "light"
  | "dark"
  | "emerald"
  | "cyan"
  | "amber"
  | "crimson";

export interface LiquidGlassContainerProps
  extends React.HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "header" | "article" | "span" | "footer" | "main";
  type?: GlassShapeType;
  borderRadius?: number;
  /** @deprecated sin efecto en modo CSS-only; conservado por compatibilidad */
  tintOpacity?: number;
  /** @deprecated sin efecto en modo CSS-only; conservado por compatibilidad */
  warp?: boolean;
  theme?: GlassThemePreset;
  children?: React.ReactNode;
}

const THEME_CLASSES: Record<GlassThemePreset, string> = {
  light: "pm-glass pm-glass-light",
  dark: "pm-glass pm-glass-dark",
  emerald: "pm-glass pm-glass-emerald",
  cyan: "pm-glass pm-glass-cyan",
  amber: "pm-glass pm-glass-amber",
  crimson: "pm-glass pm-glass-crimson",
};

export function LiquidGlassContainer({
  as: Tag = "div",
  type = "rounded",
  borderRadius = 20,
  tintOpacity: _tintOpacity,
  warp: _warp,
  theme = "light",
  className = "",
  style,
  children,
  ...rest
}: LiquidGlassContainerProps) {
  void _tintOpacity;
  void _warp;
  const Component = Tag as unknown as React.ElementType;
  return (
    <Component
      className={`${THEME_CLASSES[theme]} ${className}`}
      style={{
        borderRadius: type === "pill" || type === "circle" ? 9999 : borderRadius,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Component>
  );
}

export interface LiquidGlassButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  type?: GlassShapeType;
  buttonType?: "button" | "submit" | "reset";
  size?: number;
  /** @deprecated sin efecto en modo CSS-only; conservado por compatibilidad */
  tintOpacity?: number;
  /** @deprecated sin efecto en modo CSS-only; conservado por compatibilidad */
  warp?: boolean;
  theme?: GlassThemePreset;
  /** @deprecated sin efecto en modo CSS-only; conservado por compatibilidad */
  nested?: boolean;
  children: React.ReactNode;
}

export function LiquidGlassButton({
  type = "pill",
  buttonType = "button",
  size = 14,
  tintOpacity: _tintOpacity,
  warp: _warp,
  theme = "light",
  nested: _nested,
  className = "",
  style,
  children,
  ...rest
}: LiquidGlassButtonProps) {
  void _tintOpacity;
  void _warp;
  void _nested;
  void size;
  return (
    <button
      type={buttonType}
      className={`pm-glass-btn btn-press ${className}`}
      data-theme={theme}
      style={{
        borderRadius: type === "pill" || type === "circle" ? 9999 : size,
        ...style,
      }}
      {...rest}
    >
      <span className="relative z-10 inline-flex items-center justify-center gap-1.5">
        {children}
      </span>
    </button>
  );
}

export interface LiquidGlassControlsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * @deprecated El panel de depuración de shaders WebGL fue retirado del árbol
 * de componentes (Requerimiento 1.2). Se conserva como stub que no renderiza
 * nada para no romper importaciones residuales.
 */
export function LiquidGlassControlsPanel(
  _props: LiquidGlassControlsPanelProps
): React.ReactNode {
  return null;
}

/**
 * No-op conservado por compatibilidad. En modo CSS-only no existe snapshot
 * que refrescar (el navegador compone backdrop-filter en cada frame).
 */
export function refreshGlassSnapshot(): void {
  /* intencionalmente vacío — zero WebGL */
}
