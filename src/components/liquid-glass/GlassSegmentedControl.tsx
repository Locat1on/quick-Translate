export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface GlassSegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function GlassSegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: GlassSegmentedControlProps<T>) {
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const count = Math.max(1, options.length);

  return (
    <div
      className="lg-segmented"
      role="tablist"
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      <div
        className="lg-segmented-thumb"
        aria-hidden="true"
        style={{
          width: `calc((100% - 5px) / ${count})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={opt.value === value}
          data-active={opt.value === value}
          className="lg-segmented-item"
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
