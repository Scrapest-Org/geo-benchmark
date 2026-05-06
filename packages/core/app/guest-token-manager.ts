import { bearer_token } from "@scrapest/constants";
// import { bunFetch } from "@scrapest/axios";

// const fetch = bunFetch({ rotateOnStart: true });

class GuestTokenManager {
  public tokens: string[] = [];
  private timer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    await Promise.all(
      Array.from({ length: 5 }).map(() => this.fetchGuestToken()),
    );
    this.timer = setInterval(() => this.fetchGuestToken(), 60_000);
    console.log("Guest token manager started");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getToken(): string {
    if (this.tokens.length === 0) throw new Error("Guest token pool empty");
    const token = this.tokens.shift()!;
    this.tokens.push(token);
    return token;
  }

  private async fetchGuestToken(): Promise<void> {
    try {
      const res = await fetch("https://api.x.com/1.1/guest/activate.json", {
        method: "POST",
        headers: {
          authorization: bearer_token,
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "Unknown error");
        throw new Error(`Guest token API returned ${res.status}: ${text}`);
      }

      const data = (await res.json()) as { guest_token: string };

      this.tokens.push(data.guest_token);
      if (this.tokens.length > 10) this.tokens.shift();
      return;
    } catch (e: any) {
      console.error("An error occured", e?.message);
    }
  }
}

export default GuestTokenManager;
