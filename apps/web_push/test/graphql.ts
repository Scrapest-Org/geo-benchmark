import { GuestTokenManager, XGraphQL } from "@scrapest/core";

const gtm = new GuestTokenManager();

console.time("guest-token");
await gtm.start();
console.timeEnd("guest-token");

const gql = new XGraphQL(gtm);
// ── Profile ──
console.log("\n=== User Profile (@steffqing) ===");
console.time("fetchUserProfile");
try {
  const p = await gql.fetchUserProfile("steffqing");
  console.timeEnd("fetchUserProfile");
  console.log(`  ${p.name} (@${p.screen_name}) | ID: ${p.id}`);
  console.log(
    `  Followers: ${p.followers_count} | Tweets: ${p.statuses_count}`,
  );
  console.log(`  Blue: ${p.is_blue_verified} | Created: ${p.created_at}`);
} catch (err) {
  console.timeEnd("fetchUserProfile");
  console.error("  FAILED:", (err as Error).message);
}

// ── Tweet ──
console.log("\n=== Tweet (2019606922824151397) ===");
console.time("fetchTweet");
try {
  const t = await gql.fetchXPost("2019606922824151397");
  console.timeEnd("fetchTweet");
  console.log(`  By: ${t.author.name} (@${t.author.screen_name})`);
  console.log(`  Text: ${t.text.slice(0, 100)}`);
  console.log(`  Likes: ${t.favorite_count} | RTs: ${t.retweet_count}`);
  if (t.quoted_tweet)
    console.log(`  Quotes: @${t.quoted_tweet.author.screen_name}`);
} catch (err) {
  console.timeEnd("fetchTweet");
  console.error("  FAILED:", (err as Error).message);
}

// ── Community ──
console.log("\n=== Community (1472105760389668865 — Tech Twitter) ===");
console.time("fetchCommunity");
try {
  const c = await gql.fetchCommunity("1472105760389668865");
  console.timeEnd("fetchCommunity");
  console.log(`  ${c.name} | ID: ${c.id}`);
  console.log(
    `  Members: ${c.member_count} | Creator: @${c.creator.screen_name}`,
  );
  console.log(`  Rules: ${c.rules.length} | NSFW: ${c.is_nsfw}`);
  console.log(`  Facepile: ${c.members_facepile.length} members shown`);
} catch (err) {
  console.timeEnd("fetchCommunity");
  console.error("  FAILED:", (err as Error).message);
}

gtm.stop();
console.log("\nDone.");
