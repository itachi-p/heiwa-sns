import type { SupabaseClient } from "@supabase/supabase-js";

export const POST_IMAGES_BUCKET = "post-images";

/** アップロード前に長辺をこの px 以下に縮小（クライアント側） */
const MAX_DISPLAY_SIDE_PX = 1920;

/** 縮小・圧縮後でもこれを超えたら拒否（UI に数値は出さない） */
const MAX_COMPRESSED_BYTES = 3 * 1024 * 1024;

/** GIF は再エンコードしない。生ファイルが上限超なら拒否 */
const MAX_GIF_RAW_BYTES = 3 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type PreparedPostImage = {
  blob: Blob;
  contentType: string;
  ext: string;
};

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), type, quality);
  });
}

async function rasterToCompressedBlob(
  file: File,
  maxSide: number,
  quality: number
): Promise<{ blob: Blob; contentType: string; ext: string }> {
  const bmp = await createImageBitmap(file);
  try {
    let w = bmp.width;
    let h = bmp.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(bmp, 0, 0, w, h);

    let blob = await canvasToBlob(canvas, "image/webp", quality);
    if (blob && blob.size > 0) {
      return { blob, contentType: "image/webp", ext: "webp" };
    }
    blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (blob && blob.size > 0) {
      return { blob, contentType: "image/jpeg", ext: "jpg" };
    }
    throw new Error("toBlob");
  } finally {
    bmp.close();
  }
}

/**
 * 投稿用画像をブラウザ上で縮小・圧縮する。GIF はアニメ維持のためそのまま（大きすぎる場合のみ拒否）。
 */
export async function preparePostImageForUpload(
  file: File
): Promise<{ ok: true; blob: Blob; contentType: string; ext: string } | { ok: false; message: string }> {
  if (typeof window === "undefined") {
    return { ok: false, message: "画像の処理に失敗しました。" };
  }
  if (!file.type.startsWith("image/")) {
    return { ok: false, message: "画像以外のファイルは選べません。" };
  }
  if (!MIME_TO_EXT[file.type]) {
    return { ok: false, message: "この形式の画像には対応していません。" };
  }

  if (file.type === "image/gif") {
    if (file.size > MAX_GIF_RAW_BYTES) {
      return { ok: false, message: "この画像は大きすぎます。" };
    }
    return {
      ok: true,
      blob: file,
      contentType: file.type,
      ext: "gif",
    };
  }

  try {
    let { blob, contentType, ext } = await rasterToCompressedBlob(
      file,
      MAX_DISPLAY_SIDE_PX,
      0.82
    );
    if (blob.size > MAX_COMPRESSED_BYTES) {
      ({ blob, contentType, ext } = await rasterToCompressedBlob(
        file,
        Math.round(MAX_DISPLAY_SIDE_PX * 0.65),
        0.72
      ));
    }
    if (blob.size > MAX_COMPRESSED_BYTES) {
      return { ok: false, message: "この画像は大きすぎます。" };
    }
    return { ok: true, blob, contentType, ext };
  } catch {
    return { ok: false, message: "画像を読み込めませんでした。" };
  }
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
  image: PreparedPostImage
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const objectPath = `${userId}/${postId}.${image.ext}`;
  const { error } = await client.storage
    .from(POST_IMAGES_BUCKET)
    .upload(objectPath, image.blob, {
      upsert: true,
      contentType: image.contentType,
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
