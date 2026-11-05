import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(ROOT, ".env") });

export const OUTPUT_DIR = path.join(ROOT, "output");

export const BRANDS = [
  {
    name: "Homelegance",
    fileName: "Homelegance.xlsx",
    match: (id) => id.startsWith("MR-") && id.endsWith("-04HE"),
  },
  {
    name: "FOA",
    fileName: "FOA.xlsx",
    match: (id) => id.startsWith("MR-") && id.endsWith("-01FA"),
  },
  {
    name: "Acme",
    fileName: "Acme.xlsx",
    match: (id) => id.startsWith("MR-") && id.endsWith("-05AM"),
  },
  {
    name: "Giga Buyer",
    fileName: "Giga Buyer.xlsx",
    match: (id) => id.startsWith("IS-"),
  },
];

export const OTHERS_BRAND = { name: "Others", fileName: "Others.xlsx" };

export const UPLOAD_BRANDS = [...BRANDS, OTHERS_BRAND];

export function runDateFolderName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

export function dateOutputDir(date = new Date()) {
  return path.join(OUTPUT_DIR, runDateFolderName(date));
}

export function normalizeItemId(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim()
    .toUpperCase();
}

export function parseDriveFolderId(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const fromUrl = value.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (fromUrl) return fromUrl[1];
  if (/^[a-zA-Z0-9_-]+$/.test(value)) return value;
  return "";
}

export function findLatestCatalogFile() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    throw new Error(`Output folder not found: ${OUTPUT_DIR}`);
  }

  const entries = fs
    .readdirSync(OUTPUT_DIR, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const full = path.join(OUTPUT_DIR, e.name);
      return { name: e.name, full, mtime: fs.statSync(full).mtimeMs };
    })
    .filter((e) => /\.(csv|xlsx|xls)$/i.test(e.name))
    .sort((a, b) => b.mtime - a.mtime);

  if (!entries.length) {
    throw new Error(`No catalog file found in ${OUTPUT_DIR}. Run download:catalog first.`);
  }
  return entries[0].full;
}

function fileInfo(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const st = fs.statSync(filePath);
  return {
    name: path.basename(filePath),
    path: filePath,
    size: st.size,
    sizeMb: Number((st.size / (1024 * 1024)).toFixed(2)),
    mtime: st.mtimeMs,
  };
}

function findCatalogInDateDir(dayDir) {
  if (!fs.existsSync(dayDir)) return null;

  const brandNames = new Set(UPLOAD_BRANDS.map((b) => b.fileName.toLowerCase()));
  const entries = fs
    .readdirSync(dayDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => /\.(csv|xlsx|xls)$/i.test(name));

  const preferred = entries.find((n) => /^published items\./i.test(n));
  if (preferred) return path.join(dayDir, preferred);

  const other = entries.find((n) => !brandNames.has(n.toLowerCase()));
  return other ? path.join(dayDir, other) : null;
}

export function listDateFolders() {
  if (!fs.existsSync(OUTPUT_DIR)) return [];

  return fs
    .readdirSync(OUTPUT_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{2}-\d{2}-\d{4}$/.test(e.name))
    .map((e) => {
      const full = path.join(OUTPUT_DIR, e.name);
      return {
        name: e.name,
        path: full,
        mtime: fs.statSync(full).mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

export function getStatusSnapshot() {
  const dateName = runDateFolderName();
  const dayDir = dateOutputDir();
  const dateFolderExists = fs.existsSync(dayDir);

  let catalogRoot = null;
  try {
    catalogRoot = fileInfo(findLatestCatalogFile());
  } catch {
    catalogRoot = null;
  }

  const catalogInDate = fileInfo(findCatalogInDateDir(dayDir));
  const catalog = catalogInDate || catalogRoot;

  const brands = UPLOAD_BRANDS.map((brand) => {
    const brandPath = path.join(dayDir, brand.name, brand.fileName);
    const info = fileInfo(brandPath);
    return {
      name: brand.name,
      fileName: brand.fileName,
      exists: Boolean(info),
      size: info?.size ?? 0,
      sizeMb: info?.sizeMb ?? 0,
      path: brandPath,
    };
  });

  const sheetsExist = brands.some((b) => b.exists);

  return {
    ok: true,
    dateName,
    dayDir,
    dateFolderExists,
    sheetsExist,
    drivePathHint: `Listing Verifier Folder / searsCatalog Data / ${dateName} / [full catalog + brand folders]`,
    catalog,
    catalogRoot,
    catalogInDate,
    brands,
    dateFolders: listDateFolders(),
  };
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing ${name} in .env`);
  }
  return String(value).trim();
}
