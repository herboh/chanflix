import type { User } from '@server/entity/User';

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
