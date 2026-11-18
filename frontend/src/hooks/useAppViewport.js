import { useLayoutEffect } from 'react';

const KEYBOARD_THRESHOLD = 120;

export default function useAppViewport(frameRef, enabled) {
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const viewport = window.visualViewport;
    if (!enabled || !frame || !viewport) return;

    let restingHeight = 0;
    let previousWidth = 0;
    const sync = () => {
      const { height, width, scale } = viewport;
      // Zoom is independent of the viewport resize caused by a software keyboard.
      if (Math.abs(scale - 1) > .05) return;
      if (Math.abs(width - previousWidth) > 40) restingHeight = height;
      previousWidth = width;
      const editing = document.activeElement?.matches('input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]');
      if (!editing) restingHeight = height;
      const keyboard = editing && Math.max(window.innerHeight, restingHeight) - height >= KEYBOARD_THRESHOLD;
      frame.style.setProperty('--aura-viewport-height', `${height}px`);
      frame.toggleAttribute('data-keyboard', keyboard);
    };

    sync();
    viewport.addEventListener('resize', sync);
    window.addEventListener('resize', sync);
    document.addEventListener('focusout', sync);
    return () => {
      viewport.removeEventListener('resize', sync);
      window.removeEventListener('resize', sync);
      document.removeEventListener('focusout', sync);
      frame.style.removeProperty('--aura-viewport-height');
      frame.removeAttribute('data-keyboard');
    };
  }, [frameRef, enabled]);
}
