import { redis } from "@scrapest/config";

export interface FcmState {
  android_id: string;
  security_token: string;
  fcm_token: string;
  ecdh_private_b64: string;
  ecdh_public_b64: string;
  auth_secret_b64: string;
  subtype_uuid: string;
  twitter_subscribed: boolean;
  received_persistent_ids: string[];
}

const key = (vmName: string) => `config:${vmName}:fcm`;

export async function loadFcmState(vmName: string): Promise<FcmState | null> {
  const raw = await redis.get(key(vmName));
  if (!raw) return null;
  return JSON.parse(raw) as FcmState;
}

export async function saveFcmState(vmName: string, state: FcmState): Promise<void> {
  await redis.set(key(vmName), JSON.stringify(state));
}

export async function patchFcmState(vmName: string, patch: Partial<FcmState>): Promise<void> {
  const existing = await loadFcmState(vmName);
  if (!existing) throw new Error(`No FCM state found for ${vmName}`);
  await saveFcmState(vmName, { ...existing, ...patch });
}
