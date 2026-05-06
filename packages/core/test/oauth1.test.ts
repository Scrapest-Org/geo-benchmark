import { describe, it, expect } from "bun:test";
import { signOauth1, percentEncode, buildSignatureBaseString } from "../oauth1";

// RFC 5849 §1.2 — canonical example vector.
// Method: POST, URL: https://api.twitter.com/1/statuses/update.json
// Params combined: include_entities=true, status=Hello+Ladies+%2B+Gentlemen%2C+a+signed+OAuth+request%21
// oauth_consumer_key, oauth_nonce, oauth_timestamp, oauth_signature_method, oauth_token, oauth_version
// Expected signature (RFC vector): tnnArxj06cWHq44gCs1OSKk/jLY=

describe("percentEncode", () => {
  it("encodes per RFC 3986 unreserved set", () => {
    expect(percentEncode("Hello Ladies + Gentlemen, a signed OAuth request!")).toBe(
      "Hello%20Ladies%20%2B%20Gentlemen%2C%20a%20signed%20OAuth%20request%21",
    );
  });
  it("does not encode unreserved chars", () => {
    expect(percentEncode("abc-_.~XYZ")).toBe("abc-_.~XYZ");
  });
});

describe("buildSignatureBaseString", () => {
  it("matches RFC 5849 example", () => {
    const base = buildSignatureBaseString({
      method: "POST",
      url: "https://api.twitter.com/1/statuses/update.json",
      params: {
        include_entities: "true",
        status: "Hello Ladies + Gentlemen, a signed OAuth request!",
        oauth_consumer_key: "xvz1evFS4wEEPTGEFPHBog",
        oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: "1318622958",
        oauth_token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        oauth_version: "1.0",
      },
    });
    expect(base).toBe(
      "POST&https%3A%2F%2Fapi.twitter.com%2F1%2Fstatuses%2Fupdate.json&include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521",
    );
  });
});

describe("signOauth1", () => {
  it("matches RFC 5849 expected signature", async () => {
    const result = await signOauth1({
      method: "POST",
      url: "https://api.twitter.com/1/statuses/update.json",
      consumerKey: "xvz1evFS4wEEPTGEFPHBog",
      consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
      token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
      tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
      bodyParams: {
        include_entities: "true",
        status: "Hello Ladies + Gentlemen, a signed OAuth request!",
      },
      // Pin nonce + timestamp so the signature is deterministic.
      _testOverrides: {
        oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
        oauth_timestamp: "1318622958",
      },
    });
    expect(result.oauth_signature).toBe("tnnArxj06cWHq44gCs1OSKk/jLY=");
    expect(result.authorizationHeader).toContain('OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"');
    expect(result.authorizationHeader).toContain('oauth_signature="tnnArxj06cWHq44gCs1OSKk%2FjLY%3D"');
  });
});
