import { useEffect, useRef, useState } from 'react';

export function useAutoHideOnScroll(enabled, options = {}) {
  const { hideAfter = 72, minDelta = 8 } = options;
  const [hidden, setHidden] = useState(false);
  const lastScrollYRef = useRef(0);
  const tickingRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setHidden(false);
      return undefined;
    }

    lastScrollYRef.current = Math.max(window.scrollY || window.pageYOffset || 0, 0);

    const updateHiddenState = () => {
      const currentScrollY = Math.max(window.scrollY || window.pageYOffset || 0, 0);
      const delta = currentScrollY - lastScrollYRef.current;

      if (currentScrollY <= hideAfter) {
        setHidden(false);
      } else if (delta > minDelta) {
        setHidden(true);
      } else if (delta < -minDelta) {
        setHidden(false);
      }

      lastScrollYRef.current = currentScrollY;
      tickingRef.current = false;
    };

    const handleScroll = () => {
      if (tickingRef.current) return;
      tickingRef.current = true;

      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(updateHiddenState);
      } else {
        setTimeout(updateHiddenState, 0);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [enabled, hideAfter, minDelta]);

  return hidden;
}
