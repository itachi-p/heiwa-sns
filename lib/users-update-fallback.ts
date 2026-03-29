/** PostgREST が avatar_placeholder_hex 未認識のときのエラー */
export function isMissingAvatarPlaceholderHexError(err: unknown): boolean {
  const m =
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string"
      ? (err as { message: string }).message
      : "";
  return /avatar_placeholder_hex/i.test(m);
}
