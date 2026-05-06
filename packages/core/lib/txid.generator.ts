const TXID_SERVICE_URL =
  process.env.NODE_ENV === "production"
    ? "http://txid:7055"
    : "http://57.130.19.92:7055";

type TxidHealth = { ok: boolean };

type WaitForHealthyRetry = {
  attempt: number;
  delayMs: number;
};

type WaitForHealthyOptions = {
  context: string;
  initialDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (state: WaitForHealthyRetry) => Promise<void> | void;
  checkHealth?: () => Promise<TxidHealth>;
  triggerRefetch?: () => Promise<TxidHealth>;
  sleep?: (ms: number) => Promise<void>;
};

const isTxidHealth = (value: unknown): value is TxidHealth => {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { ok?: unknown }).ok === "boolean";
};

export default class TXID {
  private txCache = new Map<string, string>();

  async getTransactionId(method: string, path: string): Promise<string> {
    const cacheKey = `${method}:${path}`;
    const cached = this.txCache.get(cacheKey);
    if (cached) return cached;

    const url = `https://x.com${path}`;
    try {
      const response = await fetch(`${TXID_SERVICE_URL}/transaction-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, url }),
      });

      if (!response.ok) {
        throw new Error(`TXID service error: ${response.statusText}`);
      }

      const data = (await response.json()) as { transaction_id: string };
      const tid = data.transaction_id;

      this.txCache.set(cacheKey, tid);
      return tid;
    } catch (error) {
      console.error(
        `[TGQL] Failed to fetch Transaction ID from microservice:`,
        error,
      );
      throw error;
    }
  }

  static async checkTxidHealth(): Promise<TxidHealth> {
    try {
      const response = await fetch(`${TXID_SERVICE_URL}/health`);
      if (!response.ok) return { ok: false };

      const data = await response.json();
      if (!isTxidHealth(data) || !data.ok) return { ok: false };

      return { ok: true };
    } catch (_error) {
      return { ok: false };
    }
  }

  private static async triggerManualRefetch(): Promise<TxidHealth> {
    const response = await fetch(`${TXID_SERVICE_URL}/refetch`, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`TXID manual refetch failed: ${response.status}`);
    }

    const data = await response.json();
    if (!isTxidHealth(data) || !data.ok) {
      throw new Error("TXID manual refetch returned an invalid response.");
    }

    return { ok: true };
  }

  static async waitForHealthy({
    context,
    initialDelayMs = 5000,
    maxDelayMs = 60000,
    onRetry,
    checkHealth = () => this.checkTxidHealth(),
    triggerRefetch = () => this.triggerManualRefetch(),
    sleep = (ms) => Bun.sleep(ms),
  }: WaitForHealthyOptions): Promise<void> {
    let delayMs = initialDelayMs;
    let attempt = 1;

    while (true) {
      const { ok } = await checkHealth();
      if (ok) {
        if (attempt > 1) {
          console.log(`[${context}] TXID service is healthy again.`);
        }
        return;
      }

      try {
        const { ok: refetched } = await triggerRefetch();
        if (refetched) {
          console.log(`[${context}] Triggered TXID manual refetch.`);
          continue;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[${context}] TXID manual refetch failed: ${message}`);
      }

      console.warn(
        `[${context}] TXID service is unhealthy. Retrying in ${Math.ceil(delayMs / 1000)}s (attempt ${attempt}).`,
      );

      await onRetry?.({ attempt, delayMs });
      await sleep(delayMs);

      delayMs = Math.min(delayMs * 2, maxDelayMs);
      attempt++;
    }
  }
}
