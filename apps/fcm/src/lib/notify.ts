import { getEnv } from "@scrapest/config";
import SourceEvent from "@scrapest/core/resolvers";
import { tcpRpcClient, internalEmitter } from "./rpc";
import { userCache } from "./user-cache";

const vm = getEnv("VM_NAME");

export async function handleNotification(decrypted: Buffer) {
  const now = Date.now();

  try {
    console.time("decrypt");
    const text = new TextDecoder().decode(decrypted);
    //     parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decrypted));

    const tweetData: XPostData = JSON.parse(text);
    if (!tweetData.tag) {
      console.info("Skipping non-tweet notification...", text);
      return null;
    }

    const tag = tweetData.tag.replace(/[^\d]+\-/gm, "");
    const sft = Number(
      ((BigInt(tag) >> BigInt(22)) & BigInt(2199023255551)) +
        BigInt(1288834974657),
    );

    console.log(
      "~|",
      `[fcm] post ${tag} >>${Number(tweetData.timestamp) - sft}ms>> fcm >>${now - Number(tweetData.timestamp)}ms>> client`,
    );

    const uname = tweetData.data.uri.split("/")[1] || "unknown";
    const authorId = userCache.get(uname);

    const tweet: XPostNotification = {
      id: tag,
      text: tweetData.body,
      author: {
        name: tweetData.title,
        screen_name: uname,
        profile_image_url: tweetData.icon,
        id: authorId || "generic-x39r",
      },
      timestamp: Number(tweetData.timestamp),
      url: `https://x.com${tweetData.data.uri}`,
      lang: tweetData.lang,
    };

    console.log(`Broadcast ${tag} time`);
    const tweetEvent = new SourceEvent("fast-x", tweet, vm, sft);
    tcpRpcClient.emit("dispatch-events", { payload: [tweetEvent] });
    console.timeEnd("decrypt");
    internalEmitter.emit("new-tweet", { tag, rcv: sft });
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    console.error("[fcm] Error processing notification:", e.message);
  }
}
