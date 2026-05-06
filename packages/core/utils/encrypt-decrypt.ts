import * as OTPAuth from "otpauth";

export const base64_to_buffer = (base64 = "") => {
  const buf = Buffer.from(base64, "base64");
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
};

const convert_buffer = (buffer: ArrayBuffer | Uint8Array) => {
  if (buffer instanceof Uint8Array) return buffer;
  return new Uint8Array(buffer);
};

export const convert_uint8array = (uint8array: Uint8Array | ArrayBuffer) => {
  if (uint8array instanceof ArrayBuffer) return uint8array;
  return uint8array.buffer;
};

//https://stackoverflow.com/questions/56846930/how-to-convert-raw-representations-of-ecdh-key-pair-into-a-json-web-key
export const hex_to_uintarray = (hex = "") => {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  return new Uint8Array(Buffer.from(cleanHex, "hex"));
};

export const buffer_to_base64 = (buf: ArrayBuffer | Uint8Array) => {
  return Buffer.from(convert_buffer(buf)).toString("base64");
};

export const base64_to_base64url = (base64 = "") => {
  return base64.replace(/\//g, "_").replace(/\+/g, "-").replace(/=/g, "");
};
export const base64url_to_base64 = (base64url = "") => {
  let base64 = base64url.replace(/_/g, "/").replace(/-/g, "+");
  while (base64.length % 4) base64 += "=";
  return base64;
};

//https://stackoverflow.com/questions/40031688/javascript-arraybuffer-to-hex
export const buffer_to_hex = (buffer: ArrayBuffer | Uint8Array) => {
  return Buffer.from(convert_buffer(buffer)).toString("hex");
};
export const concatBuffer = (...buffers: (ArrayBuffer | Uint8Array)[]) => {
  const totalLength = buffers.reduce((acc, b) => acc + b.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const b of buffers) {
    result.set(convert_buffer(b), offset);
    offset += b.byteLength;
  }
  return result;
};

export const extractCookies = (headers: Headers): Record<string, string> => {
  const cookies: Record<string, string> = {};
  const setCookieHeaders = headers.getSetCookie?.() || [];

  for (const cookieStr of setCookieHeaders) {
    const [nameValue] = cookieStr.split(";");
    if (!nameValue) continue;
    const [name, ...valueParts] = nameValue.split("=");
    if (name) cookies[name.trim()] = valueParts.join("=").trim();
  }
  return cookies;
};

export const serializeCookies = (cookies: Record<string, string>): string => {
  return Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
};

export const generateTOTP = (secret: string): string => {
  const totp = new OTPAuth.TOTP({
    issuer: "X",
    label: "X",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: secret.toUpperCase().replace(/\s/g, ""), // X secrets are Base32
  });

  return totp.generate();
};
