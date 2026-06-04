import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div className="auth-status">Checking session...</div>;
  }

  if (!user) {
    // Assignment Section 3: "the user should be redirected to the sign-up page
    // to register a new account". Sign-in is reachable via the link on /sign-up.
    return (
      <Navigate
        to="/sign-in"
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  return <>{children}</>;
}
