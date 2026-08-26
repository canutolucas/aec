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

// CHUNK_SIZE counts JS string length — UTF-16 code units — not the UTF-8
// byte size SecureStore's ~2048-byte ceiling actually measures. A JWT and
// most of a Supabase session are plain ASCII (1 code unit = 1 byte), but
// user_metadata can carry accented names or other non-ASCII text, and a
// single UTF-16 code unit can encode to up to 3 UTF-8 bytes (everything
// outside surrogate pairs; those encode 2 code units to 4 bytes, an even
// better ratio). Dividing the real ceiling by that worst case, instead of
// trying to measure actual byte size, keeps every chunk safely under the
// limit regardless of what it contains, with no dependency on a TextEncoder
// or Buffer polyfill being present on whatever JS engine this runs on.
const CHUNK_SIZE = 600; // 600 × 3 = 1800 bytes worst case, well under ~2048

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
    // The manifest is written FIRST, before any chunk — the opposite of the
    // intuitive order, deliberately. If the process is killed partway
    // through the loop below, the manifest already on disk still promises
    // `count` chunks; the next call's own removeItem() (manifest-driven,
    // the very first thing setItem does) then deletes all `count` slots
    // regardless of which ones actually got written, so nothing from an
    // interrupted write is ever left orphaned. Writing the chunks first and
    // the manifest last — the previous order — had the opposite problem: a
    // kill after the chunks but before the manifest left them permanently
    // unreferenced, since nothing on disk would ever again claim them.
    const manifest: ChunkManifest = { chunked: true, count };
    await SecureStore.setItemAsync(key, JSON.stringify(manifest));
    await Promise.all(
      Array.from({ length: count }, (_, index) => {
        const part = value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
        return SecureStore.setItemAsync(chunkKey(key, index), part);
      }),
    );
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
