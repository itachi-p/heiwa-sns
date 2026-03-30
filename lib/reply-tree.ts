export type ReplyWithParent = {
  id: number;
  parent_reply_id?: number | null;
  created_at?: string;
};

export function partitionRepliesByParent<T extends ReplyWithParent>(
  flat: T[]
): { roots: T[]; childrenByParent: Record<number, T[]> } {
  const byCreated = (a: T, b: T) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return ta - tb;
  };
  const childrenByParent: Record<number, T[]> = {};
  const roots: T[] = [];
  for (const r of flat) {
    const pid = r.parent_reply_id ?? null;
    if (pid == null) {
      roots.push(r);
    } else {
      if (!childrenByParent[pid]) childrenByParent[pid] = [];
      childrenByParent[pid].push(r);
    }
  }
  roots.sort(byCreated);
  for (const k of Object.keys(childrenByParent)) {
    childrenByParent[Number(k)]!.sort(byCreated);
  }
  return { roots, childrenByParent };
}
