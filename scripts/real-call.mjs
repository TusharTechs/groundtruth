/**
 * One real CALL-E verification call, to a number the operator nominates.
 *
 * Drives the running app over HTTP, so this exercises exactly the code path
 * the deployed product uses. The only direct database write is the safety
 * step: createTask() seeds the task with the demo scenario's suppliers, whose
 * numbers are fictional but well-formed Indian landlines, and in real mode
 * those would dial actual strangers. Every discovered candidate is retired
 * before anything starts, and the run refuses to begin unless the pending
 * set is precisely the one nominated number.
 *
 * Usage: node real-call.mjs http://localhost:3000 +91XXXXXXXXXX "Name"
 */
import fs from "node:fs";
import pg from "pg";

const [, , BASE, PHONE, NAME = "Test Supplier"] = process.argv;
if (!BASE || !PHONE?.startsWith("+")) {
  console.error('Usage: node real-call.mjs <baseUrl> +<E164> ["Name"]');
  process.exit(1);
}

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const j = async (url, init) => {
  const r = await fetch(url, init);
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; }
  catch { return { status: r.status, body: text }; }
};

// 0. The app must actually be in real mode, or nothing rings.
const settings = await j(`${BASE}/api/settings`);
console.log("[setup] settings:", JSON.stringify(settings.body));
const DRY_RUN = process.env.DRY_RUN === "true";
if (settings.body.demoMode !== false && !DRY_RUN) {
  console.error("[abort] app is in DEMO MODE — start it with MOCK_CALL_E=false.");
  process.exit(1);
}

const REQUEST =
  "Find a genuine XZ-420 compressor for an ACME HVAC-200 within 25 km. " +
  "It must be compatible, available today, under 25000, and the supplier " +
  "must hold it until 5 PM. You may request a hold, but do not purchase anything.";

const created = await j(`${BASE}/api/tasks`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ input: REQUEST }),
});
const task = created.body.task;
console.log(`[setup] task ${task.id} — ${task.goal.hardConstraints.length} hard constraints`);

// 1. Retire every auto-discovered candidate. None of them may be dialled.
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
const retired = await pool.query(
  `update candidates set status = 'rejected',
     rejection_reason = 'not dialled: demo persona excluded from real-call test'
   where task_id = $1 and status = 'pending' returning phone`,
  [task.id],
);
console.log(`[safety] retired ${retired.rowCount} demo candidate(s)`);

// 2. Inject exactly one manual candidate, through the app's own endpoint.
const added = await j(`${BASE}/api/candidates`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    taskId: task.id,
    candidates: [{ name: NAME, phone: PHONE, region: "IN", locale: "en-IN", distanceKm: 5 }],
  }),
});
if (added.status !== 201) {
  console.error("[abort] could not add candidate:", added.status, added.body);
  process.exit(1);
}

// 3. Hard gate: the pending set must be exactly the nominated number.
const check = await pool.query(
  `select name, phone, status from candidates where task_id = $1 and status = 'pending'`,
  [task.id],
);
if (check.rowCount !== 1 || check.rows[0].phone !== PHONE) {
  console.error("[abort] pending set is not exactly the nominated number:");
  for (const r of check.rows) console.error(`         ${r.name} ${r.phone} (${r.status})`);
  await pool.end();
  process.exit(1);
}
console.log(`[safety] pending set verified: 1 candidate, ${PHONE}`);
await pool.end();

// 4. Go.
if (DRY_RUN) {
  console.log("[dry-run] safety gate passed; stopping before any call is placed.");
  process.exit(0);
}
await j(`${BASE}/api/tasks/${task.id}/start`, { method: "POST" });
console.log("\n[run] started — the phone should ring shortly.\n");

let printedTask = false, lastTurns = 0, lastStatus = "", snap;
for (let i = 0; i < 400; i++) {
  const r = await j(`${BASE}/api/tasks/${task.id}/tick`, { method: "POST" });
  snap = r.body;
  const call = snap.calls?.at(-1);
  if (call && !printedTask) {
    console.log("--- call task handed to CALL-E ---");
    console.log(call.task);
    console.log("----------------------------------\n");
    printedTask = true;
  }
  if (call && call.status !== lastStatus) {
    console.log(`[call] ${call.calleCallId} -> ${call.status}`);
    lastStatus = call.status;
  }
  if (call && call.transcript.length > lastTurns) {
    for (const t of call.transcript.slice(lastTurns)) {
      console.log(`   [${t.offsetSeconds ?? "?"}s] ${t.speaker === "bot" ? "GT " : "SUP"}: ${t.text}`);
    }
    lastTurns = call.transcript.length;
  }
  if (snap.task?.status === "completed" || snap.task?.status === "failed") break;
  await new Promise((res) => setTimeout(res, 3000));
}

console.log(`\n=== RESULT (task ${snap.task?.status}) ===`);
for (const c of snap.calls ?? []) {
  console.log(`call ${c.calleCallId}`);
  console.log(`  status     : ${c.status}`);
  console.log(`  taskDone   : ${c.taskCompleted}   confidence: ${c.completionConfidence}`);
  console.log(`  result     : ${JSON.stringify(c.result)}`);
  if (c.failureCode) console.log(`  failure    : ${c.failureCode} ${c.failureMessage ?? ""}`);
  console.log(`  transcript : ${c.transcript.length} turns`);
}
for (const cl of snap.claims ?? []) {
  console.log(`claim ${cl.type.padEnd(14)} ${cl.status.padEnd(11)} ev:${cl.evidenceIds.length}  ${cl.statement}`);
}
if (snap.decision) {
  console.log(`\ndecision: ${snap.decision.status}  confidence ${snap.decision.confidence}`);
  console.log(`  ${snap.decision.explanation}`);
}
console.log(`\nView in the UI: ${BASE}/tasks/${task.id}`);
