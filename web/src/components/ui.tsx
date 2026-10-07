import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { initials } from '../format';
import { tone } from '../theme';

/** Keeps a node mounted for its exit animation. */
function usePresence(open: boolean, ms = 180) {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const t = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, ms);
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return { mounted, leaving };
}

function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active, onClose]);
}

export function Modal({ open, onClose, title, children, width = 520, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number; footer?: ReactNode }) {
  const { mounted, leaving } = usePresence(open);
  useEscape(open, onClose);
  if (!mounted) return null;
  return createPortal(
    <div className={`overlay ${leaving ? 'leaving' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, children, width = 560 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  const { mounted, leaving } = usePresence(open, 220);
  useEscape(open, onClose);
  if (!mounted) return null;
  return createPortal(
    <div className={`overlay drawer-overlay ${leaving ? 'leaving' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        {children}
      </aside>
    </div>,
    document.body,
  );
}

// ---------- Toasts ----------

type Toast = { id: number; text: string; kind: 'ok' | 'error' | 'info'; leaving?: boolean };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x))), kind === 'error' ? 5000 : 2800);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5200 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind} ${t.leaving ? 'leaving' : ''}`}>
              <span className="toast-dot" />
              {t.text}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

// ---------- Confirm ----------

type ConfirmOpts = { title: string; body?: ReactNode; confirm?: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [open, setOpen] = useState(false);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => (setState({ ...o, resolve }), setOpen(true))), []);
  const done = (v: boolean) => {
    state?.resolve(v);
    setOpen(false);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal
        open={open}
        onClose={() => done(false)}
        title={state?.title}
        width={420}
        footer={
          <>
            <button className="btn ghost" onClick={() => done(false)}>
              Cancel
            </button>
            <button className={`btn ${state?.danger ? 'danger' : 'primary'}`} onClick={() => done(true)} autoFocus>
              {state?.confirm ?? 'Confirm'}
            </button>
          </>
        }
      >
        {state?.body && <p className="muted">{state.body}</p>}
      </Modal>
    </ConfirmCtx.Provider>
  );
}

// ---------- Small pieces ----------

export function Badge({ tone: t, children, dot }: { tone: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className="badge" style={{ ['--tone' as string]: t === 'muted' ? 'var(--muted)' : `var(--${t})` }}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}

export function Avatar({ name, color, size = 26 }: { name: string; color?: string | null; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, ['--tone' as string]: tone(color) }} title={name}>
      {initials(name)}
    </span>
  );
}

export function Empty({ icon, title, children }: { icon: Parameters<typeof Icon>[0]['name']; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={22} />
      </div>
      <h3>{title}</h3>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

export function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: number | string }) {
  return <span className="skeleton" style={{ height: h, width: w }} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          window.prompt('Copy this link', text);
        }
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={14} />
      {done ? 'Copied' : label}
    </button>
  );
}
