/** Supabase / Postgres のクライアント向けエラーメッセージを UI 用に短くする */
export function friendlyClientDbMessage(raw: string): string {
  const t = raw.trim();
  if (/row-level security policy/i.test(t)) {
    return "投稿できませんでした。この端末のログイン状態が古いか、画面のユーザー情報と一致していない可能性があります。一度ログアウトしてから再度ログインしてください。";
  }
  return t;
}
