#!/usr/bin/env node
// nainma-blog publish driver.
//
// Self-contained CLI that uploads + publishes blog posts to the live site
// through its built-in MCP server (https://blog.nainma.online/mcp).
//
// It does its OWN OAuth (dynamic client registration + PKCE + refresh token)
// and caches credentials under <repo>/.cache/nainma-cli/ (gitignored), so it
// does NOT depend on Claude Code's MCP client — whose OAuth flow state is lost
// across conversation turns. Authenticate once, reuse forever (auto-refresh).
//
// Usage:
//   node driver.mjs auth-url                 # print authorization URL (step 1)
//   node driver.mjs auth-paste "<callback>"  # finish auth w/ pasted URL (step 2)
//   node driver.mjs auth                      # local-callback auth (same machine)
//   node driver.mjs whoami                    # verify token works (lists 1 post)
//   node driver.mjs list [--status draft]     # list posts
//   node driver.mjs get <id>                  # fetch one post (markdown body)
//   node driver.mjs publish <file.md>         # create+fill+tag+PUBLISH from md
//   node driver.mjs draft <file.md>           # create+fill+tag, keep as DRAFT
//   node driver.mjs delete <id>               # delete a post
//   node driver.mjs smoke                      # full create→publish→delete check
//
// Markdown frontmatter (between --- fences) drives metadata:
//   ---
//   title: My Post
//   slug: my-post            # optional; server generates one if omitted
//   summary: one-liner       # optional
//   tags: react, cloudflare  # optional (comma list or [a, b])
//   status: draft            # optional; `publish` forces published anyway
//   ---
//   # body markdown here

import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const BASE_URL = process.env.NAINMA_BLOG_URL || "https://blog.nainma.online";
const REDIRECT_URI =
  process.env.NAINMA_REDIRECT_URI || "http://localhost:8976/callback";
const SCOPE = "posts:read posts:write offline_access";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Walk up to the repo root (nearest dir with a package.json) for .cache/.
function repoRoot() {
  let d = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(d, "package.json"))) return d;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return process.cwd();
}
const CACHE_DIR = resolve(repoRoot(), ".cache/nainma-cli");
const CLIENT_FILE = resolve(CACHE_DIR, "client.json");
const PENDING_FILE = resolve(CACHE_DIR, "pending.json");
const TOKEN_FILE = resolve(CACHE_DIR, "token.json");

function loadJson(p) {
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}
function saveJson(p, v) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2));
}
function b64url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---- OAuth ---------------------------------------------------------------

