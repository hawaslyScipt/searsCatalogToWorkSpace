#!/usr/bin/env node
/**
 * Filter Sears catalog into brand sheets under output/DD-MM-YYYY/<Brand>/
 * Unmatched rows go to Others/Others.xlsx.
 *
 * Usage:
 *   npm run split:brands
 *   npm run split:brands -- --file "output/Published Items.csv"
 */
import fs from "node:fs";
import path from "node:path";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse";
import ExcelJS from "exceljs";
import {
  BRANDS,
  OTHERS_BRAND,
  OUTPUT_DIR,
  dateOutputDir,
  findLatestCatalogFile,
  normalizeItemId,
  runDateFolderName,
} from "./lib/shared.mjs";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? String(process.argv[i + 1] || "").trim() : "";
}

async function collectBrandRows(catalogPath) {
  const buckets = Object.fromEntries(BRANDS.map((b) => [b.name, []]));
  buckets[OTHERS_BRAND.name] = [];
  let headers = null;
  let total = 0;
  let matched = 0;

  const parser = createReadStream(catalogPath).pipe(
    parse({
      columns: true,
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    })
  );

  for await (const record of parser) {
    total += 1;
    if (!headers) headers = Object.keys(record);

    const itemId = normalizeItemId(record["Item ID"]);
    if (!itemId) {
      buckets[OTHERS_BRAND.name].push(record);
      continue;
    }

    let hit = false;
    for (const brand of BRANDS) {
      if (brand.match(itemId)) {
        buckets[brand.name].push(record);
        matched += 1;
        hit = true;
        break;
      }
    }

    if (!hit) {
      buckets[OTHERS_BRAND.name].push(record);
    }

    if (total % 25000 === 0) {
      console.log(`  scanned ${total} rows...`);
    }
  }

  if (!headers) {
    throw new Error(`Catalog has no data rows: ${catalogPath}`);
  }

  return { headers, buckets, total, matched };
}

async function writeBrandSheet(filePath, headers, rows) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useStyles: false,
    useSharedStrings: false,
  });
  const sheet = workbook.addWorksheet("Catalog");
  sheet.addRow(headers).commit();

  for (const row of rows) {
    sheet.addRow(headers.map((h) => row[h] ?? "")).commit();
  }

  await workbook.commit();
}

export async function splitBrandSheets({ catalogPath } = {}) {
  const source = catalogPath || argValue("--file") || findLatestCatalogFile();
  if (!fs.existsSync(source)) {
    throw new Error(`Catalog file not found: ${source}`);
  }

  const dateName = runDateFolderName();
  const dayDir = dateOutputDir();
  fs.mkdirSync(dayDir, { recursive: true });

  // Keep full downloaded catalog inside the date folder for local + Drive upload
  const catalogFileName = path.basename(source);
  const catalogInDateDir = path.join(dayDir, catalogFileName);
  if (path.resolve(source) !== path.resolve(catalogInDateDir)) {
    fs.copyFileSync(source, catalogInDateDir);
    console.log(`Full catalog copied: ${catalogInDateDir}`);
  }

  console.log(`Catalog: ${source}`);
  console.log(`Date folder: ${dayDir}`);
  console.log("Filtering brand rows...");

  const { headers, buckets, total, matched } = await collectBrandRows(source);
  const othersCount = buckets[OTHERS_BRAND.name].length;

  console.log("");
  console.log("Brand counts:");
  const results = [];

  for (const brand of BRANDS) {
    const rows = buckets[brand.name];
    const brandDir = path.join(dayDir, brand.name);
    fs.mkdirSync(brandDir, { recursive: true });
    const outFile = path.join(brandDir, brand.fileName);

    console.log(`  ${brand.name}: ${rows.length}`);
    await writeBrandSheet(outFile, headers, rows);
    console.log(`    -> ${outFile}`);

    results.push({
      brand: brand.name,
      count: rows.length,
      filePath: outFile,
      folderName: brand.name,
      fileName: brand.fileName,
    });
  }

  // Others (unmatched)
  {
    const rows = buckets[OTHERS_BRAND.name];
    const brandDir = path.join(dayDir, OTHERS_BRAND.name);
    fs.mkdirSync(brandDir, { recursive: true });
    const outFile = path.join(brandDir, OTHERS_BRAND.fileName);

    console.log(`  ${OTHERS_BRAND.name}: ${rows.length}`);
    await writeBrandSheet(outFile, headers, rows);
    console.log(`    -> ${outFile}`);

    results.push({
      brand: OTHERS_BRAND.name,
      count: rows.length,
      filePath: outFile,
      folderName: OTHERS_BRAND.name,
      fileName: OTHERS_BRAND.fileName,
    });
  }

  console.log("");
  console.log(`Scanned rows: ${total}`);
  console.log(`Matched brand rows: ${matched}`);
  console.log(`Unmatched / other: ${othersCount}`);
  console.log(`Sheets ready under output/${dateName}/`);

  return {
    dateName,
    dayDir,
    results,
    total,
    matched,
    others: othersCount,
    catalogPath: catalogInDateDir,
    catalogFileName,
  };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  await splitBrandSheets();
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
