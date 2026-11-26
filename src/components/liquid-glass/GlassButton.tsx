import React from "react";

interface GlassButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "danger";
  iconOnly?: boolean;
}

export function GlassButton({
  variant = "default",
  iconOnly = false,
  className = "",
  children,
  ...rest
}: GlassButtonProps) {
  const classes = [
    "lg-btn",
    variant === "primary" ? "lg-btn--primary" : "",
    variant === "danger" ? "lg-btn--danger" : "",
    iconOnly ? "lg-btn--icon" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  );
}
