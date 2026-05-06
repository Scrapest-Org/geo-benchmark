import { redis } from "./redis";

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

export default class Config {
  private redisKey: string;
  public config = {
    x: {
      screen_name: "",
      password: "",
      authentication_secret: "",
      retry: 5,
      cookies: {
        auth_token: "",
        ct0: "",
      },
    } as XConfig,
    auth: "",
    jwk: {} as JWK,
    autopush: {
      uaid: "",
      channel_id: "",
      remote_settings__monitor_changes: "",
      endpoint: "",
    } as AutoPushConfig,
  };

  constructor(account?: Account, instanceId?: string) {
    this.redisKey = instanceId ? `config:${instanceId}` : "config";
    if (account) {
      const setup: XConfig = {
        screen_name: `@${account.login}`,
        password: account.password,
        authentication_secret: account["2FA"],
        retry: 5,
        cookies: {
          auth_token: account.AUTH_TOKEN,
          ct0: account.CT0,
        },
      };
      this.config.x = setup;
      void this.saveConfig();
    }
  }

  async initData() {
    const data = await redis.get(this.redisKey);
    if (data) {
      const parsed = JSON.parse(data);
      // Backward compatibility: migrate twitter -> x
      if (parsed.twitter && !parsed.x) {
        parsed.x = parsed.twitter;
        delete parsed.twitter;
      }
      this.config = parsed;
    }
  }

  async saveConfig() {
    await redis.set(this.redisKey, JSON.stringify(this.config));
  }

  async getConfig() {
    const data = await redis.get(this.redisKey);
    if (!data) throw new Error("Config is not initialized in Redis");

    const parsed = JSON.parse(data);
    // Backward compatibility: migrate twitter -> x
    if (parsed.twitter && !parsed.x) {
      parsed.x = parsed.twitter;
      delete parsed.twitter;
    }
    this.config = Object.assign(this.config, parsed);
  }

  async resetConfig() {
    const { x } = this.config;
    this.config = {
      x: { ...x, retry: 5 },
      auth: "",
      jwk: {},
      autopush: {
        uaid: "",
        channel_id: "",
        remote_settings__monitor_changes: "",
        endpoint: "",
      } as AutoPushConfig,
    };
    await this.saveConfig();
    console.log("~|", "Config reset successfully.");
  }
}
