import { Link, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Stethoscope, LogOut, Settings, LayoutGrid } from "lucide-react";

export function AppHeader() {
  const router = useRouter();
  const signOut = async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth" });
  };
  return (
    <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-40">
      <div className="mx-auto max-w-7xl px-6 h-14 flex items-center justify-between">
        <Link to="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
          <Stethoscope className="h-5 w-5 text-primary" />
          <span>OncoVideo<span className="text-primary"> AI</span></span>
        </Link>
        <nav className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard"><LayoutGrid className="h-4 w-4 mr-1" />Projects</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/settings/ai"><Settings className="h-4 w-4 mr-1" />Settings</Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-1" />Sign out
          </Button>
        </nav>
      </div>
    </header>
  );
}
