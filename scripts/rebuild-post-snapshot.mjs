#!/usr/bin/env node
/**
 * 本地重建指定文章的 shiki 高亮快照（posts.public_content_json），
 * 并同步 KV sync hash + 失效 KV/CDN 缓存。
 *
 * 背景：Workers Free plan 的 CPU 限制会让发布 workflow 的
 * "build public content" 步骤在长文/多语言代码块时超时（error 1102），
 * 这个脚本把同样的高亮逻辑放到本地跑，然后直接写回远端 D1。
 * 高亮/遍历逻辑必须与 src/lib/shiki.ts、
 * src/features/posts/utils/content.ts#highlightCodeBlocks、
 * src/features/posts/utils/sync.ts#calculatePostHash 保持一致。
 *
 * 用法（仓库根目录）：node scripts/rebuild-post-snapshot.mjs <postId>
 * 依赖：wrangler 登录态（远端 D1/KV）；CDN purge 凭据读取 .dev.vars（可选）。
 *
 * 注意：直接写 raw SQL，不会触碰 updated_at（符合 CLAUDE.md 的准则）。
 * 文章内容（content_json）有任何改动后都要重跑一次本脚本，否则线上
 * 会一直渲染旧快照。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { create, insert, load, remove, save } from "@orama/orama";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import viteDark from "shiki/themes/vitesse-dark.mjs";
import viteLight from "shiki/themes/vitesse-light.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const postId = Number(process.argv[2]);
if (!postId) {
  console.error("usage: node scripts/rebuild-post-snapshot.mjs <postId>");
  process.exit(1);
}

// ---- wrangler helpers ------------------------------------------------------

function wrangler(args, opts = {}) {
  return execFileSync("bunx", ["wrangler", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}

function d1Json(sql) {
  const out = wrangler([
    "d1",
    "execute",
    "DB",
    "--remote",
    "--json",
    "--command",
    sql,
  ]);
  return JSON.parse(out)[0].results;
}

const kvId = (() => {
  const cfg = readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8");
  const m = cfg.match(/"binding":\s*"KV"[\s\S]*?"id":\s*"([0-9a-f]+)"/);
  if (!m) throw new Error("KV namespace id not found in wrangler.jsonc");
  return m[1];
})();

function kv(args, allowFail = false) {
  try {
    return wrangler(["kv", "key", ...args, "--namespace-id", kvId, "--remote"]);
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

// ---- 1. fetch post ---------------------------------------------------------

const rows = d1Json(
  `SELECT title, summary, slug, content_json, published_at, pinned_at,
          read_time_in_minutes, cover_image_key
   FROM posts WHERE id = ${postId}`,
);
if (!rows.length) {
  console.error(`post ${postId} not found`);
  process.exit(1);
}
const post = rows[0];
const contentJson = JSON.parse(post.content_json);
const tagIds = d1Json(
  `SELECT tag_id FROM post_tags WHERE post_id = ${postId}`,
).map((r) => r.tag_id);
console.log(`· post #${postId} "${post.title}" (slug: ${post.slug})`);

// ---- 2. highlight（与 src/lib/shiki.ts 保持一致） ---------------------------

const themes = { light: "vitesse-light", dark: "vitesse-dark" };
const aliases = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yml: "yaml",
  md: "markdown",
};
const customViteDark = { ...viteDark, bg: "#18181b", name: "vitesse-dark" };
const highlighter = await createHighlighterCore({
  themes: [customViteDark, viteLight],
  langs: [],
  engine: createJavaScriptRegexEngine(),
});

async function loadLanguage(lang) {
  const normalized = aliases[lang] || lang;
  if (highlighter.getLoadedLanguages().includes(normalized)) return;
  try {
    const mod = await import(`shiki/langs/${normalized}.mjs`);
    await highlighter.loadLanguage(...mod.default);
  } catch {
    // 未知语言 → 走 text fallback
  }
}

async function highlight(code, lang) {
  await loadLanguage(lang);
  const normalized = aliases[lang] || lang;
  const safeLang = highlighter.getLoadedLanguages().includes(normalized)
    ? normalized
    : "text";
  return highlighter.codeToHtml(code, {
    lang: safeLang,
    themes: { dark: themes.dark, light: themes.light },
  });
}

const publicContent = structuredClone(contentJson);
let blockCount = 0;
async function traverse(node) {
  if (node.type === "codeBlock") {
    const lang = node.attrs?.language || "text";
    if (lang !== "mermaid") {
      const code = node.content?.map((n) => n.text || "").join("") || "";
      const html = await highlight(code.trim(), lang);
      node.attrs = { ...node.attrs, highlightedHtml: html };
      blockCount++;
    }
  }
  if (node.content) await Promise.all(node.content.map(traverse));
}
await traverse(publicContent);
console.log(`· highlighted ${blockCount} code blocks`);

// ---- 3. chunked UPDATE（D1 单条 SQL 有长度上限） -----------------------------

const json = JSON.stringify(publicContent);
const CHUNK = 40_000;
const chunks = [];
for (let i = 0; i < json.length; ) {
  let end = Math.min(i + CHUNK, json.length);
  // 不要在 UTF-16 代理对中间切开
  if (end < json.length && json.charCodeAt(end - 1) >= 0xd800 && json.charCodeAt(end - 1) <= 0xdbff) {
    end--;
  }
  chunks.push(json.slice(i, end));
  i = end;
}
const esc = (s) => s.replace(/'/g, "''");
const stmts = chunks.map((c, i) =>
  i === 0
    ? `UPDATE posts SET public_content_json = '${esc(c)}' WHERE id = ${postId};`
    : `UPDATE posts SET public_content_json = public_content_json || '${esc(c)}' WHERE id = ${postId};`,
);
const sqlFile = join(mkdtempSync(join(tmpdir(), "snap-")), "update.sql");
writeFileSync(sqlFile, stmts.join("\n"));
wrangler(["d1", "execute", "DB", "--remote", "--file", sqlFile]);

const [check] = d1Json(
  `SELECT length(public_content_json) AS len FROM posts WHERE id = ${postId}`,
);
if (check.len !== json.length) {
  console.error(`✗ snapshot length mismatch: db=${check.len} local=${json.length}`);
  process.exit(1);
}
console.log(`· snapshot written (${json.length} bytes, verified)`);

// ---- 4. sync hash（与 utils/sync.ts#calculatePostHash 一致） -----------------

const toISO = (epoch) =>
  epoch === null || epoch === undefined
    ? null
    : new Date(epoch * 1000).toISOString();
const stateToHash = {
  title: post.title,
  contentJson,
  summary: post.summary,
  tagIds: [...tagIds].sort(),
  slug: post.slug,
  publishedAt: toISO(post.published_at),
  pinnedAt: toISO(post.pinned_at),
  readTimeInMinutes: post.read_time_in_minutes,
  coverImageKey: post.cover_image_key ?? null,
};
const hash = createHash("sha256")
  .update(JSON.stringify(stateToHash))
  .digest("hex");
kv(["put", `post_hash:${postId}`, hash]);
console.log(`· sync hash written: ${hash.slice(0, 12)}…`);

// ---- 5. 失效 KV 缓存（对齐 workflows/helpers.ts#invalidatePostCaches） -------

const detailVerRaw = (kv(["get", "ver:posts:detail"], true) || "").trim();
const detailVer = /^\d+$/.test(detailVerRaw) ? `v${detailVerRaw}` : "v1";
kv(["delete", `${detailVer}:post:${post.slug}`], true);
const listVerRaw = (kv(["get", "ver:posts:list"], true) || "").trim();
const nextList = /^\d+$/.test(listVerRaw) ? Number(listVerRaw) + 1 : 1;
kv(["put", "ver:posts:list", String(nextList)]);
kv(["delete", "public:tags:list"], true);
console.log(`· KV caches invalidated (detail ${detailVer}, list ver → ${nextList})`);

// ---- 6. CDN purge（对齐 lib/invalidate.ts#purgePostCDNCache，凭据取 .dev.vars）

try {
  const devVars = readFileSync(join(repoRoot, ".dev.vars"), "utf8");
  const getVar = (k) => devVars.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
  const zone = getVar("CLOUDFLARE_ZONE_ID");
  const token = getVar("CLOUDFLARE_PURGE_API_TOKEN");
  const domain = getVar("CDN_DOMAIN") || getVar("DOMAIN");
  if (zone && token && domain) {
    const base = `https://${domain}`;
    const files = [
      `/post/${post.slug}`,
      `/api/post/${post.slug}`,
      `/api/post/${post.slug}/related`,
      "/api/tags",
    ].flatMap((p) => [`${base}${p}`, `${base}${p}/`]);
    files.push(`${base}/`);
    const prefixes = ["/posts", "/api/posts", "/search", "/api/search"].map(
      (p) => `${domain}${p}`,
    );
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ files, prefixes }),
      },
    );
    const body = await res.json();
    console.log(`· CDN purge: ${body.success ? "ok" : JSON.stringify(body.errors)}`);
  } else {
    console.log("· CDN purge skipped (.dev.vars 缺少 zone/token/domain)");
  }
} catch (e) {
  console.log(`· CDN purge skipped: ${e.message}`);
}

// ---- 7. 搜索索引 upsert（对齐 search.service.ts#upsert + model/store.ts） ------
// workflow 跳过路径不会更新索引，这里本地补齐。

const CONTENT_SLICE = 10000;
const SNIPPET_SLICE = 200;

function convertToPlainText(doc) {
  if (!doc) return "";
  const parts = [];
  const blocks = new Set([
    "paragraph",
    "heading",
    "codeBlock",
    "blockquote",
    "listItem",
    "bulletList",
    "orderedList",
  ]);
  (function traverse(node) {
    if (node.type === "text" && node.text) parts.push(node.text);
    else if (node.type === "image" && node.attrs?.alt)
      parts.push(` ${node.attrs.alt} `);
    if (Array.isArray(node.content)) node.content.forEach(traverse);
    if (blocks.has(node.type || "")) parts.push("\n");
  })(doc);
  return parts.join("").replace(/\n+/g, "\n").trim();
}

const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
const tokenizer = {
  language: "chinese",
  tokenize: (text) =>
    Array.from(segmenter.segment(text))
      .filter((x) => x.isWordLike)
      .map((x) => x.segment.toLowerCase()),
  normalizationCache: new Map(),
};
const searchSchema = {
  id: "string",
  slug: "string",
  title: "string",
  summary: "string",
  content: "string",
  tags: "string[]",
};

const SEARCH_KEY = "search:index:v3";
const SEARCH_META_KEY = "search:index:meta:v3";
const searchDb = await create({
  schema: searchSchema,
  components: { tokenizer },
});
const rawIndex = execFileSync(
  "bunx",
  ["wrangler", "kv", "key", "get", SEARCH_KEY, "--namespace-id", kvId, "--remote"],
  { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024 },
);
if (rawIndex.length) {
  let rawData;
  try {
    rawData = JSON.parse(gunzipSync(rawIndex).toString("utf8"));
  } catch {
    rawData = JSON.parse(rawIndex.toString("utf8"));
  }
  await load(searchDb, rawData);
}

const tagNames = d1Json(
  `SELECT t.name AS name FROM tags t
   JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ${postId}`,
).map((r) => r.name);
try {
  await remove(searchDb, String(postId));
} catch {}
const plain = convertToPlainText(contentJson);
const contentSlice =
  plain.length > CONTENT_SLICE ? plain.slice(0, CONTENT_SLICE) : plain;
await insert(searchDb, {
  id: String(postId),
  slug: post.slug,
  title: post.title,
  summary:
    post.summary && post.summary.trim().length > 0
      ? post.summary
      : contentSlice.slice(0, SNIPPET_SLICE),
  content: contentSlice,
  tags: tagNames,
});

const compressed = gzipSync(Buffer.from(JSON.stringify(save(searchDb)), "utf8"));
const idxFile = join(mkdtempSync(join(tmpdir(), "idx-")), "index.gz");
writeFileSync(idxFile, compressed);
kv(["put", SEARCH_KEY, "--path", idxFile]);
kv([
  "put",
  SEARCH_META_KEY,
  JSON.stringify({
    version: Date.now().toString(),
    updatedAt: new Date().toISOString(),
    sizeInBytes: compressed.byteLength,
  }),
]);
console.log(`· search index upserted (${tagNames.join("/")}, ${compressed.byteLength} bytes)`);

console.log("✓ done");
