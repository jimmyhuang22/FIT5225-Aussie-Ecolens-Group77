import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "aws-amplify/auth";
import { fetchMe, ApiError, type MeResponse } from "../api";
import { useAuth } from "../auth/AuthContext";

function display(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "—";
}

export function ProfilePage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [data, setData] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const me = await fetchMe();
        if (!cancelled) setData(me);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError(`/api/me failed with status ${err.status} (${err.message})`);
        } else if (err instanceof Error) {
          setError(`/api/me error: ${err.message}`);
        } else {
          setError("/api/me unknown error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSignOut() {
    setSigningOut(true);
    try {
      await signOut({ global: true });
    } catch {
      // Even if global sign-out fails (e.g. offline), clear local state
      // and bounce the user back to /sign-in.
    } finally {
      await refresh();
      navigate("/sign-in");
    }
  }

  return (
    <section className="page">
      <h1>Profile</h1>
      <p>
        This page is protected by the server-side <code>requireCognitoAuth</code>
        middleware and proves the end-to-end auth flow against{" "}
        <code>GET /api/me</code>.
      </p>

      {loading && <div className="auth-status">Loading /api/me...</div>}
      {error && <div className="error">{error}</div>}

      {data && (
        <table className="user-table">
          <tbody>
            <tr>
              <th>sub</th>
              <td>{display(data.user.sub)}</td>
            </tr>
            <tr>
              <th>username</th>
              <td>{display(data.user.username)}</td>
            </tr>
            <tr>
              <th>email</th>
              <td>{display(data.user.email)}</td>
            </tr>
            <tr>
              <th>given_name</th>
              <td>{display(data.user.given_name)}</td>
            </tr>
            <tr>
              <th>family_name</th>
              <td>{display(data.user.family_name)}</td>
            </tr>
            <tr>
              <th>token_use</th>
              <td>{display(data.user.token_use)}</td>
            </tr>
          </tbody>
        </table>
      )}

      <div className="form" style={{ marginTop: "1.25rem" }}>
        <button
          type="button"
          className="secondary"
          onClick={onSignOut}
          disabled={signingOut}
        >
          {signingOut ? "Signing out..." : "Sign Out"}
        </button>
      </div>
    </section>
  );
}
