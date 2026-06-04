import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { confirmSignUp, resendSignUpCode } from "aws-amplify/auth";
import { MailCheck } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ConfirmLocationState {
  email?: string;
}

export function ConfirmSignUpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialEmail = (location.state as ConfirmLocationState | null)?.email ?? "";
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
      toast.success("Email confirmed", { description: "You can sign in now." });
      navigate("/sign-in", { state: { email } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "confirm_failed";
      setError(message);
      toast.error("Confirmation failed", { description: message });
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
      const message = "Verification code re-sent. Check your inbox.";
      setInfo(message);
      toast.success("Code re-sent", { description: message });
    } catch (err) {
      const message = err instanceof Error ? err.message : "resend_failed";
      setError(message);
      toast.error("Could not resend code", { description: message });
    } finally {
      setResending(false);
    }
  }

  return (
    <Card className="auth-card">
      <CardHeader>
        <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
          <MailCheck className="size-5" />
        </div>
        <CardTitle className="text-2xl">Confirm sign up</CardTitle>
        <CardDescription>Enter the 6-digit code Cognito emailed to you.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="code">Verification code</Label>
            <Input id="code" type="text" required inputMode="numeric" pattern="[0-9]*" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Could not confirm account</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {info && (
            <Alert variant="info">
              <AlertDescription>{info}</AlertDescription>
            </Alert>
          )}

          <Button className="w-full" type="submit" disabled={submitting}>
            {submitting ? "Confirming..." : "Confirm account"}
          </Button>
          <Button className="w-full" type="button" variant="outline" onClick={onResend} disabled={resending || !email}>
            {resending ? "Re-sending..." : "Resend code"}
          </Button>
        </form>

        <p className="mt-5 text-sm text-muted-foreground">
          Back to <Link to="/sign-in">sign in</Link>
        </p>
      </CardContent>
    </Card>
  );
}