async function getClient() {
  const cached = loadJson(CLIENT_FILE);
  if (cached?.client_id) return cached;
  const res = await fetch(`${BASE_URL}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "nainma-blog-cli",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    }),
  });
  if (!res.ok) throw new Error(`client registration failed: ${res.status} ${await res.text()}`);
  const client = await res.json();
  saveJson(CLIENT_FILE, client);
  return client;
}

async function buildAuthUrl() {
  const client = await getClient();
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  saveJson(PENDING_FILE, { verifier, state, redirect_uri: REDIRECT_URI, client_id: client.client_id });
  const u = new URL(`${BASE_URL}/oauth/consent`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", client.client_id);
  u.searchParams.set("redirect_uri", REDIRECT_URI);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("resource", `${BASE_URL}/`);
  return u.toString();
}

async function exchangeCode(code) {
  const pending = loadJson(PENDING_FILE);
  if (!pending) throw new Error("no pending auth; run `auth-url` first");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: pending.redirect_uri,
    client_id: pending.client_id,
    code_verifier: pending.verifier,
  });
  const res = await fetch(`${BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  const tok = await res.json();
  tok.obtained_at = Math.floor(Date.now() / 1000);
  saveJson(TOKEN_FILE, tok);
  rmSync(PENDING_FILE, { force: true });
  return tok;
}

async function refresh(tok) {
  const client = await getClient();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tok.refresh_token,
    client_id: client.client_id,
  });
  const res = await fetch(`${BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`refresh failed: ${res.status} ${await res.text()} — re-run auth-url`);
  const next = await res.json();
  if (!next.refresh_token) next.refresh_token = tok.refresh_token;
  next.obtained_at = Math.floor(Date.now() / 1000);
  saveJson(TOKEN_FILE, next);
  return next;
}

async function accessToken() {
  let tok = loadJson(TOKEN_FILE);
  if (!tok) throw new Error("not authenticated; run `auth-url` then `auth-paste`");
  const age = Math.floor(Date.now() / 1000) - (tok.obtained_at || 0);
  if (tok.expires_in && age > tok.expires_in - 60) {
    if (!tok.refresh_token) throw new Error("token expired and no refresh_token; re-run auth-url");
    tok = await refresh(tok);
  }
  return tok.access_token;
}

function parseCallback(input) {
  // Accept a full URL or a bare code.
  let code = null;
  let state = null;
  try {
    const u = new URL(input);
    code = u.searchParams.get("code");
    state = u.searchParams.get("state");
  } catch {
    code = input.trim();
  }
  if (!code) throw new Error("could not find ?code= in the pasted value");
  const pending = loadJson(PENDING_FILE);
  if (pending && state && state !== pending.state) {
    throw new Error("state mismatch — auth-url and auth-paste are out of sync");
  }
  return code;
}

// ---- MCP (Streamable HTTP) ----------------------------------------------

let MCP_SESSION = null;

async function mcpPost(payload, token) {
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (MCP_SESSION) headers["mcp-session-id"] = MCP_SESSION;
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) MCP_SESSION = sid;
  const text = await res.text();
  if (!res.ok) throw new Error(`MCP ${payload.method} -> ${res.status}: ${text}`);
  if (!text) return null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) {
    // Concatenate all data: lines, return the JSON-RPC message with our id.
    let out = null;
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      try {
        const msg = JSON.parse(t.slice(5).trim());
        if (msg.id === payload.id) out = msg;
      } catch {
        /* skip keep-alive / partials */
      }
    }
    return out;
  }
  return JSON.parse(text);
}

let MCP_READY = false;
async function mcpInit(token) {
  if (MCP_READY) return;
  const init = await mcpPost(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "nainma-blog-cli", version: "1.0.0" },
      },
    },
    token,
  );
  if (init?.error) throw new Error(`initialize: ${JSON.stringify(init.error)}`);
  // notifications/initialized has no id and expects no response body.
  await mcpPost(
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    token,
  ).catch(() => {});
  MCP_READY = true;
}

let RPC_ID = 100;
async function callTool(name, args) {
  const token = await accessToken();
  await mcpInit(token);
  const res = await mcpPost(
    {
      jsonrpc: "2.0",
      id: RPC_ID++,
      method: "tools/call",
      params: { name, arguments: args },
    },
    token,
  );
  if (res?.error) throw new Error(`${name}: ${JSON.stringify(res.error)}`);
  const result = res?.result;
  if (result?.isError) {
    const msg = result.content?.map((c) => c.text).join("\n") || "tool error";
    throw new Error(`${name}: ${msg}`);
  }
  // Prefer structuredContent; fall back to first text block.
  if (result?.structuredContent !== undefined) return result.structuredContent;
  return result?.content?.[0]?.text ?? null;
}

// ---- frontmatter ---------------------------------------------------------

function parseMarkdown(file) {
  const raw = readFileSync(file, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  let body = raw;
  if (m) {
    body = m[2];
    for (const line of m[1].split("\n")) {
      const mm = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (!mm) continue;
      const key = mm[1];
      let val = mm[2].trim();
      if (key === "tags") {
        val = val.replace(/^\[|\]$/g, "");
        meta.tags = val
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      } else {
        meta[key] = val.replace(/^["']|["']$/g, "");
      }
    }
  }
  if (!meta.title) {
    const h1 = body.match(/^#\s+(.+)$/m);
    meta.title = h1 ? h1[1].trim() : "Untitled";
  }
  return { meta, body: body.trim() };
}

// ---- post operations -----------------------------------------------------

async function upsertFromFile(file, { publish }) {
  const { meta, body } = parseMarkdown(file);
  const draft = await callTool("posts_create_draft", {});
  const id = draft.id;
  console.log(`· created draft #${id}`);
  const update = { id, title: meta.title, contentMarkdown: body };
  if (meta.slug) update.slug = meta.slug;
  if (meta.summary) update.summary = meta.summary;
  await callTool("posts_update", update);
  console.log(`· filled "${meta.title}"${meta.slug ? ` (slug: ${meta.slug})` : ""}`);
  if (meta.tags?.length) {
    await callTool("posts_set_tags", { postId: id, tagNames: meta.tags });
    console.log(`· tags: ${meta.tags.join(", ")}`);
  }
  if (publish) {
    const vis = await callTool("posts_set_visibility", { id, visibility: "published" });
    console.log(`· published (status: ${vis.status}, workflow queued: ${vis.workflowQueued})`);
    const slug = (await callTool("posts_get", { id })).slug;
    console.log(`✓ live: ${BASE_URL}/posts/${slug}`);
  } else {
    console.log(`✓ saved as draft #${id} (not published)`);
  }
  return id;
}

// ---- commands ------------------------------------------------------------

const [cmd, ...rest] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case "auth-url": {
      const url = await buildAuthUrl();
      console.log("Open this URL in your browser and authorize:\n");
      console.log(url);
      console.log(
        "\nThe redirect to localhost will fail to load — that's fine.\n" +
          "Copy the full address-bar URL and run:\n" +
          '  node driver.mjs auth-paste "<that URL>"',
      );
      break;
    }
    case "auth-paste": {
      const code = parseCallback(rest.join(" "));
      await exchangeCode(code);
      console.log("✓ authenticated; token cached in .cache/nainma-cli/");
      break;
    }
    case "auth": {
      // Local-callback flow for same-machine use.
      const url = await buildAuthUrl();
      const port = new URL(REDIRECT_URI).port || 80;
      const code = await new Promise((res, rej) => {
        const srv = createServer((req, r) => {
          const q = new URL(req.url, REDIRECT_URI).searchParams;
          r.end("Authorized. You can close this tab.");
          srv.close();
          q.get("code") ? res(q.get("code")) : rej(new Error("no code"));
        });
        srv.listen(Number(port), () => {
          console.log("Open this URL to authorize:\n\n" + url + "\n");
        });
      });
      await exchangeCode(code);
      console.log("✓ authenticated; token cached.");
      break;
    }
    case "whoami": {
      const r = await callTool("posts_list", { limit: 1 });
      console.log("✓ token works. total reachable posts (sample):", r.items?.length ?? 0);
      break;
    }
    case "list": {
      const args = { limit: 20, sortBy: "updatedAt", sortDir: "DESC" };
      const i = rest.indexOf("--status");
      if (i >= 0) args.status = rest[i + 1];
      const r = await callTool("posts_list", args);
      for (const p of r.items)
        console.log(`#${p.id}\t[${p.status}]\t${p.slug}\t${p.title}`);
      break;
    }
    case "get": {
      const p = await callTool("posts_get", { id: Number(rest[0]) });
      console.log(JSON.stringify(p, null, 2));
      break;
    }
    case "publish":
      if (!rest[0]) throw new Error("usage: publish <file.md>");
      await upsertFromFile(resolve(rest[0]), { publish: true });
      break;
    case "draft":
      if (!rest[0]) throw new Error("usage: draft <file.md>");
      await upsertFromFile(resolve(rest[0]), { publish: false });
      break;
    case "delete": {
      const r = await callTool("posts_delete", { id: Number(rest[0]) });
      console.log(`✓ deleted #${r.id} (${r.slug})`);
      break;
    }
    case "smoke": {
      const stamp = rest[0] || String(Date.now());
      const id = await callTool("posts_create_draft", {}).then((d) => d.id);
      console.log(`· created draft #${id}`);
      await callTool("posts_update", {
        id,
        title: `[smoke] driver check ${stamp}`,
        slug: `smoke-driver-${stamp}`,
        summary: "Transient driver smoke test — auto-deleted.",
        contentMarkdown: `# smoke ${stamp}\n\nGenerated by driver.mjs smoke. Safe to ignore.`,
      });
      await callTool("posts_set_tags", { postId: id, tagNames: ["smoke-test"] });
      const vis = await callTool("posts_set_visibility", { id, visibility: "published" });
      console.log(`· published #${id} status=${vis.status} queued=${vis.workflowQueued}`);
      const got = await callTool("posts_get", { id });
      console.log(`· verified slug=${got.slug} status=${got.status}`);
      const del = await callTool("posts_delete", { id });
      console.log(`· cleaned up #${del.id}`);
      console.log("✓ smoke passed: create→update→tag→publish→get→delete");
      break;
    }
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 36).join("\n"));
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
