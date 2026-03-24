/** 图像魔数、Data URL、HTML 片段解析（服务端与表单逻辑共用） */

export function detectImageExt(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.subarray(0, 8).equals(png)) return "png";
  if (buf.subarray(0, 3).toString("ascii") === "GIF") return "gif";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "webp";
  }
  const head = buf.subarray(0, Math.min(buf.length, 8192)).toString("utf8");
  if (/<svg[\s>]/i.test(head)) return "svg";
  return null;
}

export function extToMime(ext) {
  if (ext === "svg") return "image/svg+xml";
  if (ext === "jpg") return "image/jpeg";
  return `image/${ext}`;
}

export function normalizeBase64Payload(b64) {
  let t = String(b64).replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = t.length % 4;
  if (pad) t += "=".repeat(4 - pad);
  return t;
}

/** @returns {{ mime: string, buffer: Buffer }} */
export function parseImageDataUrl(raw) {
  const s = String(raw).trim().replace(/\uFEFF/g, "").replace(/\s/g, "");
  const lower = s.toLowerCase();
  if (!lower.startsWith("data:image")) {
    throw new Error("需要以 data:image 开头的 Data URL，或改用「纯 Base64」模式粘贴");
  }
  const idx = lower.indexOf(";base64,");
  if (idx === -1) throw new Error("未找到 ;base64, 片段");
  const mimeMatch = s.match(/^data:(image\/[a-z0-9.+-]+)/i);
  const mime = mimeMatch ? mimeMatch[1].toLowerCase() : "image/png";
  const payload = normalizeBase64Payload(s.slice(idx + ";base64,".length));
  if (!payload) throw new Error("Base64 正文为空");
  let buffer;
  try {
    buffer = Buffer.from(payload, "base64");
  } catch {
    throw new Error("Base64 解码失败");
  }
  if (!buffer.length) throw new Error("解码后数据为空");
  return { mime, buffer };
}

/** 纯 Base64（无前缀）→ buffer，默认按 PNG */
export function parseRawBase64(raw) {
  const s = String(raw).trim().replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/=_-]+$/.test(s) || s.length < 16) {
    throw new Error("纯 Base64 格式不正确或过短");
  }
  const payload = normalizeBase64Payload(s);
  return Buffer.from(payload, "base64");
}

export function pngDimensions(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

export function guessDimensions(buf, ext) {
  if (ext === "png") {
    const d = pngDimensions(buf);
    if (d) return d;
  }
  return { w: 320, h: 200 };
}

export function extractDataUrlFromMixed(text) {
  const trimmed = String(text).trim();
  const direct = trimmed.match(/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=\s_-]+/i);
  if (direct) return direct[0].replace(/\s/g, "");

  const attr = trimmed.match(/(?:src|href)\s*=\s*["'](data:image\/[^"']+)["']/i);
  if (attr?.[1]) return attr[1].replace(/\s/g, "");

  const svgImg = trimmed.match(/<image[^>]+(?:href|xlink:href)\s*=\s*["'](data:image\/[^"']+)["']/i);
  if (svgImg?.[1]) return svgImg[1].replace(/\s/g, "");

  return null;
}

export function bufferToDataUrl(buffer, mime) {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

export function buildHtmlImgSnippet(dataUrl, w, h) {
  return `<img src="${dataUrl}" alt="" width="${w}" height="${h}" />`;
}

export function buildSvgSnippet(dataUrl, w, h) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<image href='${dataUrl}' width="${w}" height="${h}" /></svg>`
  );
}
