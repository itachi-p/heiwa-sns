"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

type Props = {
  message: string;
  tone: "default" | "error";
};

const subscribeNoop = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * 下部ナビの上・viewport 基準で固定。親の transform / stacking に巻き込まれないよう body 直下へ描画。
 *
 * 位置は `top-[max(28vh,6.5rem)]` 固定。**画面上部に重なるモーダルを新規追加する場合は注意**:
 * 過去にトーストが画面外に押し出され操作不能になる事故あり。新モーダルが top 領域を覆う場合は
 * トースト位置を `bottom` + `safe-area-inset-bottom` 基準に切替するか、モーダル側で z-index を
 * トーストより低く保つこと。
 */
export function AppToastPortal({ message, tone }: Props) {
  // SSR は false、ハイドレーション直後から true。これでハイドレーションズレなく
  // クライアント側のみ portal を描く（旧: useEffect + setMounted を新 lint 規則対応）。
  const mounted = useSyncExternalStore(
    subscribeNoop,
    getClientSnapshot,
    getServerSnapshot
  );

  if (!mounted || typeof document === "undefined" || !message.trim()) {
    return null;
  }

  const node = (
    <div
      className={[
        "pointer-events-none fixed left-1/2 z-[2147483000] w-max max-w-[min(92vw,28rem)] -translate-x-1/2 rounded-lg border px-4 py-2.5 text-left text-sm text-white shadow-lg",
        "whitespace-pre-line [overflow-wrap:anywhere]",
        // Keep toast away from extreme edges and above compose modal/keyboard.
        "top-[max(28vh,6.5rem)] sm:top-[max(24vh,6rem)]",
        tone === "error"
          ? "border-red-400/80 bg-red-900"
          : "border-gray-200 bg-gray-900",
      ].join(" ")}
      role="status"
      aria-live="polite"
    >
      {message.trim()}
    </div>
  );

  return createPortal(node, document.body);
}
