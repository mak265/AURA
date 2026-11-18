import { useLayoutEffect, useRef } from 'react';

export default function useTabScroll(stageRef, userId, pathname, isTab, search) {
  const memory = useRef({ userId: null, positions: new Map() });

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (memory.current.userId !== userId) memory.current = { userId, positions: new Map() };
    const { positions } = memory.current;
    const target = isTab && !search ? positions.get(pathname) || 0 : 0;
    let scrollPosition = target;
    let observer;

    const restore = () => {
      if (stage.scrollHeight - stage.clientHeight >= target) {
        stage.scrollTop = target;
        observer?.disconnect();
        observer = undefined;
      }
    };
    stage.scrollTop = 0;
    if (target > 0) {
      const content = stage.firstElementChild;
      if (content && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(restore);
        observer.observe(content);
      }
      restore();
    }

    const rememberPosition = () => {
      if (!observer) scrollPosition = stage.scrollTop;
    };
    const cancelRestore = () => {
      observer?.disconnect();
      observer = undefined;
      scrollPosition = stage.scrollTop;
    };
    stage.addEventListener('scroll', rememberPosition, { passive: true });
    stage.addEventListener('pointerdown', cancelRestore, { passive: true });
    stage.addEventListener('wheel', cancelRestore, { passive: true });
    stage.addEventListener('keydown', cancelRestore);
    return () => {
      if (isTab && !search) positions.set(pathname, scrollPosition);
      observer?.disconnect();
      stage.removeEventListener('scroll', rememberPosition);
      stage.removeEventListener('pointerdown', cancelRestore);
      stage.removeEventListener('wheel', cancelRestore);
      stage.removeEventListener('keydown', cancelRestore);
    };
  }, [isTab, pathname, search, stageRef, userId]);
}
