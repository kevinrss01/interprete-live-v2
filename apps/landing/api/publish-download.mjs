import { createHash, timingSafeEqual } from "node:crypto";
import { issueSignedToken, presignUrl } from "@vercel/blob";

const pathname = "Interprete-macOS-arm64.dmg";
const contentType = "application/x-apple-diskimage";

// Only the release workflow can obtain a short-lived upload URL. The store's
// credentials stay on Vercel; the DMG travels directly to Blob, outside Functions.
export function createUploadHandler({
  getSecret = () => process.env.DOWNLOAD_PUBLISH_SECRET,
  issueToken = issueSignedToken,
  signUrl = presignUrl,
} = {}) {
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      response.statusCode = 405;
      return response.end(JSON.stringify({ error: "Method not allowed." }));
    }
    const secret = getSecret();
    const authorization = request.headers.authorization;
    const hash = (value) => createHash("sha256").update(value).digest();
    if (!secret || typeof authorization !== "string" || !timingSafeEqual(hash(authorization), hash(`Bearer ${secret}`))) {
      response.statusCode = 401;
      return response.end(JSON.stringify({ error: "Unauthorized." }));
    }
    try {
      const constraints = {
        pathname,
        validUntil: Date.now() + 10 * 60 * 1000,
        allowedContentTypes: [contentType],
        maximumSizeInBytes: 100 * 1024 * 1024,
      };
      const token = await issueToken({ ...constraints, operations: ["put"] });
      const { presignedUrl } = await signUrl(token, {
        ...constraints,
        operation: "put",
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
      });
      response.statusCode = 200;
      return response.end(JSON.stringify({ uploadUrl: presignedUrl }));
    } catch {
      response.statusCode = 503;
      return response.end(JSON.stringify({ error: "Download publication is unavailable. Retry the release workflow." }));
    }
  };
}

export default createUploadHandler();
