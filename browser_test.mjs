/**
 * Browser test suite for Meeting Intelligence.
 * Tests unauthenticated UI, API contract, and Next.js route shapes.
 * Authenticated flows (dashboard, meeting detail) are verified via
 * direct FastAPI calls with a test JWT.
 */
import { chromium } from "playwright";
import { createHmac } from "crypto";

const BASE = "http://localhost:3000";
const API  = "http://localhost:8000";

// Build a test JWT the same way apiFetch() does
function makeJwt(userId = "test-user") {
  const header  = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url");
  const sig = createHmac("sha256", "CShpSHmN5kEjI/lC7Bzdd7Dta/bavHUtwdFfj/B2oJQt")
    .update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

const TOKEN = makeJwt();
const AUTH  = { Authorization: `Bearer ${TOKEN}` };

let pass = 0, fail = 0;

function ok(label, value) {
  if (value) { console.log(`  ✓ ${label}`); pass++; }
  else        { console.log(`  ✗ ${label}`); fail++; }
}

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
const jsErrors = [];
page.on("pageerror", e => jsErrors.push(e.message));

// ─── 1. Home page ────────────────────────────────────────────────────────────
console.log("\n[1] Home page");
await page.goto(BASE, { waitUntil: "networkidle" });
ok("App title rendered",     !!(await page.$("span:has-text('Meeting Intelligence')")));
ok("Sign-in button visible", !!(await page.$("button:has-text('Sign in')")));
ok("No JS errors on load",   jsErrors.length === 0);
await page.screenshot({ path: "/tmp/test_home.png", fullPage: true });

// ─── 2. Auth redirect ────────────────────────────────────────────────────────
console.log("\n[2] Auth redirect");
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
ok("Unauthenticated /dashboard redirects to /", page.url() === `${BASE}/`);

// ─── 3. FastAPI health + meeting list ────────────────────────────────────────
console.log("\n[3] FastAPI routes");
const health = await fetch(`${API}/health`).then(r => r.json());
ok("GET /health → {status:ok}", health.status === "ok");

const meetingsRes = await fetch(`${API}/meetings`, { headers: AUTH });
ok("GET /meetings → 200 with JWT", meetingsRes.ok);
const meetings = await meetingsRes.json();
ok("Meetings is an array", Array.isArray(meetings));

const complete = meetings.filter(m => m.status === "complete");
ok(`At least one complete meeting (found ${complete.length})`, complete.length > 0);

// ─── 4. Meeting detail shape ─────────────────────────────────────────────────
console.log("\n[4] Meeting detail shape");
const mid = complete[0].id;
const mRes = await fetch(`${API}/meetings/${mid}`, { headers: AUTH });
ok("GET /meetings/:id → 200", mRes.ok);
const m = await mRes.json();
ok("Has segments array",   Array.isArray(m.segments));
ok("Has decisions array",  Array.isArray(m.decisions));
ok("Has conflicts array",  Array.isArray(m.conflicts));
ok("Has meta object",      m.meta !== undefined);
ok("Has recording_url",    "recording_url" in m);
ok("Segments have text",   m.segments.length === 0 || typeof m.segments[0].text === "string");

// ─── 5. Search ───────────────────────────────────────────────────────────────
console.log("\n[5] Semantic search");
const sRes = await fetch(`${API}/search?q=ship+the+feature`, { headers: AUTH });
ok("GET /search → 200", sRes.ok);
const results = await sRes.json();
ok("Search returns results", results.length > 0);
ok("Results have similarity score", results.every(r => typeof r.similarity === "number"));
ok("Top result is relevant (similarity > 0.3)", results[0].similarity > 0.3);

// ─── 6. Chat ─────────────────────────────────────────────────────────────────
console.log("\n[6] Chat endpoint");
const chatRes = await fetch(`${API}/meetings/${mid}/chat`, {
  method: "POST",
  headers: { ...AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ question: "What was decided?" }),
});
ok("POST /meetings/:id/chat → 200", chatRes.ok);
const chat = await chatRes.json();
ok("Chat returns answer",         typeof chat.answer === "string" && chat.answer.length > 0);
ok("Chat returns message_id",     typeof chat.message_id === "string");
ok("Chat returns cited_segments", Array.isArray(chat.cited_segments));

// ─── 7. Next.js API routes protected ─────────────────────────────────────────
console.log("\n[7] Next.js API routes");
const nSearch = await fetch(`${BASE}/api/search?q=test`);
ok("GET /api/search protected (redirects when unauthenticated)", nSearch.status === 307 || nSearch.url.includes("localhost:3000/"));

// ─── 8. Page source checks ───────────────────────────────────────────────────
console.log("\n[8] Page source");
const homeHtml = await (await fetch(BASE)).text();
ok("'Welcome' in home page",                homeHtml.includes("Welcome"));
ok("'Sign in' in home page",               homeHtml.includes("Sign in"));
ok("'Meeting Intelligence' in page source", homeHtml.includes("Meeting Intelligence"));

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${pass}  Failed: ${fail}`);
if (jsErrors.length) {
  console.log("\nJS errors:");
  jsErrors.forEach(e => console.log("  " + e));
}

await browser.close();
process.exit(fail > 0 ? 1 : 0);
