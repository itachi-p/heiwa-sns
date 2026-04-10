/** 招待ユーザー識別用ラベル（例: INV-A3F9） */
export function generateInviteLabel(): string {
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `INV-${random}`;
}
