import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
    const channelId = typeof body.channelId === "string" ? body.channelId : "";
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId) || !/^[0-9a-f-]{36}$/i.test(channelId)) {
      return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const { data: membership, error: membershipError } = await supabase.from("workspace_members")
      .select("role").eq("workspace_id", workspaceId).eq("user_id", auth.user.id).maybeSingle();
    if (membershipError || !membership || !["owner", "admin", "member"].includes(membership.role)) {
      return NextResponse.json({ error: "WORKSPACE_FORBIDDEN" }, { status: 403 });
    }

    const { data: channel, error: channelError } = await supabase.from("telegram_channels")
      .select("id,status").eq("id", channelId).eq("workspace_id", workspaceId).maybeSingle();
    if (channelError || !channel) return NextResponse.json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });
    if (channel.status !== "approved") return NextResponse.json({ error: "CHANNEL_NOT_APPROVED" }, { status: 409 });

    const { data: existing, error: existingError } = await supabase.from("telegram_worker_tasks")
      .select("id,status").eq("workspace_id", workspaceId).eq("task_type", "collect_channel")
      .contains("payload", { channelId }).in("status", ["queued", "running"]).limit(1).maybeSingle();
    if (existingError) throw new Error("QUEUE_LOOKUP_FAILED");
    if (existing) return NextResponse.json({ queued: true, taskId: existing.id, alreadyQueued: true }, { status: 202 });

    const { data: task, error: insertError } = await supabase.from("telegram_worker_tasks").insert({
      workspace_id: workspaceId,
      task_type: "collect_channel",
      status: "queued",
      payload: { channelId, requestedBy: "workspace_user", requestedAt: new Date().toISOString() },
      created_by: auth.user.id,
    }).select("id,status").single();
    if (insertError || !task) throw new Error("QUEUE_INSERT_FAILED");

    return NextResponse.json({ queued: true, taskId: task.id, status: task.status }, { status: 202 });
  } catch (error) {
    console.error("[telegram-collect-enqueue]", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "COLLECTION_ENQUEUE_FAILED" }, { status: 500 });
  }
}
