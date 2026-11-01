import React, { useEffect } from 'react';

export function Modal({ open, onClose, title, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={wide ? { width: 'min(760px, 100%)' } : undefined}>
        {title && <h2>{title}</h2>}
        {children}
        {footer && <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className="stat">
      <div className="label upper">{label}</div>
      <div className={`value ${tone || ''}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Empty({ children, icon = '◍' }) {
  return (
    <div className="empty">
      <div style={{ fontSize: '1.6rem', marginBottom: 8, opacity: 0.55 }}>{icon}</div>
      {children}
    </div>
  );
}

export function Spinner({ label }) {
  return (
    <div className="loader">
      <div className="stack-sm" style={{ alignItems: 'center' }}>
        <span className="spinner" />
        {label && <span className="small muted">{label}</span>}
      </div>
    </div>
  );
}

export function Tabs({ value, onChange, options }) {
  return (
    <div className="tabs">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`tab ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Toasts({ toasts }) {
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function Progress({ value, max = 100, tone = '' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`progress ${tone}`}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}
