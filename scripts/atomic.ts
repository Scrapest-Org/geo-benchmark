// Main thread — writer (web_push logic)
const sab = new SharedArrayBuffer(1024 * 1024); // 1MB shared buffer
const signal = new Int32Array(new SharedArrayBuffer(4));
const data = new Uint8Array(sab);

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

const start = performance.now();
console.time("write");
// write payload into shared buffer
const encoded = Buffer.from(JSON.stringify(payload));
data.set(encoded, 0);
console.timeEnd("write");

// wake the reader
Atomics.notify(signal, 0, 1);

// Worker thread — reader (app logic)
console.time("wait");
Atomics.wait(signal, 0, 0); // sleeps until notified
console.timeEnd("wait");
// read from shared buffer instantly
