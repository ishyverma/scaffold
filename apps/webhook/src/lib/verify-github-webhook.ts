import dotenv from "dotenv";
import path from "path";

dotenv.config({
    path: path.join(__dirname, "../../../../.env")
})

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET!;

export async function verifyGithubSignature(
  rawBody: ArrayBuffer,
  signatureHeader: string | undefined,
): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const secret = new TextEncoder().encode(WEBHOOK_SECRET);
  const body = new Uint8Array(rawBody);

  // Import secret as HMAC-SHA256 key
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  // Compute expected signature
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, body);
  const expectedHex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const expected = `sha256=${expectedHex}`;
  const actual = signatureHeader;

  // Constant-time comparison to prevent timing attacks
  if (expected.length !== actual.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }

  return mismatch === 0;
}