interface JWK {
  d?: string;
  x?: string;
  y?: string;
  crv?: string;
  key_ops?: string[];
  kty?: string;
}

interface XConfig {
  screen_name: string;
  password?: string;
  authentication_secret?: string;
  retry: number;
  cookies: {
    auth_token: string;
    ct0: string;
  };
}

interface AutoPushConfig {
  uaid: string;
  channel_id: string;
  remote_settings__monitor_changes: string;
  endpoint: string;
}

interface XResponse<T = any> {
  message: string;
  cookies: Record<string, string>;
  content: T;
}

interface XPostData {
  registration_ids: string[];
  title: string; // post author, just name
  body: string; // post content
  icon: string; // post author, profile image
  timestamp: string; // Timestamp in ms
  tag?: string; // post id, separated by "-"
  data: {
    lang: string;
    bundle_text: string;
    type: string;
    uri: string; // can extract username from first string after / before /status. Can build url from this.
    impression_id: string;
    title: string;
    body: string;
    tag: string;
    scribe_target: string;
  };
  lang: string;
}

interface XPostNotification {
  author: {
    name: string;
    screen_name: string;
    profile_image_url: string;
    id: string;
  };
  text: string;
  timestamp: number;
  url: string;
  id: string;
  lang: string;
}

interface GetXUser {
  data: {
    created_at: string;
    id: string;
    name: string;
    protected: boolean;
    username: string;
  };
  errors: Array<{
    detail: string;
    title: string;
    type: string;
    status: number;
  }>;
}
