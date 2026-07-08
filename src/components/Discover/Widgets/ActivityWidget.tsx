import {
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ClockIcon,
  PlayIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import useSWR from 'swr';

type ActivityItem =
  | {
      id: string;
      type: 'request';
      occurredAt: string;
      user: string;
      mediaType: 'movie' | 'tv';
      mediaTitle: string;
      tmdbId: number;
      status: 'pending' | 'approved' | 'declined' | 'failed';
      is4k: boolean;
    }
  | {
      id: string;
      type: 'watch';
      occurredAt: string;
      user: string;
      mediaType: 'movie' | 'episode';
      mediaTitle: string;
      episodeTitle?: string;
    }
  | {
      id: string;
      type: 'download';
      occurredAt: string;
      mediaType: 'movie' | 'tv';
      mediaTitle: string;
      status: string;
    };

const formatTimeAgo = (timestamp: string): string => {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)
  );

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
};

const getStatusIcon = (item: ActivityItem) => {
  if (item.type === 'watch') {
    return <PlayIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />;
  }

  if (item.type === 'download') {
    return (
      <ArrowDownTrayIcon className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
    );
  }

  switch (item.status) {
    case 'approved':
      return (
        <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-purple-400" />
      );
    case 'declined':
    case 'failed':
      return <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />;
    case 'pending':
    default:
      return <ClockIcon className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />;
  }
};

const getPrimaryText = (item: ActivityItem) => {
  if (item.type === 'watch') {
    return (
      <>
        <span className="font-medium">{item.user}</span>
        <span className="text-gray-400"> watched </span>
        <span className="font-medium">{item.mediaTitle}</span>
      </>
    );
  }

  if (item.type === 'download') {
    return (
      <>
        <span className="text-gray-400">Downloading </span>
        <span className="font-medium">{item.mediaTitle}</span>
      </>
    );
  }

  const statusText =
    item.status === 'pending'
      ? ' requested '
      : item.status === 'approved'
      ? ' was approved for '
      : item.status === 'declined'
      ? ' was declined for '
      : ' hit a request error for ';

  return (
    <>
      <span className="font-medium">{item.user}</span>
      <span className="text-gray-400">{statusText}</span>
      <Link href={`/${item.mediaType}/${item.tmdbId}`}>
        <a className="font-medium hover:underline">
          {item.mediaTitle}
          {item.is4k ? ' 4K' : ''}
        </a>
      </Link>
    </>
  );
};

const getSecondaryText = (item: ActivityItem) => {
  const timeAgo = formatTimeAgo(item.occurredAt);

  if (item.type === 'watch' && item.episodeTitle) {
    return `${timeAgo} · ${item.episodeTitle}`;
  }

  if (item.type === 'download') {
    return `${timeAgo} · ${item.status}`;
  }

  return timeAgo;
};

const ActivityWidget = () => {
  const { data, error } = useSWR<ActivityItem[]>(
    '/api/v1/stats/recent?take=6',
    { refreshInterval: 120000 }
  );

  const isLoading = !data && !error;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center text-lg font-semibold text-gray-100">
          <ClockIcon className="mr-2 h-5 w-5 text-indigo-400" />
          Recent Activity
        </h2>
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-gray-400" />
        </div>
      ) : error ? (
        <div className="flex h-32 items-center justify-center text-sm text-gray-500">
          Unable to load activity
        </div>
      ) : !data || data.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-gray-500">
          No recent activity
        </div>
      ) : (
        <ul className="space-y-2">
          {data.map((item) => (
            <li key={item.id}>
              <div className="flex items-start space-x-3 rounded-md p-2 transition hover:bg-gray-700/50">
                {getStatusIcon(item)}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-200">
                    {getPrimaryText(item)}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {getSecondaryText(item)}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ActivityWidget;
