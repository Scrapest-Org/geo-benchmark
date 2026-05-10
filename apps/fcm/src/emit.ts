// Stdout emitter. Exactly one JSON object per received notification, one
// per line. Same shape as the Rust port's `emit::emit`.

interface Notification {
  account: string;
  received_at: string;
  persistent_id: string;
  payload?: unknown;
  payload_b64?: string;
}

export function emit(account: string, persistentId: string, decrypted: Uint8Array): void {
  const receivedAt = new Date().toISOString();

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decrypted));
  } catch {
    parsed = undefined;
  }

  const notification: Notification = {
    account,
    received_at: receivedAt,
    persistent_id: persistentId,
  };
  if (parsed !== undefined) {
    notification.payload = parsed;
  } else {
    notification.payload_b64 = Buffer.from(decrypted).toString("base64url");
  }

  process.stdout.write(JSON.stringify(notification) + "\n");
}
