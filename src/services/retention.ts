export type RetentionRecord = { id: string; createdAt: Date; containsPii: boolean; legalHold?: boolean };
export function retentionActions(
  records: readonly RetentionRecord[],
  now: Date,
  ttlDays: number,
): { deleteIds: string[]; anonymizeIds: string[] } {
  const cutoff = now.getTime() - ttlDays * 86_400_000;
  const expired = records.filter((record) => !record.legalHold && record.createdAt.getTime() < cutoff);
  return {
    deleteIds: expired.filter((record) => !record.containsPii).map((record) => record.id),
    anonymizeIds: expired.filter((record) => record.containsPii).map((record) => record.id),
  };
}
