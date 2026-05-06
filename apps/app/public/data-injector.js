document.addEventListener("DOMContentLoaded", () => {
  // Elements to update
  const totalVolumeCounter = document.getElementById("total-volume-counter");

  const sources = ["twitter", "discord", "telegram", "reddit"];
  const rowElements = {};

  sources.forEach((source) => {
    const row = document.querySelector(
      `.connector-row[data-source="${source}"]`,
    );
    if (row) {
      rowElements[source] = {
        latency: row.querySelector('[data-metric="latency"]'),
        statusText: row.querySelector('[data-metric="status-text"]'),
        statusDot: row.querySelector('[data-metric="status-dot"]'),
      };

      // Set initial loading states
      if (rowElements[source].latency)
        rowElements[source].latency.textContent = "...";
      if (rowElements[source].statusText)
        rowElements[source].statusText.textContent = "...";
      if (rowElements[source].statusDot) {
        rowElements[source].statusDot.className =
          "row-status-dot w-1.5 h-1.5 transition-colors bg-zinc-500 animate-pulse";
      }
    }
  });

  if (totalVolumeCounter) totalVolumeCounter.textContent = "...";

  // Formatting helper for Total Volume
  const formatVolume = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M RECORDS";
    if (num >= 1000) return (num / 1000).toFixed(1) + "K RECORDS";
    return num + " RECORDS";
  };

  // Helper to update row status color based on status text
  const updateStatusColor = (dotEl, statusStr) => {
    if (!dotEl) return;
    const s = (statusStr || "").toLowerCase();

    // reset to base classes
    dotEl.className = "row-status-dot w-1.5 h-1.5 transition-colors";

    if (
      s === "active" ||
      s === "indexing" ||
      s === "synced" ||
      s === "aligned" ||
      s === "healthy"
    ) {
      dotEl.classList.add("bg-zinc-700"); // the default "connected" indicator in the dark mode
    } else if (s === "idle" || s === "stopped" || s === "offline") {
      dotEl.classList.add("bg-red-500"); // just as an example for offline
    } else {
      dotEl.classList.add("bg-zinc-700");
    }
  };

  // 1. Fetch Health Data (covers global volume and individual statuses)
  fetch("https://scrape.st/health/status")
    .then((res) => res.json())
    .then((data) => {
      // Update Total Volume
      if (totalVolumeCounter && typeof data.total_sent === "number") {
        totalVolumeCounter.textContent = formatVolume(data.total_sent);
      } else if (totalVolumeCounter) {
        totalVolumeCounter.textContent = "-";
      }

      // Map statuses for each source - now flat structure: data.twitter, data.discord, etc.
      const getStatus = (source) => {
        const status = data[source];
        return status && status !== "coming soon" ? status : null;
      };

      sources.forEach((source) => {
        const els = rowElements[source];
        if (!els) return;

        const status = getStatus(source);
        if (status && els.statusText) {
          els.statusText.textContent = String(status).toUpperCase();
          updateStatusColor(els.statusDot, status);
        } else {
          if (els.statusText) els.statusText.textContent = "-";
          if (els.statusDot) {
            els.statusDot.className =
              "row-status-dot w-1.5 h-1.5 transition-colors bg-zinc-700";
          }
        }
      });
    })
    .catch((err) => {
      console.error("Failed to fetch health data:", err);
      if (totalVolumeCounter) totalVolumeCounter.textContent = "-";
      sources.forEach((source) => {
        const els = rowElements[source];
        if (!els) return;
        if (els.statusText) els.statusText.textContent = "-";
        if (els.statusDot)
          els.statusDot.className =
            "row-status-dot w-1.5 h-1.5 transition-colors bg-zinc-700";
      });
    });

  // 2. Fetch Metrics per source (covers latency)
  sources.forEach((source) => {
    fetch(`https://scrape.st/metrics/${source}`)
      .then((res) => res.json())
      .then((data) => {
        const els = rowElements[source];
        if (!els) return;

        // Grab internal latency p50 for example
        if (
          data &&
          data.internal_latency_ms &&
          typeof data.internal_latency_ms.p50 === "number"
        ) {
          if (els.latency)
            els.latency.textContent = data.internal_latency_ms.p50 + "ms";
        } else {
          if (els.latency) els.latency.textContent = "-";
        }
      })
      .catch((err) => {
        console.error(`Failed to fetch metrics for ${source}:`, err);
        const els = rowElements[source];
        if (els && els.latency) els.latency.textContent = "-";
      });
  });
});
