#!/usr/bin/env node
/**
 * Sears Catalog Console — local Express UI
 *   npm start
 *   http://localhost:4177
 */
import express from "express";
import open from "open";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getStatusSnapshot, runDateFolderName } from "../scripts/lib/shared.mjs";
import { downloadCatalogMain } from "../scripts/download-catalog.mjs";
import { splitBrandSheets } from "../scripts/split-brand-sheets.mjs";
import { uploadToWorkspace } from "../scripts/upload-to-workspace.mjs";
import {
  addSseClient,
  broadcast,
  getCurrentJob,
  isBusy,
  runExclusive,
} from "./jobs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const UI_DIR = path.join(ROOT, "ui");
const PORT = Number(process.env.PORT || 4177);

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(UI_DIR));

app.get("/api/status", (_req, res) => {
  try {
    const snap = getStatusSnapshot();
    res.json({
      ...snap,
      busy: isBusy(),
      currentJob: getCurrentJob(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  res.write(
    `event: hello\ndata: ${JSON.stringify({
      busy: isBusy(),
      currentJob: getCurrentJob(),
    })}\n\n`
  );

  const remove = addSseClient(res);
  const keepAlive = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(keepAlive);
      remove();
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    remove();
  });
});

function sendJobConflict(res) {
  res.status(409).json({
    ok: false,
    error: `Busy: "${getCurrentJob()}" is still running`,
    busy: true,
    currentJob: getCurrentJob(),
  });
}

async function handleJob(res, jobName, fn) {
  if (isBusy()) return sendJobConflict(res);

  try {
    const result = await runExclusive(jobName, fn);
    res.json({ ok: true, job: jobName, result });
  } catch (err) {
    if (err?.status === 409) return sendJobConflict(res);
    res.status(500).json({
      ok: false,
      job: jobName,
      error: err?.message || String(err),
    });
  }
}

app.post("/api/download", async (_req, res) => {
  await handleJob(res, "download", async () => {
    console.log("=== Download Catalog ===");
    const catalogPath = await downloadCatalogMain();
    return { catalogPath };
  });
});

app.post("/api/split", async (_req, res) => {
  await handleJob(res, "split", async () => {
    console.log("=== Filter & Build Sheets ===");
    return await splitBrandSheets();
  });
});

app.post("/api/upload", async (req, res) => {
  const dateName =
    String(req.body?.date || req.body?.dateName || "").trim() || runDateFolderName();

  await handleJob(res, "upload", async () => {
    console.log("=== Upload to Workspace ===");
    console.log(`Date: ${dateName}`);
    return await uploadToWorkspace({ dateName });
  });
});

app.post("/api/run-all", async (_req, res) => {
  await handleJob(res, "run-all", async () => {
    console.log("=== 1/3 Download Sears catalog ===");
    const catalogPath = await downloadCatalogMain();

    console.log("");
    console.log("=== 2/3 Split brand sheets ===");
    const split = await splitBrandSheets({ catalogPath });

    console.log("");
    console.log("=== 3/3 Upload to Workspace ===");
    const upload = await uploadToWorkspace({ dateName: split.dateName });

    console.log("");
    console.log("Pipeline complete.");
    return { catalogPath, split, upload };
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(UI_DIR, "index.html"));
});

app.listen(PORT, async () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Sears Catalog Console → ${url}`);
  broadcast("log", {
    level: "info",
    message: `Server ready at ${url}`,
    ts: new Date().toISOString(),
  });
  try {
    await open(url);
  } catch (err) {
    console.warn(`Could not open browser automatically: ${err?.message || err}`);
  }
});
