const UNSAFE = /[^a-zA-Z0-9._/-]/g;

/** Resolve relative path segments; drop traversal; no absolute paths. */
export function safeRelativePath(raw: string): string {
  const s = raw.trim().replace(/\\/g, "/");
  if (s.startsWith("/") || s.includes("\0")) return "_invalid";
  const segments = s.split("/").filter(Boolean);
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === "..") {
      if (out.length) out.pop();
      continue;
    }
    if (seg === ".") continue;
    out.push(seg.replace(UNSAFE, "_"));
  }
  return out.join("/") || "_file";
}

export function clientIp(headers: Record<string, string | string[] | undefined>): string {
  const xf = headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) {
    return xf.split(",")[0]?.trim() || "unknown";
  }
  return "unknown";
}
