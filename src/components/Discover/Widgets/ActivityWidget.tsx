import useSWR from 'swr';
import { ClockIcon } from '@heroicons/react/24/outline';
import { PlayIcon } from '@heroicons/react/24/solid';

interface ActivityItem {
  date: number;
  friendly_name: string;
  full_title: string;
  media_type: string;
  title: string;
  grandparent_title?: string;
  parent_title?: string;
  rating_key: number;
  user: string;
  percent_complete: number;
}

const formatTimeAgo = (timestamp: number): string => {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
};

const ActivityWidget = () => {
  const { data, error } = useSWR<ActivityItem[]>(
    '/api/v1/stats/activity?take=5',
    { refreshInterval: 60000 } // Refresh every minute
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
          {data.map((item, index) => (
            <li key={`${item.rating_key}-${item.date}-${index}`}>
              <div className="flex items-start space-x-3 rounded-md p-2 transition hover:bg-gray-700/50">
                <PlayIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-200">
                    <span className="font-medium">{item.friendly_name || item.user}</span>
                    <span className="text-gray-400"> watched </span>
                    <span className="font-medium">
                      {item.media_type === 'episode'
                        ? item.grandparent_title || item.title
                        : item.title}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatTimeAgo(item.date)}
                    {item.media_type === 'episode' && item.parent_title && (
                      <span> · {item.parent_title}</span>
                    )}
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
