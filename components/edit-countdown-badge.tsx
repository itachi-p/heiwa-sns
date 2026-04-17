"use client";

import { useEffect, useReducer } from "react";
import {
  formatRemainingLabel,
  getEditRemainingMs,
} from "@/lib/post-edit-window";

type Props = {
  /** 投稿 / 返信の created_at（ISO 文字列）。未設定なら描画しない。 */
  createdAt: string | null | undefined;
  /** 追加クラス。呼び出し側で余白等を調整したい場合に使う。 */
  className?: string;
};

/**
 * 「編集残り MM:SS」バッジ。
 *
 * 以前は親側（HomePage / アクティビティ / ReplyThread）の `nowTick` state を
 * 1 秒毎に setInterval で更新し、その再レンダーの巻き添えでこのバッジも
 * 更新していたが、タイムライン全体が毎秒再描画され重くなる原因になっていた。
 *
 * 現仕様では「編集」ボタンを押して編集フォームが開いた時だけこのバッジを
 * 表示する。`nowTick` は廃止し、バッジ自身が自前のタイマーを持って
 * 毎秒再描画を自分だけに閉じ込める。残り 0 になればタイマーを止めて null を返す。
 *
 * 実装メモ: 残り時間はレンダー時に `getEditRemainingMs()` で都度計算し、
 * タイマーのコールバックから forceUpdate するだけにしている。こうすると
 * effect 本体内で setState を同期呼び出しせずに済む（react-hooks/set-state-in-effect
 * を回避）。
 */
export function EditCountdownBadge({ createdAt, className }: Props) {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!createdAt) return;
    if (getEditRemainingMs(createdAt) <= 0) return;
    let timerId: number | null = null;
    const tick = () => {
      forceUpdate();
      if (getEditRemainingMs(createdAt) > 0) {
        timerId = window.setTimeout(tick, 1000);
      }
    };
    timerId = window.setTimeout(tick, 1000);
    return () => {
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [createdAt]);

  const remaining = getEditRemainingMs(createdAt ?? undefined);
  if (remaining <= 0) return null;

  return (
    <span
      className={[
        "rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800",
        className ?? "",
      ]
        .join(" ")
        .trim()}
    >
      編集残り {formatRemainingLabel(remaining)}
    </span>
  );
}
