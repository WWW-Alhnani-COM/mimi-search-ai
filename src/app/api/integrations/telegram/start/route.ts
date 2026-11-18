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

function safeTelegramErrorDetails(error: unknown) {
  if (!(error instanceof Error)) return { errorName: "UnknownError" };
  const candidate = error as Error & { code?: unknown; errorMessage?: unknown };
  const safeToken = (value: unknown) =>
    typeof value === "string" && /^[A-Z0-9_]{1,80}$/i.test(value) ? value : undefined;
  return {
    errorName: error.name,
    messageCode: safeToken(error.message),
    rpcCode: typeof candidate.code === "number" ? candidate.code : undefined,
    rpcMessage: safeToken(candidate.errorMessage),
  };
}

function safeFailureCode(error: unknown, stage: string): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED" || message === "WORKSPACE_FORBIDDEN") return message;
  if (message === "TELEGRAM_CONFIGURATION_MISSING") return message;
  if (message === "TELEGRAM_ENCRYPTION_KEY_INVALID") return message;
  if (/PHONE_NUMBER_INVALID/i.test(message)) return "TELEGRAM_PHONE_INVALID";
  if (/API_ID_INVALID|API_HASH_INVALID|API_ID_PUBLISHED_FLOOD/i.test(message)) return "TELEGRAM_API_CREDENTIALS_REJECTED";
  if (/FLOOD_WAIT|FLOOD_PREMIUM_WAIT/i.test(message)) return "TELEGRAM_RATE_LIMITED";
  if (/PHONE_NUMBER_BANNED|PHONE_NUMBER_FLOOD/i.test(message)) return "TELEGRAM_PHONE_RESTRICTED";
  if (stage === "send_code") return "TELEGRAM_CODE_SEND_FAILED";
  if (stage === "persist_pending") return "TELEGRAM_PENDING_STATE_SAVE_FAILED";
  if (stage === "encrypt_pending") return "TELEGRAM_ENCRYPTION_FAILED";
  if (stage === "telegram_connect") return "TELEGRAM_NETWORK_CONNECT_FAILED";
  return "TELEGRAM_CONNECT_START_FAILED";
}

export async function POST(request: Request) {
  let client: TelegramClient | undefined;
  let stage = "parse_request";
  try {
    const body = await request.json();
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
    const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
    if (!/^[+][1-9][0-9]{7,14}$/.test(phoneNumber) || !/^[0-9a-f-]{36}$/i.test(workspaceId)) {
      return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
    }

    stage = "workspace_authorization";
    const { user } = await requireTelegramWorkspaceAdmin(workspaceId);
    const admin = createTelegramAdminClient();
    await admin.from("telegram_auth_attempts").delete().lt("expires_at", new Date().toISOString());

    stage = "attempt_limit";
    const { count, error: countError } = await admin.from("telegram_auth_attempts")
      .select("id", { count: "exact", head: true }).eq("user_id", user.id);
    if (countError) throw new Error("TELEGRAM_PENDING_STATE_QUERY_FAILED");
    if ((count ?? 0) >= 3) return NextResponse.json({ error: "TOO_MANY_PENDING_ATTEMPTS" }, { status: 429 });

    stage = "telegram_configuration";
    const { apiId, apiHash } = telegramCredentials();
    const session = new StringSession("");
    client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 2, requestRetries: 1, autoReconnect: false,
    });

    stage = "telegram_connect";
    await client.connect();

    stage = "send_code";
    const sent = await client.sendCode({ apiId, apiHash }, phoneNumber);

    stage = "encrypt_pending";
    const state = {
      phoneNumber,
      phoneCodeHash: sent.phoneCodeHash,
      sessionString: session.save(),
      isCodeViaApp: sent.isCodeViaApp,
    };
    const stateCiphertext = encryptTelegramState(state);

    stage = "persist_pending";
    const { data, error } = await admin.from("telegram_auth_attempts").insert({
      user_id: user.id,
      workspace_id: workspaceId,
      state_ciphertext: stateCiphertext,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }).select("id").single();
    if (error || !data) throw new Error("TELEGRAM_PENDING_STATE_SAVE_FAILED");

    return NextResponse.json({
      attemptId: data.id,
      isCodeViaApp: sent.isCodeViaApp,
      expiresInSeconds: 600,
    });
  } catch (error) {
    const safeCode = safeFailureCode(error, stage);
    console.error("[telegram-start]", { stage, code: safeCode, details: stage === "send_code" ? safeTelegramErrorDetails(error) : undefined });
    const status = safeCode === "UNAUTHORIZED" ? 401
      : safeCode === "WORKSPACE_FORBIDDEN" ? 403
      : safeCode === "TELEGRAM_RATE_LIMITED" ? 429
      : safeCode === "TELEGRAM_CONFIGURATION_MISSING" || safeCode === "TELEGRAM_ENCRYPTION_KEY_INVALID" ? 503
      : safeCode === "TELEGRAM_PHONE_INVALID" || safeCode === "INVALID_INPUT" ? 400
      : 502;
    return NextResponse.json({ error: safeCode }, { status });
  } finally {
    await client?.disconnect().catch(() => undefined);
  }
}
