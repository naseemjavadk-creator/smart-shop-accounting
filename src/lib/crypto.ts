import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// AES-256-GCM with a key derived from AUTH_SECRET: a database copy alone does not reveal company API keys
const key = () => createHash("sha256").update(`company-secrets:${process.env.AUTH_SECRET ?? ""}`).digest();

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decryptSecret(box: string): string | null {
  try {
    const [v, iv, tag, data] = box.split(".");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
