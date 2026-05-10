// FCM registration (`c2dm/register3`). 1:1 port of `src/register.rs`.

export const REGISTER_URL = "https://android.clients.google.com/c2dm/register3";

/** `app=` value used by Chrome desktop. Despite the literal "linux", this is
 *  what Chrome on every desktop platform actually sends. */
export const FCM_APP_ID = "org.chromium.linux";

/** Register an FCM token bound to a specific application server's VAPID key.
 *
 *  `sender` is the app server's NIST P-256 public key (base64url, 87 chars,
 *  uncompressed SEC1 starting with `B`). FCM remembers this key with the
 *  registration and rejects pushes signed with any other key. */
export async function register(
  url: string,
  androidId: bigint,
  securityToken: bigint,
  subtype: string,
  sender: string,
): Promise<string> {
  const auth = `AidLogin ${androidId.toString()}:${securityToken.toString()}`;
  const body = buildForm(androidId, subtype, sender);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      authorization: auth,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`register3 HTTP ${resp.status}: ${text}`);
  }
  return parseResponse(text);
}

function buildForm(androidId: bigint, subtype: string, sender: string): string {
  return (
    `app=${FCM_APP_ID}` +
    `&device=${androidId.toString()}` +
    `&sender=${sender}` +
    `&X-subtype=${subtype}`
  );
}

function parseResponse(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("token=")) return line.slice("token=".length).trim();
    if (line.startsWith("Error=")) {
      throw new Error(`register3 returned error: ${line.slice("Error=".length).trim()}`);
    }
  }
  throw new Error(`register3 response did not contain token=/Error= line: ${JSON.stringify(text)}`);
}
