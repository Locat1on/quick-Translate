import React from "react";

interface BlurTextProps {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * React Bits-style BlurText: reveals words/characters smoothly from a soft blur to sharp focus.
 */
export function BlurText({ text, className = "", style }: BlurTextProps) {
  const chars = Array.from(text);

  return (
    <span className={`rb-blur-text ${className}`.trim()} style={style}>
      {chars.map((char, idx) => (
        <span
          key={`${idx}-${char}`}
          className="rb-blur-char"
          style={{ animationDelay: `${Math.min(idx * 18, 320)}ms` }}
        >
          {char === " " ? "\u00A0" : char}
        </span>
      ))}
    </span>
  );
}
