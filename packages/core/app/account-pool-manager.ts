import { redis } from "@scrapest/config";
import { bearer_token, fireFoxUserAgent } from "@scrapest/constants";
import { bunFetch } from "@scrapest/axios";

type Account = {
  [K in
    | "login"
    | "password"
    | "mail"
    | "passwordmail"
    | "CT0"
    | "2FA"
    | "AUTH_TOKEN"
    | "createdAt"
    | "proxy"]: string;
} & {
  status: "active" | "inactive" | "new" | "error";
};

type Cookies = {
  ct0: string;
  auth_token: string;
};

type AccountOpts = {
  claimKey?: string;
  skipValidation?: boolean;
};

const fetch = bunFetch({ maxRetries: 3, timeout: 5_000 });

class AccountPoolManager {
  private conveyorKey: string;

  constructor(conveyorKey = "conveyor4") {
    this.conveyorKey = conveyorKey;
  }

  async getAccount(opts?: AccountOpts): Promise<Account> {
    const claimKey = opts?.claimKey;
    let login: string | null = null;

    if (claimKey) {
      login = await redis.get(`claim:${claimKey}`);
    }

    if (!login) {
      const poolSize = await redis.llen(this.conveyorKey);
      let attempts = 0;

      while (attempts < poolSize) {
        login = await redis.rpoplpush(this.conveyorKey, this.conveyorKey);
        if (!login) throw new Error("No accounts available in conveyor");

        if (claimKey) {
          const claimed = await redis.set(
            `in_use:${login}`,
            claimKey,
            "EX",
            86400,
            "NX",
          );

          if (claimed) {
            await redis.set(`claim:${claimKey}`, login, "EX", 86400);
            break;
          } else {
            login = null;
          }
        } else {
          break;
        }
        attempts++;
      }

      if (!login) {
        throw new Error("All accounts in conveyor are currently in use");
      }
    }

    const raw = await redis.hget("warehouse", login);
    if (!raw) throw new Error(`Account warehouse for ${login} is empty`);

    const account = JSON.parse(raw) as Account;
    const valid = opts?.skipValidation ? true : await this.validate(account);

    if (!valid) {
      if (claimKey) {
        await redis.del(`claim:${claimKey}`);
        await redis.del(`in_use:${account.login}`);
      }
      throw new Error(`${account.login} is not valid`);
    }

    return account;
  }

  async getAnAccountHeaders(login: string) {
    const raw = await redis.hget("warehouse", login);
    if (!raw) throw new Error(`Account warehouse for ${login} is empty`);

    const account = JSON.parse(raw) as Account;
    const valid = await this.validate(account);

    if (!valid) {
      throw new Error(`${account.login} is not valid`);
    }

    const cookies: Cookies = {
      ct0: account.CT0,
      auth_token: account.AUTH_TOKEN,
    };

    return this.getHeaders(cookies);
  }

  async getRawAccount() {
    const login = await redis.rpoplpush(this.conveyorKey, this.conveyorKey);
    const raw = await redis.hget("warehouse", login);
    if (!raw) throw new Error(`Account warehouse for ${login} is empty`);

    return JSON.parse(raw) as Account;
  }

  async validate(acc: Account) {
    try {
      const cookies = { ct0: acc.CT0, auth_token: acc.AUTH_TOKEN };
      const headers = this.getHeaders(cookies);
      const res = await fetch(
        "https://x.com/i/api/2/badge_count/badge_count.json?supports_ntab_urt=1&include_xchat_count=1",
        {
          method: "GET",
          headers,
        },
      );
      return res.ok;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  }

  public getHeaders(
    cookies: Cookies,
    extraHeaders: Record<string, string> = {},
  ) {
    return {
      "User-Agent": fireFoxUserAgent,
      "Content-Type": "application/json",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
      "x-csrf-token": cookies.ct0 || "",
      "x-twitter-client-language": "en",
      authorization: bearer_token,
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
      ...extraHeaders,
    };
  }

  private async getAccountAndHeaders_(
    extraHeaders: Record<string, string> = {},
    opts?: AccountOpts,
  ) {
    const account = await this.getAccount(opts);
    const cookies: Cookies = {
      ct0: account.CT0,
      auth_token: account.AUTH_TOKEN,
    };

    return this.getHeaders(cookies, extraHeaders);
  }

  public async getAccountAndHeaders(
    extraHeaders: Record<string, string> = {},
    maxAttempts = 5,
    opts?: AccountOpts,
  ): Promise<Record<string, string> | null> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        return await this.getAccountAndHeaders_(extraHeaders, opts);
      } catch (error: any) {
        const msg = error.message || "";
        console.error(`❌| Acquisition failed:`, msg);

        const loginMatch = msg.match(/(\S+) is not valid/);
        if (loginMatch) {
          const badLogin = loginMatch[1];

          console.warn(
            `🗑️| Offloading ${badLogin} from ${this.conveyorKey} to failed_conveyor.`,
          );
          // await redis.pipeline().lrem(this.conveyorKey, 0, badLogin).sadd("failed_conveyor", badLogin).exec();
        }
      }

      attempts++;
      await Bun.sleep(500);
    }
    return null;
  }

  public async getAccountHeaders(acc: Account, extras = {}) {
    const cookies: Cookies = {
      ct0: acc.CT0,
      auth_token: acc.AUTH_TOKEN,
    };

    return this.getHeaders(cookies, extras);
  }
}

export default AccountPoolManager;
export type { Cookies, Account };
