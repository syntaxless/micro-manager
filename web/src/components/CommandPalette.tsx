import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { useAuth } from '../auth';
import { THEMES } from '../theme';

type Item = { id: string; label: string; hint?: string; icon: IconName; run: () => void; themeId?: string; swatch?: string[] };

export function CommandPalette({ open, onClose, nav }: { open: boolean; onClose: () => void; nav: { to: string; label: string; icon: IconName }[] }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const committed = useRef(false);

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [
      ...nav.map((n) => ({ id: `nav:${n.to}`, label: `Go to ${n.label}`, icon: n.icon, run: () => navigate(n.to) })),
      { id: 'new', label: 'New request', hint: 'board', icon: 'plus', run: () => navigate('/board?new=1') },
      ...(auth.isStaff ? [{ id: 'inv', label: 'New invoice', hint: 'billing', icon: 'receipt' as IconName, run: () => navigate('/billing?new=invoice') }] : []),
      ...THEMES.map((t) => ({
        id: `theme:${t.id}`,
        label: `Theme: ${t.name}`,
        hint: t.dark ? 'dark' : 'light',
        icon: 'palette' as IconName,
        themeId: t.id,
        swatch: [t.colors.bg, t.colors.accent, t.colors.green, t.colors.red],
        run: () => {
          committed.current = true;
          auth.setTheme(t.id);
        },
      })),
    ];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return terms.length ? all.filter((i) => terms.every((t) => `${i.label} ${i.hint ?? ''}`.toLowerCase().includes(t))) : all;
  }, [q, nav, navigate, auth]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      committed.current = false;
    }
  }, [open]);

  useEffect(() => setActive(0), [q]);

  // Live-preview themes while browsing them.
  const current = items[active];
  useEffect(() => {
    if (open && current?.themeId) auth.previewTheme(current.themeId);
    else if (open) auth.previewTheme(null);
  }, [open, current?.themeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    if (!committed.current) auth.previewTheme(null);
    onClose();
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  return createPortal(
    <div className="overlay palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true">
        <div className="palette-input">
          <span className="prompt mono">❯</span>
          <input
            autoFocus
            value={q}
            placeholder="Type a command or theme…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, items.length - 1)));
              else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
              else if (e.key === 'Enter' && items[active]) {
                items[active].run();
                onClose();
              } else if (e.key === 'Escape') close();
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {items.length === 0 && <div className="palette-empty mono muted">no matches</div>}
          {items.map((it, i) => (
            <button
              key={it.id}
              data-idx={i}
              className={`palette-item ${i === active ? 'active' : ''}`}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => {
                it.run();
                onClose();
              }}
            >
              <Icon name={it.icon} size={15} />
              <span className="palette-label">{it.label}</span>
              {it.swatch && (
                <span className="swatch-row">
                  {it.swatch.map((c, j) => (
                    <span key={j} style={{ background: c }} />
                  ))}
                </span>
              )}
              {it.hint && <span className="mono muted palette-hint">{it.hint}</span>}
            </button>
          ))}
        </div>
        <div className="palette-foot mono muted">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
