import Tooltip from '@app/components/Common/Tooltip';
import { EyeIcon } from '@heroicons/react/24/solid';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages({
  watchedBy: 'Watched by {count} {count, plural, one {user} other {users}}',
});

interface TautulliWatchUser {
  friendly_name: string;
  user_id: number;
  username: string;
  total_plays: number;
}

interface WatchedStatusBadgeProps {
  ratingKey?: string | null;
  ratingKey4k?: string | null;
}

const uniqueWatchUsers = (
  users: TautulliWatchUser[],
  users4k: TautulliWatchUser[]
): TautulliWatchUser[] => {
  const seen = new Set<number>();

  return [...users, ...users4k].filter((user) => {
    if (seen.has(user.user_id)) {
      return false;
    }

    seen.add(user.user_id);
    return true;
  });
};

const WatchedStatusBadge = ({
  ratingKey,
  ratingKey4k,
}: WatchedStatusBadgeProps) => {
  const intl = useIntl();
  const { data: watchUsers } = useSWR<TautulliWatchUser[]>(
    ratingKey ? `/api/v1/media/watch-users/${ratingKey}` : null
  );
  const { data: watchUsers4k } = useSWR<TautulliWatchUser[]>(
    ratingKey4k && ratingKey4k !== ratingKey
      ? `/api/v1/media/watch-users/${ratingKey4k}`
      : null
  );
  const users = uniqueWatchUsers(watchUsers ?? [], watchUsers4k ?? []);

  if ((!ratingKey && !ratingKey4k) || users.length === 0) {
    return null;
  }

  return (
    <Tooltip
      content={intl.formatMessage(messages.watchedBy, { count: users.length })}
    >
      <span className="inline-flex items-center space-x-1 rounded-full bg-gray-700 px-2 py-1 text-xs font-medium text-gray-100">
        <EyeIcon className="h-4 w-4" />
        <span>{users.length}</span>
      </span>
    </Tooltip>
  );
};

export default WatchedStatusBadge;
