/**
 * Single-job lock + console capture + SSE log broadcasting.
 */

const clients = new Set();
let busy = false;
let currentJob = null;

export function isBusy() {
  return busy;
}

export function getCurrentJob() {
  return currentJob;
}

export function addSseClient(res) {
  clients.add(res);
  return () => clients.delete(res);
}

export function broadcast(event, data) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  const chunk = `event: ${event}\ndata: ${payload}\n\n`;
  for (const res of clients) {
    try {
      res.write(chunk);
    } catch {
      clients.delete(res);
    }
  }
}

function broadcastLog(level, message) {
  const line = String(message).replace(/\r?\n$/, "");
  if (!line) return;
  broadcast("log", {
    level,
    message: line,
    ts: new Date().toISOString(),
  });
}

export async function runExclusive(jobName, fn) {
  if (busy) {
    const err = new Error(`Busy: "${currentJob}" is still running`);
    err.status = 409;
    throw err;
  }

  busy = true;
  currentJob = jobName;
  broadcast("job", { status: "started", job: jobName });

  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  const wrap =
    (level, original) =>
    (...args) => {
      const text = args
        .map((a) => {
          if (typeof a === "string") return a;
          if (a instanceof Error) return a.stack || a.message;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(" ");
      broadcastLog(level, text);
      original.apply(console, args);
    };

  console.log = wrap("info", originalLog);
  console.error = wrap("error", originalError);
  console.warn = wrap("warn", originalWarn);

  try {
    const result = await fn();
    broadcast("job", { status: "done", job: jobName });
    return result;
  } catch (err) {
    broadcastLog("error", err?.stack || err?.message || String(err));
    broadcast("job", {
      status: "error",
      job: jobName,
      message: err?.message || String(err),
    });
    throw err;
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    busy = false;
    currentJob = null;
  }
}
