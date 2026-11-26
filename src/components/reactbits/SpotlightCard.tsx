import React, { useCallback, useEffect, useRef } from "react";

interface SpotlightCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  spotlightColor?: string;
}

/**
 * React Bits-style SpotlightCard: tracks cursor position via rAF to cast a soft radial spotlight
 * across the surface without layout thrashing or interfering with child controls.
 */
export function SpotlightCard({
  children,
  className = "",
  spotlightColor = "rgba(255, 255, 255, 0.14)",
  style,
  onMouseMove,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const clientX = e.clientX;
      const clientY = e.clientY;
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          const el = ref.current;
          if (el) {
            const rect = el.getBoundingClientRect();
            el.style.setProperty("--spot-x", `${clientX - rect.left}px`);
            el.style.setProperty("--spot-y", `${clientY - rect.top}px`);
          }
        });
      }
      onMouseMove?.(e);
    },
    [onMouseMove]
  );

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      ref.current?.style.setProperty("--spot-opacity", "1");
      onMouseEnter?.(e);
    },
    [onMouseEnter]
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      ref.current?.style.setProperty("--spot-opacity", "0");
      onMouseLeave?.(e);
    },
    [onMouseLeave]
  );

  return (
    <div
      ref={ref}
      className={`lg-group rb-spotlight-card ${className}`.trim()}
      style={{
        ...style,
        ["--spot-color" as string]: spotlightColor,
      }}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...rest}
    >
      {children}
    </div>
  );
}
