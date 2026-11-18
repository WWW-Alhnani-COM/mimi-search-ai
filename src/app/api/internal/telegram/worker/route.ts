import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createTelegramAdminClient } from "@/lib/telegram/auth-server";
import { discoverTelegramChannels } from "@/lib/telegram/discovery-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const expected = process.env.TELEGRAM_WORKER_SECRET ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = createTelegramAdminClient();
  const workerId = `vercel-${process.env.VERCEL_REGION ?? "node"}`;
  const { data: tasks, error: claimError } = await admin.rpc("claim_telegram_worker_tasks", {
    p_worker_id: workerId,
    p_limit: 2,
  });

  if (claimError) {
    console.error("[telegram-worker-claim]", claimError.message);
    return NextResponse.json({ error: "WORKER_CLAIM_FAILED" }, { status: 500 });
  }

  const results: Array<{ taskId: string; status: string; result?: unknown; error?: string }> = [];
  for (const task of tasks ?? []) {
    try {
      if (task.task_type !== "discover_channels") throw new Error("UNSUPPORTED_TASK_TYPE");
      const result = await discoverTelegramChannels(admin, task.workspace_id);
      const { error: updateError } = await admin.from("telegram_worker_tasks").update({
        status: "completed",
        result,
        last_error: null,
        locked_at: null,
        locked_by: null,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", task.id);
      if (updateError) throw new Error("TASK_COMPLETION_SAVE_FAILED");
      results.push({ taskId: task.id, status: "completed", result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "WORKER_TASK_FAILED";
      const retryable = task.attempts < task.max_attempts;
      const safeMessage = /^[A-Z0-9_]{3,80}$/.test(message) ? message : "WORKER_TASK_FAILED";
      await admin.from("telegram_worker_tasks").update({
        status: retryable ? "queued" : "failed",
        available_at: retryable ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : new Date().toISOString(),
        last_error: safeMessage,
        locked_at: null,
        locked_by: null,
        finished_at: retryable ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", task.id);
      results.push({ taskId: task.id, status: retryable ? "queued" : "failed", error: safeMessage });
    }
  }

  return NextResponse.json({ claimed: (tasks ?? []).length, results });
}
