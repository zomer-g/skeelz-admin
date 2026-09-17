"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Explanations shown while the pointer rests on them, when their "?" button has
 * keyboard focus, or after a tap on phones. Per WCAG 1.4.13 the explanation can
 * itself be hovered, stays until the pointer or focus leaves, and Escape or a tap
 * elsewhere dismisses it. Screen readers get it through aria-describedby.
 */
function useTip<T extends HTMLElement>() {
  const id = useId();
  const ref = useRef<T>(null);
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
  return {
    id,
    ref,
    open,
    hoverProps: {
      onMouseEnter: () => {
        setHovered(true);
        show();
      },
      onMouseLeave: () => setHovered(false),
    },
    buttonProps: {
      type: "button" as const,
      "aria-describedby": id,
      "aria-expanded": open,
      onFocus: () => {
        setPinned(true);
        show();
      },
      onBlur: () => setPinned(false),
      onClick: () => {
        setPinned(true);
        show();
      },
    },
  };
}

const BUTTON = "flex size-7 items-center justify-center rounded-full bg-white text-sm font-bold text-accent-dark ring-1 ring-line hover:ring-accent";
const PANEL = "z-20 rounded-card bg-ink p-4 text-sm font-normal leading-relaxed text-white shadow-lg";

/** A card (a StatCard) with a "?" in its corner that explains what it counts. */
export function Explained({ label, text, children }: { label: string; text: string; children: ReactNode }) {
  const tip = useTip<HTMLDivElement>();
  return (
    <div ref={tip.ref} className="relative" {...tip.hoverProps}>
      {children}
      <button {...tip.buttonProps} className={`absolute end-3 top-3 ${BUTTON}`}>
        <span aria-hidden>?</span>
        <span className="sr-only">מה נספר ב{label}</span>
      </button>
      <div id={tip.id} role="tooltip" className={`absolute inset-x-0 top-full mt-2 ${PANEL} ${tip.open ? "" : "hidden"}`}>
        {text}
      </div>
    </div>
  );
}

/** An inline "?" beside a title or a badge, with the same behaviour as Explained. */
export function InfoTip({ label, text }: { label: string; text: string }) {
  const tip = useTip<HTMLSpanElement>();
  return (
    <span ref={tip.ref} className="relative inline-flex align-middle" {...tip.hoverProps}>
      <button {...tip.buttonProps} className={`${BUTTON} size-6 text-xs`}>
        <span aria-hidden>?</span>
        <span className="sr-only">הסבר: {label}</span>
      </button>
      <span
        id={tip.id}
        role="tooltip"
        className={`absolute start-0 top-full mt-2 w-[min(22rem,80vw)] text-start ${PANEL} ${tip.open ? "" : "hidden"}`}
      >
        {text}
      </span>
    </span>
  );
}
