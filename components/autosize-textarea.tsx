"use client";

import {
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from "react";

export type AutosizeTextareaProps =
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    maxRows?: number;
  };

export function AutosizeTextarea({
  className = "",
  maxRows = 14,
  value,
  onChange,
  ...rest
}: AutosizeTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight);
    const padding =
      parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const line = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 20;
    const maxHeight = line * maxRows + padding;
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, maxRows]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={onChange}
      className={className}
      {...rest}
    />
  );
}
