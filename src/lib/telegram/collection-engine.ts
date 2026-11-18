import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { decryptTelegramState, telegramCredentials } from "@/lib/telegram/auth-server";

type PublicMessage = {
  id: number;
  text?: string;
  date?: Date | string | number;
  senderId?: string | number | { toString(): string };
  views?: number;
  forwards?: number;
  postAuthor?: string;
};

function detectLanguage(text: string | null | undefined) {
  if (!text?.trim()) return "und";
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[A-Za-z]/.test(text)) return "en";
  return "und";
}

function messageDate(value: PublicMessage["date"]) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/FLOOD_WAIT|FLOOD_PREMIUM_WAIT/i.test(message)) return "TELEGRAM_RATE_LIMITED";
  if (/USERNAME_NOT_OCCUPIED|CHANNEL_INVALID|CHANNEL_PRIVATE/i.test(message)) return "TELEGRAM_CHANNEL_UNAVAILABLE";
  if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|USER_DEACTIVATED/i.test(message)) return "TELEGRAM_SESSION_EXPIRED";
  if (/^(CHANNEL_|TELEGRAM_)[A-Z0-9_]{3,80}$/.test(message)) return message;
  return "TELEGRAM_COLLECTION_FAILED";
}

export async function collectTelegramChannel(admin: any, workspaceId: string, channelId: string) {
  const { data: channel, error: channelError } = await admin.from("telegram_channels")
    .select("id,workspace_id,username,title,public_url,status,country_code,city_id,last_synced_message_id,history_cursor_message_id,initial_history_latest_message_id,initial_history_complete")
    .eq("id", channelId).eq("workspace_id", workspaceId).maybeSingle();
  if (channelError || !channel) throw new Error("CHANNEL_NOT_FOUND");
  if (channel.status !== "approved" || !channel.username) throw new Error("CHANNEL_NOT_APPROVED");

  const [{ data: settings }, { data: connection, error: connectionError }] = await Promise.all([
    admin.from("telegram_discovery_settings").select("default_history_days")
      .eq("workspace_id", workspaceId).maybeSingle(),
    admin.from("source_connections").select("id")
      .eq("workspace_id", workspaceId).eq("platform", "telegram").eq("status", "connected")
      .order("last_checked_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
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
    connectionRetries: 1,
    requestRetries: 1,
    autoReconnect: false,
  });

  let runId: string | null = null;
  try {
    await admin.from("telegram_channels").update({
      last_collection_attempt_at: new Date().toISOString(),
      last_collection_status: "running",
    }).eq("id", channelId).eq("workspace_id", workspaceId);
    await client.connect();
    if (!(await client.isUserAuthorized())) throw new Error("TELEGRAM_SESSION_EXPIRED");

    const entity = await client.getEntity(channel.username);
    const historyComplete = Boolean(channel.initial_history_complete);
    const historyDays = Number(settings?.default_history_days ?? 10);
    const historyCutoff = Date.now() - historyDays * 24 * 60 * 60 * 1000;
    const cursor = channel.history_cursor_message_id ? Number(channel.history_cursor_message_id) : null;
    const lastSynced = channel.last_synced_message_id ? Number(channel.last_synced_message_id) : null;

    const messages = await client.getMessages(entity, historyComplete
      ? { limit: 20, minId: lastSynced ?? 0, reverse: true }
      : { limit: 20, ...(cursor ? { maxId: cursor } : {}) });
    const page = (messages as unknown as PublicMessage[]).filter((message) => Number.isInteger(message.id) && message.id > 0);
    const chronological = [...page].sort((a, b) => a.id - b.id);
    const newestId = chronological.reduce((max, item) => Math.max(max, item.id), lastSynced ?? 0);
    const oldestId = chronological.reduce((min, item) => Math.min(min, item.id), Number.MAX_SAFE_INTEGER);
    const eligible = historyComplete
      ? chronological
      : chronological.filter((message) => {
          const published = messageDate(message.date);
          return published ? new Date(published).getTime() >= historyCutoff : false;
        });

    const oldestDate = chronological.length ? messageDate(chronological[0].date) : null;
    const hasMoreHistory = historyComplete
      ? chronological.length === 20
      : chronological.length === 20 && (!oldestDate || new Date(oldestDate).getTime() >= historyCutoff);
    const nextHistoryCursor = !historyComplete && hasMoreHistory && oldestId !== Number.MAX_SAFE_INTEGER ? oldestId : null;
    const nextHistoryComplete = historyComplete || !hasMoreHistory;
    const initialLatestMessageId = Number(channel.initial_history_latest_message_id ?? 0) || newestId;

    const { data: run, error: runError } = await admin.from("collection_runs").insert({
      workspace_id: workspaceId,
      telegram_channel_id: channelId,
      source_connection_id: connection.id,
      platform: "telegram",
      status: "running",
      started_at: new Date().toISOString(),
      metadata: {
        collection_mode: historyComplete ? "incremental" : "initial_history",
        history_days: historyDays,
        page_size: 20,
      },
    }).select("id").single();
    if (runError || !run) throw new Error("COLLECTION_RUN_CREATE_FAILED");
    runId = run.id;

    const rows = eligible.map((message) => {
      const publishedAt = messageDate(message.date);
      const senderId = message.senderId === undefined ? null : String(message.senderId);
      return {
        workspace_id: workspaceId,
        collection_run_id: run.id,
        platform: "telegram",
        external_item_id: `${channelId}:${message.id}`,
        source_url: `https://t.me/${channel.username}/${message.id}`,
        source_name: channel.title ?? `@${channel.username}`,
        source_type: "telegram_channel_post",
        author_public_id: senderId,
        author_display_name: message.postAuthor ?? null,
        text_content: typeof message.text === "string" ? message.text : null,
        language_code: detectLanguage(message.text),
        published_at: publishedAt,
        country_code: channel.country_code,
        city_id: channel.city_id,
        raw_metadata: {
          telegram_channel_id: channelId,
          telegram_message_id: message.id,
          views: typeof message.views === "number" ? message.views : null,
          forwards: typeof message.forwards === "number" ? message.forwards : null,
        },
      };
    });

    let inserted = 0;
    if (rows.length) {
      const { data: saved, error: saveError } = await admin.from("source_items")
        .upsert(rows, { onConflict: "workspace_id,platform,external_item_id", ignoreDuplicates: true })
        .select("id");
      if (saveError) throw new Error("SOURCE_ITEMS_SAVE_FAILED");
      inserted = saved?.length ?? 0;
    }

    const channelPatch: Record<string, unknown> = {
      last_collected_at: new Date().toISOString(),
      last_collection_status: hasMoreHistory ? "partial" : "completed",
    };
    if (!historyComplete) {
      channelPatch.history_cursor_message_id = nextHistoryCursor;
      channelPatch.initial_history_complete = nextHistoryComplete;
      if (nextHistoryComplete) {
        channelPatch.last_synced_message_id = initialLatestMessageId > 0 ? initialLatestMessageId : null;
        channelPatch.initial_history_latest_message_id = null;
      } else {
        channelPatch.initial_history_latest_message_id = initialLatestMessageId > 0 ? initialLatestMessageId : null;
      }
    } else if (newestId > lastSynced!) {
      channelPatch.last_synced_message_id = newestId;
    }

    const { error: channelUpdateError } = await admin.from("telegram_channels")
      .update(channelPatch).eq("id", channelId).eq("workspace_id", workspaceId);
    if (channelUpdateError) throw new Error("CHANNEL_SYNC_STATE_SAVE_FAILED");

    const { error: runUpdateError } = await admin.from("collection_runs").update({
      status: hasMoreHistory ? "partial" : "completed",
      finished_at: new Date().toISOString(),
      items_collected: inserted,
      metadata: {
        collection_mode: historyComplete ? "incremental" : "initial_history",
        fetched_count: eligible.length,
        inserted_count: inserted,
        has_more_history: hasMoreHistory,
        next_history_cursor: nextHistoryCursor,
      },
    }).eq("id", run.id).eq("workspace_id", workspaceId);
    if (runUpdateError) throw new Error("COLLECTION_RUN_FINALIZE_FAILED");

    return {
      runId: run.id,
      fetched: eligible.length,
      inserted,
      hasMore: hasMoreHistory,
      nextHistoryCursor,
      lastMessageId: newestId || null,
    };
  } catch (error) {
    await admin.from("telegram_channels").update({
      last_collection_status: "failed",
    }).eq("id", channelId).eq("workspace_id", workspaceId);
    if (runId) {
      await admin.from("collection_runs").update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_summary: safeErrorCode(error),
      }).eq("id", runId).eq("workspace_id", workspaceId);
    }
    throw new Error(safeErrorCode(error));
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}
