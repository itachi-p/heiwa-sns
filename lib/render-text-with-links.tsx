import React from "react";

/**
 * テキスト内の URL を安全にリンク化し、React ノード配列で返す。
 * 旧 page.tsx / home-page.tsx / p/[handle]/page.tsx / reply-thread.tsx で
 * 重複定義されていた `renderTextWithLinks` のうち、`page.tsx` 用を共通化。
 * 他ファイルの同名関数は `.cursorrules` に従い今回のスコープで触らない（別 Issue）。
 */
export function renderTextWithLinks(text: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const isUrl = /^https?:\/\/[^\s]+$/;
  return text.split(urlRegex).map((part, idx) => {
    if (isUrl.test(part)) {
      return (
        <a
          key={`${part}-${idx}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-blue-300 underline-offset-2 hover:text-blue-700"
        >
          {part}
        </a>
      );
    }
    return <React.Fragment key={`${part}-${idx}`}>{part}</React.Fragment>;
  });
}
