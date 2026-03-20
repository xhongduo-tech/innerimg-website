import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyRequest } from "fastify";
import fs from "node:fs";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { insertHistory, listHistoryByIp, openDb } from "./db.js";
import {
  buildOpenAIVisionRequest,
  curlOpenAIChatCompletions,
  pythonOpenAIChatCompletions,
} from "./openaiTemplate.js";
import { clientIp, safeRelativePath } from "./util.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const uploadDir = process.env.UPLOAD_DIR || path.join(root, "data", "uploads");
const dbPath = process.env.DB_PATH || path.join(root, "data", "innerimg.db");
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(
  /\/$/,
  ""
);
const maxFileMb = Number(process.env.MAX_FILE_MB || 20);
const maxBatchFiles = Number(process.env.MAX_BATCH_FILES || 200);

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const db = openDb(dbPath);
const app = Fastify({
  logger: true,
  trustProxy: true,
  bodyLimit: Math.max(maxFileMb * 1024 * 1024, 2 * 1024 * 1024),
});

function resolveClientIp(req: FastifyRequest): string {
  const direct = typeof req.ip === "string" ? req.ip.trim() : "";
  if (direct) return direct;
  return clientIp(req.headers as Record<string, string | string[] | undefined>);
}

await app.register(cors, { origin: true });
await app.register(rateLimit, {
  max: Number(process.env.RATE_LIMIT_MAX || 200),
  timeWindow: process.env.RATE_LIMIT_WINDOW || "1 minute",
});
await app.register(multipart, {
  limits: {
    fileSize: maxFileMb * 1024 * 1024,
    files: maxBatchFiles + 5,
  },
});

function fullUrlForStoredFile(storedPath: string) {
  const rel = storedPath.split(path.sep).join("/");
  return `${publicBaseUrl}/files/${rel}`;
}

app.get("/health", async () => ({ ok: true }));

app.get("/api/config", async () => ({
  publicBaseUrl,
  maxFileMb,
  maxBatchFiles,
}));

app.get("/api/history", async (req) => {
  const ip = resolveClientIp(req);
  const limit = Math.min(
    200,
    Math.max(1, Number((req.query as { limit?: string }).limit || 50))
  );
  return { ip, items: listHistoryByIp(db, ip, limit) };
});

app.post("/api/llm/openai-chat-vision", async (req, reply) => {
  const ip = resolveClientIp(req);
  const body = req.body as {
    model?: string;
    prompt?: string;
    imageUrl?: string;
    imageUrls?: string[];
    base64?: string;
    mime?: string;
  };

  const model = body.model?.trim() || "gpt-4o";
  const prompt =
    body.prompt?.trim() ||
    "请根据图片内容进行描述，并提取可能对后续工具调用或推理有帮助的结构化要点。";

  const urls: string[] = [];
  if (Array.isArray(body.imageUrls)) {
    for (const u of body.imageUrls) {
      if (typeof u === "string" && u.trim()) urls.push(u.trim());
    }
  }
  if (typeof body.imageUrl === "string" && body.imageUrl.trim()) {
    urls.push(body.imageUrl.trim());
  }

  let dataUrl: string | null = null;
  if (
    urls.length === 0 &&
    typeof body.base64 === "string" &&
    body.base64.trim()
  ) {
    const mime = body.mime?.trim() || "image/png";
    const b64 = body.base64.replace(/\s/g, "");
    dataUrl = `data:${mime};base64,${b64}`;
  }

  if (urls.length === 0 && !dataUrl) {
    return reply
      .code(400)
      .send({ error: "需要至少提供 imageUrl、imageUrls 之一，或 base64+mime" });
  }

  const requestBody = buildOpenAIVisionRequest({
    model,
    prompt,
    imageUrls: urls,
    dataUrl,
  });

  const jsonPretty = JSON.stringify(requestBody, null, 2);
  insertHistory(db, ip, "openai_vision_strategy", {
    model,
    imageCount:
      urls.length + (dataUrl ? 1 : 0),
  });

  return {
    requestBody,
    jsonPretty,
    curl: curlOpenAIChatCompletions(jsonPretty),
    python: pythonOpenAIChatCompletions(requestBody),
  };
});

app.post("/api/convert/image-to-base64", async (req, reply) => {
  const ip = resolveClientIp(req);
  const body = req.body as { dataUrl?: string };
  const dataUrl = body?.dataUrl;
  if (!dataUrl || typeof dataUrl !== "string") {
    return reply.code(400).send({ error: "dataUrl required" });
  }
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!m) {
    return reply.code(400).send({ error: "invalid data URL" });
  }
  const mime = m[1];
  const b64 = m[2];
  insertHistory(db, ip, "image_to_base64", { mime, length: b64.length });
  return { mime, base64: b64 };
});

