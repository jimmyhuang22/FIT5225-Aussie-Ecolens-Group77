import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { confirmResetPassword, resetPassword } from "aws-amplify/auth";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordRequirements } from "@/components/PasswordRequirements";

interface ForgotPasswordLocationState {
  email?: string;
}

type ResetStep = "request-code" | "confirm-code";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialEmail = (location.state as ForgotPasswordLocationState | null)?.email ?? "";
  const [step, setStep] = useState<ResetStep>("request-code");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function requestCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await resetPassword({ username: email });
      const message = "Cognito sent a password reset code to your email.";
      setInfo(message);
      setStep("confirm-code");
      toast.success("Reset code sent", { description: message });
    } catch (err) {
      const message = err instanceof Error ? err.message : "reset_code_failed";
      setError(message);
      toast.error("Could not send reset code", { description: message });
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);

    if (newPassword !== confirmPassword) {
      const message = "Passwords do not match.";
      setError(message);
      toast.error("Password reset failed", { description: message });
      return;
    }

    setSubmitting(true);
    try {
      await confirmResetPassword({
        username: email,
        confirmationCode: code,
        newPassword,
      });
      toast.success("Password updated", { description: "You can sign in with your new password now." });
      navigate("/sign-in", { state: { email }, replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "password_reset_failed";
      setError(message);
      toast.error("Password reset failed", { description: message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="auth-card">
      <CardHeader>
        <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
          <KeyRound className="size-5" />
        </div>
        <CardTitle className="text-2xl">Reset password</CardTitle>
        <CardDescription>
          Use Cognito&apos;s email reset code to set a new password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {step === "request-code" ? (
          <form className="space-y-4" onSubmit={requestCode}>
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email</Label>
              <Input
                id="reset-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTitle>Could not start password reset</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button className="w-full" type="submit" disabled={submitting || !email}>
              {submitting ? "Sending code..." : "Send reset code"}
            </Button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={confirmNewPassword}>
            <div className="space-y-2">
              <Label htmlFor="reset-email-confirm">Email</Label>
              <Input
                id="reset-email-confirm"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-code">Reset code</Label>
              <Input
                id="reset-code"
                type="text"
                required
                inputMode="numeric"
                pattern="[0-9]*"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="one-time-code"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                aria-describedby="reset-password-requirements"
              />
              <PasswordRequirements id="reset-password-requirements" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-new-password">Confirm new password</Label>
              <Input
                id="confirm-new-password"
                type="password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTitle>Could not reset password</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {info && (
              <Alert variant="info">
                <AlertDescription>{info}</AlertDescription>
              </Alert>
            )}

            <Button className="w-full" type="submit" disabled={submitting}>
              {submitting ? "Updating password..." : "Update password"}
            </Button>
            <Button
              className="w-full"
              type="button"
              variant="outline"
              onClick={() => void requestCode()}
              disabled={submitting || !email}
            >
              Re-send code
            </Button>
          </form>
        )}

        <p className="mt-5 text-sm text-muted-foreground">
          Remembered your password? <Link to="/sign-in" state={{ email }}>Back to sign in</Link>
        </p>
      </CardContent>
    </Card>
  );
}
