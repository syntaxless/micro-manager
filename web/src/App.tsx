import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { api } from './api';
import { Icon, type IconName } from './components/Icon';
import { Avatar } from './components/ui';
import { CommandPalette } from './components/CommandPalette';
import { Login, Setup, AcceptInvite } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { Board } from './pages/Board';
import { Files } from './pages/Files';
import { Billing } from './pages/Billing';
import { Clients } from './pages/Clients';
import { Settings } from './pages/Settings';
import { Onboarding } from './pages/Onboarding';

export function App() {
  const auth = useAuth();
  const loc = useLocation();

  if (loc.pathname.startsWith('/invite/')) {
    return (
      <Routes>
        <Route path="/invite/:token" element={<AcceptInvite />} />
      </Routes>
    );
  }
  if (auth.needsSetup) return <Setup />;
  if (!auth.user) return <Login />;
  if (auth.user.role === 'admin' && !auth.onboarded) return <Onboarding />;
  return <Shell />;
}

const NAV: { to: string; label: string; icon: IconName; staff?: boolean }[] = [
  { to: '/', label: 'Overview', icon: 'home' },
  { to: '/board', label: 'Board', icon: 'board' },
  { to: '/files', label: 'Files', icon: 'folder' },
  { to: '/billing', label: 'Billing', icon: 'receipt' },
  { to: '/clients', label: 'Clients', icon: 'users', staff: true },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

function Shell() {
  const auth = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => setMenuOpen(false), [loc.pathname]);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    await auth.refresh();
    nav('/');
  };

  const user = auth.user!;
  return (
    <div className={`shell ${menuOpen ? 'menu-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="terminal" size={15} strokeWidth={2.4} />
          </span>
          <div className="brand-text">
            <strong>{auth.businessName}</strong>
            <span className="mono muted">{auth.isStaff ? 'workspace' : auth.client?.company || auth.client?.name || 'client portal'}</span>
          </div>
        </div>
        <button className="palette-trigger" onClick={() => setPaletteOpen(true)}>
          <Icon name="search" size={14} />
          <span>Jump to…</span>
          <kbd>⌘K</kbd>
        </button>
        <nav className="nav">
          {NAV.filter((n) => !n.staff || auth.isStaff).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <Avatar name={user.name} color="accent" size={30} />
          <div className="me">
            <strong>{user.name}</strong>
            <span className="mono muted">{user.role}</span>
          </div>
          <button className="icon-btn" onClick={logout} title="Sign out" aria-label="Sign out">
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setMenuOpen(false)} />
      <main className="main">
        <div className="mobile-bar">
          <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Menu">
            <Icon name="menu" />
          </button>
          <strong>{auth.businessName}</strong>
          <button className="icon-btn" onClick={() => setPaletteOpen(true)} aria-label="Search">
            <Icon name="search" />
          </button>
        </div>
        <div className="page" key={loc.pathname}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/board" element={<Board />} />
            <Route path="/files" element={<Files />} />
            <Route path="/billing" element={<Billing />} />
            {auth.isStaff && <Route path="/clients" element={<Clients />} />}
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} nav={NAV.filter((n) => !n.staff || auth.isStaff)} />
    </div>
  );
}
