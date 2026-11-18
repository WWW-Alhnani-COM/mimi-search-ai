import { createCipheriv, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH?.trim();
const key = Buffer.from(process.env.TELEGRAM_SESSION_ENCRYPTION_KEY ?? "", "base64");

if (!Number.isSafeInteger(apiId) || apiId <= 0 || !apiHash) {
  throw new Error("Set TELEGRAM_API_ID and TELEGRAM_API_HASH in your local environment.");
}
if (key.length !== 32) {
  throw new Error("TELEGRAM_SESSION_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
}

const rl = createInterface({ input: stdin, output: stdout });
const ask = (prompt) => rl.question(prompt);

const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 3,
  requestRetries: 1,
});

try {
  await client.start({
    phoneNumber: () => ask("Telegram phone number (international format): "),
    phoneCode: (_isCodeViaApp, info) => ask(`Telegram login code (${info?.type ?? "verification"}): `),
    password: () => ask("Telegram two-step verification password (if enabled): "),
    onError: (error) => {
      // Do not print request payloads, codes, passwords, or session values.
      console.error("Telegram authorization failed:", error instanceof Error ? error.message : "Unknown error");
    },
  });

  if (!(await client.isUserAuthorized())) {
    throw new Error("Telegram authorization did not complete.");
  }

  const session = client.session.save();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(session, "utf8"), cipher.final()]);
  const payload = {
    version: "v1",
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };

  console.log("\nEncrypted Telegram session payload (ciphertext only):");
  console.log(JSON.stringify(payload));
  console.log("\nDo not share the API hash, encryption key, login code, 2FA password, or decrypted session.");
} finally {
  await client.disconnect().catch(() => undefined);
  rl.close();
}
