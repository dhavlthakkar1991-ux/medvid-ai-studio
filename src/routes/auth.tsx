import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Stethoscope } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — MedVideo AI Studio" }] }),
  component: AuthPage,
});

function authErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String((error as any)?.message ?? "");
  if (/unsupported provider|provider is not enabled/i.test(message)) {
    return "Google sign-in is not enabled for this Supabase project. Use email and password for local testing.";
  }
  if (/invalid login credentials/i.test(message)) return "Invalid email or password.";
  if (/email not confirmed/i.test(message)) return "Please confirm your email before signing in.";
  return message || fallback;
}

function validateCredentials(email: string, password: string): string | null {
  if (!email.trim()) return "Email is required.";
  if (!password) return "Password is required.";
  if (password.length < 6) return "Password must be at least 6 characters.";
  return null;
}

function validateEmail(email: string): string | null {
  if (!email.trim()) return "Email is required.";
  return null;
}

function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user && !recoveryMode) router.navigate({ to: "/dashboard" });
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
    });
    return () => listener.subscription.unsubscribe();
  }, [recoveryMode, router]);

  const onSignIn = async () => {
    const validation = validateCredentials(email, password);
    if (validation) return toast.error(validation);
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) return toast.error(authErrorMessage(error, "Sign-in failed."));
      router.navigate({ to: "/dashboard" });
    } finally {
      setBusy(false);
    }
  };
  const onSignUp = async () => {
    const validation = validateCredentials(email, password);
    if (validation) return toast.error(validation);
    setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: window.location.origin + "/dashboard" },
      });
      if (error) return toast.error(authErrorMessage(error, "Sign-up failed."));
      toast.success("Account created. You can sign in now.");
    } finally {
      setBusy(false);
    }
  };
  const onGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) toast.error(authErrorMessage(error, "Google sign-in failed."));
  };
  const onForgotPassword = async () => {
    const validation = validateEmail(email);
    if (validation) return toast.error(validation);
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth`,
      });
      if (error) return toast.error(authErrorMessage(error, "Password reset email failed."));
      toast.success("Password reset email sent. Check your inbox.");
    } finally {
      setBusy(false);
    }
  };
  const onUpdatePassword = async () => {
    if (!newPassword || newPassword.length < 6) return toast.error("Password must be at least 6 characters.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return toast.error(authErrorMessage(error, "Password update failed."));
      toast.success("Password updated. You are signed in.");
      router.navigate({ to: "/dashboard" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center justify-center gap-2 mb-6">
          <Stethoscope className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold">MedVideo<span className="text-primary"> AI</span></span>
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>{recoveryMode ? "Reset password" : "Welcome"}</CardTitle>
            <CardDescription>
              {recoveryMode
                ? "Choose a new password for your MedVideo AI account."
                : "Sign in to continue producing medical video content."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recoveryMode ? (
              <div className="space-y-3">
                <div>
                  <Label>New password</Label>
                  <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </div>
                <Button className="w-full" disabled={busy} onClick={onUpdatePassword}>
                  {busy ? "..." : "Update password"}
                </Button>
                <Button variant="ghost" className="w-full" disabled={busy} onClick={() => setRecoveryMode(false)}>
                  Back to sign in
                </Button>
              </div>
            ) : (
              <>
                <Button variant="outline" className="w-full mb-4" onClick={onGoogle}>
                  Continue with Google
                </Button>
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or with email</span>
                  </div>
                </div>
                <Tabs defaultValue="signin">
                  <TabsList className="grid grid-cols-2 w-full">
                    <TabsTrigger value="signin">Sign in</TabsTrigger>
                    <TabsTrigger value="signup">Sign up</TabsTrigger>
                  </TabsList>
                  <TabsContent value="signin" className="space-y-3 pt-3">
                    <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                    <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
                    <Button className="w-full" disabled={busy} onClick={onSignIn}>{busy ? "..." : "Sign in"}</Button>
                    <Button variant="link" className="w-full px-0 text-sm" disabled={busy} onClick={onForgotPassword}>
                      Forgot password?
                    </Button>
                  </TabsContent>
                  <TabsContent value="signup" className="space-y-3 pt-3">
                    <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                    <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
                    <Button className="w-full" disabled={busy} onClick={onSignUp}>{busy ? "..." : "Create account"}</Button>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
