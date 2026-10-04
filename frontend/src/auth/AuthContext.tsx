import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { api, setAccessToken, setOnUnauthorized } from '../api/client';
import type { AuthUser } from '../types';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  has: (permission: string) => boolean;
  hasAny: (...permissions: string[]) => boolean;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setOnUnauthorized(clear);
    (async () => {
      try {
        const ok = await api.tryRefresh();
        if (ok) {
          const me = await api.get<AuthUser>('/auth/me');
          setUser(me);
        }
      } catch {
        clear();
      } finally {
        setLoading(false);
      }
    })();
  }, [clear]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ accessToken: string; user: AuthUser }>('/auth/login', {
      email,
      password,
    });
    setAccessToken(res.accessToken);
    setUser(res.user);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const res = await api.post<{ accessToken: string; user: AuthUser }>('/auth/register', {
      name,
      email,
      password,
    });
    setAccessToken(res.accessToken);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
    clear();
  }, [clear]);

  const refreshMe = useCallback(async () => {
    const me = await api.get<AuthUser>('/auth/me');
    setUser(me);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login,
      register,
      logout,
      refreshMe,
      has: (p: string) => !!user?.permissions?.includes(p),
      hasAny: (...perms: string[]) => perms.some((p) => !!user?.permissions?.includes(p)),
    }),
    [user, loading, login, register, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
