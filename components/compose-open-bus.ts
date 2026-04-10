/** タイムライン／マイホームの投稿フォームを開く（下部ナビの中央ボタン用） */
export const COMPOSE_OPEN_EVENT = "heiwa:open-compose";

export function requestOpenCompose() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COMPOSE_OPEN_EVENT));
}
