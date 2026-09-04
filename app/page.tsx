import Link from "next/link";
import { PhoneCall, ShieldCheck, FileSearch, ArrowRight, Scale, ScrollText, Radar } from "lucide-react";
import { isMockMode } from "@/lib/calle/client";

export const dynamic = "force-dynamic";

export default function Landing() {
  const demoMode = isMockMode();
  return (
    <main className="relative flex min-h-screen flex-col items-center overflow-hidden">
      <div className="hero-grid pointer-events-none absolute inset-0" />

      <header className="z-10 flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <Radar className="h-6 w-6 text-emerald-400" />
          <span className="text-lg font-semibold tracking-[0.2em]">GROUNDTRUTH</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span
            className={`rounded-full border px-3 py-1 font-mono text-xs ${
              demoMode
                ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
            }`}
          >
            {demoMode ? "DEMO MODE (mock CALL-E)" : "LIVE CALL-E"}
          </span>
          <a
            href="https://github.com/CALLE-AI/awesome-phone-call-agents"
            target="_blank"
            rel="noreferrer"
            className="text-zinc-400 hover:text-zinc-200"
          >
            Built for CALL-E
          </a>
        </div>
      </header>

      <section className="z-10 flex flex-col items-center px-6 pt-16 pb-24 text-center">
        <p className="mb-4 font-mono text-sm uppercase tracking-[0.35em] text-emerald-400">
          Agentic verification engine
        </p>
        <h1 className="max-w-4xl text-5xl font-bold leading-tight tracking-tight md:text-7xl">
          Verify Reality
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-zinc-400 md:text-xl">
          When the internet isn&apos;t enough, ask the people who know.
        </p>
        <p className="mt-4 max-w-2xl text-base text-zinc-500">
          GroundTruth turns a fuzzy operational goal into hard constraints, calls real
          suppliers by phone through{" "}
          <a
            className="text-emerald-400 underline decoration-emerald-500/40 underline-offset-4 hover:decoration-emerald-400"
            href="https://www.heycall-e.com/"
            target="_blank"
            rel="noreferrer"
          >
            CALL-E
          </a>
          , adapts its questions to what each person actually says, and returns
          evidence-backed claims — not guesses.
        </p>
        <Link
          href="/verify"
          className="group mt-10 inline-flex items-center gap-2 rounded-full bg-emerald-500 px-8 py-4 text-base font-semibold text-zinc-950 transition hover:bg-emerald-400"
        >
          Verify Reality
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </section>

      <section className="z-10 grid w-full max-w-6xl gap-4 px-6 pb-24 md:grid-cols-3">
        {[
          {
            icon: FileSearch,
            title: "Claims, not vibes",
            body: "Every answer from a phone call becomes a typed claim — availability, compatibility, price, hold — with a lifecycle that never turns 'I think so' into VERIFIED.",
          },
          {
            icon: PhoneCall,
            title: "CALL-E does the phone work",
            body: "Adaptive conversations, transfers, follow-ups and structured results are handled by CALL-E at runtime. GroundTruth orchestrates, CALL-E dials.",
          },
          {
            icon: ShieldCheck,
            title: "Safety is structural",
            body: "Authorization gates run at the orchestration layer: question-only calls, purchase/payment phrases blocked before dialing, PII redacted, every action audited.",
          },
        ].map((f) => (
          <div
            key={f.title}
            className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 backdrop-blur"
          >
            <f.icon className="mb-4 h-6 w-6 text-emerald-400" />
            <h3 className="mb-2 text-lg font-semibold">{f.title}</h3>
            <p className="text-sm leading-relaxed text-zinc-400">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="z-10 w-full max-w-6xl px-6 pb-32">
        <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-8">
          <div className="mb-6 flex items-center gap-2 text-sm font-mono uppercase tracking-widest text-zinc-500">
            <Scale className="h-4 w-4" /> The core loop
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-sm">
            {["PLAN", "CALL", "ADAPT", "EXTRACT", "VERIFY", "DECIDE"].map((step, i) => (
              <span key={step} className="flex items-center gap-2">
                <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-emerald-300">
                  {step}
                </span>
                {i < 5 && <span className="text-zinc-600">→</span>}
              </span>
            ))}
          </div>
          <div className="mt-8 grid gap-6 text-sm text-zinc-400 md:grid-cols-2">
            <div className="flex gap-3">
              <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
              <p>
                <span className="text-zinc-200">Judges can inspect everything:</span> each
                verified claim links to its CALL-E call, the supplier&apos;s own words,
                and the completion confidence — or it isn&apos;t verified at all.
              </p>
            </div>
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
              <p>
                <span className="text-zinc-200">Failure is a feature:</span> when no
                supplier satisfies the constraints, GroundTruth says so plainly and
                shows exactly why each candidate was rejected.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
