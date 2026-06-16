import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/settings/brand")({
  component: BrandPage,
  head: () => ({ meta: [{ title: "Brand profile — OncoVideo" }] }),
});

function BrandPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Brand profile</CardTitle>
          <CardDescription>Intro/outro, watermark, logo, subtitle styling. Used when the Phase 2 rendering pipeline ships.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Phase 1 ships without video rendering. Render profiles are stored and will be used by the Phase 2 auto-editor.</p>
        </CardContent>
      </Card>
    </div>
  );
}
