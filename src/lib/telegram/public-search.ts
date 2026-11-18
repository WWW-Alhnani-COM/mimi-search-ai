import "server-only";

import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";

export type TelegramPublicPost = {
  platform: "telegram";
  externalItemId: string;
  sourceUrl: string;
  sourceName: string | null;
  sourceType: "public_channel";
  textContent: string;
  publishedAt: string | null;
  collectedAt: string;
  rawMetadata: {
    channelUsername: string | null;
    channelId: string | null;
    messageId: number;
  };
};

export type TelegramSearchOptions = {
  query: string;
  limit?: number;
};

export type TelegramSearchResult = {
  items: TelegramPublicPost[];
  searchMode: "public_channel_posts";
  paymentRequired: false;
};

type TelegramApiMessage = {
  id?: number;
  date?: number;
  message?: string;
  peerId?: { channelId?: { toString(): string } | string };
};

type TelegramApiChat = {
  id?: { toString(): string } | string | number;
  title?: string;
  username?: string;
  className?: string;
};

type TelegramSearchResponse = {
  messages?: TelegramApiMessage[];
  chats?: TelegramApiChat[];
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

function normalizeQuery(query: string): string {
  const normalized = query.trim().replace(/\\s+/g, " ");
  if (normalized.length < 2) throw new Error("Telegram search query must contain at least 2 characters.");
  if (normalized.length > 128) throw new Error("Telegram search query cannot exceed 128 characters.");
  return normalized;
}

function safeChannelUrl(username: string | undefined, messageId: number): string | null {
  if (!username || !/^[a-zA-Z0-9_]{5,32}$/.test(username)) return null;
  return `https://t.me/${username}/${messageId}`;
}

/**
 * Searches Telegram's global public-channel post index.
 *
 * This function deliberately does not:
 * - join channels or groups;
 * - read private chats or private groups;
 * - send messages or interact with users;
 * - request paid search using Telegram Stars.
 *
 * The caller must provide a session obtained through an explicit user login flow
 * and decrypted only in a trusted server/worker environment.
 */
export async function searchTelegramPublicPosts(
  sessionString: string,
  options: TelegramSearchOptions,
): Promise<TelegramSearchResult> {
  if (!sessionString.trim()) throw new Error("A Telegram user session is required.");

  const query = normalizeQuery(options.query);
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 50);
  const apiId = Number(requiredEnv("TELEGRAM_API_ID"));
  const apiHash = requiredEnv("TELEGRAM_API_HASH");

  if (!Number.isSafeInteger(apiId) || apiId <= 0) {
    throw new Error("TELEGRAM_API_ID must be a positive integer.");
  }

  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 2,
    requestRetries: 1,
    autoReconnect: false,
  });

  try {
    await client.connect();

    const authorized = await client.isUserAuthorized();
    if (!authorized) {
      throw new Error("TELEGRAM_SESSION_UNAUTHORIZED");
    }

    // Telegram documents a free quota for full-text global public-post search.
    // Do not pass allowPaidStars: the connector must never initiate a paid search.
    const response = (await client.api.channels.searchPosts({
      query,
      offsetRate: 0,
      offsetPeer: "me",
      offsetId: 0,
      limit,
    })) as unknown as TelegramSearchResponse;

    const chats = response.chats ?? [];
    const channelById = new Map<string, TelegramApiChat>();
    for (const chat of chats) {
      if (chat.id !== undefined) channelById.set(String(chat.id), chat);
    }

    const collectedAt = new Date().toISOString();
    const items: TelegramPublicPost[] = [];

    for (const message of response.messages ?? []) {
      if (!message.id || !message.message?.trim()) continue;

      const channelIdValue = message.peerId?.channelId;
      const channelId = channelIdValue === undefined ? null : String(channelIdValue);
      const channel = channelId ? channelById.get(channelId) : undefined;
      const sourceUrl = safeChannelUrl(channel?.username, message.id);

      // Skip records without a stable public permalink; they cannot be verified later.
      if (!sourceUrl) continue;

      items.push({
        platform: "telegram",
        externalItemId: `telegram:${channelId ?? channel?.username}:${message.id}`,
        sourceUrl,
        sourceName: channel?.title ?? null,
        sourceType: "public_channel",
        textContent: message.message.trim(),
        publishedAt: message.date ? new Date(message.date * 1000).toISOString() : null,
        collectedAt,
        rawMetadata: {
          channelUsername: channel?.username ?? null,
          channelId,
          messageId: message.id,
        },
      });
    }

    return {
      items,
      searchMode: "public_channel_posts",
      paymentRequired: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Telegram connector error";
    if (/SEARCH_QUERY_TOO_SHORT|QUERY_TOO_SHORT/i.test(message)) {
      throw new Error("TELEGRAM_QUERY_TOO_SHORT");
    }
    if (/SEARCH.*(PAID|STARS)|STARS.*SEARCH|PAYMENT_REQUIRED/i.test(message)) {
      throw new Error("TELEGRAM_PUBLIC_SEARCH_PAYMENT_REQUIRED");
    }
    if (/FLOOD_WAIT|FLOOD_PREMIUM_WAIT/i.test(message)) {
      throw new Error("TELEGRAM_RATE_LIMITED");
    }
    throw error;
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}
