/** 閲覧フィルタ保存後、タイムライン等が閾値を取り直す用 */
export const VIEWER_TOXICITY_UPDATED_EVENT = "heiwa:viewer-toxicity-updated";

export function notifyViewerToxicityUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(VIEWER_TOXICITY_UPDATED_EVENT));
}
