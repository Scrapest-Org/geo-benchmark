const fireFoxUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0";
const braveUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const bearer_token =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

// Leaked Twitter-for-Android OAuth 1.0a consumer credentials.
// Used to sign mobile-API calls (xauth_password, device/register.json).
const twitter_android_consumer_key = "3nVuSoBZnx6U4vzUxf5w";
const twitter_android_consumer_secret =
  "Bcs59EFbbsdF6Sl9Ng71smgStWEGwXXKSjYvPVt7qys";

// Twitter's FCM project sender id (com.twitter.android).
const twitter_fcm_sender_id = "996653472103";

// User-Agent the Twitter Android app sends. Matches Pixel 7 / Android 14.
const dalvik_user_agent =
  "Dalvik/2.1.0 (Linux; U; Android 14; Pixel 7 Build/UQ1A.240205.004)";

// FCM register3 metadata — Google Play Services version + Twitter app version.
// gmsv must match the SDK version of a real GMS build; bump if Google rotates.
const gms_version = "240515000";
const twitter_app_version = "10.40.0-release.0";

// Realistic Android build fingerprints. checkin.ts picks one
// deterministically per accountId (hash mod len).
const android_build_fingerprints = [
  {
    fingerprint:
      "google/panther/panther:14/UQ1A.240205.004/11269751:user/release-keys",
    model: "Pixel 7",
    brand: "google",
    device: "panther",
    manufacturer: "Google",
    product: "panther",
    sdk_version: 34,
  },
  {
    fingerprint:
      "samsung/dm3qxxx/dm3q:14/UP1A.231005.007/S918BXXS3CXFA:user/release-keys",
    model: "SM-S918B",
    brand: "samsung",
    device: "dm3q",
    manufacturer: "samsung",
    product: "dm3qxxx",
    sdk_version: 34,
  },
  {
    fingerprint:
      "google/raven/raven:13/TQ3A.230901.001/10750268:user/release-keys",
    model: "Pixel 6 Pro",
    brand: "google",
    device: "raven",
    manufacturer: "Google",
    product: "raven",
    sdk_version: 33,
  },
] as const;

type AndroidBuildFingerprint =
  (typeof android_build_fingerprints)[number];

const VAPID =
  "BF5oEo0xDUpgylKDTlsd8pZmxQA1leYINiY-rSscWYK_3tWAkz4VMbtf1MLE_Yyd6iII6o-e3Q9TCN5vZMzVMEs";
enum TIME {
  SECOND = 1000,
  MINUTE = 60 * SECOND,
  _30SEC = 30 * SECOND,
  _5MIN = 5 * MINUTE,
  _10MIN = 10 * MINUTE,
  _15MIN = 15 * MINUTE,
  HOUR = 60 * MINUTE,
  CHECK = 2 * HOUR,
}

const APP_URL = "https://scrape.st";

enum KEYS {
  WEBHOOK = "webhooks",
  TRACKING = "tracking",
  TRACKERS = "trackers",
  GLOBAL_TRACKED_USERS = "all_users",
  TEMP_AUTH = "temp_auth",
  API_KEYS = "api_keys",
  GUEST_TOKEN = "guest_token",
  LAST_X_POST = "last_x_post",
  STATS_KEY = "dispatch:stats",
  LAST_POLL_POST_DATE = "date_of_last_x_post_from_poll",
  METRICS_SOURCE_LATENCY = "metrics:latency:source",
  METRICS_INTERNAL_LATENCY = "metrics:latency:internal",
}

const sourceMetricKeys = (source: string) => ({
  sourceLatency: `${KEYS.METRICS_SOURCE_LATENCY}:${source}` as const,
  internalLatency: `${KEYS.METRICS_INTERNAL_LATENCY}:${source}` as const,
});

export {
  fireFoxUserAgent,
  braveUserAgent,
  bearer_token,
  twitter_android_consumer_key,
  twitter_android_consumer_secret,
  twitter_fcm_sender_id,
  dalvik_user_agent,
  gms_version,
  twitter_app_version,
  android_build_fingerprints,
  type AndroidBuildFingerprint,
  VAPID,
  APP_URL,
  TIME,
  KEYS,
  sourceMetricKeys,
};
