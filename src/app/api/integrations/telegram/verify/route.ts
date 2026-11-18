import { NextResponse } from "next/server";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import {
  createTelegramAdminClient,
  decryptTelegramState,
  encryptTelegramState,
  requireTelegramWorkspaceAdmin,
  safeTelegramError,
  telegramCredentials,
  type TelegramAuthState,
} from "@/lib/telegram/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let client: TelegramClient | undefined;
  let admin: ReturnType<typeof createTelegramAdminClient> | undefined;
  let attemptId = "";
  try {
    const body = await request.json();
    attemptId = typeof body.attemptId === "string" ? body.attemptId : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[0-9a-f-]{36}$/i.test(attemptId) || !/^\d{4,8}$/.test(code)) {
      return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
    }

    // Resolve the owner from the authenticated attempt; never trust a client-supplied userId.
    const cookieClient = await (await import("@/lib/supabase/server")).createClient();
    const { data: authData, error: authError } = await cookieClient.auth.getUser();
    if (authError || !authData.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    admin = createTelegramAdminClient();
    const { data: attempt, error: attemptError } = await admin.from("telegram_auth_attempts")
      .select("id,user_id,workspace_id,state_ciphertext,attempt_count,expires_at")
      .eq("id", attemptId).eq("user_id", authData.user.id).maybeSingle();
    if (attemptError || !attempt) return NextResponse.json({ error: "AUTH_ATTEMPT_NOT_FOUND" }, { status: 404 });
    if (new Date(attempt.expires_at).getTime() <= Date.now() || attempt.attempt_count >= 5) {
      await admin.from("telegram_auth_attempts").delete().eq("id", attemptId);
      return NextResponse.json({ error: "AUTH_ATTEMPT_EXPIRED" }, { status: 410 });
    }

    await requireTelegramWorkspaceAdmin(attempt.workspace_id);
    const state = decryptTelegramState<TelegramAuthState>(attempt.state_ciphertext);
    const { apiId, apiHash } = telegramCredentials();
    const session = new StringSession(state.sessionString);
    client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 2, requestRetries: 1, autoReconnect: false,
    });
    await client.connect();

    try {
      if (password) {
        await client.signInWithPassword({ apiId, apiHash }, {
          password: async () => password,
          onError: async () => true,
        });
      } else {
        await client.api.auth.signIn({
          phoneNumber: state.phoneNumber,
          phoneCodeHash: state.phoneCodeHash,
          phoneCode: code,
        });
      }
    } catch (authError) {
      const errorMessage = authError instanceof Error ? authError.message : "";
      if (/SESSION_PASSWORD_NEEDED/i.test(errorMessage) && !password) {
        await admin.from("telegram_auth_attempts").update({
          state_ciphertext: encryptTelegramState({ ...state, sessionString: session.save() }),
        }).eq("id", attemptId);
        return NextResponse.json({ requiresTwoFactor: true });
      }
      const nextCount = attempt.attempt_count + 1;
      if (nextCount >= 5) await admin.from("telegram_auth_attempts").delete().eq("id", attemptId);
      else await admin.from("telegram_auth_attempts").update({ attempt_count: nextCount }).eq("id", attemptId);
      const safeError = safeTelegramError(authError);
      return NextResponse.json({ error: safeError }, { status: safeError === "TELEGRAM_RATE_LIMITED" ? 429 : 400 });
    }

    if (!(await client.isUserAuthorized())) throw new Error("TELEGRAM_AUTH_NOT_CONFIRMED");
    const me = await client.getMe() as { id?: { toString(): string } | string | number; username?: string; firstName?: string };
    const externalAccountId = me.id === undefined ? null : String(me.id);
    if (!externalAccountId) throw new Error("TELEGRAM_ACCOUNT_ID_MISSING");

    const { data: connection, error: connectionError } = await admin.from("source_connections").upsert({
      workspace_id: attempt.workspace_id,
      platform: "telegram",
      connection_label: me.username ? `Telegram @${me.username}` : "Telegram account",
      external_account_id: externalAccountId,
      display_name: me.username ? `@${me.username}` : me.firstName ?? "Telegram account",
      status: "connected",
      granted_scopes: ["public_channel_posts"],
      connected_by: authData.user.id,
      last_checked_at: new Date().toISOString(),
    }, { onConflict: "workspace_id,platform,external_account_id" }).select("id").single();
    if (connectionError || !connection) throw new Error("TELEGRAM_CONNECTION_SAVE_FAILED");

    const encryptedSession = encryptTelegramState({ sessionString: session.save() });
    const { error: secretError } = await admin.rpc("store_telegram_session", {
      target_connection_id: connection.id,
      target_workspace_id: attempt.workspace_id,
      encrypted_payload: encryptedSession,
    });
    if (secretError) throw new Error("TELEGRAM_SESSION_SAVE_FAILED");

    await admin.from("telegram_auth_attempts").delete().eq("id", attemptId);
    return NextResponse.json({ connected: true, connectionId: connection.id, displayName: connection.display_name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "WORKSPACE_FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: status === 401 ? "UNAUTHORIZED" : status === 403 ? "WORKSPACE_FORBIDDEN" : "TELEGRAM_AUTH_FAILED" }, { status });
  } finally {
    await client?.disconnect().catch(() => undefined);
  }
}
