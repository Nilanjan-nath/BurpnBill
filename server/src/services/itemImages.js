import { HttpError } from '../errors.js';

// Item photos, in Supabase Storage.
//
// The upload goes through the API rather than straight from the browser to
// Supabase. A signed upload URL would save a hop, but it would also mean the
// browser telling the server where the file ended up — and the server writing
// that string into `image_url` on trust. This way the service-role key stays
// the only thing that can write to the bucket, and the URL the database gets
// is one the server produced itself.

export const BUCKET = 'menu-images';

// The three formats the upload box advertises. The extension comes from this
// map, never from the filename the browser claimed.
export const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function createImageStore({ supabase, bucket = BUCKET }) {
  let ensured = false;

  // Created on demand rather than as a setup step the owner has to remember.
  // Public read: these are menu photos on a page anyone at a table can open,
  // so signing every URL would buy nothing and cost a round trip per item.
  async function ensureBucket() {
    if (ensured) return;
    const { error } = await supabase.storage.createBucket(bucket, {
      public: true,
      fileSizeLimit: MAX_IMAGE_BYTES,
      allowedMimeTypes: Object.keys(IMAGE_TYPES),
    });
    // "already exists" is the expected answer every time after the first.
    if (error && !/exist/i.test(error.message)) {
      throw new HttpError(502, 'storage_unavailable', `Could not prepare image storage: ${error.message}`);
    }
    ensured = true;
  }

  return {
    async upload({ restaurantId, itemId, bytes, contentType }) {
      await ensureBucket();

      // The timestamp is what makes replacing a photo visible: the old URL is
      // still in a dozen phone caches, and a new path is the only reliable way
      // past that.
      const path = `${restaurantId}/${itemId}-${Date.now()}.${IMAGE_TYPES[contentType]}`;
      const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
      if (error) throw new HttpError(502, 'storage_unavailable', `Could not store the photo: ${error.message}`);

      return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    },

    // Best effort, and deliberately so: a file left behind costs a few KB,
    // while a failed delete that breaks the request costs the owner the edit
    // they were actually making.
    async remove(publicUrl) {
      const path = pathFromPublicUrl(publicUrl, bucket);
      if (!path) return false;
      const { error } = await supabase.storage.from(bucket).remove([path]);
      if (error) console.error(`[storage] could not remove ${path}:`, error.message);
      return !error;
    },
  };
}

// Turn a public URL back into the object path inside the bucket. Anything that
// isn't one of our own URLs returns null and is left alone — image_url could
// hold a hand-written link from before uploads existed.
export function pathFromPublicUrl(publicUrl, bucket = BUCKET) {
  if (typeof publicUrl !== 'string') return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = publicUrl.indexOf(marker);
  return at === -1 ? null : decodeURIComponent(publicUrl.slice(at + marker.length));
}
