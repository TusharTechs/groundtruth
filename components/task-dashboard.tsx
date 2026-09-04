"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  Ban,
  CircleDashed,
  FileText,
  Loader2,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  Scale,
  ShieldAlert,
  Sparkles,
  XCircle,
} from "lucide-react";
import { GroundTruthMark } from "@/components/brand";
import { cn, maskPhoneUi, formatCurrency } from "@/lib/ui/utils";
import type { TaskSnapshot, Claim, Evidence } from "@/lib/domain/types";

const POLL_MS = 1200;

export function TaskDashboard({ taskId }: { taskId: string }) {
  const [snap, setSnap] = useState<TaskSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applySnapshot = useCallback((next: TaskSnapshot) => {
    setSnap(next);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function tickOnce() {
      try {
        const res = await fetch(`/api/tasks/${taskId}/tick`, { method: "POST" });
        if (!res.ok) throw new Error((await res.json()).error ?? "tick failed");
        const next = (await res.json()) as TaskSnapshot;
        if (!cancelled) applySnapshot(next);
        if (next.task.status === "completed" || next.task.status === "failed") {
          if (tickRef.current) clearInterval(tickRef.current);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "tick failed");
        if (tickRef.current) clearInterval(tickRef.current);
      }
    }

    tickOnce();
    tickRef.current = setInterval(tickOnce, POLL_MS);
    return () => {
      cancelled = true;
      if (tickRef.current) clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const evidenceFor = useMemo(() => {
    const map = new Map<string, Evidence[]>();
    for (const ev of snap?.evidence ?? []) {
      const list = map.get(ev.claimId) ?? [];
      list.push(ev);
      map.set(ev.claimId, list);
    }
    return map;
  }, [snap]);

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-3 px-6">
        <ShieldAlert className="h-8 w-8 text-red-400" />
        <p className="text-zinc-300">{error}</p>
        <a href="/verify" className="text-sm text-emerald-400 hover:underline">
          ← Start a new verification
        </a>
      </main>
    );
  }

  if (!snap) {
    return (
      <main className="flex min-h-screen items-center justify-center text-zinc-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading verification…
      </main>
    );
  }

  const { task, candidates, calls, events, claims, decision, evaluations, audit } = snap;
  const goal = task.goal!;
  const running = task.status === "running";
  const completed = task.status === "completed" || task.status === "failed";
  const winner = decision?.winnerCandidateId
    ? candidates.find((c) => c.id === decision.winnerCandidateId)
    : undefined;
  const winnerRanked = decision?.ranked.find((r) => r.candidateId === decision.winnerCandidateId);
  const activeCall = calls.find((c) =>
    ["pending", "queued", "dialing", "in_progress"].includes(c.status),
  );
  const winnerClaims = winner ? claims.filter((c) => c.candidateId === winner.id) : [];

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <a href="/verify" className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200">
          <GroundTruthMark className="h-5 w-5 text-emerald-400" /> GROUNDTRUTH
        </a>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full border px-3 py-1 font-mono text-xs",
              task.mode === "mock"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
            )}
          >
            {task.mode === "mock" ? "DEMO MODE (mock CALL-E)" : "LIVE CALL-E"}
          </span>
          <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-3 py-1 font-mono text-xs text-zinc-300">
            {running && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
            {task.status.toUpperCase()}
          </span>
        </div>
      </div>

      <h1 className="text-2xl font-bold tracking-tight">{goal.objective}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {candidates.length} candidates · {calls.length} calls ·{" "}
        {calls.filter((c) => c.status === "completed").length} completed
      </p>

      {/* Final result banner */}
      <AnimatePresence>
        {decision && completed && (
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "mt-6 rounded-2xl border p-6",
              decision.status === "success"
                ? "border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 to-zinc-900"
                : "border-red-500/40 bg-gradient-to-br from-red-500/10 to-zinc-900",
            )}
          >
            {decision.status === "success" && winner ? (
              <>
                <p className="font-mono text-xs uppercase tracking-[0.3em] text-emerald-400">
                  Reality verified
                </p>
                <h2 className="mt-2 text-3xl font-bold">{goal.item}</h2>
                <p className="mt-1 text-lg text-zinc-300">{winner.name}</p>
                {winnerClaims.some((c) => c.type === "price" && c.status === "verified") && (
                  <p className="mt-3 text-2xl font-semibold text-emerald-300">
                    {formatCurrency(
                      (winnerClaims.find((c) => c.type === "price")!.value as { amount: number })
                        .amount,
                    )}
                  </p>
                )}
                <ul className="mt-4 flex flex-wrap gap-2">
                  {winnerClaims
                    .filter((c) => c.status === "verified")
                    .map((c) => (
                      <li key={c.id}>
                        <ClaimChip claim={c} onClick={() => setSelectedClaim(c)} />
                      </li>
                    ))}
                </ul>
                <dl className="mt-5 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                  <div>
                    <dt className="text-zinc-500">Distance</dt>
                    <dd className="font-medium">{winner.distanceKm ?? "?"} km</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Confidence</dt>
                    <dd className="font-medium">{Math.round(decision.confidence * 100)}%</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Hard checks</dt>
                    <dd className="font-medium">
                      {winnerRanked?.verifiedHard}/{goal.hardConstraints.length} verified
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Phone</dt>
                    <dd className="font-mono">{maskPhoneUi(winner.phone)}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <>
                <p className="font-mono text-xs uppercase tracking-[0.3em] text-red-400">
                  No fully verified match
                </p>
                <h2 className="mt-2 text-2xl font-bold">
                  {calls.length} call{calls.length === 1 ? "" : "s"} placed. Every candidate
                  failed at least one hard requirement.
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-zinc-400">{decision.explanation}</p>
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {decision.ranked.map((r) => (
                    <div
                      key={r.candidateId}
                      className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 text-sm"
                    >
                      <div className="font-medium">{r.name}</div>
                      <ul className="mt-1 space-y-0.5 text-xs text-zinc-400">
                        {r.reasons.length > 0 ? (
                          r.reasons.map((reason, i) => <li key={i}>· {reason}</li>)
                        ) : (
                          <li>· unresolved requirements</li>
                        )}
                      </ul>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap gap-2 text-sm">
                  <span className="text-zinc-500">Options:</span>
                  {["Increase budget", "Expand radius", "Relax pickup deadline", "Stop"].map(
                    (o) => (
                      <span
                        key={o}
                        className="rounded-full border border-zinc-700 bg-zinc-800/60 px-3 py-1 text-zinc-300"
                      >
                        {o}
                      </span>
                    ),
                  )}
                </div>
              </>
            )}
            <p className="mt-5 border-t border-zinc-800 pt-4 text-sm text-zinc-400">
              <span className="font-medium text-zinc-200">Why this result?</span>{" "}
              {decision.explanation}
            </p>
          </motion.section>
        )}
      </AnimatePresence>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        {/* Left: candidates + constraints */}
        <div className="flex flex-col gap-4 lg:col-span-3">
          {candidates.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              evaluations={evaluations.filter((e) => e.candidateId === candidate.id)}
              claims={claims.filter((c) => c.candidateId === candidate.id)}
              goalConstraints={goal.hardConstraints}
              calls={calls.filter((c) => c.candidateId === candidate.id)}
              onSelectClaim={setSelectedClaim}
              isWinner={decision?.winnerCandidateId === candidate.id}
            />
          ))}
        </div>

        {/* Right: live timeline */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">
                <PhoneCall className="h-3.5 w-3.5" /> Live timeline
              </h2>
            </div>
            {activeCall && (
              <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-3">
                <p className="flex items-center gap-2 text-sm font-medium text-emerald-300">
                  <span className="pulse-ring relative inline-block h-2 w-2 rounded-full bg-emerald-400" />
                  {activeCall.status === "dialing" ? "Dialing…" : "On the call…"} · attempt{" "}
                  {activeCall.attempt}
                </p>
                {activeCall.transcript.length > 0 && (
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono text-xs">
                    {activeCall.transcript.map((t, i) => (
                      <p key={i} className={t.speaker === "bot" ? "text-zinc-400" : "text-zinc-200"}>
                        <span className="text-zinc-600">
                          [{t.offsetSeconds ?? "?"}s]{" "}
                          {t.speaker === "bot" ? "GT:" : "SUP:"}
                        </span>{" "}
                        {t.text}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
            <ol className="max-h-[480px] space-y-0 overflow-y-auto p-4">
              {events.length === 0 && (
                <li className="text-sm text-zinc-600">Waiting for the first event…</li>
              )}
              {[...events].reverse().map((event) => (
                <li key={event.id} className="flex gap-3 py-1.5">
                  <EventIcon type={event.type} level={event.level} />
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-xs",
                        event.level === "warning" ? "text-amber-300" : "text-zinc-200",
                      )}
                    >
                      {event.message}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                      {event.type}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">
                <Scale className="h-3.5 w-3.5" /> Audit trail
              </h2>
            </div>
            <ol className="max-h-56 space-y-1.5 overflow-y-auto p-4 text-xs text-zinc-400">
              {audit.map((a) => (
                <li key={a.id}>
                  <span className="font-mono text-zinc-500">
                    {new Date(a.createdAt).toLocaleTimeString("en-IN", { hour12: false })}
                  </span>{" "}
                  <span className="text-zinc-300">{a.action}</span> — {a.detail}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      {/* Evidence modal */}
      <AnimatePresence>
        {selectedClaim && (
          <EvidenceModal
            claim={selectedClaim}
            evidence={evidenceFor.get(selectedClaim.id) ?? []}
            candidateName={candidates.find((c) => c.id === selectedClaim.candidateId)?.name ?? ""}
            call={calls.find((c) => c.id === selectedClaim.callId)}
            onClose={() => setSelectedClaim(null)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

// ---------------------------------------------------------------------------

function CandidateCard({
  candidate,
  evaluations,
  claims,
  goalConstraints,
  calls,
  onSelectClaim,
  isWinner,
}: {
  candidate: TaskSnapshot["candidates"][number];
  evaluations: TaskSnapshot["evaluations"];
  claims: Claim[];
  goalConstraints: NonNullable<TaskSnapshot["task"]["goal"]>["hardConstraints"];
  calls: TaskSnapshot["calls"];
  onSelectClaim: (c: Claim) => void;
  isWinner: boolean;
}) {
  const transcriptCall = calls.find((c) => c.transcript.length > 0);
  return (
    <section
      className={cn(
        "rounded-2xl border bg-zinc-900/60 p-5",
        isWinner ? "border-emerald-500/50" : "border-zinc-800",
        candidate.status === "rejected" && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            {candidate.name}
            {isWinner && <BadgeCheck className="h-4 w-4 text-emerald-400" />}
          </h3>
          <p className="text-xs text-zinc-500">
            {maskPhoneUi(candidate.phone)} · {candidate.distanceKm ?? "?"} km ·{" "}
            {candidate.status}
          </p>
        </div>
        <span className="rounded-full border border-zinc-700 px-2 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
          {candidate.provider}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {goalConstraints.map((constraint) => {
          const evaluation = evaluations.find((e) => e.constraintId === constraint.id);
          const status = evaluation?.status ?? "unknown";
          const claim = claims.find((c) => c.id === evaluation?.claimId);
          const hasEvidence = claim ? claim.evidenceIds.length > 0 : false;
          return (
            <button
              key={constraint.id}
              onClick={() => claim && hasEvidence && onSelectClaim(claim)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs transition",
                status === "pass" &&
                  "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
                status === "fail" && "border-red-500/40 bg-red-500/10 text-red-300",
                status === "unknown" && "border-zinc-700 bg-zinc-800/50 text-zinc-400",
                claim && hasEvidence && "cursor-pointer hover:brightness-125",
              )}
              title={evaluation?.reason}
            >
              {status === "pass" ? "✓" : status === "fail" ? "✕" : "?"} {constraint.label}
              {claim?.status === "verified" && claim.confidence > 0 && (
                <span className="ml-1 text-[10px] text-zinc-500">
                  {Math.round(claim.confidence * 100)}%
                </span>
              )}
            </button>
          );
        })}
      </div>

      {candidate.rejectionReason && (
        <p className="mt-3 text-xs text-red-300/80">{candidate.rejectionReason}</p>
      )}

      {transcriptCall && transcriptCall.transcript.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
            <FileText className="mr-1 inline h-3 w-3" /> Transcript ({transcriptCall.transcript.length}{" "}
            turns, PII-redacted)
          </summary>
          <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg bg-zinc-950/60 p-3 font-mono text-[11px]">
            {transcriptCall.transcript.map((t, i) => (
              <p key={i} className={t.speaker === "bot" ? "text-zinc-500" : "text-zinc-300"}>
                <span className="text-zinc-600">
                  [{t.offsetSeconds ?? "?"}s] {t.speaker === "bot" ? "GT" : "SUP"}:
                </span>{" "}
                {t.text}
              </p>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function ClaimChip({ claim, onClick }: { claim: Claim; onClick: () => void }) {
  const label =
    claim.type === "price" && claim.value && typeof claim.value === "object"
      ? `Price ${(claim.value as { amount: number }).amount}`
      : claim.type === "quantity"
        ? `${claim.value} units confirmed`
        : claim.type === "hold"
          ? `Hold confirmed${claim.value && claim.value !== true ? ` until ${claim.value}` : ""}`
          : claim.type === "pickup"
            ? "Pickup today"
            : claim.type === "availability"
              ? "In stock"
              : claim.type === "compatibility"
                ? "Compatible"
                : claim.type;
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20"
    >
      <BadgeCheck className="h-3.5 w-3.5" /> {label} ✓
    </button>
  );
}

function EventIcon({ type, level }: { type: string; level: string }) {
  const cls = cn(
    "mt-0.5 h-3.5 w-3.5 shrink-0",
    level === "warning" ? "text-amber-400" : "text-zinc-500",
  );
  if (type === "CALL_STARTED") return <PhoneIncoming className={cls} />;
  if (type === "CALL_FAILED") return <PhoneMissed className={cls} />;
  if (type === "CALL_COMPLETED") return <PhoneCall className={cls} />;
  if (type.includes("VERIFIED")) return <BadgeCheck className="text-emerald-400" />;
  if (type.includes("FAILED")) return <XCircle className="text-red-400" />;
  if (type === "STRATEGY_DECISION") return <Sparkles className={cls} />;
  if (type === "REQUEST_PARTIALLY_REFUSED") return <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />;
  if (type === "GOAL_INCOMPATIBLE") return <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />;
  if (type === "DECISION_REACHED") return <BadgeCheck className="text-emerald-400" />;
  if (type === "TASK_STARTED") return <CircleDashed className={cls} />;
  return <CircleDashed className={cls} />;
}

function EvidenceModal({
  claim,
  evidence,
  candidateName,
  call,
  onClose,
}: {
  claim: Claim;
  evidence: Evidence[];
  candidateName: string;
  call?: TaskSnapshot["calls"][number];
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p
              className={cn(
                "font-mono text-xs uppercase tracking-[0.3em]",
                claim.status === "verified" ? "text-emerald-400" : "text-amber-400",
              )}
            >
              {claim.status} claim
            </p>
            <h3 className="mt-2 text-lg font-semibold">{claim.statement}</h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <Ban className="h-5 w-5" />
          </button>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-zinc-500">Source</dt>
            <dd className="font-medium">{candidateName}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Method</dt>
            <dd className="font-medium">Phone verification via CALL-E</dd>
          </div>
          <div>
            <dt className="text-zinc-500">CALL-E call ID</dt>
            <dd className="font-mono text-xs">{call?.calleCallId ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Confidence</dt>
            <dd className="font-medium">
              {claim.status === "verified" ? `${Math.round(claim.confidence * 100)}%` : "—"}
            </dd>
          </div>
        </dl>

        <div className="mt-5">
          <h4 className="mb-2 font-mono text-xs uppercase tracking-widest text-zinc-500">
            Evidence ({evidence.length})
          </h4>
          <ul className="space-y-2">
            {evidence.length === 0 && (
              <li className="text-sm text-zinc-500">
                No evidence attached — this claim is not verifiable.
              </li>
            )}
            {evidence.map((ev) => (
              <li
                key={ev.id}
                className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-sm"
              >
                <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  <span>{ev.source.replace(/_/g, " ")}</span>
                  <span>{new Date(ev.capturedAt).toLocaleTimeString("en-IN")}</span>
                </div>
                <p className="text-zinc-300">{ev.excerpt}</p>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-5 text-xs text-zinc-600">
          Captured {new Date(claim.createdAt).toLocaleString("en-IN")} · claims are immutable
          once evidence is attached; status history:{" "}
          {claim.statusHistory.map((h) => `${h.from}→${h.to}`).join(", ")}
        </p>
      </motion.div>
    </motion.div>
  );
}
