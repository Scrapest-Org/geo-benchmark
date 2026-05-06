import {
  base64_to_base64url,
  buffer_to_base64,
} from "../utils/encrypt-decrypt";
import { fireFoxUserAgent, bearer_token } from "@scrapest/constants";
import XHelper from "../lib/x-helper";

class X extends XHelper {
  public cookies: Record<string, string> = {};
  constructor(cookies: Record<string, string> = {}, proxy?: string) {
    super(proxy);
    this.cookies = cookies;
  }

  public getHeaders(extraHeaders: Record<string, string> = {}) {
    return {
      "User-Agent": fireFoxUserAgent,
      "Content-Type": "application/json",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
      "x-csrf-token": this.cookies.ct0 || "",
      "x-twitter-client-language": "en",
      authorization: bearer_token,
      cookie: Object.entries(this.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
      ...extraHeaders,
    };
  }

  async login(username: string, password: string, tfa?: string) {
    throw new Error(`login method on X not set`);
  }

  private async postNotificationsAction(url: string, payload: object) {
    return this.fetchWithRetry(url, {
      method: "POST",
      headers: this.getHeaders({
        referrer: "https://x.com/settings/push_notifications",
      }),
      body: JSON.stringify(payload),
    });
  }

  async postNotificationsLogin(
    endpoint: string,
    publicKey: ArrayBuffer,
    _auth: ArrayBuffer,
  ) {
    const payload = this.loginPayloadBuilder(endpoint, publicKey, _auth);
    return this.postNotificationsAction(
      "https://x.com/i/api/1.1/notifications/settings/login.json",
      payload,
    );
  }

  async postNotificationsLogout(endpoint: string) {
    return this.postNotificationsAction(
      "https://x.com/i/api/1.1/notifications/settings/logout.json",
      this.payloadBuilder(endpoint),
    );
  }

  async postNotificationsCheckin(
    endpoint: string,
    publicKey: ArrayBuffer,
    _auth: ArrayBuffer,
  ) {
    const payload = this.loginPayloadBuilder(endpoint, publicKey, _auth);
    return this.postNotificationsAction(
      "https://x.com/i/api/1.1/notifications/settings/checkin.json",
      payload,
    );
  }

  async getNotificationsBadgeCount() {
    const url =
      "https://x.com/i/api/2/badge_count/badge_count.json?supports_ntab_urt=1";
    const response = await this.fetchWithRetry(url, {
      headers: this.getHeaders({
        referrer: "https://x.com/settings/push_notifications",
      }),
    });

    if (!response.ok)
      throw new Error(`Badge count failed: ${response.statusText}`);
    return await response.json();
  }

  private payloadBuilder(endpoint: string) {
    return {
      os_version: "Windows/Firefox",
      udid: "Windows/Firefox",
      env: 3,
      locale: "en",
      protocol_version: 1,
      token: endpoint,
    };
  }

  private loginPayloadBuilder(
    endpoint: string,
    publicKey: ArrayBuffer,
    _auth: ArrayBuffer,
  ) {
    const auth = base64_to_base64url(buffer_to_base64(_auth));
    const payload = {
      push_device_info: {
        ...this.payloadBuilder(endpoint),
        encryption_key1: base64_to_base64url(buffer_to_base64(publicKey)),
        encryption_key2:
          typeof auth !== "string" ? (auth as any).toString("base64url") : auth,
      },
    };
    return payload;
  }

  private paramsBuilder(
    targetUserId: string,
    otherParams: Record<string, string> = {},
  ) {
    return new URLSearchParams({
      id: targetUserId,
      include_profile_interstitial_type: "1",
      include_blocking: "1",
      include_blocked_by: "1",
      include_followed_by: "1",
      include_want_retweets: "1",
      include_mute_edge: "1",
      include_can_dm: "1",
      include_can_media_tag: "1",
      include_ext_is_blue_verified: "1",
      include_ext_verified_type: "1",
      include_ext_profile_image_shape: "1",
      skip_status: "1",
      ...otherParams,
    });
  }

  private async pushConfigAction(
    url: string,
    params: URLSearchParams,
    action: string,
    maxRetries = 3,
  ) {
    let attempt = 0;
    while (attempt < maxRetries) {
      const response = await this.fetchWithRetry(url, {
        method: "POST",
        headers: this.getHeaders({
          "Content-Type": "application/x-www-form-urlencoded",
        }),
        body: params.toString(),
      });

      const data = (await response.json()) as any;
      if (response.ok) {
        console.log(`✅ ${action} successfully!`);
        return;
      }

      const isRateLimited =
        response.status === 429 ||
        data?.errors?.some((e: any) => e.code === 88);

      if (isRateLimited) {
        const resetAt = response.headers.get("x-rate-limit-reset");
        const waitMs = resetAt
          ? Math.max(0, parseInt(resetAt) * 1000 - Date.now())
          : Math.min(1000 * 60 * 15, 1000 * 60 * 2 ** attempt);

        console.warn(
          `Rate limited on ${action}. Waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})...`,
        );
        await Bun.sleep(waitMs);
        attempt++;
        continue;
      }

      console.error(`Failed to ${action}:`, data);
      return;
    }

    console.error(
      `${action} exhausted ${maxRetries} retries due to rate limiting.`,
    );
  }

  async turnOnNotifications(targetUserId: string) {
    const url = "https://x.com/i/api/1.1/friendships/update.json";
    const params = this.paramsBuilder(targetUserId, { device: "true" });

    await this.pushConfigAction(url, params, "Turn On Notifications");
  }

  async turnOffNotifications(targetUserId: string) {
    const url = "https://x.com/i/api/1.1/friendships/update.json";
    const params = this.paramsBuilder(targetUserId, { device: "false" });

    await this.pushConfigAction(url, params, "Turn Off Notifications");
  }

  async followUser(targetUserId: string) {
    const url = "https://x.com/i/api/1.1/friendships/create.json";
    const params = this.paramsBuilder(targetUserId, { user_id: targetUserId });

    await this.pushConfigAction(url, params, "Follow User");
  }

  async unfollowUser(targetUserId: string) {
    const url = "https://x.com/i/api/1.1/friendships/destroy.json";
    const params = this.paramsBuilder(targetUserId, { user_id: targetUserId });

    await this.pushConfigAction(url, params, "Unfollow User");
  }
}

export default X;
