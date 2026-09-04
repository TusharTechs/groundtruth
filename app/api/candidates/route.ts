import { NextResponse } from "next/server";
import { z } from "zod";
import { discoverCandidates } from "@/lib/discovery/candidates";
import { ManualCandidateProvider } from "@/lib/discovery/providers";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  taskId: z.string().uuid(),
  candidates: z
    .array(
      z.object({
        name: z.string().min(1),
        phone: z.string().min(7),
        region: z.string().min(2).max(2).default("IN"),
        locale: z.string().default("en-IN"),
        distanceKm: z.number().nonnegative().nullable().optional(),
        address: z.string().optional(),
      }),
    )
    .min(1)
    .max(10),
});

/** Manual candidate injection for an existing analyzed task. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid candidates payload" }, { status: 400 });
  }
  const store = getStore();
  const task = await store.getTask(parsed.data.taskId);
  if (!task?.goal) {
    return NextResponse.json({ error: "Task not found or not analyzed" }, { status: 404 });
  }
  const provider = new ManualCandidateProvider(parsed.data.candidates);
  const candidates = await discoverCandidates(parsed.data.taskId, task.goal, provider, {
    limit: 10,
  });
  const added = await store.addCandidates(parsed.data.taskId, candidates);
  return NextResponse.json({ candidates: added }, { status: 201 });
}
