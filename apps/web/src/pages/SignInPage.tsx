import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { signIn } from "aws-amplify/auth";
import { LogIn } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
        toast.success("Welcome back to Aussie EcoLens.");
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
      toast.error("Sign in failed", { description: message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="auth-card">
      <CardHeader>
        <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
          <LogIn className="size-5" />
        </div>
        <CardTitle className="text-2xl">Sign in</CardTitle>
        <CardDescription>Use the Cognito account you created for the demo.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Could not sign in</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button className="w-full" type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <p className="mt-5 text-sm text-muted-foreground">
          Need an account? <Link to="/sign-up">Sign up</Link>
        </p>
      </CardContent>
    </Card>
  );
}
