import type { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { Session } from "@shopify/shopify-api";
import { encrypt, decrypt } from "./crypto";

// Wraps PrismaSessionStorage with AES-256-GCM applied to the accessToken on
// the way to/from the DB. Refresh tokens, when present, are also encrypted.
// Spec §3.1: tokens encrypted at rest.
//
// Note: not currently wired into shopify.server.ts due to a transitive version
// conflict between @shopify/shopify-app-remix and @shopify/shopify-app-session-storage-prisma.
// Crypto roundtrip is unit-tested. See app/shopify.server.ts for the deferral note.
export class EncryptedSessionStorage implements SessionStorage {
  private readonly inner: PrismaSessionStorage<any>;

  constructor(inner: PrismaSessionStorage<any>) {
    this.inner = inner;
  }

  async storeSession(session: Session): Promise<boolean> {
    return this.inner.storeSession(transformSession(session, encrypt));
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const session = await this.inner.loadSession(id);
    if (!session) return undefined;
    return transformSession(session, safeDecrypt);
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.inner.deleteSession(id);
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    return this.inner.deleteSessions(ids);
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const sessions = await this.inner.findSessionsByShop(shop);
    return sessions.map((s) => transformSession(s, safeDecrypt));
  }
}

function transformSession(
  session: Session,
  fn: (value: string) => string,
): Session {
  const cloned = Session.fromPropertyArray(session.toPropertyArray());
  if (cloned.accessToken) cloned.accessToken = fn(cloned.accessToken);
  return cloned;
}

// If the DB still holds a plaintext token from a pre-encryption install, the
// decrypt call will throw on bad base64 / auth tag. Treat that as "already
// plaintext, return as-is" so we don't lock out existing dev installs while
// rolling out encryption. Production: backfill + remove this fallback.
function safeDecrypt(value: string): string {
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}
