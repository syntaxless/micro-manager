import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler, type AuthState } from './api';
import { applyTheme } from './theme';

interface AuthCtx extends AuthState {
  refresh: () => Promise<void>;
  setTheme: (id: string | null) => Promise<void>;
  previewTheme: (id: string | null) => void;
  isStaff: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);
export const useAuth = () => useContext(Ctx)!;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);

  const refresh = useCallback(async () => {
    const s = await api<AuthState>('/auth/state');
    setState(s);
    applyTheme(s.user?.theme ?? s.defaultTheme);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => refresh());
    refresh().catch(() => setState(null));
  }, [refresh]);

  const setTheme = useCallback(
    async (id: string | null) => {
      if (!state) return;
      applyTheme(id ?? state.defaultTheme);
      if (state.user) {
        setState({ ...state, user: { ...state.user, theme: id } });
        await api('/me', { method: 'PATCH', body: { theme: id } });
      }
    },
    [state],
  );

  const previewTheme = useCallback((id: string | null) => applyTheme(id ?? state?.user?.theme ?? state?.defaultTheme), [state]);

  if (!state) {
    return (
      <div className="boot">
        <span className="boot-cursor">▍</span>
      </div>
    );
  }
  return <Ctx.Provider value={{ ...state, refresh, setTheme, previewTheme, isStaff: !!state.user && state.user.role !== 'client' }}>{children}</Ctx.Provider>;
}
