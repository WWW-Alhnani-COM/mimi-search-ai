import { NextResponse } from "next/server";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import {
  createTelegramAdminClient,
  encryptTelegramState,
  requireTelegramWorkspaceAdmin,
  telegramCredentials,
} from "@/lib/telegram/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let client: TelegramClient | undefined;
  try {
    const body = await request.json();
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
    const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
    if (!/^[+][1-9][0-9]{7,14}$/.test(phoneNumber) || !/^[0-9a-f-]{36}$/i.test(workspaceId)) {
      return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
    }

    const { user } = await requireTelegramWorkspaceAdmin(workspaceId);
    const admin = createTelegramAdminClient();
    await admin.from("telegram_auth_attempts").delete().lt("expires_at", new Date().toISOString());

    const { count } = await admin.from("telegram_auth_attempts")
      .select("id", { count: "exact", head: true }).eq("user_id", user.id);
    if ((count ?? 0) >= 3) return NextResponse.json({ error: "TOO_MANY_PENDING_ATTEMPTS" }, { status: 429 });

    const { apiId, apiHash } = telegramCredentials();
    const session = new StringSession("");
    client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 2, requestRetries: 1, autoReconnect: false,
    });
    await client.connect();
    const sent = await client.sendCode({ apiId, apiHash }, phoneNumber);
    const state = {
      phoneNumber,
      phoneCodeHash: sent.phoneCodeHash,
      sessionString: session.save(),
      isCodeViaApp: sent.isCodeViaApp,
    };
    const { data, error } = await admin.from("telegram_auth_attempts").insert({
      user_id: user.id,
      workspace_id: workspaceId,
      state_ciphertext: encryptTelegramState(state),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }).select("id").single();
    if (error || !data) throw new Error("TELEGRAM_PENDING_STATE_SAVE_FAILED");

    return NextResponse.json({
      attemptId: data.id,
      isCodeViaApp: sent.isCodeViaApp,
      expiresInSeconds: 600,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401
      : message === "WORKSPACE_FORBIDDEN" ? 403
      : message === "TELEGRAM_CONFIGURATION_MISSING" || message === "TELEGRAM_ENCRYPTION_KEY_INVALID" ? 503 : 400;
    return NextResponse.json({ error: status === 401 ? "UNAUTHORIZED" : status === 403 ? "WORKSPACE_FORBIDDEN" : "TELEGRAM_CONNECT_START_FAILED" }, { status });
  } finally {
    await client?.disconnect().catch(() => undefined);
  }
}
