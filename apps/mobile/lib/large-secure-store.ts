import * as SecureStore from "expo-secure-store";

/**
 * A `SecureStore`-backed storage adapter that survives values larger than
 * SecureStore's own per-item limit.
 *
 * SecureStore (on Android, backed by `SharedPreferences` plus the Keystore)
 * rejects — or on some OEM builds silently truncates — values above roughly
 * 2 KB. Supabase's session payload (access token, refresh token, user
 * metadata, all as JSON) routinely exceeds that once the JWT carries more
 * than a couple of custom claims. Without this wrapper, `setItem` would fail
 * (or worse, "succeed" with a truncated value SecureStore can't read back),
 * `persistSession` would look configured but not actually work, and the
 * person using the app would be logged out with no explanation the next
 * time they reopened it — the exact bug this file exists to prevent.
 *
 * A value at or under `CHUNK_SIZE` is stored as-is, unchanged from before
 * this wrapper existed — so a session written by an older build of the app
 * reads back exactly the same way. A larger value is split across sibling
 * keys (`${key}__chunk_0`, `__chunk_1`, ...) and the original key holds a
 * small JSON manifest recording how many chunks to read back and reunite.
 */

const CHUNK_SIZE = 1800; // comfortably under the ~2048-byte practical ceiling

function chunkKey(key: string, index: number): string {
  return `${key}__chunk_${index}`;
}

interface ChunkManifest {
  readonly chunked: true;
  readonly count: number;
}

// Supabase's own session JSON never has a top-level `chunked` field, so this
// is a safe (if informal) way to tell "a manifest we wrote" apart from
// "a small plain value that happens to be JSON" without a version byte.
function asManifest(raw: string): ChunkManifest | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as { chunked?: unknown }).chunked === true &&
      Number.isInteger((parsed as { count?: unknown }).count)
    ) {
      return parsed as ChunkManifest;
    }
    return null;
  } catch {
    return null;
  }
}

async function removeChunked(key: string, manifest: ChunkManifest): Promise<void> {
  await Promise.all(
    Array.from({ length: manifest.count }, (_, index) =>
      SecureStore.deleteItemAsync(chunkKey(key, index)),
    ),
  );
}

export const largeSecureStore = {
  async getItem(key: string): Promise<string | null> {
    const raw = await SecureStore.getItemAsync(key);
    if (raw === null) return null;

    const manifest = asManifest(raw);
    if (!manifest) return raw;

    const parts = await Promise.all(
      Array.from({ length: manifest.count }, (_, index) =>
        SecureStore.getItemAsync(chunkKey(key, index)),
      ),
    );
    // A missing chunk means a previous write was interrupted partway through
    // (app killed mid-write, storage cleared for one key but not others).
    // Returning a truncated session would look valid and fail confusingly
    // later; treating it as absent forces a clean re-login instead.
    if (parts.some((part) => part === null)) return null;
    return parts.join("");
  },

  async setItem(key: string, value: string): Promise<void> {
    // Clear whatever was there before writing — a shorter new value must
    // not leave a stale trailing chunk from a longer previous one behind.
    await largeSecureStore.removeItem(key);

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    const count = Math.ceil(value.length / CHUNK_SIZE);
    for (let index = 0; index < count; index++) {
      const part = value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
      await SecureStore.setItemAsync(chunkKey(key, index), part);
    }
    const manifest: ChunkManifest = { chunked: true, count };
    await SecureStore.setItemAsync(key, JSON.stringify(manifest));
  },

  async removeItem(key: string): Promise<void> {
    const raw = await SecureStore.getItemAsync(key);
    if (raw !== null) {
      const manifest = asManifest(raw);
      if (manifest) await removeChunked(key, manifest);
    }
    await SecureStore.deleteItemAsync(key);
  },
};
