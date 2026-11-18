import { NextResponse } from "next/server";
import { createTelegramAdminClient, decryptTelegramState, requireTelegramWorkspaceAdmin } from "@/lib/telegram/auth-server";
import { searchTelegramPublicPosts } from "@/lib/telegram/public-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
    const connectionId = typeof body.connectionId === "string" ? body.connectionId : "";
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId) || !/^[0-9a-f-]{36}$/i.test(connectionId) || query.length < 2 || query.length > 128) {
      return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
    }

    await requireTelegramWorkspaceAdmin(workspaceId);
    const admin = createTelegramAdminClient();
    const { data: connection, error: connectionError } = await admin.from("source_connections")
      .select("id,workspace_id,status")
      .eq("id", connectionId).eq("workspace_id", workspaceId)
      .eq("platform", "telegram").eq("status", "connected").maybeSingle();
    if (connectionError || !connection) return NextResponse.json({ error: "TELEGRAM_CONNECTION_NOT_FOUND" }, { status: 404 });

    const { data: secretRows, error: secretError } = await admin.rpc("read_telegram_session", {
      target_connection_id: connectionId,
    });
    const secret = Array.isArray(secretRows) ? secretRows[0] : secretRows;
    if (secretError || !secret?.secret_payload_ciphertext || secret.workspace_id !== workspaceId) {
      return NextResponse.json({ error: "TELEGRAM_SESSION_UNAVAILABLE" }, { status: 409 });
    }

    const saved = decryptTelegramState<{ sessionString: string }>(secret.secret_payload_ciphertext);
    const result = await searchTelegramPublicPosts(saved.sessionString, { query, limit: 20 });
    return NextResponse.json({
      searchMode: result.searchMode,
      count: result.items.length,
      items: result.items,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401
      : message === "WORKSPACE_FORBIDDEN" ? 403
      : message === "TELEGRAM_SESSION_UNAUTHORIZED" ? 409
      : message === "TELEGRAM_PUBLIC_SEARCH_PAYMENT_REQUIRED" ? 402
      : message === "TELEGRAM_RATE_LIMITED" ? 429 : 400;
    const safeError = message === "TELEGRAM_PUBLIC_SEARCH_PAYMENT_REQUIRED" ? "TELEGRAM_PUBLIC_SEARCH_PAYMENT_REQUIRED"
      : message === "TELEGRAM_RATE_LIMITED" ? "TELEGRAM_RATE_LIMITED"
      : status === 401 ? "UNAUTHORIZED" : status === 403 ? "WORKSPACE_FORBIDDEN"
      : status === 409 ? "TELEGRAM_SESSION_UNAUTHORIZED" : "TELEGRAM_PUBLIC_SEARCH_FAILED";
    return NextResponse.json({ error: safeError }, { status });
  }
}
