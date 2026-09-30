#!/usr/bin/env node
// Execute <dir>/jobs.json on Xelent API (nano-banana-2 at 2K). Safe to stop and re-run at any time.
//   node run.mjs --dir D [--concurrency 6] [--size 2K]
//   node run.mjs --dir D --status
// A job is done when its output file exists. Every generation id is written to <dir>/ledger.json before anything
// else, so a re-run polls generations already submitted instead of paying for them again. References go up as
// 1600px JPEG copies (<dir>/refs): full-size PNGs are several MB and time out on a slow uplink.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { apiBase, verifyKey, submitGeneration, generationResult, xelent, XelentError } from "./xelent.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const D = resolve(arg("--dir", "."));
const MODEL = "nano-banana-2";
const SIZE = arg("--size", "2K");
const CONC = +arg("--concurrency", "6");
const MAX_TRIES = 4, MAX_NET = 8, STALE_MIN = 20, POLL_MS = 8000;

const JOBS = JSON.parse(readFileSync(join(D, "jobs.json"), "utf8"));
const LEDGER = join(D, "ledger.json");
const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : {};
for (const j of JOBS) ledger[j.name] ??= { attempts: [] };
const save = () => { writeFileSync(LEDGER + ".tmp", JSON.stringify(ledger, null, 1)); renameSync(LEDGER + ".tmp", LEDGER); };
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (j) => existsSync(j.out);
const last = (j) => ledger[j.name].attempts.at(-1);
const tries = (j) => ledger[j.name].attempts.filter((a) => a.id).length;
const netErrs = (j) => ledger[j.name].attempts.filter((a) => a.status === "neterror").length;
const gaveUp = (j) => tries(j) >= MAX_TRIES || netErrs(j) >= MAX_NET || last(j)?.status === "violation";

function status() {
  const c = { done: 0, running: 0, waiting: 0, failed: 0 };
  const missing = [];
  for (const j of JOBS) {
    if (done(j)) { c.done++; continue; }
    missing.push(j.name);
    if (last(j)?.status === "pending") c.running++;
    else if (gaveUp(j)) c.failed++;
    else c.waiting++;
  }
  return { ...c, total: JOBS.length, missing };
}
if (argv.includes("--status")) { const s = status(); console.log(JSON.stringify({ ...s, missing: s.missing.slice(0, 40) }, null, 1)); process.exit(0); }

// small JPEG copy of a reference: 1600px on the long side, quality 85
function small(p) {
  if (!existsSync(p)) throw new Error("reference not found: " + p);
  const st = statSync(p);
  const out = join(D, "refs", createHash("md5").update(p + st.mtimeMs).digest("hex").slice(0, 12) + "-" + basename(p).replace(/\.\w+$/, "") + ".jpg");
  if (existsSync(out)) return out;
  mkdirSync(join(D, "refs"), { recursive: true });
  try { execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "85", "-Z", "1600", p, "--out", out], { stdio: "ignore" }); }
  catch {
    execFileSync("python3", ["-c", "import sys;from PIL import Image;i=Image.open(sys.argv[1]).convert('RGB');i.thumbnail((1600,1600));i.save(sys.argv[2],quality=85)", p, out]);
  }
  return out;
}

const isNet = (e) => e instanceof XelentError && (e.status === 0 || e.status >= 500 || e.status === 429);

async function submit(j) {
  const at = new Date().toISOString();
  try {
    const images = (j.refs || []).map((r) => "data:image/jpeg;base64," + readFileSync(small(r)).toString("base64"));
    const id = await submitGeneration({ model: MODEL, prompt: j.prompt, aspectRatio: j.aspect || "1:1", imageSize: SIZE, images });
    ledger[j.name].attempts.push({ id, at, status: "pending", model: MODEL, size: SIZE });
    log("submitted", j.name);
  } catch (e) {
    const violation = e instanceof XelentError && e.code === "content_policy_violation";
    ledger[j.name].attempts.push({ id: null, at, status: violation ? "violation" : isNet(e) ? "neterror" : "failed", reason: e.message });
    log(violation ? "REFUSED (content policy; reword the design)" : "submit failed", j.name, e.message);
    if (e instanceof XelentError && (e.status === 401 || e.status === 402 || e.code === "insufficient_credits")) {
      save();
      console.error(`\nStopped: ${e.message}\nTop up at https://xelentapi.com/dashboard/billing, then run this again; finished images are kept.`);
      process.exit(3);
    }
  }
  save();
}

