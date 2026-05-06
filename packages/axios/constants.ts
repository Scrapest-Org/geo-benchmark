export const TW_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";

export const GEONODE_SERVER_ERROR_CODES = [
  500, 517, 518, 560, 561, 562, 563, 564, 565, 566, 567, 568, 569,
];

export const HTTP_RATE_LIMIT_STATUS = 429;

export interface FetchConfig extends RequestInit {
  baseUrl?: string;
  params?: Record<string, string> | URLSearchParams;
  timeout?: number;
  proxy?: string;
  maxRetries?: number;
  retryDelay?: number; // Fixed delay between retries if you don't want exponential
  backoffFactor?: number; // To tune the '2^attempt' logic (e.g., 1.5 or 2)
  validateStatus?: (status: number) => boolean; // Custom logic for what counts as a "failure"
  keepAlive?: boolean;
  rotateOnStart?: boolean;
}
