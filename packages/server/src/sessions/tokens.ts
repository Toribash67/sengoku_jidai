import { createHash, randomBytes, randomUUID } from "node:crypto";

export interface IssuedToken {
  id: string;
  token: string;
  tokenHash: string;
}

export function issueToken(): IssuedToken {
  const token = randomBytes(32).toString("base64url");
  return {
    id: randomUUID(),
    token,
    tokenHash: hashToken(token)
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function bearerToken(authorization: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  return authorization.slice("Bearer ".length).trim() || null;
}
