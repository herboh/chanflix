import CachedImage from '@app/components/Common/CachedImage';
import { POLLING_INTERVALS } from '@app/utils/pollingIntervals';
import {
  ArrowDownTrayIcon,
  CheckCircleIcon,
  FilmIcon,
  PauseIcon,
  PlayIcon,
  SignalIcon,
  TvIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import useSWR from 'swr';

interface NowStream {
  id: string;
  user: string;
  state: string;
  mediaType: 'movie' | 'episode' | 'other';
  title: string;
  episodeTitle?: string;
  progressPercent: number;
  player: string;
  year?: number;
  tmdbId?: number;
  posterPath?: string;
}

interface NowDownload {
  mediaType: 'movie' | 'tv';
  externalId: number;
  title: string;
  status: string;
  size: number;
  sizeLeft: number;
  timeLeft: string;
  estimatedCompletionTime: string;
  episode?: {
    seasonNumber: number;
    episodeNumber: number;
    id: number;
  };
  tmdbId?: number;
  posterPath?: string;
}

interface NowRecentDownload extends NowDownload {
  completedAt: string;
  outcome: 'completed' | 'cleared';
}

interface NowResponse {
  streams: NowStream[];
  downloads: NowDownload[];
  recentlyFinished: NowRecentDownload[];
  updatedAt: string;
}

const formatTimeAgo = (timestamp: string): string => {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)
  );

  if (seconds < 60) return 'just now';
  return `${Math.floor(seconds / 60)}m ago`;
};

const Poster = ({
  posterPath,
  mediaType,
  title,
}: {
  posterPath?: string;
  mediaType: 'movie' | 'episode' | 'tv' | 'other';
  title: string;
}) => {
  if (posterPath) {
    return (
      <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded bg-gray-900">
        <CachedImage
          src={`https://image.tmdb.org/t/p/w154${posterPath}`}
          alt={title}
          layout="fill"
          objectFit="cover"
        />
      </div>
    );
  }

  return (
    <div className="flex h-16 w-11 shrink-0 items-center justify-center rounded bg-gray-900">
      {mediaType === 'movie' ? (
        <FilmIcon className="h-5 w-5 text-gray-600" />
      ) : (
        <TvIcon className="h-5 w-5 text-gray-600" />
      )}
    </div>
  );
};

const MaybeLink = ({
  tmdbId,
  mediaType,
  children,
}: {
  tmdbId?: number;
  mediaType: 'movie' | 'episode' | 'tv' | 'other';
  children: React.ReactNode;
}) => {
  if (!tmdbId) {
    return <>{children}</>;
  }

  const href = `/${mediaType === 'movie' ? 'movie' : 'tv'}/${tmdbId}`;

  return (
    <Link href={href}>
      <a className="hover:underline">{children}</a>
    </Link>
  );
};

const StreamRow = ({ stream }: { stream: NowStream }) => (
  <div className="flex items-center gap-3 rounded-md p-2 transition hover:bg-gray-700/50">
    <Poster
      posterPath={stream.posterPath}
      mediaType={stream.mediaType}
      title={stream.title}
    />
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm text-gray-200">
        <span className="font-medium">{stream.user}</span>
        <span className="text-gray-400"> is watching </span>
        <MaybeLink tmdbId={stream.tmdbId} mediaType={stream.mediaType}>
          <span className="font-medium">{stream.title}</span>
        </MaybeLink>
      </p>
      {stream.episodeTitle && (
        <p className="truncate text-xs text-gray-500">{stream.episodeTitle}</p>
      )}
      <div className="mt-1.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-700">
          <div
            className="h-full rounded-full bg-green-500"
            style={{ width: `${stream.progressPercent}%` }}
          />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-gray-500">
          {Math.round(stream.progressPercent)}%
        </span>
      </div>
      <p className="mt-0.5 truncate text-xs text-gray-500">{stream.player}</p>
    </div>
    <div className="shrink-0">
      {stream.state === 'paused' ? (
        <PauseIcon className="h-5 w-5 text-yellow-400" />
      ) : (
        <PlayIcon className="h-5 w-5 text-green-400" />
      )}
    </div>
  </div>
);

