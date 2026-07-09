import { MediaStatus } from '@server/constants/media';

export type LibraryItemStatus =
  | 'available'
  | 'pending'
  | 'processing'
  | 'stalled'
  | 'partial'
  | 'unknown';

// A media row stuck in PROCESSING with no matching queue item is not
// actually downloading - surface it as stalled so it can be retried.
export const classifyLocalMediaStatus = (
  media: {
    status: MediaStatus;
    externalServiceId?: number | null;
    externalServiceId4k?: number | null;
  },
  activeExternalIds: Set<number>
): LibraryItemStatus => {
  switch (media.status) {
    case MediaStatus.PENDING:
      return 'pending';
    case MediaStatus.PARTIALLY_AVAILABLE:
      return 'partial';
    case MediaStatus.PROCESSING: {
      const externalIds = [
        media.externalServiceId,
        media.externalServiceId4k,
      ].filter((id): id is number => id !== null && id !== undefined);

      return externalIds.some((id) => activeExternalIds.has(id))
        ? 'processing'
        : 'stalled';
    }
    default:
      return 'unknown';
  }
};
