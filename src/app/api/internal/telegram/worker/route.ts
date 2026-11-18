import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createTelegramAdminClient } from "@/lib/telegram/auth-server";
import { discoverTelegramChannels } from "@/lib/telegram/discovery-engine";
import { collectTelegramChannel } from "@/lib/telegram/collection-engine";
import { processTelegramSourceItem } from "@/lib/telegram/lead-processing-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

function intervalMilliseconds(value: string | null | undefined) {
  if (value === "hourly") return 60 * 60 * 1000;
  if (value === "every_6_hours") return 6 * 60 * 60 * 1000;
  if (value === "every_12_hours") return 12 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

async function enqueueScheduledTasks(admin: ReturnType<typeof createTelegramAdminClient>) {
  const now = new Date();
  const nowIso = now.toISOString();
  const searchReady = process.env.TELEGRAM_DISCOVERY_SEARCH_ENABLED === "true"
    && Boolean(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX);

  if (searchReady) {
    const { data: dueSettings } = await admin.from("telegram_discovery_settings")
      .select("workspace_id,schedule_interval")
      .eq("discovery_enabled", true)
      .or(`next_discovery_at.is.null,next_discovery_at.lte.${nowIso}`)
      .limit(20);
    for (const setting of dueSettings ?? []) {
      const { data: active } = await admin.from("telegram_worker_tasks").select("id")
        .eq("workspace_id", setting.workspace_id).eq("task_type", "discover_channels")
        .in("status", ["queued", "running"]).limit(1).maybeSingle();
      if (!active) {
        await admin.from("telegram_worker_tasks").insert({
          workspace_id: setting.workspace_id,
          task_type: "discover_channels",
          status: "queued",
          payload: { ruleOffset: 0, scheduled: true },
        });
      }
      await admin.from("telegram_discovery_settings").update({
        next_discovery_at: new Date(now.getTime() + intervalMilliseconds(setting.schedule_interval)).toISOString(),
        last_discovery_status: active ? "running" : "queued",
      }).eq("workspace_id", setting.workspace_id);
    }
  }

  const { data: dueChannels } = await admin.from("telegram_channels")
    .select("id,workspace_id,last_collected_at")
    .eq("status", "approved").eq("collection_enabled", true)
    .limit(30);
  for (const channel of dueChannels ?? []) {
    const { data: setting } = await admin.from("telegram_discovery_settings")
      .select("schedule_interval").eq("workspace_id", channel.workspace_id).maybeSingle();
    const interval = intervalMilliseconds(setting?.schedule_interval);
    const lastCollected = channel.last_collected_at ? new Date(channel.last_collected_at).getTime() : 0;
    if (lastCollected && now.getTime() - lastCollected < interval) continue;

    const { data: active } = await admin.from("telegram_worker_tasks").select("id")
      .eq("workspace_id", channel.workspace_id).eq("task_type", "collect_channel")
      .contains("payload", { channelId: channel.id }).in("status", ["queued", "running"])
      .limit(1).maybeSingle();
    if (active) continue;

    await admin.from("telegram_worker_tasks").insert({
      workspace_id: channel.workspace_id,
      task_type: "collect_channel",
      status: "queued",
      payload: { channelId: channel.id, scheduled: true },
    });
    await admin.from("telegram_channels").update({ last_collection_status: "queued" })
      .eq("id", channel.id).eq("workspace_id", channel.workspace_id);
  }
}

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
  await enqueueScheduledTasks(admin);
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
      } else if (task.task_type === "process_source_item") {
        const sourceItemId = typeof task.payload?.sourceItemId === "string" ? task.payload.sourceItemId : "";
        if (!sourceItemId) throw new Error("SOURCE_ITEM_ID_MISSING");
        result = await processTelegramSourceItem(admin, task.workspace_id, sourceItemId) as unknown as Record<string, unknown>;
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
      if (task.task_type === "discover_channels" && result.hasMore !== true) {
        await admin.from("telegram_discovery_settings").update({
          last_discovery_at: new Date().toISOString(),
          last_discovery_status: "completed",
        }).eq("workspace_id", task.workspace_id);
      }
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
      if (task.task_type === "discover_channels" && !retryable) {
        await admin.from("telegram_discovery_settings").update({
          last_discovery_status: "failed",
        }).eq("workspace_id", task.workspace_id);
      }
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
