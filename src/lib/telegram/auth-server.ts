import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";

export type TelegramAuthState = {
  phoneNumber: string;
  phoneCodeHash: string;
  sessionString: string;
  isCodeViaApp: boolean;
};

export function telegramCredentials() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH?.trim();
  if (!Number.isSafeInteger(apiId) || apiId <= 0 || !apiHash) {
    throw new Error("TELEGRAM_CONFIGURATION_MISSING");
  }
  return { apiId, apiHash };
}

function encryptionKey() {
  const key = Buffer.from(process.env.TELEGRAM_SESSION_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("TELEGRAM_ENCRYPTION_KEY_INVALID");
  return key;
}

export function encryptTelegramState(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: ciphertext.toString("base64"),
  });
}

export function decryptTelegramState<T>(payload: string): T {
  const parsed = JSON.parse(payload) as { version: number; iv: string; tag: string; data: string };
  if (parsed.version !== 1) throw new Error("TELEGRAM_CIPHERTEXT_VERSION_UNSUPPORTED");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as T;
}

export function createTelegramAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("SUPABASE_SERVER_SECRET_MISSING");
  return createSupabaseClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function requireTelegramWorkspaceAdmin(workspaceId: string) {
  const supabase = await createCookieClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("UNAUTHORIZED");

  const { data: membership, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (error || !membership || !["owner", "admin"].includes(membership.role)) {
    throw new Error("WORKSPACE_FORBIDDEN");
  }

  return { user: authData.user, admin: createTelegramAdminClient() };
}

export function safeTelegramError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/SESSION_PASSWORD_NEEDED/i.test(message)) return "TELEGRAM_2FA_REQUIRED";
  if (/PHONE_CODE_INVALID|PHONE_CODE_EXPIRED|PHONE_CODE_EMPTY/i.test(message)) return "TELEGRAM_CODE_INVALID";
  if (/PHONE_NUMBER_INVALID/i.test(message)) return "TELEGRAM_PHONE_INVALID";
  if (/FLOOD_WAIT|FLOOD_PREMIUM_WAIT/i.test(message)) return "TELEGRAM_RATE_LIMITED";
  if (/PASSWORD_HASH_INVALID/i.test(message)) return "TELEGRAM_2FA_INVALID";
  return "TELEGRAM_AUTH_FAILED";
}
