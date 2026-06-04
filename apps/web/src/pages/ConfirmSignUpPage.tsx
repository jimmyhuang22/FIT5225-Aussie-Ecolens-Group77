import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { confirmSignUp, resendSignUpCode } from "aws-amplify/auth";

interface ConfirmLocationState {
  email?: string;
}

export function ConfirmSignUpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialEmail =
    (location.state as ConfirmLocationState | null)?.email ?? "";
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await confirmSignUp({ username: email, confirmationCode: code });
      navigate("/sign-in", { state: { email } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "confirm_failed";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    setError(null);
    setInfo(null);
    setResending(true);
    try {
      await resendSignUpCode({ username: email });
      setInfo("Verification code re-sent. Check your inbox.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "resend_failed";
      setError(message);
    } finally {
      setResending(false);
    }
  }

  return (
    <section className="page">
      <h1>Confirm Sign Up</h1>
      <p>Enter the 6-digit code Cognito emailed to you.</p>

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
          Verification code
          <input
            type="text"
            required
            inputMode="numeric"
            pattern="[0-9]*"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
          />
        </label>

        {error && <div className="error">{error}</div>}
        {info && <div className="auth-status">{info}</div>}

        <button type="submit" disabled={submitting}>
          {submitting ? "Confirming..." : "Confirm"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={onResend}
          disabled={resending || !email}
        >
          {resending ? "Re-sending..." : "Resend code"}
        </button>
      </form>

      <p className="link-row">
        Back to <Link to="/sign-in">Sign in</Link>
      </p>
    </section>
  );
}
