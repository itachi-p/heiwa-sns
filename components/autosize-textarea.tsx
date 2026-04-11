"use client";

import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from "react";

export type AutosizeTextareaProps =
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    maxRows?: number;
  };

export const AutosizeTextarea = forwardRef<
  HTMLTextAreaElement,
  AutosizeTextareaProps
>(function AutosizeTextarea(
  { className = "", maxRows = 14, value, onChange, ...rest },
  ref
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const setRefs = useCallback(
    (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref]
  );

  useLayoutEffect(() => {
    const el = innerRef.current;
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
      ref={setRefs}
      rows={1}
      value={value}
      onChange={onChange}
      className={className}
      {...rest}
    />
  );
});
