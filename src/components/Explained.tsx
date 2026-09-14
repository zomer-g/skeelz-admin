"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * What a figure counts, shown while the pointer rests on it, when its "?" button
 * has keyboard focus, or after a tap on phones. Per WCAG 1.4.13 the explanation
 * can itself be hovered, stays until the pointer or focus leaves, and Escape or a
 * tap elsewhere dismisses it. Screen readers get it through aria-describedby.
 */
export function Explained({ label, text, children }: { label: string; text: string; children: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || pinned) && !dismissed;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDismissed(true);
    };
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setPinned(false);
        setHovered(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const show = () => setDismissed(false);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => {
        setHovered(true);
        show();
      }}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      <button
        type="button"
        aria-describedby={id}
        aria-expanded={open}
        onFocus={() => {
          setPinned(true);
          show();
        }}
        onBlur={() => setPinned(false)}
        onClick={() => {
          setPinned(true);
          show();
        }}
        className="absolute end-3 top-3 flex size-7 items-center justify-center rounded-full bg-white text-sm font-bold text-accent-dark ring-1 ring-line hover:ring-accent"
      >
        <span aria-hidden>?</span>
        <span className="sr-only">מה נספר ב{label}</span>
      </button>
      <div
        id={id}
        role="tooltip"
        className={`absolute inset-x-0 top-full z-20 mt-2 rounded-card bg-ink p-4 text-sm leading-relaxed text-white shadow-lg ${open ? "" : "hidden"}`}
      >
        {text}
      </div>
    </div>
  );
}
