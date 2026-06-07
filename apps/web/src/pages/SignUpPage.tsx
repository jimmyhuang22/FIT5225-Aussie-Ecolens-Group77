import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signUp } from "aws-amplify/auth";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordRequirements } from "@/components/PasswordRequirements";

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
      toast.success("Account created", {
        description: "Check your inbox for the Cognito verification code.",
      });
      navigate("/confirm-sign-up", { state: { email } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "sign_up_failed";
      setError(message);
      toast.error("Sign up failed", { description: message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="auth-card">
      <CardHeader>
        <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
          <UserPlus className="size-5" />
        </div>
        <CardTitle className="text-2xl">Create account</CardTitle>
        <CardDescription>Register through AWS Cognito with verified email.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="given-name">First name</Label>
              <Input id="given-name" required value={givenName} onChange={(e) => setGivenName(e.target.value)} autoComplete="given-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="family-name">Last name</Label>
              <Input id="family-name" required value={familyName} onChange={(e) => setFamilyName(e.target.value)} autoComplete="family-name" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              aria-describedby="sign-up-password-requirements"
            />
            <PasswordRequirements id="sign-up-password-requirements" />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Could not create account</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button className="w-full" type="submit" disabled={submitting}>
            {submitting ? "Sending verification..." : "Create account"}
          </Button>
        </form>

        <p className="mt-5 text-sm text-muted-foreground">
          Already have an account? <Link to="/sign-in">Sign in</Link>
        </p>
      </CardContent>
    </Card>
  );
}
