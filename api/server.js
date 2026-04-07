"use strict";

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sharp = require("sharp");

const MAX_BODY = "48mb";
const MAX_FILE = 40 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE },
});

const app = express();
app.use(cors());
app.use(express.json({ limit: MAX_BODY }));

const api = express.Router();

api.get("/health", function (req, res) {
  res.json({ ok: true, service: "innerimg-api" });
});

api.get("/", function (req, res) {
  res.json({
    service: "innerimg-api",
    note:
      "HTML 转位图依赖浏览器布局引擎，本服务不提供 html→png；请用站点页面或自建 Puppeteer。",
    endpoints: [
      { method: "POST", path: "/api/image/to-base64", desc: "multipart 字段 file，返回 JSON base64 / dataUrl" },
      { method: "POST", path: "/api/base64/to-image", desc: "JSON { dataUrl } 或 { base64 }，返回解码后的图片二进制" },
      { method: "POST", path: "/api/svg/to-png", desc: "JSON { svg }，可选 width、height，返回 PNG" },
      { method: "POST", path: "/api/image/to-svg-wrap", desc: "multipart file，可选 width、height，返回嵌入位图的 SVG" },
      { method: "POST", path: "/api/image/compress", desc: "multipart file，可选 maxEdge(默认1920)、format(webp|jpeg|png)" },
      { method: "POST", path: "/api/image/convert", desc: "multipart file，format(png|jpeg|webp|avif)，可选 maxEdge、quality" },
    ],
  });
});

function parseBase64Input(input) {
  const str = String(input).trim();
  if (/^data:/i.test(str)) {
    const m = str.match(/^data:([^;]+);base64,(.+)$/is);
    if (!m) {
      throw new Error("无效的 data URL");
    }
    return {
      mime: m[1].split(";")[0].trim(),
      buf: Buffer.from(m[2].replace(/\s/g, ""), "base64"),
    };
  }
  return {
    mime: "application/octet-stream",
    buf: Buffer.from(str.replace(/\s/g, ""), "base64"),
  };
}

