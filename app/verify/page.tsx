"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, Radar, Sparkles, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/ui/utils";

interface DemoInfo {
  mode: "mock" | "real";
  demoMode: boolean;
  store: string;
  scenarios: Array<{ id: string; title: string; description: string; sampleRequest: string }>;
}

interface AnalyzedGoal {
  goal: {
    objective: string;
    item: string;
    targetEquipment?: string;
    hardConstraints: Array<{ id: string; kind: string; label: string; question: string }>;
    softPreferences: Array<{ id: string; label: string }>;
    deadline?: string;
    geography?: string;
    authorization: { allowed: string[]; prohibited: string[]; note?: string };
    successCriteria: string;
  };
  analyzer: string;
}

export default function VerifyPage() {
  const router = useRouter();
  const [demo, setDemo] = useState<DemoInfo | null>(null);
  const [input, setInput] = useState("");
  const [scenarioId, setScenarioId] = useState<string>("compressor");
  const [phase, setPhase] = useState<"input" | "analyzing" | "review">("input");
  const [task, setTask] = useState<{ id: string; goal: AnalyzedGoal["goal"]; analyzer: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    fetch("/api/demo")
      .then((r) => r.json())
      .then((info: DemoInfo) => {
        setDemo(info);
        if (info.scenarios[0]) {
          setScenarioId(info.scenarios[0].id);
          if (!input) setInput(info.scenarios[0].sampleRequest);
        }
      })
      .catch(() => setError("Could not load demo configuration."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function analyze() {
    setPhase("analyzing");
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input, scenarioId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Analysis failed");
      setTask(body.task);
      setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
      setPhase("input");
    }
  }

  async function startVerification() {
    if (!task) return;
    setStarting(true);
    try {
      await fetch(`/api/tasks/${task.id}/start`, { method: "POST" });
      router.push(`/tasks/${task.id}`);
    } catch {
      setError("Could not start verification.");
      setStarting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200">
          <Radar className="h-4 w-4 text-emerald-400" /> GROUNDTRUTH
        </Link>
        {demo && (
          <span
            className={cn(
              "rounded-full border px-3 py-1 font-mono text-xs",
              demo.demoMode
                ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
            )}
          >
            {demo.demoMode ? "DEMO MODE" : "LIVE CALL-E"} · db: {demo.store}
          </span>
        )}
      </div>

      {phase !== "review" && (
        <>
          <h1 className="text-3xl font-bold tracking-tight">What do you need to verify?</h1>
          <p className="mt-2 text-zinc-400">
            Describe the goal the way you would describe it to a procurement colleague.
            GroundTruth extracts hard requirements, then calls suppliers to verify them.
          </p>

          <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-1.5">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder='e.g. "Find a genuine XZ-420 compressor for an ACME HVAC-200 within 25 km, available today, under ₹25,000. You may request a hold, but do not purchase anything."'
              className="w-full resize-none rounded-xl bg-transparent p-4 text-base outline-none placeholder:text-zinc-600"
            />
            <div className="flex items-center justify-between px-4 pb-3">
              <span className="font-mono text-xs text-zinc-600">{input.length}/2000</span>
              <button
                onClick={analyze}
                disabled={input.trim().length < 10 || phase === "analyzing"}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {phase === "analyzing" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Analyzing…
                  </>
                ) : (
                  <>
                    Analyze goal <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>

          {demo && demo.scenarios.length > 1 && (
            <div className="mt-6">
              <p className="mb-2 font-mono text-xs uppercase tracking-widest text-zinc-500">
                Demo scenario (deterministic)
              </p>
              <div className="grid gap-2 md:grid-cols-2">
                {demo.scenarios.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setScenarioId(s.id);
                      setInput(s.sampleRequest);
                    }}
                    className={cn(
                      "rounded-xl border p-4 text-left transition",
                      scenarioId === s.id
                        ? "border-emerald-500/50 bg-emerald-500/10"
                        : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700",
                    )}
                  >
                    <div className="text-sm font-semibold">{s.title}</div>
                    <div className="mt-1 text-xs leading-relaxed text-zinc-400">{s.description}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </>
      )}

      {phase === "analyzing" && (
        <div className="mt-16 flex flex-col items-center gap-3 text-zinc-400">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
          Extracting constraints and building the verification plan…
        </div>
      )}

      {phase === "review" && task && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-emerald-400">
            Understanding your request
          </p>
          <h1 className="mt-3 text-2xl font-bold">{task.goal.objective}</h1>

          <div className="mt-8 grid gap-4">
            <Section title="Goal">
              <div className="flex flex-wrap gap-2">
                <Chip>{task.goal.item}</Chip>
                {task.goal.targetEquipment && <Chip>works with {task.goal.targetEquipment}</Chip>}
                {task.goal.geography && <Chip>{task.goal.geography}</Chip>}
                {task.goal.deadline && <Chip>deadline {task.goal.deadline}</Chip>}
                <Chip>analyzer: {task.analyzer}</Chip>
              </div>
            </Section>

            <Section title="Hard requirements">
              <ul className="space-y-2">
                {task.goal.hardConstraints.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-sm">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    <div>
                      <span className="font-medium">{c.label}</span>
                      <span className="block text-xs text-zinc-500">
                        phone check: “{c.question}”
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>

            {task.goal.softPreferences.length > 0 && (
              <Section title="Preferences (ranking only)">
                <div className="flex flex-wrap gap-2">
                  {task.goal.softPreferences.map((p) => (
                    <Chip key={p.id}>{p.label}</Chip>
                  ))}
                </div>
              </Section>
            )}

            <Section title="Authorized actions">
              <div className="flex flex-wrap gap-2">
                {task.goal.authorization.allowed.map((a) => (
                  <Chip key={a} tone="ok">
                    ✓ {a.replace(/_/g, " ")}
                  </Chip>
                ))}
                {task.goal.authorization.prohibited.map((a) => (
                  <Chip key={a} tone="blocked">
                    ✕ {a.replace(/_/g, " ")}
                  </Chip>
                ))}
              </div>
              {task.goal.authorization.note && (
                <p className="mt-2 text-xs text-zinc-500">{task.goal.authorization.note}</p>
              )}
            </Section>
          </div>

          <div className="mt-8 flex items-center justify-between">
            <button
              onClick={() => setPhase("input")}
              className="text-sm text-zinc-400 hover:text-zinc-200"
            >
              ← Edit request
            </button>
            <button
              onClick={startVerification}
              disabled={starting}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-40"
            >
              {starting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Starting…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> Start verification
                </>
              )}
            </button>
          </div>
        </motion.div>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Chip({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "ok" | "blocked";
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-3 py-1 text-xs",
        tone === "default" && "border-zinc-700 bg-zinc-800/60 text-zinc-300",
        tone === "ok" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
        tone === "blocked" && "border-red-500/30 bg-red-500/10 text-red-300",
      )}
    >
      {children}
    </span>
  );
}
