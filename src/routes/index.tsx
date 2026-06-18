import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Stethoscope, Sparkles, Film, FileText, Image as ImageIcon, ListChecks, Wand2 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MedVideo AI Studio — AI video production for medical educators" },
      { name: "description", content: "Turn a raw clinical talking-head video into a chaptered, storyboarded, SEO-ready educational package — transcripts, scene plans, storyboards, B-roll prompts, thumbnails and shorts." },
      { property: "og:title", content: "MedVideo AI Studio" },
      { property: "og:description", content: "AI video production assistant for medical educators." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <Stethoscope className="h-5 w-5 text-primary" />
            MedVideo<span className="text-primary"> AI</span>
          </div>
          <Button asChild size="sm"><Link to="/auth">Sign in</Link></Button>
        </div>
      </header>
      <section className="mx-auto max-w-5xl px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground mb-6">
          <Sparkles className="h-3 w-3 text-primary" /> Built for clinicians, surgeons, and medical educators
        </div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
          From talking-head to <span className="text-primary">publish-ready</span> medical video.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          Upload a raw clinical recording. Get a transcript, chapter map, visual storyboard, B-roll prompts, infographic ideas, thumbnails, SEO and shorts — tuned to your specialty.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button size="lg" asChild><Link to="/auth">Start producing</Link></Button>
          <Button size="lg" variant="outline" asChild><Link to="/auth">Sign in</Link></Button>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-6 pb-24 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { icon: FileText, t: "Transcripts & chapters", d: "Word-accurate transcript with structured chapter map." },
          { icon: Film, t: "Scene plan + storyboard", d: "Specialty-tuned visual storyboard with asset prompts." },
          { icon: ImageIcon, t: "B-roll & infographics", d: "Generation-ready prompts for every cutaway and chart." },
          { icon: Wand2, t: "Thumbnails & SEO", d: "Click-worthy thumbnails plus YouTube SEO package." },
          { icon: ListChecks, t: "Shorts ideas", d: "Hooks and captions ready for Reels, Shorts, TikTok." },
          { icon: Sparkles, t: "Cost tracking & versions", d: "Every AI call logged. Regenerate any task safely." },
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="rounded-xl border border-border bg-card p-5">
            <Icon className="h-5 w-5 text-primary mb-3" />
            <div className="font-medium">{t}</div>
            <p className="text-sm text-muted-foreground mt-1">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
