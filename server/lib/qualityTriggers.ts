import type { User } from '@server/entity/User';
import type { UserQualityTriggers } from '@server/interfaces/api/userSettingsInterfaces';
import logger from '@server/logger';

export const defaultQualityTriggers = (): UserQualityTriggers => ({
  enabled: false,
});

export const parseQualityTriggers = (
  value?: string | null
): UserQualityTriggers => {
  if (!value) {
    return defaultQualityTriggers();
  }

  try {
    const parsed = JSON.parse(value) as Partial<UserQualityTriggers>;

    if (!parsed || typeof parsed !== 'object') {
      return defaultQualityTriggers();
    }

    return {
      enabled: parsed.enabled === true,
      maxProfileId:
        typeof parsed.maxProfileId === 'number' && parsed.maxProfileId > 0
          ? parsed.maxProfileId
          : undefined,
      rules: Array.isArray(parsed.rules) ? parsed.rules : undefined,
    };
  } catch {
    return defaultQualityTriggers();
  }
};

export const serializeQualityTriggers = (
  value?: UserQualityTriggers | null
): string | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return JSON.stringify({
    enabled: value.enabled === true,
    maxProfileId:
      typeof value.maxProfileId === 'number' && value.maxProfileId > 0
        ? value.maxProfileId
        : undefined,
    rules: Array.isArray(value.rules) ? value.rules : undefined,
  });
};

export interface QualityTriggerContext {
  mediaType: 'movie' | 'tv';
  is4k: boolean;
  requestId?: number;
  mediaId?: number;
}

// Called from the request pipeline after the quality profile for a request
// has been decided. This is the single hook point where per-user quality
// trigger rules will be implemented; today it intentionally returns the
// incoming profile unchanged so the plumbing can ship ahead of the rules.
export const evaluateQualityTriggers = (
  user: User | undefined,
  profileId: number,
  context: QualityTriggerContext
): number => {
  const triggers = user?.settings?.qualityTriggers;

  if (!triggers?.enabled) {
    return profileId;
  }

  // STUB: trigger rules (e.g. clamping to maxProfileId, per-rule matching)
  // land here. Until then, log that a trigger would have been evaluated.
  logger.debug('Quality triggers enabled for user; rules not yet implemented', {
    label: 'Quality Triggers',
    userId: user?.id,
    profileId,
    maxProfileId: triggers.maxProfileId,
    ...context,
  });

  return profileId;
};
