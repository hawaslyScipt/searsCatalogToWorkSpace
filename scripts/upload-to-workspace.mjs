#!/usr/bin/env node
/**
 * Upload into Google Drive:
 * searsCatalog Data (FolderId from .env) / <date> /
 *   - full downloaded catalog sheet (e.g. Published Items.csv)
 *   - Homelegance / FOA / Acme / Giga Buyer / Others brand sheets
 *
 * FolderId in .env must point to "searsCatalog Data".
 *
 * Usage:
 *   npm run upload:workspace
 *   npm run upload:workspace -- --date 04-11-2026
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import {
  OUTPUT_DIR,
  UPLOAD_BRANDS,
  parseDriveFolderId,
  requireEnv,
  runDateFolderName,
} from "./lib/shared.mjs";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? String(process.argv[i + 1] || "").trim() : "";
}

function driveClient() {
  const auth = new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    process.env.GOOGLE_REDIRECT_URI || "http://localhost"
  );
  auth.setCredentials({ refresh_token: requireEnv("GOOGLE_REFRESH_TOKEN") });
  return google.drive({ version: "v3", auth });
}

function searsCatalogDataFolderId() {
  const id = parseDriveFolderId(process.env.FolderId);
  if (!id) {
    throw new Error(
      'Missing or invalid FolderId in .env (must be "searsCatalog Data" Drive URL/ID)'
    );
  }
  return id;
}

async function findChild(drive, name, parentId, mimeType) {
  const parts = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `'${parentId}' in parents`,
    "trashed = false",
  ];
  if (mimeType) parts.push(`mimeType = '${mimeType}'`);

  const res = await drive.files.list({
    q: parts.join(" and "),
    fields: "files(id, name, webViewLink)",
    pageSize: 10,
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0] || null;
}

async function findOrCreateFolder(drive, name, parentId) {
  const existing = await findChild(
    drive,
    name,
    parentId,
    "application/vnd.google-apps.folder"
  );
  if (existing) return existing.id;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  return created.data.id;
}

function mimeTypeFor(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".csv") return "text/csv";
  if (ext === ".xls") return "application/vnd.ms-excel";
  return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function findFullCatalogInDateDir(dayDir) {
  const entries = fs
    .readdirSync(dayDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => /\.(csv|xlsx|xls)$/i.test(name));

  const preferred = entries.find((n) => /^published items\./i.test(n));
  if (preferred) return path.join(dayDir, preferred);

  const brandNames = new Set(UPLOAD_BRANDS.map((b) => b.fileName.toLowerCase()));
  const other = entries.find((n) => !brandNames.has(n.toLowerCase()));
  return other ? path.join(dayDir, other) : "";
}

async function uploadOrReplace(drive, localPath, fileName, parentId) {
  const mimeType = mimeTypeFor(fileName);
  const existing = await findChild(drive, fileName, parentId, null);

  if (existing) {
    const updated = await drive.files.update({
      fileId: existing.id,
      media: {
        mimeType,
        body: fs.createReadStream(localPath),
      },
      fields: "id, webViewLink",
      supportsAllDrives: true,
    });
    return { id: updated.data.id, link: updated.data.webViewLink, replaced: true };
  }

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [parentId],
    },
    media: {
      mimeType,
      body: fs.createReadStream(localPath),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  return { id: created.data.id, link: created.data.webViewLink, replaced: false };
}

export async function uploadToWorkspace({ dateName } = {}) {
  const day = dateName || argValue("--date") || runDateFolderName();
  const dayDir = path.join(OUTPUT_DIR, day);

  if (!fs.existsSync(dayDir)) {
    throw new Error(
      `Local date folder not found: ${dayDir}. Run split:brands first.`
    );
  }

  const drive = driveClient();
  const searsCatalogDataId = searsCatalogDataFolderId();

  console.log(`searsCatalog Data (FolderId): ${searsCatalogDataId}`);
  console.log(`Uploading local folder: ${dayDir}`);

  // searsCatalog Data -> date -> (full catalog + brands)
  const dateFolderId = await findOrCreateFolder(drive, day, searsCatalogDataId);
  console.log(`Date folder on Drive: ${day}`);

  console.log("");
  console.log("Full catalog upload:");
  let catalogLocal = findFullCatalogInDateDir(dayDir);
  if (!catalogLocal) {
    const rootCandidates = fs
      .readdirSync(OUTPUT_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.(csv|xlsx|xls)$/i.test(e.name))
      .map((e) => path.join(OUTPUT_DIR, e.name));
    const preferredRoot = rootCandidates.find((p) =>
      /^published items\./i.test(path.basename(p))
    );
    const source = preferredRoot || rootCandidates[0];
    if (source) {
      catalogLocal = path.join(dayDir, path.basename(source));
      fs.copyFileSync(source, catalogLocal);
      console.log(`  Copied full catalog into date folder: ${catalogLocal}`);
    }
  }

  if (catalogLocal && fs.existsSync(catalogLocal)) {
    const catalogName = path.basename(catalogLocal);
    const result = await uploadOrReplace(
      drive,
      catalogLocal,
      catalogName,
      dateFolderId
    );
    const sizeMb = (fs.statSync(catalogLocal).size / (1024 * 1024)).toFixed(2);
    console.log(
      `  ${catalogName}: ${result.replaced ? "replaced" : "uploaded"} (${sizeMb} MB)`
    );
    if (result.link) console.log(`    ${result.link}`);
  } else {
    console.log("  SKIP (full catalog file not found in date folder or output root)");
  }

  console.log("");
  console.log("Brand upload:");

  for (const brand of UPLOAD_BRANDS) {
    const localFile = path.join(dayDir, brand.name, brand.fileName);
    if (!fs.existsSync(localFile)) {
      console.log(`  ${brand.name}: SKIP (missing ${localFile})`);
      continue;
    }

    const brandFolderId = await findOrCreateFolder(drive, brand.name, dateFolderId);
    const result = await uploadOrReplace(drive, localFile, brand.fileName, brandFolderId);
    const sizeMb = (fs.statSync(localFile).size / (1024 * 1024)).toFixed(2);
    console.log(
      `  ${brand.name}: ${result.replaced ? "replaced" : "uploaded"} (${sizeMb} MB)`
    );
    if (result.link) console.log(`    ${result.link}`);
  }

  console.log("");
  console.log(
    `Done. Drive path: searsCatalog Data / ${day} / [full catalog + brand folders]`
  );
  return { dateName: day, dateFolderId, searsCatalogDataId };
}

async function main() {
  await uploadToWorkspace();
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirect) {
  main().catch((err) => {
    console.error(err?.stack || err);
    process.exit(1);
  });
}
