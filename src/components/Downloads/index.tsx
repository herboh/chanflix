import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import {
  ArrowDownTrayIcon,
  FilmIcon,
  TvIcon,
  ClockIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import { POLLING_INTERVALS } from '@app/utils/pollingIntervals';
import useSWR from 'swr';

interface DownloadingItem {
  mediaType: 'movie' | 'tv';
  externalId: number;
  size: number;
  sizeLeft: number;
  status: string;
  timeLeft: string;
  estimatedCompletionTime: string;
  title: string;
  episode?: {
    seasonNumber: number;
    episodeNumber: number;
    absoluteEpisodeNumber: number;
    id: number;
  };
}

interface DownloadsResponse {
  movies: DownloadingItem[];
  tv: DownloadingItem[];
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const getStatusColor = (status: string): string => {
  switch (status.toLowerCase()) {
    case 'downloading':
      return 'text-blue-400';
    case 'completed':
      return 'text-green-400';
    case 'queued':
    case 'delay':
      return 'text-yellow-400';
    case 'failed':
    case 'warning':
      return 'text-red-400';
    default:
      return 'text-gray-400';
  }
};

const getStatusIcon = (status: string) => {
  switch (status.toLowerCase()) {
    case 'downloading':
      return <ArrowDownTrayIcon className="h-5 w-5 animate-pulse" />;
    case 'completed':
      return <CheckCircleIcon className="h-5 w-5" />;
    case 'queued':
    case 'delay':
      return <ClockIcon className="h-5 w-5" />;
    case 'failed':
    case 'warning':
      return <ExclamationTriangleIcon className="h-5 w-5" />;
    default:
      return <ArrowDownTrayIcon className="h-5 w-5" />;
  }
};

const DownloadItem = ({ item }: { item: DownloadingItem }) => {
  const progress = item.size > 0 ? ((item.size - item.sizeLeft) / item.size) * 100 : 0;
  const downloaded = item.size - item.sizeLeft;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3">
          {item.mediaType === 'movie' ? (
            <FilmIcon className="mt-1 h-6 w-6 shrink-0 text-indigo-400" />
          ) : (
            <TvIcon className="mt-1 h-6 w-6 shrink-0 text-purple-400" />
          )}
          <div>
            <h3 className="font-medium text-gray-100">{item.title}</h3>
            {item.episode && (
              <p className="text-sm text-gray-400">
                Season {item.episode.seasonNumber} Episode {item.episode.episodeNumber}
              </p>
            )}
          </div>
        </div>
        <div className={`flex items-center space-x-2 ${getStatusColor(item.status)}`}>
          {getStatusIcon(item.status)}
          <span className="text-sm capitalize">{item.status}</span>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-gray-400">
            {formatBytes(downloaded)} / {formatBytes(item.size)}
          </span>
          <span className="text-gray-400">{progress.toFixed(1)}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-700">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        {item.timeLeft && item.status.toLowerCase() === 'downloading' && (
          <p className="mt-2 text-sm text-gray-500">
            <ClockIcon className="mr-1 inline h-4 w-4" />
            {item.timeLeft} remaining
          </p>
        )}
      </div>
    </div>
  );
};

const Downloads = () => {
  const { data, error, isLoading } = useSWR<DownloadsResponse>(
    '/api/v1/downloads',
    {
      refreshInterval: POLLING_INTERVALS.activeDownloads,
    }
  );

  const totalDownloads = (data?.movies.length || 0) + (data?.tv.length || 0);

  return (
    <>
      <PageTitle title="Downloads" />
      <div className="mb-6">
        <Header subtext="Active downloads from Radarr and Sonarr">
          Downloads
        </Header>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-gray-700 bg-gray-800 p-12">
          <ExclamationTriangleIcon className="h-12 w-12 text-red-400" />
          <p className="mt-4 text-gray-400">Failed to load downloads</p>
        </div>
      ) : totalDownloads === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-gray-700 bg-gray-800 p-12">
          <ArrowDownTrayIcon className="h-12 w-12 text-gray-600" />
          <p className="mt-4 text-lg font-medium text-gray-300">No active downloads</p>
          <p className="mt-2 text-gray-500">
            Downloads from Radarr and Sonarr will appear here
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {data?.movies && data.movies.length > 0 && (
            <section>
              <h2 className="mb-4 flex items-center text-xl font-semibold text-gray-100">
                <FilmIcon className="mr-2 h-6 w-6 text-indigo-400" />
                Movies ({data.movies.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.movies.map((item, index) => (
                  <DownloadItem key={`movie-${item.externalId}-${index}`} item={item} />
                ))}
              </div>
            </section>
          )}

          {data?.tv && data.tv.length > 0 && (
            <section>
              <h2 className="mb-4 flex items-center text-xl font-semibold text-gray-100">
                <TvIcon className="mr-2 h-6 w-6 text-purple-400" />
                TV Shows ({data.tv.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.tv.map((item, index) => (
                  <DownloadItem key={`tv-${item.externalId}-${item.episode?.id || index}`} item={item} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
};

export default Downloads;
