import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { signIn } from "aws-amplify/auth";
import { useAuth } from "../auth/AuthContext";

interface SignInLocationState {
  from?: string;
  email?: string;
}

export function SignInPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useAuth();
  const locationState = location.state as SignInLocationState | null;
  const [email, setEmail] = useState(locationState?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await signIn({ username: email, password });
      if (result.isSignedIn) {
        await refresh();
        navigate(locationState?.from ?? "/media", { replace: true });
        return;
      }
      const nextStep = result.nextStep?.signInStep;
      if (nextStep === "CONFIRM_SIGN_UP") {
        navigate("/confirm-sign-up", { state: { email } });
        return;
      }
      setError(`additional_step_required:${nextStep ?? "unknown"}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "sign_in_failed";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page">
      <h1>Sign In</h1>
      <p>Use the email and password you registered with Cognito.</p>

      <form className="form" onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>

        {error && <div className="error">{error}</div>}

        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="link-row">
        Need an account? <Link to="/sign-up">Sign up</Link>
      </p>
    </section>
  );
}
