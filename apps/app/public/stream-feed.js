document.addEventListener("DOMContentLoaded", () => {
  const feed = document.getElementById("stream-feed");
  if (!feed) return;

  const MAX_ROWS = 7;

  function nowStamp(ts) {
    const d = ts ? new Date(ts) : new Date();
    const h = String(d.getUTCHours()).padStart(2, "0");
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    const s = String(d.getUTCSeconds()).padStart(2, "0");
    const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
    return `${h}:${m}:${s}.${ms}`;
  }

  function formatSource(source) {
    switch (source) {
      case "x":
        return "X";
      case "reddit":
        return "REDDIT";
      case "telegram":
        return "TELEGRAM";
      case "discord":
        return "DISCORD";
      default:
        return source.toUpperCase();
    }
  }

  function addRow(event) {
    const row = document.createElement("div");
    row.className =
      "stream-row-enter flex items-start px-4 py-3 border-b border-zinc-900 bg-black/40 hover:bg-[#050505] transition-colors group";
    row.innerHTML =
      `<div class="w-24 shrink-0 text-[9px] text-zinc-500 pt-0.5 font-mono">${nowStamp(event.timestamp)}</div>` +
      `<div class="w-28 shrink-0 text-[10px] text-white font-bold group-hover:text-zinc-300 transition-colors">${formatSource(event.source)}</div>` +
      `<div class="flex-1 text-[10px] text-zinc-400 font-mono truncate">${event.payload}</div>`;

    feed.prepend(row);

    if (feed.children.length > MAX_ROWS) {
      const last = feed.lastElementChild;
      last.classList.remove("stream-row-enter");
      last.classList.add("stream-row-exit");

      last.addEventListener("transitionend", () => last.remove(), {
        once: true,
      });
      setTimeout(() => {
        if (last.parentNode) last.remove();
      }, 400);
    }
  }

  const local =
    location.hostname === "127.0.0.1" || location.hostname === "localhost";
  const STREAM_BASE_URL = local ? "https://scrape.st" : "";

  const queue = [];
  let stream = null;

  async function connectStream() {
    try {
      stream = new EventSource(
        `${STREAM_BASE_URL}/stream?useFastX=true&ignoreFullPayload=true`,
      );

      stream.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (!data || !data.payload) return;

          if (queue.length < 100) queue.push(data);
          if (queue.length > 50) queue.splice(0, queue.length - 20);
        } catch (err) {
          console.warn("Bad event:", e.data);
        }
      };

      stream.onopen = () => {
        console.log("✅ Stream connected");
      };

      stream.onerror = () => {
        console.warn("⚠️ Stream disconnected, retrying...");
        stream.close();
        setTimeout(connectStream, 3000);
      };
    } catch (err) {
      console.error("Stream connection error:", err);
      setTimeout(connectStream, 5000);
    }
  }

  connectStream();

  setInterval(() => {
    if (queue.length > 0) {
      addRow(queue.shift());
    }
  }, 200);
});
