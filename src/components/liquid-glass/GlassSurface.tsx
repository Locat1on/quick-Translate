import React, { useCallback, useEffect, useRef } from "react";

interface GlassSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function GlassSurface({
  children,
  className = "",
  onMouseMove,
  ...rest
}: GlassSurfaceProps) {
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
            el.style.setProperty("--mx", `${clientX - rect.left}px`);
            el.style.setProperty("--my", `${clientY - rect.top}px`);
          }
        });
      }
      onMouseMove?.(e);
    },
    [onMouseMove]
  );

  return (
    <div
      ref={ref}
      className={`lg-surface ${className}`.trim()}
      onMouseMove={handleMouseMove}
      {...rest}
    >
      {children}
    </div>
  );
}
