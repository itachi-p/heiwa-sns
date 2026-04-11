/** 下部ナビなどから閲覧フィルタモーダルを開く */
export const SETTINGS_OPEN_EVENT = "heiwa:open-settings";

export function requestOpenSettings() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SETTINGS_OPEN_EVENT));
}
