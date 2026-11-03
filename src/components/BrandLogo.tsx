import React from "react";

export interface BrandLogoProps {
  variant?: "horizontal" | "mark" | "stacked";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  theme?: "dark" | "light" | "auto";
  showTagline?: boolean;
  className?: string;
}

const sizes = { xs: 24, sm: 32, md: 40, lg: 48, xl: 64 };

export function BrandLogoMark({ size = "md", className = "" }: Pick<BrandLogoProps, "size" | "className">) {
  return <img src="/brand/packmatch-icon.svg" width={sizes[size]} height={sizes[size]} alt="PackMatch" className={`shrink-0 select-none ${className}`} />;
}

export function BrandLogo({ variant = "horizontal", size = "md", theme = "dark", showTagline = false, className = "" }: BrandLogoProps) {
  if (variant === "mark") return <BrandLogoMark size={size} className={className} />;
  const asset = variant === "stacked" ? "stacked" : "logo";
  return (
    <div className={`pm-brand ${theme === "auto" ? "pm-brand-auto" : ""} ${className}`}>
      <img src={`/brand/packmatch-${asset}-${theme === "auto" ? "light" : theme}.svg`} alt="PackMatch" width={variant === "stacked" ? sizes[size] * 3.75 : sizes[size] * 4.125} height={variant === "stacked" ? sizes[size] * 2.25 : sizes[size]} className="pm-brand-image" />
      {showTagline && <span className={`pm-brand-tagline ${theme === "dark" ? "text-slate-300" : "text-slate-600"}`}>Conciliación pre-despacho</span>}
    </div>
  );
}

export default BrandLogo;
