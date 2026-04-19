/**
 * インライン返信入力欄（「〇〇に返信」プレースホルダーが出る bottom-fixed フォーム）が
 * 開いているかをグローバルにブロードキャストするバス。
 *
 * 目的: MainShellLayout 側で購読し、開いている間は MainBottomNav（中央の「+」を含む）
 * を非表示にする。これにより
 *   - 返信入力中に「+」を押して新規投稿モーダル（bottom-20 z-[55]）が
 *     インライン返信フォーム（bottom-16 z-[56]）と重畳する不具合を防止
 *   - 視覚的にナビと入力欄を「入れ替える」UX を実現
 *
 * compose-open-bus / settings-open-bus と同じイベント駆動パターン。
 * インライン返信フォームを描画するページ（タイムライン / マイホーム / 他人プロフィール）が
 * useEffect で setReplyActive を呼び、unmount／閉じ時に false を投げる契約。
 */
const REPLY_ACTIVE_EVENT = "heiwa:reply-active-change";

let active = false;

export function setReplyActive(value: boolean) {
  if (typeof window === "undefined") return;
  if (active === value) return;
  active = value;
  window.dispatchEvent(
    new CustomEvent(REPLY_ACTIVE_EVENT, { detail: value })
  );
}

export function getReplyActiveSnapshot(): boolean {
  return active;
}

export function subscribeReplyActive(
  cb: (value: boolean) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) =>
    cb((e as CustomEvent<boolean>).detail);
  window.addEventListener(REPLY_ACTIVE_EVENT, handler);
  return () => window.removeEventListener(REPLY_ACTIVE_EVENT, handler);
}
