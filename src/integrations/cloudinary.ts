import { createHash } from "node:crypto";
import { cloudinaryEnabled, env } from "../config/env";

/**
 * Cloudinary image hosting. Uploads go straight from the browser to Cloudinary using a short-lived
 * signature minted here, so the API secret never leaves the server.
 */

const FOLDER = "salon-gallery";
const ALLOWED_FORMATS = "jpg,jpeg,png,webp";

const sign = (params: Record<string, string | number>) => {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(toSign + env.CLOUDINARY_API_SECRET).digest("hex");
};

export function createUploadSignature() {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { allowed_formats: ALLOWED_FORMATS, folder: FOLDER, timestamp };
  return {
    cloudName: env.CLOUDINARY_CLOUD_NAME!,
    apiKey: env.CLOUDINARY_API_KEY!,
    ...params,
    signature: sign(params),
  };
}

/** True only for assets that really live in our Cloudinary account and folder. */
export function isOwnAsset(publicId: string, url: string) {
  return (
    cloudinaryEnabled &&
    publicId.startsWith(`${FOLDER}/`) &&
    /^[\w\-/]+$/.test(publicId) &&
    url.startsWith(`https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/`)
  );
}

export async function destroyAsset(publicId: string): Promise<boolean> {
  if (!cloudinaryEnabled) return false;
  const timestamp = Math.floor(Date.now() / 1000);
  const body = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: env.CLOUDINARY_API_KEY!,
    signature: sign({ public_id: publicId, timestamp }),
  });
  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/destroy`, { method: "POST", body, signal: AbortSignal.timeout(15_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Serve a resized, auto-format, auto-quality version (smaller downloads on mobile data). */
export function optimizedUrl(url: string, width: number) {
  return url.replace("/image/upload/", `/image/upload/f_auto,q_auto,c_limit,w_${width}/`);
}
