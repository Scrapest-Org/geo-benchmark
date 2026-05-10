import { getEnv } from "@scrapest/config";
import type { XGraphQL } from "@scrapest/core";
import SourceEvent from "@scrapest/core/resolvers";
import { tcpRpcClient, internalEmitter } from "./rpc";

const vm = getEnv("VM_NAME");

function buildWorkers(gql: XGraphQL) {
  internalEmitter.on(
    "new-tweet",
    async ({ tag, rcv }: { tag: string; rcv: number }) => {
      const t = await gql.fetchXPost(tag);
      const se = new SourceEvent("x", t, vm, rcv);
      tcpRpcClient.emit("dispatch-events", { payload: [se], app: "fcm" });
      console.log(`[${vm}] [fcm] Processed full post: ${tag}`);
    },
  );

  // TODO: add mgmtWorker when running alongside Mozilla web_push
}

export default buildWorkers;
