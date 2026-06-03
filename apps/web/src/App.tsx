import { Navigate, Route, Routes, Link, useNavigate } from "react-router-dom";
import { signOut } from "aws-amplify/auth";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";
import { ConfirmSignUpPage } from "./pages/ConfirmSignUpPage";
import { ProfilePage } from "./pages/ProfilePage";
import { MediaPage } from "./pages/MediaPage";

function Shell() {
  const navigate = useNavigate();
  const { user, refresh } = useAuth();

  async function onSignOut() {
    try {
      await signOut({ global: true });
    } catch {
      // Clear local state even if the network sign-out request fails.
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
                // Assignment Section 3: unauthenticated users land on sign-up
                // (sign-in is reachable via the link inside the sign-up page).
                <Navigate to="/sign-up" replace />
              )
            }
          />
          <Route path="/sign-up" element={<SignUpPage />} />
          <Route path="/confirm-sign-up" element={<ConfirmSignUpPage />} />
          <Route path="/sign-in" element={<SignInPage />} />
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
