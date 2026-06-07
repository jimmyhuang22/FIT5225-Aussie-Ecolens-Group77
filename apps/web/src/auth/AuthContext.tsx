import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";

export interface AuthUser {
  userId: string;
  username: string;
  email: string | null;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const current = await getCurrentUser();
      const session = await fetchAuthSession();
      const email = String(session.tokens?.idToken?.payload.email ?? "").trim() || null;
      setUser({ userId: current.userId, username: current.username, email });
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({ user, isLoading, refresh }),
    [user, isLoading, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
