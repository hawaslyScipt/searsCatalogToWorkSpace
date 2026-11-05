#!/usr/bin/env node
/**
 * Full flow:
 *  1) Download Sears catalog (Playwright headed Chrome)
 *  2) Split into brand sheets under output/DD-MM-YYYY/
 *  3) Upload full catalog + brand sheets to
 *     searsCatalog Data (FolderId) / <date> /
 *
 * Usage:
 *   npm run catalog:workspace
 */
import { downloadCatalogMain } from "./download-catalog.mjs";
import { splitBrandSheets } from "./split-brand-sheets.mjs";
import { uploadToWorkspace } from "./upload-to-workspace.mjs";

async function main() {
  console.log("=== 1/3 Download Sears catalog ===");
  const catalogPath = await downloadCatalogMain();

  console.log("");
  console.log("=== 2/3 Split brand sheets ===");
  const split = await splitBrandSheets({ catalogPath });

  console.log("");
  console.log("=== 3/3 Upload to Workspace ===");
  await uploadToWorkspace({ dateName: split.dateName });

  console.log("");
  console.log("Pipeline complete.");
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
