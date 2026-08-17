import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

export async function staticAsset(clientDirectory, requestUrl) {
  const url = new URL(requestUrl, "http://127.0.0.1");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname === "/" || pathname.endsWith("/")) return null;

  const root = path.resolve(clientDirectory);
  const target = path.resolve(root, `.${pathname}`);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;

  try {
    const details = await stat(target);
    if (!details.isFile()) return null;
    return {
      path: target,
      size: details.size,
      contentType:
        CONTENT_TYPES.get(path.extname(target).toLowerCase()) ||
        "application/octet-stream",
      cacheControl: pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function serveStaticAsset(request, response, clientDirectory, securityHeaders = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const asset = await staticAsset(clientDirectory, request.url || "/");
  if (!asset) return false;
  response.writeHead(200, {
    ...securityHeaders,
    "cache-control": asset.cacheControl,
    "content-length": String(asset.size),
    "content-type": asset.contentType,
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(asset.path).pipe(response);
  return true;
}
