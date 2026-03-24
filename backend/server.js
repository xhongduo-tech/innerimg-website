import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { createHostingStore } from "./lib/hosting.js";
import {
  detectImageExt,
  extToMime,
  parseImageDataUrl,
  parseRawBase64,
  extractDataUrlFromMixed,
  bufferToDataUrl,
  guessDimensions,
  buildHtmlImgSnippet,
  buildSvgSnippet,
} from "./lib/imageCodec.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
});

const hosting = createHostingStore(DATA_DIR);

function decodeBase64Payload(raw) {
  let buffer;
  let mime;
  try {
    const p = parseImageDataUrl(raw);
    buffer = p.buffer;
    mime = p.mime;
  } catch {
    buffer = parseRawBase64(raw);
    const det = detectImageExt(buffer);
    mime = det ? extToMime(det) : "image/png";
  }
  const extDet = detectImageExt(buffer);
  let ext = extDet;
  let mimeFinal = mime;
  if (extDet) {
    mimeFinal = extToMime(extDet);
  } else if (mime.includes("svg")) {
    ext = "svg";
    mimeFinal = "image/svg+xml";
  } else {
    const sub = mime.split("/")[1] || "png";
    ext = sub.replace("jpeg", "jpg").replace("+xml", "");
  }
  const dataUrl = bufferToDataUrl(buffer, mimeFinal);
  return { buffer, mime: mimeFinal, ext: ext || "png", dataUrl };
}

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1);

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use(express.json({ limit: "25mb" }));

/* ---------- 页面 ---------- */
app.get("/", (_req, res) => {
  res.render("home", { title: "工作台" });
});

/* ---------- 表单 POST（无 JS） ---------- */
app.post("/form/encode-base64", upload.single("file"), (req, res) => {
  try {
    if (!req.file?.buffer) throw new Error("请选择图片文件");
    const ext = detectImageExt(req.file.buffer);
    if (!ext) throw new Error("无法识别的图像格式");
    const mime = extToMime(ext);
    const dataUrl = bufferToDataUrl(req.file.buffer, mime);
    const rawBase64 = req.file.buffer.toString("base64");
    res.render("result-encode", { dataUrl, rawBase64, ext, error: null });
  } catch (e) {
    res.status(400).render("result-encode", { error: e.message || String(e) });
  }
});

app.post("/form/decode-base64", (req, res) => {
  try {
    const raw = req.body.payload || "";
    const { dataUrl, ext } = decodeBase64Payload(raw);
    res.render("result-decode", { dataUrl, ext, error: null });
  } catch (e) {
    res.status(400).render("result-decode", { error: e.message || String(e) });
  }
});

app.post("/form/html-from-image", upload.single("file"), (req, res) => {
  try {
    if (!req.file?.buffer) throw new Error("请选择图片");
    const ext = detectImageExt(req.file.buffer);
    if (!ext) throw new Error("无法识别的图像格式");
    const mime = extToMime(ext);
    const dataUrl = bufferToDataUrl(req.file.buffer, mime);
    const { w, h } = guessDimensions(req.file.buffer, ext);
    const htmlSnippet = buildHtmlImgSnippet(dataUrl, w, h);
    const svgSnippet = buildSvgSnippet(dataUrl, w, h);
    res.render("result-html", { htmlSnippet, svgSnippet, error: null });
  } catch (e) {
    res.status(400).render("result-html", { error: e.message || String(e) });
  }
});

app.post("/form/parse-html", (req, res) => {
  try {
    const text = req.body.htmlPayload || "";
    const extracted = extractDataUrlFromMixed(text);
    if (!extracted) throw new Error("未找到 data:image…;base64, 片段");
    const { dataUrl, ext } = decodeBase64Payload(extracted);
    res.render("result-parse", { dataUrl, ext, error: null });
  } catch (e) {
    res.status(400).render("result-parse", { error: e.message || String(e) });
  }
});

app.post("/form/host", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) throw new Error("请选择图片");
    const out = await hosting.saveHostedImage(req.file.buffer, req);
    const expiresText = new Date(out.expiresAt).toLocaleString("zh-CN");
    res.render("result-host", { absoluteUrl: out.absoluteUrl, expiresText, error: null });
  } catch (e) {
    res.status(400).render("result-host", { error: e.message || String(e) });
  }
});

/* ---------- JSON API（有 JS / 程序化） ---------- */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/form/encode-base64", upload.single("file"), (req, res) => {
  try {
    if (!req.file?.buffer) throw new Error("请选择图片文件");
    const ext = detectImageExt(req.file.buffer);
    if (!ext) throw new Error("无法识别的图像格式");
    const mime = extToMime(ext);
    const dataUrl = bufferToDataUrl(req.file.buffer, mime);
    const rawBase64 = req.file.buffer.toString("base64");
    res.json({ ok: true, dataUrl, rawBase64, ext });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || String(e) });
  }
});

app.post("/api/form/decode-base64", (req, res) => {
  try {
    const raw = req.body.payload || "";
    const { dataUrl, ext } = decodeBase64Payload(raw);
    res.json({ ok: true, dataUrl, ext });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || String(e) });
  }
});

app.post("/api/form/html-from-image", upload.single("file"), (req, res) => {
  try {
    if (!req.file?.buffer) throw new Error("请选择图片");
    const ext = detectImageExt(req.file.buffer);
    if (!ext) throw new Error("无法识别的图像格式");
    const mime = extToMime(ext);
    const dataUrl = bufferToDataUrl(req.file.buffer, mime);
    const { w, h } = guessDimensions(req.file.buffer, ext);
    res.json({
      ok: true,
      htmlSnippet: buildHtmlImgSnippet(dataUrl, w, h),
      svgSnippet: buildSvgSnippet(dataUrl, w, h),
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || String(e) });
  }
});

app.post("/api/form/parse-html", (req, res) => {
  try {
    const text = req.body.htmlPayload || "";
    const extracted = extractDataUrlFromMixed(text);
    if (!extracted) throw new Error("未找到 data:image…;base64, 片段");
    const { dataUrl, ext } = decodeBase64Payload(extracted);
    res.json({ ok: true, dataUrl, ext });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || String(e) });
  }
});

app.post("/api/form/host", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) throw new Error("请选择图片");
    const out = await hosting.saveHostedImage(req.file.buffer, req);
    const expiresText = new Date(out.expiresAt).toLocaleString("zh-CN");
    res.json({ ok: true, absoluteUrl: out.absoluteUrl, expiresAt: out.expiresAt, expiresText });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || String(e) });
  }
});

/* 兼容旧客户端 */
app.post("/api/host", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: "missing file" });
    const out = await hosting.saveHostedImage(req.file.buffer, req);
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const absoluteUrl = `${proto}://${host}${out.url}`;
    res.json({
      id: out.id,
      url: out.url,
      absoluteUrl,
      expiresAt: out.expiresAt,
      ttlSeconds: out.ttlSeconds,
    });
  } catch (e) {
    res.status(400).json({ error: e.message || String(e) });
  }
});

app.get("/i/:filename", async (req, res) => {
  const got = await hosting.getHostedFile(req.params.filename);
  if (!got) return res.status(404).end();
  res.setHeader("Content-Type", got.mime);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(got.buffer);
});

setInterval(() => hosting.periodicCleanup(), 60 * 60 * 1000);

const port = Number(process.env.PORT) || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`InnerImg listening on ${port}`);
});
