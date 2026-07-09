import Link from 'next/link';
import useSWR from 'swr';
import { FilmIcon, TvIcon } from '@heroicons/react/24/outline';
import { FireIcon } from '@heroicons/react/24/solid';

interface PopularItem {
  title: string;
  rating_key: string;
  grandparent_rating_key?: string;
  thumb: string;
  total_plays: number;
  total_duration: number;
  users_watched: number;
  media_type: 'movie' | 'show';
  year?: number;
}

const PopularWidget = () => {
  const { data, error } = useSWR<PopularItem[]>(
    '/api/v1/stats/popular?days=30&take=5',
    { refreshInterval: 300000 } // Refresh every 5 minutes
  );

  const isLoading = !data && !error;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center text-lg font-semibold text-gray-100">
          <FireIcon className="mr-2 h-5 w-5 text-orange-500" />
          Popular This Month
        </h2>
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-gray-400" />
        </div>
      ) : error ? (
        <div className="flex h-32 items-center justify-center text-sm text-gray-500">
          Unable to load popular content
        </div>
      ) : !data || data.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-gray-500">
          No watch data available
        </div>
      ) : (
        <ul className="space-y-0.5">
          {data.map((item, index) => (
            <li key={item.rating_key}>
              <div className="flex items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-gray-700/50">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-700 text-[10px] font-medium text-gray-300">
                  {index + 1}
                </span>
                {item.media_type === 'movie' ? (
                  <FilmIcon className="h-4 w-4 shrink-0 text-gray-400" />
                ) : (
                  <TvIcon className="h-4 w-4 shrink-0 text-gray-400" />
                )}
                <p className="min-w-0 flex-1 truncate text-xs font-medium text-gray-200">
                  {item.title}
                </p>
                <span className="shrink-0 text-xs tabular-nums text-gray-500">
                  {item.total_plays} plays
                  {item.users_watched > 1 && ` · ${item.users_watched} viewers`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default PopularWidget;
