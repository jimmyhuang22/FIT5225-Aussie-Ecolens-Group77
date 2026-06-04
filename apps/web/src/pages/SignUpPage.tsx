import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signUp } from "aws-amplify/auth";

export function SignUpPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signUp({
        username: email,
        password,
        options: {
          userAttributes: {
            email,
            given_name: givenName,
            family_name: familyName,
          },
        },
      });
      navigate("/confirm-sign-up", { state: { email } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "sign_up_failed";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page">
      <h1>Sign Up</h1>
      <p>Create an Aussie EcoLens account through AWS Cognito.</p>

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
          First name
          <input
            type="text"
            required
            value={givenName}
            onChange={(e) => setGivenName(e.target.value)}
            autoComplete="given-name"
          />
        </label>
        <label>
          Last name
          <input
            type="text"
            required
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            autoComplete="family-name"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>

        {error && <div className="error">{error}</div>}

        <button type="submit" disabled={submitting}>
          {submitting ? "Sending..." : "Create account"}
        </button>
      </form>

      <p className="link-row">
        Already have an account? <Link to="/sign-in">Sign in</Link>
      </p>
    </section>
  );
}
