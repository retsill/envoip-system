import { useRef } from 'react';

/**
 * Mantener pulsado (dedo o ratón) ~0,5 s. Devuelve los manejadores para el elemento y una función que dice si el
 * último clic fue el final de una pulsación larga (para no tratarlo además como clic normal).
 */
export function useLongPress(onLongPress, ms = 500) {
  const timer = useRef(null);
  const fired = useRef(false);
  const start = useRef(null);
  const cancel = () => clearTimeout(timer.current);
  const handlers = (arg) => ({
    onPointerDown: (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      cancel();
      timer.current = setTimeout(() => {
        fired.current = true;
        onLongPress(arg);
      }, ms);
    },
    onPointerMove: (e) => {
      // Si se desplaza la lista, no es una pulsación larga
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e) => fired.current && e.preventDefault(),
  });
  const consumed = () => {
    const f = fired.current;
    fired.current = false;
    return f;
  };
  return { handlers, consumed };
}
