import { NextResponse } from "next/server";
import { startTask, snapshot } from "@/lib/agent/resolver";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await startTask(id);
    return NextResponse.json(await snapshot(id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "start failed";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