api.post("/image/to-base64", upload.single("file"), function (req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "缺少 multipart 文件字段 file" });
    }
    const mime = req.file.mimetype || "image/png";
    const b64 = req.file.buffer.toString("base64");
    res.json({
      mimeType: mime,
      base64: b64,
      dataUrl: "data:" + mime + ";base64," + b64,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

api.post("/base64/to-image", async function (req, res) {
  try {
    const raw = req.body.dataUrl || req.body.base64;
    if (!raw) {
      return res.status(400).json({ error: "请提供 JSON 字段 dataUrl 或 base64" });
    }
    const { mime, buf } = parseBase64Input(raw);
    await sharp(buf).metadata();
    res.set("Content-Type", mime.indexOf("image/") === 0 ? mime : "image/png");
    res.send(buf);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

api.post("/svg/to-png", async function (req, res) {
  try {
    const svg = req.body.svg;
    if (!svg || typeof svg !== "string") {
      return res.status(400).json({ error: "请提供 JSON 字段 svg（字符串）" });
    }
    const bufIn = Buffer.from(svg, "utf8");
    const meta = await sharp(bufIn).metadata();
    let w = parseInt(req.body.width, 10) || meta.width;
    let h = parseInt(req.body.height, 10) || meta.height;
    let img = sharp(bufIn, { density: 192 });
    if (w > 0 && h > 0) {
      img = img.resize(w, h, { fit: "fill" });
    }
    const out = await img.png().toBuffer();
    res.type("image/png").send(out);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

api.post("/image/to-svg-wrap", upload.single("file"), function (req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "缺少 multipart 文件字段 file" });
    }
    const mime = req.file.mimetype || "image/png";
    const w = Math.min(8192, Math.max(1, parseInt(req.body.width, 10) || 800));
    const h = Math.min(8192, Math.max(1, parseInt(req.body.height, 10) || 600));
    const b64 = req.file.buffer.toString("base64");
    const svg =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'width="' +
      w +
      '" height="' +
      h +
      '" viewBox="0 0 ' +
      w +
      " " +
      h +
      '">' +
      '<image href="data:' +
      mime +
      ";base64," +
      b64 +
      '" xlink:href="data:' +
      mime +
      ";base64," +
      b64 +
      '" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"/>' +
      "</svg>";
    res.type("image/svg+xml; charset=utf-8").send(svg);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

api.post("/image/convert", upload.single("file"), async function (req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "缺少 multipart 文件字段 file" });
    }
    const format = String(req.body.format || "png").toLowerCase().replace(/^jpg$/, "jpeg");
    const quality = Math.min(100, Math.max(1, parseInt(req.body.quality, 10) || 85));
    const maxEdgeRaw = req.body.maxEdge;
    let img = sharp(req.file.buffer);
    const meta = await img.metadata();
    if (maxEdgeRaw !== undefined && maxEdgeRaw !== "" && maxEdgeRaw !== null) {
      const maxEdge = parseInt(maxEdgeRaw, 10);
      if (!isNaN(maxEdge) && maxEdge > 0) {
        const cap = Math.min(8192, Math.max(32, maxEdge));
        const mw = meta.width || cap;
        const mh = meta.height || cap;
        const scale = Math.min(1, cap / Math.max(mw, mh));
        const tw = Math.max(1, Math.round(mw * scale));
        const th = Math.max(1, Math.round(mh * scale));
        img = img.resize(tw, th, { fit: "inside" });
      }
    }
    let buf;
    let ct;
    if (format === "jpeg" || format === "jpg") {
      buf = await img.jpeg({ quality, mozjpeg: true }).toBuffer();
      ct = "image/jpeg";
    } else if (format === "png") {
      buf = await img.png({ compressionLevel: 9 }).toBuffer();
      ct = "image/png";
    } else if (format === "webp") {
      buf = await img.webp({ quality }).toBuffer();
      ct = "image/webp";
    } else if (format === "avif") {
      buf = await img.avif({ quality }).toBuffer();
      ct = "image/avif";
    } else {
      return res.status(400).json({ error: "不支持的 format，请使用 png、jpeg、webp、avif" });
    }
    res.type(ct).send(buf);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

api.post("/image/compress", upload.single("file"), async function (req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "缺少 multipart 文件字段 file" });
    }
    const maxEdge = Math.min(8192, Math.max(64, parseInt(req.body.maxEdge, 10) || 1920));
    const format = String(req.body.format || "webp").toLowerCase();
    let img = sharp(req.file.buffer);
    const meta = await img.metadata();
    const mw = meta.width || maxEdge;
    const mh = meta.height || maxEdge;
    const scale = Math.min(1, maxEdge / Math.max(mw, mh));
    const tw = Math.max(1, Math.round(mw * scale));
    const th = Math.max(1, Math.round(mh * scale));
    img = img.resize(tw, th, { fit: "inside" });
    let buf;
    let ct;
    if (format === "jpeg" || format === "jpg") {
      buf = await img.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
      ct = "image/jpeg";
    } else if (format === "png") {
      buf = await img.png({ compressionLevel: 9 }).toBuffer();
      ct = "image/png";
    } else {
      buf = await img.webp({ quality: 80 }).toBuffer();
      ct = "image/webp";
    }
    res.type(ct).send(buf);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

api.post("/html/to-png", function (req, res) {
  res.status(501).json({
    error: "未实现",
    hint: "HTML 渲染为位图需要无头浏览器（如 Puppeteer）。请使用本站页面的「HTML → 图片」在浏览器内完成。",
  });
});

app.use("/api", api);

app.use(function (err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "文件超过大小限制（最大 40MB）" });
    }
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

const port = parseInt(process.env.PORT, 10) || 3000;
app.listen(port, "0.0.0.0", function () {
  console.log("innerimg-api listening on " + port);
});
