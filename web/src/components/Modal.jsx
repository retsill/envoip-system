import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n.js';

/** Ventana modal centrada (sustituye a las alertas del navegador). */
export function Modal({ open = true, title, icon, children, footer, onClose, tone = 'default', width = 440 }) {
  const t = useT();
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    // Foco en el botón principal para poder confirmar con Enter
    setTimeout(() => (box.current?.querySelector('[data-autofocus]') || box.current?.querySelector('button, select, input'))?.focus(), 30);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={box} className={`modal modal-${tone}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} style={{ maxWidth: width }}>
        {onClose && <button className="modal-x" onClick={onClose} aria-label={t('Cerrar')}>✕</button>}
        {icon && <div className="modal-icon" aria-hidden>{icon}</div>}
        {title && <h2 className="modal-title">{title}</h2>}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

const ConfirmCtx = createContext(null);

/**
 * const confirm = useConfirm();
 * if (await confirm({ title, message, okText, danger: true })) …          → true / false
 * const v = await confirm({ title, message, choices: [{ value, label, danger }] }) → value o null
 */
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }) {
  const t = useT();
  const [req, setReq] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setReq({ ...opts, resolve })), []);
  const close = (value) => {
    req?.resolve(value);
    setReq(null);
  };
  const choices = req?.choices || [{ value: true, label: req?.okText || t('Aceptar'), danger: req?.danger }];
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {req && (
        <Modal
          title={req.title}
          icon={req.icon ?? (req.danger ? '⚠️' : '❓')}
          tone={req.danger ? 'danger' : 'default'}
          onClose={() => close(req.choices ? null : false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => close(req.choices ? null : false)}>{req.cancelText || t('Cancelar')}</button>
              {choices.map((c, i) => (
                <button
                  key={String(c.value)}
                  className={`btn ${c.danger ? 'btn-danger' : 'btn-primary'}`}
                  data-autofocus={i === choices.length - 1 ? '' : undefined}
                  onClick={() => close(c.value)}
                >
                  {c.label}
                </button>
              ))}
            </>
          }
        >
          {req.message && <p className="modal-text">{req.message}</p>}
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}
