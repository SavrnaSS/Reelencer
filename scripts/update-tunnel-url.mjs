import fs from "node:fs";
import path from "node:path";

const logPath = "/tmp/cloudflared.log";
const wranglerPath = path.resolve("wrangler.toml");

if (!fs.existsSync(logPath)) {
  console.error(`Missing ${logPath}. Is cloudflared running?`);
  process.exit(1);
}

const log = fs.readFileSync(logPath, "utf8");
const urlMatch = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
if (!urlMatch) {
  console.error("No trycloudflare URL found in cloudflared log.");
  process.exit(1);
}

const baseUrl = urlMatch[0];
const ingestUrl = `${baseUrl}/api/gig-inbox/ingest`;

if (!fs.existsSync(wranglerPath)) {
  console.error("Missing wrangler.toml");
  process.exit(1);
}

let wrangler = fs.readFileSync(wranglerPath, "utf8");
if (!wrangler.includes("GIG_INGEST_URL")) {
  console.error("GIG_INGEST_URL not found in wrangler.toml");
  process.exit(1);
}

wrangler = wrangler.replace(
  /GIG_INGEST_URL\s*=\s*".*?"/,
  `GIG_INGEST_URL = "${ingestUrl}"`
);

fs.writeFileSync(wranglerPath, wrangler, "utf8");
console.log(`Updated GIG_INGEST_URL to ${ingestUrl}`);
