#!/usr/bin/env node
// Xelent API client for this skill. Every image and every listing goes through
// Xelent API (https://api.xelentapi.com); no other image service is used.
//
//   node xelent.mjs login --key sk-...          verify a key and save it (~/.config/xelent/credentials, mode 600)
//   node xelent.mjs check                        verify the saved key; print credits and marketplace connections
//   node xelent.mjs marketplaces                 which marketplaces are connected
//   node xelent.mjs etsy-reference               Etsy shipping / processing / return / partner ids for listings
//   node xelent.mjs etsy-taxonomy "hoodies"      search Etsy category ids
//
// Imported by run.mjs and publish.mjs for generation, assets and listings.
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_BASE = "https://api.xelentapi.com";
const CRED = join(homedir(), ".config", "xelent", "credentials");

/** Only Xelent API hosts (and a local development server) are accepted. */
export function apiBase() {
  const raw = (process.env.XELENT_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`XELENT_API_BASE is not a URL: ${raw}`);
  }
  const host = url.hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  const xelentHost = host === "xelentapi.com" || host.endsWith(".xelentapi.com");
  if (!local && !xelentHost) {
    throw new Error(`This skill only works with Xelent API. ${host} is not a Xelent API host. Unset XELENT_API_BASE or point it at api.xelentapi.com.`);
  }
  if (xelentHost && url.protocol !== "https:") throw new Error("Xelent API must be reached over https.");
  return raw;
}

export function apiKey() {
  const env = process.env.XELENT_API_KEY?.trim();
  if (env) return env;
  if (existsSync(CRED)) {
    const saved = readFileSync(CRED, "utf8").trim();
    if (saved) return saved;
  }
  throw new Error("No Xelent API key. Create one at https://xelentapi.com/dashboard/keys, then run: node xelent.mjs login --key sk-...");
}

export class XelentError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function xelent(path, { method = "GET", body, form, key, timeout = 120_000 } = {}) {
  const base = apiBase(); // throws for anything that is not Xelent API, before a key is ever sent
  const headers = { Authorization: `Bearer ${key ?? apiKey()}` };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(base + path, { method, headers, body: payload, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    throw new XelentError(`Could not reach Xelent API (${e.cause?.code || e.name}).`, 0, "network");
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new XelentError(`Xelent API returned HTTP ${res.status}: ${text.slice(0, 200)}`, res.status, "bad_response");
  }
  if (!res.ok && res.status !== 422) {
    const message = data?.error?.message ?? data?.error ?? `HTTP ${res.status}`;
    throw new XelentError(String(message), res.status, data?.code ?? data?.error?.code ?? "error");
  }
  return data;
}

/** A key counts as a Xelent key only if Xelent API accepts it and answers like Xelent API. */
export async function verifyKey(key) {
  const acct = await xelent("/v1/account", { key });
  if (typeof acct?.balance_credits !== "number") throw new XelentError("That key did not return a Xelent API account.", 401, "not_xelent");
  return acct;
}

// ---------------------------------------------------------------------------
// Generation (used by run.mjs)
// ---------------------------------------------------------------------------

/** Submits one generation in async mode and returns the Xelent generation id. */
export async function submitGeneration({ model, prompt, aspectRatio, imageSize, images }) {
  const body = { model, prompt, aspectRatio, replyType: "async" };
  if (imageSize) body.imageSize = imageSize;
  if (images?.length) body.images = images;
  const r = await xelent("/v1/api/generate", { method: "POST", body, timeout: 180_000 });
  if (!r.id) throw new XelentError(`No generation id: ${JSON.stringify(r).slice(0, 200)}`, 502, "no_id");
  return r.id;
}

export const generationResult = (id) => xelent(`/v1/api/result?id=${encodeURIComponent(id)}`, { timeout: 60_000 });

// ---------------------------------------------------------------------------
// Assets and listings (used by publish.mjs)
// ---------------------------------------------------------------------------

export async function uploadAsset(bytes, name, type) {
  const form = new FormData();
  form.set("file", new Blob([bytes], { type }), name);
  return xelent("/v1/assets", { method: "POST", form, timeout: 180_000 });
}

export const validateListing = (payload) => xelent("/v1/listings/validate", { method: "POST", body: payload });
export const submitListing = (payload) => xelent("/v1/listings", { method: "POST", body: payload, timeout: 300_000 });
export const listingStatus = (id) => xelent(`/v1/listings/${id}`);
export const marketplaces = () => xelent("/v1/marketplaces");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function cli() {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (name) => {
    const i = rest.indexOf(name);
    return i > -1 ? rest[i + 1] : undefined;
  };
  if (cmd === "login") {
    const key = arg("--key")?.trim();
    if (!key) throw new Error("Usage: node xelent.mjs login --key sk-...");
    const acct = await verifyKey(key);
    mkdirSync(dirname(CRED), { recursive: true });
    writeFileSync(CRED, key + "\n", { mode: 0o600 });
    chmodSync(CRED, 0o600);
    console.log(`Saved. Xelent API key works: ${acct.balance_credits} credits available.`);
    return;
  }
  if (cmd === "check") {
    const acct = await verifyKey();
    const m = await marketplaces();
    console.log(
      JSON.stringify(
        {
          api: apiBase(),
          credits: acct.balance_credits,
          held: acct.held_credits,
          alibaba: m.alibaba?.connection?.status === "connected" ? `connected (${m.alibaba.connection.account})` : m.alibaba?.available ? "not connected" : "not available (use the spreadsheet export)",
          etsy: m.etsy?.connection?.status === "connected" ? `connected (${m.etsy.connection.account})` : "not connected",
        },
        null,
        1,
      ),
    );
    return;
  }
  if (cmd === "marketplaces") return console.log(JSON.stringify(await marketplaces(), null, 1));
  if (cmd === "etsy-reference") return console.log(JSON.stringify(await xelent("/v1/marketplaces/etsy/reference"), null, 1));
  if (cmd === "etsy-taxonomy") return console.log(JSON.stringify(await xelent(`/v1/marketplaces/etsy/taxonomy?q=${encodeURIComponent(rest.join(" "))}`), null, 1));
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 11).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli().catch((e) => {
    console.error(`xelent: ${e.message}`);
    process.exit(1);
  });
}
