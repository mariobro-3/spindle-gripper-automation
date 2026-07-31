import { useEffect, useRef, useState, type ReactNode } from "react";

const PANEL_WIDTH_KEY = "sga-panel-width";
const PANEL_MIN = 300;

/**
 * Right side panel with a draggable left edge. The width is shared across all
 * tabs and remembered between sessions.
 */
export function ResizablePanel({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return saved >= PANEL_MIN ? saved : 380;
  });
  const widthRef = useRef(width);
  widthRef.current = width;

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    const maxW = Math.max(500, Math.round(window.innerWidth * 0.7));
    const move = (ev: PointerEvent) => {
      const w = Math.min(maxW, Math.max(PANEL_MIN, startW + (startX - ev.clientX)));
      widthRef.current = w;
      setWidth(w);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("col-resizing");
      localStorage.setItem(PANEL_WIDTH_KEY, String(widthRef.current));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.classList.add("col-resizing");
  };

  return (
    <>
      <div className="panel-resizer" onPointerDown={startDrag} title="Drag to resize" />
      <div className="panel-side" style={{ width }}>
        {children}
      </div>
    </>
  );
}

export function NumField({
  label,
  value,
  onChange,
  step,
  unit,
  min,
  title,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  unit?: string;
  min?: number;
  title?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    // sync external changes, but don't clobber in-progress typing like "-" or "1."
    if (parseFloat(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <label className="field" title={title}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="number"
          step={step ?? 0.001}
          min={min}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) onChange(v);
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  title,
  width,
  wide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  title?: string;
  width?: number;
  /** match the standard select-field width (240px) */
  wide?: boolean;
}) {
  return (
    <label className="field" title={title}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="text"
          className={wide ? "wide" : undefined}
          value={value}
          style={width ? { width } : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  title,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  title?: string;
}) {
  return (
    <label className="field" title={title}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <select value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

export function CheckField({
  label,
  value,
  onChange,
  title,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  title?: string;
}) {
  return (
    <label className="field field-check" title={title}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className="field-label">{label}</span>
    </label>
  );
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <button className="section-header" onClick={() => setOpen(!open)}>
        <span className={`chevron ${open ? "open" : ""}`}>&#9656;</span> {title}
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}