const DownloadRow = ({ item }: { item: NowDownload }) => {
  const progress =
    item.size > 0 ? ((item.size - item.sizeLeft) / item.size) * 100 : 0;

  return (
    <div className="flex items-center gap-3 rounded-md p-2 transition hover:bg-gray-700/50">
      <Poster
        posterPath={item.posterPath}
        mediaType={item.mediaType}
        title={item.title}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-gray-200">
          <MaybeLink tmdbId={item.tmdbId} mediaType={item.mediaType}>
            <span className="font-medium">{item.title}</span>
          </MaybeLink>
        </p>
        <p className="truncate text-xs text-gray-500">
          {item.episode
            ? `S${item.episode.seasonNumber} E${item.episode.episodeNumber} · `
            : ''}
          {item.status}
          {item.timeLeft ? ` · ${item.timeLeft} left` : ''}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-700">
            <div
              className="h-full rounded-full bg-blue-500"
              style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }}
            />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-gray-500">
            {Math.round(Math.max(0, Math.min(progress, 100)))}%
          </span>
        </div>
      </div>
      <ArrowDownTrayIcon className="h-5 w-5 shrink-0 text-blue-400" />
    </div>
  );
};

const FinishedRow = ({ item }: { item: NowRecentDownload }) => (
  <div className="flex items-center gap-3 rounded-md p-2 transition hover:bg-gray-700/50">
    <Poster
      posterPath={item.posterPath}
      mediaType={item.mediaType}
      title={item.title}
    />
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm text-gray-200">
        <MaybeLink tmdbId={item.tmdbId} mediaType={item.mediaType}>
          <span className="font-medium">{item.title}</span>
        </MaybeLink>
      </p>
      <p className="truncate text-xs text-gray-500">
        {item.episode
          ? `S${item.episode.seasonNumber} E${item.episode.episodeNumber} · `
          : ''}
        Finished {formatTimeAgo(item.completedAt)}
      </p>
    </div>
    <CheckCircleIcon className="h-5 w-5 shrink-0 text-green-400" />
  </div>
);

const NowWidget = () => {
  const { data, error } = useSWR<NowResponse>('/api/v1/stats/now', {
    refreshInterval: POLLING_INTERVALS.nowPanel,
  });

  const isLoading = !data && !error;
  const streams = data?.streams ?? [];
  const downloads = data?.downloads ?? [];
  const recentlyFinished = data?.recentlyFinished ?? [];
  const isLive = streams.length > 0 || downloads.length > 0;
  const isEmpty =
    streams.length === 0 &&
    downloads.length === 0 &&
    recentlyFinished.length === 0;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center text-lg font-semibold text-gray-100">
          <SignalIcon className="mr-2 h-5 w-5 text-green-400" />
          Now
          {isLive && (
            <span className="ml-2 inline-flex items-center">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
            </span>
          )}
        </h2>
      </div>

      {isLoading ? (
        <div className="flex h-16 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-gray-400" />
        </div>
      ) : error ? (
        <div className="py-2 text-sm text-gray-500">
          Unable to load live activity
        </div>
      ) : isEmpty ? (
        <div className="py-2 text-sm text-gray-500">
          Nothing playing or downloading right now.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
          {streams.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Watching
              </h3>
              <div className="space-y-1">
                {streams.map((stream) => (
                  <StreamRow key={stream.id} stream={stream} />
                ))}
              </div>
            </div>
          )}
          {(downloads.length > 0 || recentlyFinished.length > 0) && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Downloading
              </h3>
              <div className="space-y-1">
                {downloads.map((item, index) => (
                  <DownloadRow
                    key={`now-download-${item.mediaType}-${item.externalId}-${index}`}
                    item={item}
                  />
                ))}
                {recentlyFinished.map((item, index) => (
                  <FinishedRow
                    key={`now-finished-${item.mediaType}-${item.externalId}-${index}`}
                    item={item}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NowWidget;
