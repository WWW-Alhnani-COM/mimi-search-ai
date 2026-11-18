import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createTelegramAdminClient } from "@/lib/telegram/auth-server";
import { discoverTelegramChannels } from "@/lib/telegram/discovery-engine";
import { collectTelegramChannel } from "@/lib/telegram/collection-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

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
    p_limit: 1,
  });

  if (claimError) {
    console.error("[telegram-worker-claim]", claimError.message);
    return NextResponse.json({ error: "WORKER_CLAIM_FAILED" }, { status: 500 });
  }

  const results: Array<{ taskId: string; status: string; result?: unknown; error?: string }> = [];
  for (const task of tasks ?? []) {
    try {
      let result: Record<string, unknown>;
      if (task.task_type === "discover_channels") {
        const ruleOffset = Number(task.payload?.ruleOffset ?? 0);
        result = await discoverTelegramChannels(admin, task.workspace_id, Number.isInteger(ruleOffset) && ruleOffset >= 0 ? ruleOffset : 0);
      } else if (task.task_type === "collect_channel") {
        const channelId = typeof task.payload?.channelId === "string" ? task.payload.channelId : "";
        if (!channelId) throw new Error("CHANNEL_ID_MISSING");
        result = await collectTelegramChannel(admin, task.workspace_id, channelId) as unknown as Record<string, unknown>;
      } else {
        throw new Error("UNSUPPORTED_TASK_TYPE");
      }
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
      if (result.hasMore === true) {
        const continuationPayload = task.task_type === "collect_channel"
          ? { channelId: task.payload?.channelId, continuationOf: task.id }
          : { ruleOffset: Number(result.nextRuleOffset ?? 0), continuationOf: task.id };
        const nextTaskType = task.task_type === "collect_channel" ? "collect_channel" : "discover_channels";
        const { error: continuationError } = await admin.from("telegram_worker_tasks").insert({
          workspace_id: task.workspace_id,
          task_type: nextTaskType,
          status: "queued",
          payload: continuationPayload,
          created_by: task.created_by ?? null,
        });
        if (continuationError && continuationError.code !== "23505") {
          console.error("[telegram-worker-continuation]", continuationError.message);
        }
      }
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
