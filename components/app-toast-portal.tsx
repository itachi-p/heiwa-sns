"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  message: string;
  tone: "default" | "error";
};

/**
 * 下部ナビの上・viewport 基準で固定。親の transform / stacking に巻き込まれないよう body 直下へ描画。
 */
export function AppToastPortal({ message, tone }: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
