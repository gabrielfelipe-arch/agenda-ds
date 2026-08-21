import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler, type Role, type User } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  passkeys: number;
  login: (user: User, token: string) => void;
  logout: () => void;
  refresh: () => Promise<void>;
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthState>({
  user: null,
  loading: true,
  passkeys: 0,
  login: () => {},
  logout: () => {},
  refresh: async () => {},
  can: () => false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [passkeys, setPasskeys] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.get<{ user: User; passkeys: number }>('/auth/me');
      setUser(me.user);
      setPasskeys(me.passkeys);
    } catch {
      setUser(null);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      passkeys,
      login: (u, t) => {
        setToken(t);
        setUser(u);
        void refresh();
      },
      logout: () => {
        setToken(null);
        setUser(null);
      },
      refresh,
      can: (...roles: Role[]) => Boolean(user && roles.includes(user.role)),
    }),
    [user, loading, passkeys, refresh]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
