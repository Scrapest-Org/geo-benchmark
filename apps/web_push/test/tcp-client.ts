import { TcpRpcClient } from "@scrapest/tcp-rpc";

export const client = new TcpRpcClient("app");

const payload = {
  mid: "2052870885602742518",
  sid: "1457620134546268160",
  source: "x",
  vmName: "asia-singapore",
  timestamp: 1778277534281,
  payload: {
    id: "2052870885602742518",
    text: "For Valhalla",
    created_at: "Fri May 08 21:58:54 +0000 2026",
    lang: "hu",
    favorite_count: 0,
    retweet_count: 0,
    reply_count: 0,
    quote_count: 0,
    bookmark_count: 0,
    author: {
      id: "1457620134546268160",
      name: "Steven Tomi",
      screen_name: "Steffqing",
      profile_image_url:
        "https://pbs.twimg.com/profile_images/2036797820221435904/ZJeWKcE4_normal.jpg",
      verified: false,
      is_blue_verified: false,
    },
    entities: {
      hashtags: [],
      symbols: [],
      timestamps: [],
      urls: [],
      user_mentions: [],
    },
    conversation_id: "2052870885602742518",
    retweeted_tweet: false,
    link: "https://x.com/Steffqing/status/2052870885602742518",
  },
};

await client.connect().catch(() => {
  console.warn("⚠️ App RPC not available yet, retrying...");
});

for (let i = 0; i < 3; i++) {
  await Bun.sleep(1_000 * i);
  console.log(`Dispatching event ${i + 1}`);
  console.log(Date.now());
  client.emit("dispatch-events", { payload: [payload] });
  console.log("Event dispatched");
}

process.exit(0);
