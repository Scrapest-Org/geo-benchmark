type Statuses = "initializing" | "syncing" | "error" | "indexing";
declare global {
  type WebPushHealth = {
    status: Statuses;
    last_checkin: string;
    next_checkin: string;
    is_registered: boolean;
    ws_connected: boolean;
    twitter_authenticated: boolean;
    instance_id: string;
  };

  type WebPollHealth = {
    status: Statuses;
    last_poll: string;
    next_poll?: string;
    instance_id: string;
  };

  type DiscordHealth = {
    status: string;
    uptime: number;
  };

  namespace Express {
    interface Request {
      apiKey?: string;
      auth?: {
        apiKey?: string;
        isAdmin: boolean;
      };
      sse?: {
        apiKey?: string;
      };
    }
  }
}

export {};
