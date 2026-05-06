import {
  base64_to_base64url,
  base64_to_buffer,
  base64url_to_base64,
  buffer_to_base64,
  concatBuffer,
} from "../utils/encrypt-decrypt";

const toAB = (d: ArrayBuffer | Uint8Array) => {
  if (d instanceof Uint8Array)
    return d.buffer.slice(
      d.byteOffset,
      d.byteOffset + d.byteLength,
    ) as ArrayBuffer;
  return d as ArrayBuffer;
};

class Decrypt {
  private keyCurve: CryptoKeyPair | any = {};
  public publicKey: ArrayBuffer | null = null;
  public auth: ArrayBuffer | null = null;

  async init(jwk: JWK = {}, auth: string | ArrayBuffer = "") {
    if (!jwk.d || !(jwk.x && jwk.y)) {
      this.keyCurve = await crypto.subtle.generateKey(
        {
          name: "ECDH",
          namedCurve: "P-256",
        },
        true,
        ["deriveKey"],
      );
    } else {
      const privateKey = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDH", namedCurve: jwk.crv || "P-256" },
        true,
        ["deriveKey"],
      );

      const publicJwk = { ...jwk };
      delete publicJwk.d;
      const publicKey = await crypto.subtle.importKey(
        "jwk",
        publicJwk,
        { name: "ECDH", namedCurve: jwk.crv || "P-256" },
        true,
        [],
      );
      this.keyCurve = {
        privateKey,
        publicKey,
      };
    }

    this.publicKey = await crypto.subtle.exportKey(
      "raw",
      this.keyCurve.publicKey,
    );

    if (auth) {
      this.auth =
        typeof auth === "string"
          ? base64_to_buffer(base64url_to_base64(auth))
          : auth;
    } else {
      this.auth = crypto.getRandomValues(new Uint8Array(16)).buffer;
    }
  }

  async exportKey() {
    return {
      jwk: await crypto.subtle.exportKey("jwk", this.keyCurve.privateKey),
      auth: base64_to_base64url(buffer_to_base64(this.auth!)),
    };
  }

  async hmac_sha_256(key: any, data: any) {
    const keyData = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    return new Uint8Array(await crypto.subtle.sign("HMAC", keyData, data));
  }
  async get_ecdh_secret(dh: any) {
    const pubDH = await crypto.subtle.importKey(
      "raw",
      dh,
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      true,
      [],
    );

    const ecdh_secret_CryptoKey = await crypto.subtle.deriveKey(
      {
        name: "ECDH",
        public: pubDH,
      },
      this.keyCurve.privateKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const ecdh_secret = await crypto.subtle.exportKey(
      "raw",
      ecdh_secret_CryptoKey,
    );
    return ecdh_secret;
  }

  async get_cek_and_nonce(dh: Uint8Array, salt: Uint8Array) {
    if (!this.publicKey) throw new Error("Public key is not initialized");
    if (!this.auth) throw new Error("Auth is not initialized");

    const context = concatBuffer(
      new TextEncoder().encode("P-256\0"),
      new Uint8Array([0, 65]),
      this.publicKey,
      new Uint8Array([0, 65]),
      dh,
    );
    const auth_info = new TextEncoder().encode("Content-Encoding: auth\0");
    const PRK_combine = await this.hmac_sha_256(
      this.auth,
      await this.get_ecdh_secret(dh),
    );
    const IKM = await this.hmac_sha_256(
      PRK_combine,
      concatBuffer(auth_info, new Uint8Array([1])),
    );
    const PRK = await this.hmac_sha_256(salt, IKM);
    const cek_info = concatBuffer(
      new TextEncoder().encode("Content-Encoding: aesgcm\0"),
      context,
    );
    let CEK = (
      await this.hmac_sha_256(PRK, concatBuffer(cek_info, new Uint8Array([1])))
    ).slice(0, 16);
    const nonce_info = concatBuffer(
      new TextEncoder().encode("Content-Encoding: nonce\0"),
      context,
    );
    let NONCE = (
      await this.hmac_sha_256(
        PRK,
        concatBuffer(nonce_info, new Uint8Array([1])),
      )
    ).slice(0, 12);

    return { CEK, NONCE };
  }

  async decrypt(nonce: Uint8Array, cek: Uint8Array, content: ArrayBuffer) {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      toAB(cek),
      "AES-GCM",
      true,
      ["decrypt"],
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toAB(nonce) },
      cryptoKey,
      content,
    );

    const view = new DataView(decrypted.slice(0, 2));
    const paddingLength = view.getUint8(0);
    const data = decrypted.slice(2 + paddingLength);

    return { data, paddingLength };
  }
}
export default Decrypt;
