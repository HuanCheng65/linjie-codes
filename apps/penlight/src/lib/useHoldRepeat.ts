import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';

/** 按住按钮时连续触发：先触发一次，停 400 ms 后每 90 ms 触发一次。 */
export function useHoldRepeat(action: () => void) {
  const actionRef = useRef(action);
  actionRef.current = action;
  const timers = useRef<number[]>([]);

  const stop = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  useEffect(() => stop, []);

  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      stop();
      actionRef.current();
      const repeat = () => {
        actionRef.current();
        timers.current.push(window.setTimeout(repeat, 90));
      };
      timers.current.push(window.setTimeout(repeat, 400));
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        actionRef.current();
      }
    },
  };
}