async function poll(j) {
  const a = last(j);
  try {
    const r = await generationResult(a.id);
    if (r.status === "succeeded") {
      const url = r.results?.[0]?.url;
      if (!url) throw new Error("succeeded without a result url");
      const img = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!img.ok) throw new Error("download HTTP " + img.status);
      mkdirSync(dirname(j.out), { recursive: true });
      writeFileSync(j.out + ".part", Buffer.from(await img.arrayBuffer()));
      renameSync(j.out + ".part", j.out);
      a.status = "succeeded"; a.url = url; a.credits = r.credits_used; log("done", j.name);
    } else if (r.status === "failed" || r.status === "violation") {
      a.status = r.status; a.reason = r.error || "unknown"; log(r.status.toUpperCase(), j.name, a.reason);
    } else if (Date.now() - Date.parse(a.at) > STALE_MIN * 60_000) {
      a.status = "stale"; log("stale, will resubmit", j.name);
    }
  } catch (e) { a.lastError = e.message; }
  save();
}

async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()); })); }

// Before paying for anything: the key must be a Xelent API key with enough credits for what is left to do.
const todo = JOBS.filter((j) => !done(j));
if (!todo.length) { log("nothing to generate: every output is already on disk"); process.exit(0); }
const acct = await verifyKey().catch((e) => { console.error(`Xelent API: ${e.message}`); process.exit(1); });
const models = await xelent("/v1/models").catch(() => ({ data: [] }));
const price = models.data?.find((m) => m.id === MODEL)?.credits?.[SIZE] ?? models.data?.find((m) => m.id === MODEL)?.credits?.default ?? 1;
const unsubmitted = todo.filter((j) => last(j)?.status !== "pending").length;
const need = +(unsubmitted * price).toFixed(2);
log(`Xelent API ${apiBase()}: ${acct.balance_credits} credits available; ${todo.length} images to make (${unsubmitted} new, about ${need} credits).`);
if (acct.balance_credits < need) {
  console.error(`Not enough credits: ${need} needed, ${acct.balance_credits} available. Top up at https://xelentapi.com/dashboard/billing or run fewer products (plan.py --only).`);
  process.exit(3);
}
// A key can carry its own spending cap, separate from the balance. Check it too, so a stage never stops halfway.
const cap = acct.key?.spend_limit_credits;
if (cap !== null && cap !== undefined) {
  const left = +(cap - (acct.key.spent_credits ?? 0)).toFixed(2);
  if (left < need) {
    console.error(
      `This API key has ${left} of its ${cap}-credit spending limit left, and this stage needs about ${need} credits (${unsubmitted} images at ${price}). ` +
        `The account balance (${acct.balance_credits} credits) is fine: the limit is on the key. Raise the key's limit to at least ${Math.ceil((acct.key.spent_credits ?? 0) + need)} credits, ` +
        `or remove it, at https://xelentapi.com/dashboard/keys (edit the key "${acct.key.name}"), then run again. Finished images are kept.`,
    );
    process.exit(3);
  }
}

let lastLine = 0;
for (;;) {
  const pending = JOBS.filter((j) => !done(j) && last(j)?.status === "pending");
  if (pending.length) await pool(pending, 8, poll);
  const ready = JOBS.filter((j) => {
    if (done(j)) return false;
    const a = last(j);
    if (a?.status === "pending" || gaveUp(j)) return false;
    if (a?.status === "neterror" && Date.now() - Date.parse(a.at) < 15_000) return false;
    return true;
  });
  const slots = Math.max(0, CONC - JOBS.filter((j) => !done(j) && last(j)?.status === "pending").length);
  if (ready.length && slots) await pool(ready.slice(0, slots), slots, submit);
  const s = status();
  if (Date.now() - lastLine > 60_000 || (!s.running && !s.waiting)) { log(`progress: ${s.done}/${s.total} done, ${s.running} running, ${s.waiting} waiting, ${s.failed} gave up`); lastLine = Date.now(); }
  if (!s.running && !s.waiting) break;
  await sleep(POLL_MS);
}
const s = status();
log(`FINISHED ${s.done}/${s.total}` + (s.missing.length ? `; missing: ${s.missing.join(", ")}` : ""));
process.exit(s.missing.length ? 2 : 0);
