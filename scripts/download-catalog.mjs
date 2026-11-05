#!/usr/bin/env node
/**
 * Login to Sears Seller Portal and download the full catalog into ./output
 *
 * Usage:
 *   npm run download:catalog
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env") });

const EMAIL = String(process.env.Email || "").trim();
const PASSWORD = String(process.env.Password || "").trim();

const LOGIN_URL = "https://seller.marketplace.sears.com/SellerPortal/d/login.jsp";
const HOME_URL = "https://seller.marketplace.sears.com/SellerPortal/d/home/fbm/home.jsp";
const DOWNLOAD_PAGE_URL =
  "https://seller.marketplace.sears.com/SellerPortal/pages/catalog/download/download.jsp";
const CATALOG_DOWNLOAD_HREF = "/SellerPortal/download?rid=10";

const OUTPUT_DIR = path.join(ROOT, "output");

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function requireCreds() {
  if (!EMAIL || !PASSWORD) {
    console.error("Missing Email or Password in .env");
    process.exit(1);
  }
}

async function login(page) {
  console.log("Opening Sears login page...");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 120000 });

  await page.waitForSelector("#txtEmail", { timeout: 60000 });
  await page.fill("#txtEmail", EMAIL);
  await page.fill("#txtPassword", PASSWORD);

  console.log("Submitting login...");
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login.jsp"), {
      timeout: 120000,
    }),
    page.evaluate(() => {
      if (typeof formSubmit === "function") formSubmit();
      else document.querySelector("a.btn.btn-warning")?.click();
    }),
  ]);

  if (!page.url().includes("/SellerPortal/")) {
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  }

  console.log(`Logged in. Current URL: ${page.url()}`);
}

async function openDownloadPage(page) {
  console.log("Opening Catalog Download page...");
  await page.goto(DOWNLOAD_PAGE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(`a[href="${CATALOG_DOWNLOAD_HREF}"]`, { timeout: 60000 });
  console.log("Catalog Download page ready.");
}

async function downloadCatalog(page, context) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const link = page.locator(`a[href="${CATALOG_DOWNLOAD_HREF}"]`);
  await link.waitFor({ state: "visible", timeout: 60000 });

  console.log('Clicking "Download Catalog"...');

  const downloadPromise = Promise.race([
    page.waitForEvent("download", { timeout: 300000 }),
    context.waitForEvent("download", { timeout: 300000 }),
  ]);

  const popupPromise = context
    .waitForEvent("page", { timeout: 15000 })
    .catch(() => null);

  await link.click();

  const popup = await popupPromise;
  if (popup) {
    console.log("Download opened in a new tab; waiting for file...");
  }

  const download = await downloadPromise;
  const suggested = download.suggestedFilename() || `sears-catalog-${stamp()}.xlsx`;
  const safeName = suggested.replace(/[<>:"/\\|?*]/g, "_");
  const targetPath = path.join(OUTPUT_DIR, safeName);

  await download.saveAs(targetPath);

  console.log(`Saved catalog: ${targetPath}`);
  return targetPath;
}

export async function downloadCatalogMain() {
  requireCreds();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log("Launching real Chrome (headed)...");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  try {
    await login(page);
    await openDownloadPage(page);
    const catalogPath = await downloadCatalog(page, context);
    console.log("Download done.");
    return catalogPath;
  } catch (err) {
    const shot = path.join(OUTPUT_DIR, `error-${stamp()}.png`);
    try {
      await page.screenshot({ path: shot, fullPage: true });
      console.error(`Screenshot saved: ${shot}`);
    } catch {
      // ignore screenshot failures
    }
    throw err;
  } finally {
    await browser.close();
  }
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirect) {
  downloadCatalogMain().catch((err) => {
    console.error(err?.stack || err);
    process.exit(1);
  });
}
