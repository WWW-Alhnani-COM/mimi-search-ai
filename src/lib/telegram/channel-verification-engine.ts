import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { decryptTelegramState, telegramCredentials } from "@/lib/telegram/auth-server";

export async function verifyDiscoveredTelegramChannel(admin: any, workspaceId: string, channelId: string) {
  const { data: channel, error: channelError } = await admin.from("telegram_channels")
    .select("id,workspace_id,username,status,evaluation_score,evaluation_details")
    .eq("id", channelId).eq("workspace_id", workspaceId).maybeSingle();
  if (channelError || !channel) throw new Error("CHANNEL_NOT_FOUND");
  if (channel.status !== "candidate" && channel.status !== "review") return { skipped: true, reason: "CHANNEL_NOT_PENDING" };
  if (!channel.username) throw new Error("CHANNEL_USERNAME_MISSING");

  const { data: connection, error: connectionError } = await admin.from("source_connections")
    .select("id").eq("workspace_id", workspaceId).eq("platform", "telegram").eq("status", "connected")
    .order("last_checked_at", { ascending: false }).limit(1).maybeSingle();
  if (connectionError || !connection) throw new Error("TELEGRAM_CONNECTION_REQUIRED");

  const { data: secretRows, error: secretError } = await admin.rpc("read_telegram_session", {
    target_connection_id: connection.id,
  });
  const secret = Array.isArray(secretRows) ? secretRows[0] : secretRows;
  if (secretError || !secret?.secret_payload_ciphertext) throw new Error("TELEGRAM_SESSION_NOT_FOUND");

  const state = decryptTelegramState<{ sessionString: string }>(secret.secret_payload_ciphertext);
  if (!state.sessionString) throw new Error("TELEGRAM_SESSION_INVALID");
  const { apiId, apiHash } = telegramCredentials();
  const client = new TelegramClient(new StringSession(state.sessionString), apiId, apiHash, {
    connectionRetries: 1, requestRetries: 1, autoReconnect: false,
  });

  try {
    await client.connect();
    if (!(await client.isUserAuthorized())) throw new Error("TELEGRAM_SESSION_EXPIRED");
    const entity = await client.getEntity(channel.username) as unknown as {
      className?: string; broadcast?: boolean; megagroup?: boolean;
      username?: string; title?: string; id?: number | bigint;
    };
    const isPublicBroadcastChannel = entity.className === "Channel"
      && entity.broadcast === true
      && Boolean(entity.username);

    if (!isPublicBroadcastChannel) {
      const { error: updateError } = await admin.from("telegram_channels").update({
        status: "rejected",
        approved_at: null,
        approved_by: null,
        evaluation_details: {
          ...(channel.evaluation_details ?? {}),
          verification: { verified: false, reason: "NOT_A_PUBLIC_BROADCAST_CHANNEL", checked_at: new Date().toISOString() },
        },
        updated_at: new Date().toISOString(),
      }).eq("id", channelId).eq("workspace_id", workspaceId);
      if (updateError) throw new Error("CHANNEL_VERIFICATION_SAVE_FAILED");
      return { verified: false, status: "rejected" };
    }

    const { data: settings } = await admin.from("telegram_discovery_settings")
      .select("auto_approve_enabled,minimum_approval_score")
      .eq("workspace_id", workspaceId).maybeSingle();
    const autoApprove = Boolean(settings?.auto_approve_enabled)
      && Number(channel.evaluation_score ?? 0) >= Number(settings?.minimum_approval_score ?? 85);
    const status = autoApprove ? "approved" : "review";

    const { error: updateError } = await admin.from("telegram_channels").update({
      title: entity.title ?? null,
      username: entity.username,
      public_url: `https://t.me/${entity.username}`,
      status,
      approved_at: autoApprove ? new Date().toISOString() : null,
      approved_by: null,
      evaluation_details: {
        ...(channel.evaluation_details ?? {}),
        verification: { verified: true, reason: "PUBLIC_BROADCAST_CHANNEL", checked_at: new Date().toISOString() },
      },
      updated_at: new Date().toISOString(),
    }).eq("id", channelId).eq("workspace_id", workspaceId);
    if (updateError) throw new Error("CHANNEL_VERIFICATION_SAVE_FAILED");
    return { verified: true, status, title: entity.title ?? null };
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}
