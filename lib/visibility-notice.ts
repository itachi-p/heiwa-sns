/** 投稿直後・返信直後に、閲覧しきい値を超えたときだけ投稿者本人に見せる案内 */
export const OTHER_USERS_VISIBILITY_NOTICE =
  "この内容は、他の方には表示されにくい可能性があります。";

/** 閾値は `lib/toxicity-filter-level` の HIGH_TOXICITY_AUTHOR_NOTICE_THRESHOLD（投稿直後・返信直後に投稿者のみ） */
export const POST_HIGH_TOXICITY_VISIBILITY_NOTICE =
  "この投稿は他のユーザーから見えにくくなる可能性があります";

/** 同上（返信用コピー） */
export const REPLY_HIGH_TOXICITY_VISIBILITY_NOTICE =
  "この返信は他のユーザーには表示されにくい可能性があります";
