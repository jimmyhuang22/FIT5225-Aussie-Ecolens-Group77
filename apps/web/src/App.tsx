import { Navigate, Route, Routes, Link, useNavigate } from "react-router-dom";
import { signOut } from "aws-amplify/auth";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";
import { ConfirmSignUpPage } from "./pages/ConfirmSignUpPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ProfilePage } from "./pages/ProfilePage";
import { MediaPage } from "./pages/MediaPage";

function Shell() {
  const navigate = useNavigate();
  const { user, refresh } = useAuth();

  async function onSignOut() {
    try {
      await signOut({ global: true });
      toast.success("Signed out successfully.");
    } catch {
      toast.warning("Local session cleared, but global sign-out could not be confirmed.");
    } finally {
      await refresh();
      navigate("/sign-in", { replace: true });
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="app-title">
          Aussie EcoLens
        </Link>
        <nav>
          {user ? (
            <>
              <Link to="/media">Media</Link>
              <Link to="/profile">Profile</Link>
              <button type="button" className="nav-button" onClick={onSignOut}>
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link to="/sign-in">Sign In</Link>
              <Link to="/sign-up">Sign Up</Link>
            </>
          )}
        </nav>
      </header>
      <main className="app-main">
        <Routes>
          <Route
            path="/"
            element={
              user ? (
                <Navigate to="/media" replace />
              ) : (
                <Navigate to="/sign-up" replace />
              )
            }
          />
          <Route path="/sign-up" element={<SignUpPage />} />
          <Route path="/confirm-sign-up" element={<ConfirmSignUpPage />} />
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route
            path="/profile"
            element={
              <RequireAuth>
                <ProfilePage />
              </RequireAuth>
            }
          />
          <Route
            path="/media"
            element={
              <RequireAuth>
                <MediaPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Toaster richColors closeButton position="top-right" />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