app.post("/api/convert/base64-to-image", async (req, reply) => {
  const ip = resolveClientIp(req);
  const body = req.body as { base64?: string; mime?: string };
  const rawB64 = body?.base64;
  const mime = body?.mime || "image/png";
  if (!rawB64 || typeof rawB64 !== "string") {
    return reply.code(400).send({ error: "base64 required" });
  }
  const b64 = rawB64.replace(/\s/g, "");
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return reply.code(400).send({ error: "invalid base64" });
  }
  if (buf.length === 0) {
    return reply.code(400).send({ error: "empty image" });
  }
  const ext =
    mime === "image/jpeg" || mime === "image/jpg"
      ? "jpg"
      : mime === "image/webp"
        ? "webp"
        : mime === "image/gif"
          ? "gif"
          : "png";
  const id = nanoid(12);
  const rel = `${id}.${ext}`;
  const dest = path.join(uploadDir, rel);
  await fs.promises.writeFile(dest, buf);
  const url = fullUrlForStoredFile(rel);
  insertHistory(db, ip, "base64_to_image", { url, mime, bytes: buf.length });
  return { url, mime, bytes: buf.length };
});

app.post("/api/upload", async (req, reply) => {
  const ip = resolveClientIp(req);
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: "file required" });
  const ext = path.extname(file.filename || "").slice(0, 16) || ".bin";
  const id = nanoid(14);
  const safeExt = ext.match(/^\.[a-zA-Z0-9]+$/) ? ext : ".bin";
  const rel = `${id}${safeExt}`;
  const dest = path.join(uploadDir, rel);
  await pipeline(file.file, createWriteStream(dest));
  const url = fullUrlForStoredFile(rel);
  insertHistory(db, ip, "upload", {
    url,
    originalName: file.filename,
    bytes: (await fs.promises.stat(dest)).size,
  });
  return { url, originalName: file.filename };
});

app.post("/api/upload/batch", async (req, reply) => {
  const ip = resolveClientIp(req);
  const parts = req.parts();
  const results: {
    url: string;
    originalName: string;
    relativePath?: string;
    bytes: number;
  }[] = [];
  let count = 0;

  for await (const part of parts) {
    if (part.type !== "file") continue;
    if (count >= maxBatchFiles) {
      return reply.code(400).send({
        error: `too many files (max ${maxBatchFiles})`,
        partial: results,
      });
    }
    count += 1;
    const rawName = part.filename || "file";
    const relativePath =
      rawName.includes("/") || rawName.includes("\\")
        ? safeRelativePath(rawName)
        : undefined;

    const ext = path.extname(part.filename || "").slice(0, 16) || ".bin";
    const safeExt = ext.match(/^\.[a-zA-Z0-9]+$/) ? ext : ".bin";
    const id = nanoid(12);
    const baseName = relativePath
      ? path.posix.join(path.posix.dirname(relativePath), `${id}${safeExt}`)
      : `${id}${safeExt}`;

    const dest = path.join(uploadDir, ...baseName.split("/"));
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await pipeline(part.file, createWriteStream(dest));
    const st = await fs.promises.stat(dest);
    const url = fullUrlForStoredFile(baseName);
    results.push({
      url,
      originalName: part.filename,
      relativePath,
      bytes: st.size,
    });
  }

  if (results.length === 0) {
    return reply.code(400).send({ error: "no files" });
  }

  insertHistory(db, ip, "batch_upload", {
    count: results.length,
    files: results.map((r) => ({
      url: r.url,
      originalName: r.originalName,
      relativePath: r.relativePath,
    })),
  });

  return { count: results.length, items: results };
});

await app.register(fastifyStatic, {
  root: uploadDir,
  prefix: "/files/",
  decorateReply: false,
});

const webDistRaw = process.env.WEB_DIST?.trim();
const webDist =
  webDistRaw && fs.existsSync(path.join(webDistRaw, "index.html"))
    ? path.resolve(webDistRaw)
    : null;

if (webDist) {
  await app.register(fastifyStatic, {
    root: webDist,
    prefix: "/",
    decorateReply: false,
  });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.method !== "GET") {
      return reply.code(404).send({ error: "not found" });
    }
    const p = (req.url.split("?")[0] ?? "").split("#")[0];
    if (
      p.startsWith("/api") ||
      p.startsWith("/files/") ||
      p === "/files" ||
      p === "/health"
    ) {
      return reply.code(404).send({ error: "not found" });
    }
    const html = await fs.promises.readFile(
      path.join(webDist, "index.html"),
      "utf8"
    );
    return reply.type("text/html").send(html);
  });
}

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

try {
  await app.listen({ port, host });
  app.log.info(
    { publicBaseUrl, uploadDir, dbPath, webDist },
    "InnerImg server listening"
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
