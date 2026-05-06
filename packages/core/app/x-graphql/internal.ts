import type GuestTokenManager from "../guest-token-manager";
import { BASE_HEADERS, QUERY_IDS } from "../../constants/graphql-constants";
import { bearer_token } from "@scrapest/constants";
import TXID from "../../lib/txid.generator";
import { bunFetch } from "@scrapest/axios";

const proxyFetch = bunFetch({ baseUrl: "https://api.x.com" });

export class XGQLInternal extends TXID {
  private gtm: GuestTokenManager;
  private txid: TXID;

  constructor(guestTokenManager: GuestTokenManager) {
    super();
    this.txid = new TXID();
    this.gtm = guestTokenManager;
  }

  protected async query<T>(
    id: keyof typeof QUERY_IDS,
    params: URLSearchParams,
    customHeaders?: Record<string, string>,
  ) {
    const path = `/graphql/${QUERY_IDS[id]}/${id}`;
    const fullPath = `https://api.x.com${path}?${params.toString()}`;

    try {
      const headers = customHeaders ?? (await this.buildHeaders("GET", path));
      const res = await fetch(fullPath, {
        headers,
        // params,
      });
      if (!res.ok) throw new Error(`${id} ${res.status}: ${await res.text()}`);

      return (await res.json()) as T;
    } catch (e) {
      throw e;
    }
  }

  protected async proxyQuery<T>(
    id: keyof typeof QUERY_IDS,
    params: URLSearchParams,
    customHeaders?: Record<string, string>,
  ) {
    const path = `/graphql/${QUERY_IDS[id]}/${id}`;
    try {
      const headers = customHeaders ?? (await this.buildHeaders("GET", path));
      const res = await proxyFetch(path, {
        headers,
        params,
      });
      if (!res.ok) throw new Error(`${id} ${res.status}: ${await res.text()}`);

      return (await res.json()) as T;
    } catch (e) {
      throw e;
    }
  }

  protected async buildHeaders(
    method: string,
    path: string,
  ): Promise<Record<string, string>> {
    const guestToken = this.gtm.getToken();
    const transactionId = await this.txid.getTransactionId(method, path);
    const forwardedFor = await generateXForwardedFor();

    return {
      ...BASE_HEADERS,
      authorization: bearer_token,
      "x-guest-token": guestToken,
      "x-client-transaction-id": transactionId,
      "x-twitter-x-forwarded-for": forwardedFor,
      cookie: `gt=${guestToken}`,
    };
  }

  protected async buildAuthHeaders(
    method: string,
    path: string,
    authHeaders: Record<string, any>,
  ): Promise<Record<string, string>> {
    const transactionId = await this.txid.getTransactionId(method, path);

    return {
      ...BASE_HEADERS,
      ...authHeaders,
      authorization: bearer_token,
      "x-client-transaction-id": transactionId,
    };
  }

  protected resolveXPost(raw: RawXPostResult): ResolvedXPost {
    let data;
    if (raw.__typename === "Tweet") {
      data = raw;
    } else if (raw.__typename === "TweetWithVisibilityResults") {
      data = raw.tweet;
    } else if (raw.__typename === "TweetTombstone") {
      throw new Error("Post is tombstoned");
    } else if (raw.__typename === "TweetPreviewDisplay") {
      return this.resolvePreview(raw.tweet);
    } else {
      Bun.write(`${Date.now()}.txt`, JSON.stringify(raw));
      throw new Error(
        `Post unavailable: ${(raw as { reason?: string }).reason ?? "unknown"}`,
      );
    }

    const user = data.core.user_results.result;
    const legacy = data.legacy;
    const noteText = data.note_tweet?.note_tweet_results?.result?.text;
    const text = noteText ?? legacy.full_text ?? "-x-";

    const resolved: ResolvedXPost = {
      id: data.rest_id,
      text: text,
      created_at: legacy.created_at,
      lang: legacy.lang,
      favorite_count: legacy.favorite_count,
      retweet_count: legacy.retweet_count,
      reply_count: legacy.reply_count,
      quote_count: legacy.quote_count,
      bookmark_count: legacy.bookmark_count,
      author: {
        id: user.rest_id,
        name: user.core?.name ?? "",
        screen_name: user.core?.screen_name ?? "",
        profile_image_url: user.avatar?.image_url ?? "",
        verified: user.verification?.verified ?? false,
        is_blue_verified: user.is_blue_verified ?? false,
      },
      entities: legacy.entities,
      media: legacy.extended_entities?.media,
      in_reply_to_status_id: legacy.in_reply_to_status_id_str,
      in_reply_to_screen_name: legacy.in_reply_to_screen_name,
      conversation_id: legacy.conversation_id_str,
      retweeted_tweet: text.startsWith("RT"),
      link: `https://x.com/${user.core?.screen_name}/status/${data.rest_id}`,
    };

    if (noteText) resolved.note_tweet_text = noteText;
    if (data.quoted_status_result?.result) {
      try {
        resolved.quoted_tweet = this.resolveXPost(
          data.quoted_status_result.result,
        );
      } catch {
        // quoted post may be tombstoned/unavailable — skip
      }
    }
    if (legacy.retweeted_status_result?.result) {
      try {
        resolved.retweeted = this.resolveXPost(
          legacy.retweeted_status_result.result,
        );
      } catch {
        /* skip failed RTs */
      }
    }

    return resolved;
  }

  protected resolvePreview(data: XPostPreview): ResolvedXPost {
    const user = data.core.user_results.result;
    return {
      id: data.rest_id,
      text: data.text,
      created_at: data.created_at,
      lang: "en",
      favorite_count: data.favorite_count,
      retweet_count: data.retweet_count,
      reply_count: data.reply_count,
      quote_count: data.quote_count,
      bookmark_count: data.bookmark_count,
      author: {
        id: user.rest_id,
        name: user.core?.name ?? "",
        screen_name: user.core?.screen_name ?? "",
        profile_image_url: user.avatar?.image_url ?? "",
        verified: user.verification?.verified ?? false,
        is_blue_verified: user.is_blue_verified ?? false,
      },
      entities: data.entities,
      retweeted_tweet: data.text.startsWith("RT"),
      link: `https://x.com/${user.core?.screen_name}/status/${data.rest_id}`,
    };
  }
}

async function generateXForwardedFor(): Promise<string> {
  const input = `${Date.now()}${Math.random()}`;
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
