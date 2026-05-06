import { getEnv } from "@scrapest/config";
import { extractCookies, serializeCookies } from "../utils/encrypt-decrypt";
import TXID from "./txid.generator";

const GEONODE_SERVER_ERROR_CODES = [
  500, 517, 518, 560, 561, 562, 563, 564, 565, 566, 567, 569,
];

class XHelper extends TXID {
  private proxy_url: string;

  constructor(proxy?: string) {
    super();
    this.proxy_url = proxy || getEnv("GEONODE_PROXY");
  }

  private rotateProxy() {
    const id = Math.random().toString(36).substring(2, 12);
    const sessionRegex = /session-[a-zA-Z0-9]+/;
    const proxy_url = this.proxy_url.replace(sessionRegex, `session-${id}`);

    this.proxy_url = proxy_url;
  }

  protected async fetchWithRetry(
    url: string,
    init: RequestInit,
    maxRetries = 3,
  ): Promise<Response> {
    let attempts = 0;
    while (attempts < maxRetries) {
      try {
        const response = await fetch(url, { ...init, proxy: this.proxy_url });

        if (GEONODE_SERVER_ERROR_CODES.includes(response.status)) {
          console.warn(
            `🔄 ${response.status} Geonode Server Error. Rotating session...`,
          );
          this.rotateProxy();
          attempts++;
          continue;
        }

        return response;
      } catch (error: any) {
        if (error.message.includes("569") || error.code === "ECONNRESET") {
          this.rotateProxy();
          attempts++;
          continue;
        }
        throw error;
      }
    }
    throw new Error(`Max retries reached for ${url}`);
  }

  protected sendLoginRequest = async (
    bearerToken: string,
    guestToken: string,
    cookies: Record<string, string> = {},
    headers: Record<string, string> = {},
    query: URLSearchParams = new URLSearchParams(),
    body: any = {},
  ): Promise<XResponse> => {
    const path = "/1.1/onboarding/task.json";
    const url = `https://api.x.com${path}${query.size > 0 ? `?${query.toString()}` : ""}`;

    try {
      const txid = await this.getTransactionId("POST", path);

      const response = await this.fetchWithRetry(url, {
        method: "POST",
        headers: {
          ...headers,
          authorization: bearerToken,
          "x-guest-token": guestToken,
          cookie: serializeCookies(cookies),
          "x-client-transaction-id":
            "5QcRpx08qYYx+JFRRptfl1dSHSV5nTCUlQjULesD3hw8wymP18skSjr1b9R1czuC6mReheCLxjgjzioDyTGA9dCioy9U5g",
          "content-type": "application/json",
          "content-length": "930",
        },
        body: JSON.stringify(body),
      });

      const contentType = response.headers.get("content-type");
      if (!response.ok || !contentType?.includes("application/json")) {
        const text = await response.text();
        console.error(
          `🛑 Request failed with status ${response.status}. Body snippet: ${text.slice(0, 200)}`,
        );
        return {
          message: `403 Forbidden - Cloudflare Blocked. Snippet: ${text.slice(0, 100)}`,
          cookies: extractCookies(response.headers),
          content: { errors: [{ message: "Blocked by Cloudflare/WAF" }] },
        };
      }

      console.log(response);

      return {
        message: "",
        cookies: extractCookies(response.headers),
        content: await response.json(),
      };
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      console.error("LOGIN_REQUEST_ERROR", error);
      return {
        message: error.message,
        cookies: {},
        content: {},
      };
    }
  };

  protected getViewer = async (
    bearerToken: string,
    cookies: Record<string, string>,
    viewerQueryId: string,
    viewerFeatures: any,
  ) => {
    const params = new URLSearchParams({
      variables: JSON.stringify({
        withCommunitiesMemberships: true,
        withSubscribedTab: true,
        withCommunitiesCreation: true,
      }),
      features: JSON.stringify(viewerFeatures),
    });

    const url = `https://api.x.com/graphql/${viewerQueryId}/Viewer?${params.toString()}`;

    try {
      const response = await this.fetchWithRetry(url, {
        method: "GET",
        headers: {
          authorization: bearerToken,
          "x-csrf-token": cookies.ct0 || "",
          cookie: serializeCookies(cookies),
        },
      });

      return {
        message: "",
        cookies: extractCookies(response.headers),
        content: await response.json(),
      };
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      return {
        message: error.message,
        cookies: {},
        content: {},
      };
    }
  };
}

export default XHelper;
