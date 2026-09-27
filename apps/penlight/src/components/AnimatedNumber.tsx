import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';

interface AnimatedNumberProps {
  value: number;
  format?: (v: number) => string;
  duration?: number;
  className?: string;
  /** 首次出现时从这个值开始滚动，默认直接显示。 */
  from?: number;
}

/** 数值变化时平滑滚动过去，只改文本不触发重渲染。 */
export function AnimatedNumber({ value, format = (v) => String(Math.round(v)), duration = 0.6, className, from }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const current = useRef(from ?? value);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced) {
      current.current = value;
      el.textContent = format(value);
      return;
    }
    const controls = animate(current.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        current.current = v;
        el.textContent = format(v);
      },
    });
    return () => controls.stop();
  }, [value, duration, format, reduced]);

  return (
    <span ref={ref} className={className}>
      {format(from ?? value)}
    </span>
  );
}
