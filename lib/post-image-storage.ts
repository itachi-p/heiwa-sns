import type { SupabaseClient } from "@supabase/supabase-js";

export const POST_IMAGES_BUCKET = "post-images";

/** 投稿1件あたりの画像サイズ上限 */
export const POST_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function validatePostImageFile(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return "画像ファイル（JPEG / PNG / WebP / GIF）を選択してください。";
  }
  if (!MIME_TO_EXT[file.type]) {
    return "対応形式は JPEG / PNG / WebP / GIF です。";
  }
  if (file.size > POST_IMAGE_MAX_BYTES) {
    return `画像サイズは ${POST_IMAGE_MAX_BYTES / (1024 * 1024)}MB 以下にしてください。`;
  }
  return null;
}

export function getPostImagePublicUrl(
  client: SupabaseClient,
  path: string | null | undefined
): string | null {
  const p = path?.trim();
  if (!p) return null;
  const { data } = client.storage.from(POST_IMAGES_BUCKET).getPublicUrl(p);
  return data.publicUrl;
}

export async function uploadPostImage(
  client: SupabaseClient,
  userId: string,
  postId: number,
  file: File
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const v = validatePostImageFile(file);
  if (v) return { ok: false, message: v };
  const ext = MIME_TO_EXT[file.type] ?? "jpg";
  const objectPath = `${userId}/${postId}.${ext}`;
  const { error } = await client.storage
    .from(POST_IMAGES_BUCKET)
    .upload(objectPath, file, {
      upsert: true,
      contentType: file.type,
    });
  if (error) return { ok: false, message: error.message };
  return { ok: true, path: objectPath };
}

export async function removePostImageIfAny(
  client: SupabaseClient,
  path: string | null | undefined
): Promise<void> {
  const p = path?.trim();
  if (!p) return;
  await client.storage.from(POST_IMAGES_BUCKET).remove([p]);
}
