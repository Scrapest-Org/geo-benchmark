import {
  TW_USER_AGENT,
  GEONODE_SERVER_ERROR_CODES,
  HTTP_RATE_LIMIT_STATUS,
  type FetchConfig,
} from "./constants";

const axiosFetch = (defaultConfig: FetchConfig = {}) => {
  return async (url: string, config: FetchConfig = {}) => {
    const mergedConfig = { ...defaultConfig, ...config };

    const headers = new Headers(defaultConfig.headers);
    if (config.headers) {
      for (const [key, value] of Object.entries(config.headers)) {
        headers.set(key, value);
      }
    }
    headers.set("user-agent", TW_USER_AGENT);

    let finalUrl = mergedConfig.baseUrl ? `${mergedConfig.baseUrl}${url}` : url;
    if (mergedConfig.params) {
      const searchParams = new URLSearchParams(mergedConfig.params);
      finalUrl += `?${searchParams.toString()}`;
    }

    const proxy = mergedConfig.proxy || process.env.GEONODE_PROXY;

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      mergedConfig.timeout || 30000,
    );

    try {
      const response = await fetch(finalUrl, {
        ...mergedConfig,
        headers,
        signal: controller.signal,
        proxy,
      });

      clearTimeout(timeoutId);

      const data = response.headers
        .get("content-type")
        ?.includes("application/json")
        ? await response.json()
        : await response.text();

      return {
        data,
        status: response.status,
        headers: response.headers,
        ok: response.ok,
      };
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      if (error.name === "AbortError") throw new Error("Request Timeout");
      throw error;
    }
  };
};

const MAX_DELAY = 60_000 * 15;
async function rotateProxy(proxy: string, attempt: number, wait?: number) {
  const backoff = 1000 * 5 * Math.pow(2, attempt);
  const backoffMs = wait ?? Math.min(MAX_DELAY, backoff);

  await Bun.sleep(backoffMs);
  const id = Math.random().toString(36).substring(2, 8);
  const sessionRegex = /session-[a-zA-Z0-9]+/;
  return proxy.replace(sessionRegex, `session-${id}`);
}

/**
 * A fetch wrapper that automatically retries on errors with proxy rotation support.
 *
 * - Retries on Geonode server errors (5xx codes)
 * - Retries on connection errors (ECONNRESET, "569" message)
 * - Retries on rate-limit (429) with exponential backoff
 * - Rotates proxy session ID on each retry
 * - Returns raw Response object (caller handles parsing)
 */
const bunFetch = (defaultConfig: FetchConfig = {}) => {
  return async (url: string, config: FetchConfig = {}): Promise<Response> => {
    const mergedConfig = { ...defaultConfig, ...config };
    const maxRetries = mergedConfig.maxRetries ?? 3;
    const callSite = new Error().stack?.split("\n")[2]?.trim() ?? "unknown";

    const headers = new Headers(defaultConfig.headers);
    if (config.headers) {
      for (const [key, value] of Object.entries(config.headers)) {
        headers.set(key, value);
      }
    }

    let finalUrl = mergedConfig.baseUrl ? `${mergedConfig.baseUrl}${url}` : url;
    if (mergedConfig.params) {
      const searchParams = new URLSearchParams(mergedConfig.params);
      finalUrl += `?${searchParams.toString()}`;
    }

    let proxy = mergedConfig.proxy || process.env.PROXY_URL || null;
    if (mergedConfig.rotateOnStart && proxy)
      proxy = await rotateProxy(proxy, 0, 0);

    let attempts = 0;

    while (attempts < maxRetries) {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        mergedConfig.timeout || 30000,
      );

      try {
        const response = await fetch(finalUrl, {
          ...mergedConfig,
          headers,
          signal: controller.signal,
          ...(proxy && { proxy }),
        });

        clearTimeout(timeoutId);

        if (GEONODE_SERVER_ERROR_CODES.includes(response.status)) {
          console.warn(
            `🔄 ${response.status} Geonode Server Error. Rotating session... (attempt ${attempts + 1}/${maxRetries})`,
            `\nCall site: ${callSite}`,
          );
          if (proxy) proxy = await rotateProxy(proxy, attempts);
          attempts++;

          continue;
        }

        if (response.status === HTTP_RATE_LIMIT_STATUS) {
          const resetAt = response.headers.get("x-rate-limit-reset");
          const waitMs = resetAt
            ? Math.max(0, parseInt(resetAt) * 1000 - Date.now())
            : Math.min(1000 * 60 * 15, 1000 * 60 * Math.pow(2, attempts));

          console.warn(
            `🔄 Rate limited (429). Waiting ${Math.round(waitMs / 1000)}s (attempt ${attempts + 1}/${maxRetries})...`,
            `\nCall site: ${callSite}`,
          );

          if (proxy) proxy = await rotateProxy(proxy, attempts, waitMs);
          attempts++;
          continue;
        }

        return response;
      } catch (error: any) {
        clearTimeout(timeoutId);

        if (error.code === "ConnectionRefused" || error.code === "ECONNRESET") {
          console.warn(
            `🔄 Connection error: ${error.message}. Rotating session...(attempt ${attempts + 1}/${maxRetries})`,
            `\nCall site: ${callSite}`,
          );
          if (proxy) proxy = await rotateProxy(proxy, attempts);
          attempts++;
          continue;
        }

        if (error.name === "AbortError") {
          const backoffMs = Math.min(5000, 1000 * Math.pow(2, attempts));
          console.warn(
            `⏱️| Timeout on ${url.split("/").pop()}. Rotating & Retrying... (${attempts + 1}/${maxRetries})`,
            `\nCall site: ${callSite}`,
          );

          if (proxy) proxy = await rotateProxy(proxy, attempts, backoffMs);
          attempts++;
          continue;
        }

        throw error;
      }
    }

    throw new Error(
      `Max retries (${maxRetries}) reached for ${new URL(url).origin} at ${callSite}`,
    );
  };
};

export default axiosFetch;
export { bunFetch, axiosFetch, rotateProxy };
