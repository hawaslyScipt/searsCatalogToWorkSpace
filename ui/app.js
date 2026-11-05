(() => {
  const logView = document.getElementById("logView");
  const btnClearLog = document.getElementById("btnClearLog");
  const brandCards = document.getElementById("brandCards");
  const buttons = [...document.querySelectorAll("[data-action]")];

  const endpoints = {
    download: "/api/download",
    split: "/api/split",
    upload: "/api/upload",
    "run-all": "/api/run-all",
  };

  let busy = false;

  function appendLog(message, level = "info") {
    const line = document.createElement("div");
    if (level === "error") line.className = "err";
    else if (level === "warn") line.className = "warn";
    else if (level === "ok") line.className = "ok";
    line.textContent = message;
    logView.appendChild(line);
    logView.scrollTop = logView.scrollHeight;
  }

  function setBusy(next, jobName) {
    busy = Boolean(next);
    buttons.forEach((btn) => {
      btn.disabled = busy;
    });
    const jobEl = document.getElementById("statJob");
    if (busy) {
      jobEl.textContent = jobName || "Running…";
      jobEl.className = "busy";
    } else {
      jobEl.textContent = "Idle";
      jobEl.className = "idle";
    }
  }

  function formatSize(mb, bytes) {
    if (!bytes && !mb) return "—";
    if (mb >= 0.01) return `${mb.toFixed(2)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function renderCards(status) {
    const catalog = status.catalog;
    const items = [
      {
        label: "Full catalog",
        title: catalog?.name || "Not downloaded",
        meta: catalog
          ? formatSize(catalog.sizeMb ?? 0, catalog.size ?? 0)
          : "Waiting for download",
        ready: Boolean(catalog),
      },
      ...(status.brands || []).map((b) => ({
        label: "Brand sheet",
        title: b.name,
        meta: b.exists ? formatSize(b.sizeMb ?? 0, b.size ?? 0) : "Not built yet",
        ready: b.exists,
      })),
    ];

    brandCards.innerHTML = items
      .map(
        (item) => `
      <article class="card ${item.ready ? "" : "missing"}">
        <p class="card-label">${item.label}</p>
        <h3 class="card-title">${item.title}</h3>
        <p class="card-meta">${item.meta}</p>
        <span class="pill ${item.ready ? "ready" : "missing"}">
          ${item.ready ? "Ready" : "Missing"}
        </span>
      </article>`
      )
      .join("");
  }

  async function refreshStatus() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Status failed");

      document.getElementById("statDate").textContent = data.dateName || "—";
      document.getElementById("statCatalog").textContent =
        data.catalog?.name || "No catalog yet";
      document.getElementById("statDrive").textContent =
        data.drivePathHint || "—";

      renderCards(data);
      setBusy(data.busy, data.currentJob);
      return data;
    } catch (err) {
      appendLog(`Status error: ${err.message}`, "error");
      return null;
    }
  }

  async function runAction(action) {
    if (busy) return;
    const url = endpoints[action];
    if (!url) return;

    setBusy(true, action);
    appendLog(`→ Starting ${action}…`, "ok");

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "upload" ? JSON.stringify({}) : undefined,
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        appendLog(data.error || "Another job is running", "warn");
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      appendLog(`✓ ${action} finished`, "ok");

      if (action === "split" || action === "run-all") {
        const results = data.result?.results || data.result?.split?.results;
        if (Array.isArray(results)) {
          for (const r of results) {
            appendLog(`  ${r.brand}: ${r.count} rows`);
          }
        }
      }
    } catch (err) {
      appendLog(`✗ ${action} failed: ${err.message}`, "error");
    } finally {
      await refreshStatus();
    }
  }

  function connectEvents() {
    const es = new EventSource("/api/events");

    es.addEventListener("hello", (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setBusy(data.busy, data.currentJob);
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("log", (ev) => {
      try {
        const data = JSON.parse(ev.data);
        appendLog(data.message, data.level === "error" ? "error" : data.level || "info");
      } catch {
        appendLog(ev.data);
      }
    });

    es.addEventListener("job", async (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.status === "started") {
          setBusy(true, data.job);
        } else if (data.status === "done" || data.status === "error") {
          await refreshStatus();
        }
      } catch {
        /* ignore */
      }
    });

    es.onerror = () => {
      // Browser will reconnect; avoid spamming the log.
    };
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => runAction(btn.dataset.action));
  });

  btnClearLog.addEventListener("click", () => {
    logView.textContent = "";
  });

  appendLog("Connected. Ready for jobs.", "ok");
  connectEvents();
  refreshStatus();
})();
