import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { detectImageExt, extToMime } from "./imageCodec.js";

const DEFAULT_TTL_SEC = 2 * 60 * 60;
const MAX_TTL_SEC = 30 * 24 * 60 * 60;

export function getDefaultTtl() {
  return DEFAULT_TTL_SEC;
}

export function getMaxTtl() {
  return MAX_TTL_SEC;
}

export function parseTtlSeconds(body) {
  let ttlSec = parseInt(body?.ttlSeconds ?? body?.ttl ?? "", 10);
  if (Number.isNaN(ttlSec) || ttlSec < 60) ttlSec = DEFAULT_TTL_SEC;
  return Math.min(Math.max(ttlSec, 60), MAX_TTL_SEC);
}

export function createHostingStore(dataDir) {
  const metaFile = path.join(dataDir, "meta.json");

  async function loadMeta() {
    try {
      const raw = await fs.readFile(metaFile, "utf8");
      const j = JSON.parse(raw);
      return typeof j === "object" && j !== null ? j : {};
    } catch {
      return {};
    }
  }

  async function saveMeta(meta) {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(metaFile, JSON.stringify(meta, null, 2), "utf8");
  }

  async function cleanupExpired(meta) {
    const now = Date.now();
    let changed = false;
    for (const id of Object.keys(meta)) {
      const m = meta[id];
      if (!m || typeof m.expiresAt !== "number") {
        delete meta[id];
        changed = true;
        continue;
      }
      if (m.expiresAt <= now) {
        const fp = m.filePath;
        delete meta[id];
        changed = true;
        if (fp) {
          try {
            await fs.unlink(fp);
          } catch {
            /* ignore */
          }
        }
      }
    }
    if (changed) await saveMeta(meta);
    return meta;
  }

  async function saveHostedImage(buffer, req) {
    let meta = await loadMeta();
    meta = await cleanupExpired(meta);

    const ext = detectImageExt(buffer);
    if (!ext) throw new Error("unsupported or invalid image");

    const id = uuidv4();
    const uploadsDir = path.join(dataDir, "uploads");
    await fs.mkdir(uploadsDir, { recursive: true });
    const filePath = path.join(uploadsDir, `${id}.${ext}`);
    await fs.writeFile(filePath, buffer);

    const ttlSec = parseTtlSeconds(req.body);
    const expiresAt = Date.now() + ttlSec * 1000;
    meta[id] = {
      filePath,
      mime: extToMime(ext),
      expiresAt,
    };
    await saveMeta(meta);

    const base = req.headers["x-forwarded-prefix"] || "";
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const publicPath = `${base}/i/${id}.${ext}`;
    const absoluteUrl = `${proto}://${host}${publicPath}`;

    return {
      id,
      ext,
      url: publicPath,
      absoluteUrl,
      expiresAt,
      ttlSeconds: ttlSec,
    };
  }

  async function getHostedFile(filename) {
    if (!/^[a-f0-9-]{36}\.(jpg|png|gif|webp|svg)$/i.test(filename)) {
      return null;
    }
    const id = filename.replace(/\.[^.]+$/, "");
    let meta = await loadMeta();
    meta = await cleanupExpired(meta);
    const m = meta[id];
    if (!m || m.expiresAt <= Date.now()) return null;
    try {
      const buf = await fs.readFile(m.filePath);
      return { buffer: buf, mime: m.mime || "application/octet-stream" };
    } catch {
      return null;
    }
  }

  async function periodicCleanup() {
    try {
      let meta = await loadMeta();
      await cleanupExpired(meta);
    } catch {
      /* ignore */
    }
  }

  return {
    loadMeta,
    saveHostedImage,
    getHostedFile,
    periodicCleanup,
  };
}
