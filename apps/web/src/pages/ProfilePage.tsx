import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "aws-amplify/auth";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      toast.success("Signed out successfully.");
    } catch {
      toast.warning("Local session cleared, but global sign-out could not be confirmed.");
    } finally {
      await refresh();
      navigate("/sign-in");
    }
  }

  return (
    <Card className="w-full max-w-3xl">
      <CardHeader>
        <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
          <ShieldCheck className="size-5" />
        </div>
        <CardTitle className="text-2xl">Profile</CardTitle>
        <CardDescription>
          Protected Cognito identity returned by <code>GET /api/me</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <Alert variant="info"><AlertDescription>Loading /api/me...</AlertDescription></Alert>}
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Profile request failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {data && (
          <div className="overflow-hidden rounded-lg border">
            <dl className="divide-y">
              {[
                ["Sub", display(data.user.sub)],
                ["Username", display(data.user.username)],
                ["Email", display(data.user.email)],
                ["Given Name", display(data.user.given_name)],
                ["Family Name", display(data.user.family_name)],
                ["Token Use", display(data.user.token_use)],
              ].map(([key, value]) => (
                <div className="grid gap-2 p-4 sm:grid-cols-[10rem_1fr]" key={key}>
                  <dt className="font-medium text-muted-foreground">{key}</dt>
                  <dd className="break-all">
                    {key === "Token Use" ? <Badge variant="secondary">{value}</Badge> : value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <Button type="button" variant="outline" onClick={onSignOut} disabled={signingOut}>
          {signingOut ? "Signing out..." : "Sign out"}
        </Button>
      </CardContent>
    </Card>
  );
}
