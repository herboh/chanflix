import type { User } from '@server/entity/User';
import logger from '@server/logger';

export interface RequestTagApi {
  getTags: () => Promise<{ id: number; label: string }[]>;
  createTag: (options: { label: string }) => Promise<{ id?: number }>;
}

export const getRequestUserTagLabel = (user: User): string => {
  const normalizedName = user.displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `request-${user.id}${normalizedName ? `-${normalizedName}` : ''}`;
};

export const isRequestUserTag = (label: string, user: User): boolean => {
  return (
    label === getRequestUserTagLabel(user) ||
    new RegExp(`^request-${user.id}($|-)`).test(label) ||
    label.startsWith(`${user.id} - `)
  );
};

// Tagging is best-effort decoration: a tag failure (read-only API key,
// label rejection, network) must never fail the media request itself.
export const resolveRequestUserTagId = async (
  api: RequestTagApi,
  user: User,
  logMeta: Record<string, unknown> = {}
): Promise<number | undefined> => {
  const userTagLabel = getRequestUserTagLabel(user);

  try {
    const existingTag = (await api.getTags()).find((tag) =>
      isRequestUserTag(tag.label, user)
    );

    if (existingTag?.id) {
      return existingTag.id;
    }
  } catch (e) {
    logger.warn(
      'Failed to read tags; continuing request without a user tag',
      {
        label: 'Media Request',
        userId: user.id,
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
        ...logMeta,
      }
    );

    return undefined;
  }

  logger.info('Requester has no active tag. Creating new', {
    label: 'Media Request',
    userId: user.id,
    newTag: userTagLabel,
    ...logMeta,
  });

  try {
    const createdTag = await api.createTag({ label: userTagLabel });

    if (createdTag?.id) {
      return createdTag.id;
    }
  } catch (e) {
    // A concurrent request may have created the tag between our read and
    // write, or the API key may be read-only; re-read once before giving up.
    try {
      const retriedTag = (await api.getTags()).find((tag) =>
        isRequestUserTag(tag.label, user)
      );

      if (retriedTag?.id) {
        return retriedTag.id;
      }
    } catch {
      // fall through to the warning below
    }

    logger.warn(
      'Failed to create user tag; continuing request without a user tag',
      {
        label: 'Media Request',
        userId: user.id,
        newTag: userTagLabel,
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
        ...logMeta,
      }
    );

    return undefined;
  }

  logger.warn('User tag was created but no tag ID was returned', {
    label: 'Media Request',
    userId: user.id,
    newTag: userTagLabel,
    ...logMeta,
  });

  return undefined;
};
