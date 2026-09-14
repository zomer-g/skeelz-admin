"use client";

import { useEffect, type RefObject } from "react";

/**
 * On narrow screens the nav and tab strips scroll sideways; this keeps the
 * current item inside the visible part of its strip. Scrolls the strip only,
 * never the page, and does nothing when the strip fits.
 */
export function useActiveInStrip(activeRef: RefObject<HTMLElement | null>, key: string) {
  useEffect(() => {
    const el = activeRef.current;
    const strip = el?.parentElement;
    if (!el || !strip || strip.scrollWidth <= strip.clientWidth) return;
    const box = strip.getBoundingClientRect();
    const item = el.getBoundingClientRect();
    if (item.left < box.left) strip.scrollBy({ left: item.left - box.left - 16 });
    else if (item.right > box.right) strip.scrollBy({ left: item.right - box.right + 16 });
  }, [activeRef, key]);
}
