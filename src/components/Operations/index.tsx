import Badge from '@app/components/Common/Badge';
import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import { Permission, useUser } from '@app/hooks/useUser';
import Error from '@app/pages/_error';
import { POLLING_INTERVALS } from '@app/utils/pollingIntervals';
import {
  ArrowDownTrayIcon,
  ArrowRightCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  FilmIcon,
  ListBulletIcon,
  TvIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import useSWR from 'swr';

interface DownloadingItem {
  mediaType: 'movie' | 'tv';
  externalId: number;
  size: number;
  sizeLeft: number;
  status: string;
  timeLeft: string;
  title: string;
  episode?: {
    seasonNumber: number;
    episodeNumber: number;
    id: number;
  };
}

interface DownloadsResponse {
  movies: DownloadingItem[];
  tv: DownloadingItem[];
  recent: RecentDownloadItem[];
}

interface RecentDownloadItem extends DownloadingItem {
  completedAt: string;
  serverId: number;
  outcome: 'completed' | 'cleared';
}

interface ActivityItem {
  id: string;
  type: 'request' | 'watch' | 'download';
  mediaTitle: string;
  user?: string;
  status?: string;
  occurredAt: string;
}

interface PendingRequestSummary {
  id: number;
  createdAt: string;
  updatedAt: string;
  user: string;
  mediaType: 'movie' | 'tv';
  mediaTitle: string;
  tmdbId: number;
  status: 'pending' | 'approved' | 'declined' | 'failed';
  is4k: boolean;
  serverId?: number;
  serverName?: string;
  profileId?: number;
  profileName?: string;
  rootFolder?: string;
  tags?: number[];
}

interface PendingRequestsResponse {
  pageInfo: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results: PendingRequestSummary[];
}

const formatTime = (dateString?: string): string => {
  if (!dateString) {
    return 'Unknown time';
  }

  const seconds = Math.floor(
    (Date.now() - new Date(dateString).getTime()) / 1000
  );

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

const getRequestBadge = (
  status: PendingRequestSummary['status']
): 'default' | 'success' | 'warning' | 'danger' => {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'approved':
      return 'success';
    case 'declined':
    case 'failed':
      return 'danger';
    default:
      return 'default';
  }
};

const formatRequestStatus = (
  status: PendingRequestSummary['status']
): string => {
  return status.charAt(0).toUpperCase() + status.slice(1);
};

const formatRequestRouting = (request: PendingRequestSummary): string => {
  const details = [
    request.serverName ?? (request.serverId ? `Server ${request.serverId}` : ''),
    request.profileName ??
      (request.profileId ? `Profile ${request.profileId}` : ''),
    request.rootFolder,
    request.tags?.length ? `${request.tags.length} tags` : '',
  ].filter(Boolean);

  return details.join(' · ');
};

const DownloadRow = ({ item }: { item: DownloadingItem }) => {
  const progress =
    item.size > 0 ? ((item.size - item.sizeLeft) / item.size) * 100 : 0;

  return (
    <div className="rounded-md border border-gray-700 bg-gray-800 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {item.mediaType === 'movie' ? (
            <FilmIcon className="mt-0.5 h-5 w-5 shrink-0 text-indigo-400" />
          ) : (
            <TvIcon className="mt-0.5 h-5 w-5 shrink-0 text-purple-400" />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-gray-100">
              {item.title}
            </div>
            <div className="text-xs text-gray-400">
              {item.episode
                ? `S${item.episode.seasonNumber} E${item.episode.episodeNumber}`
                : item.mediaType === 'movie'
                ? 'Movie'
                : 'Series'}
            </div>
          </div>
        </div>
        <Badge badgeType="dark">{item.status}</Badge>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-700">
        <div
          className="h-full rounded-full bg-indigo-500"
          style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }}
        />
      </div>
      {item.timeLeft && (
        <div className="mt-2 text-xs text-gray-500">{item.timeLeft} left</div>
      )}
    </div>
  );
};

const RecentDownloadRow = ({ item }: { item: RecentDownloadItem }) => {
  return (
    <div className="rounded-md border border-gray-700 bg-gray-800 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {item.mediaType === 'movie' ? (
            <FilmIcon className="mt-0.5 h-5 w-5 shrink-0 text-indigo-400" />
          ) : (
            <TvIcon className="mt-0.5 h-5 w-5 shrink-0 text-purple-400" />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-gray-100">
              {item.title}
            </div>
            <div className="text-xs text-gray-400">
              {formatTime(item.completedAt)}
              {item.episode
                ? ` · S${item.episode.seasonNumber} E${item.episode.episodeNumber}`
                : ''}
            </div>
          </div>
        </div>
        <Badge badgeType={item.outcome === 'completed' ? 'success' : 'dark'}>
          {item.outcome}
        </Badge>
      </div>
    </div>
  );
};

const Operations = () => {
  const { hasPermission, loading } = useUser();
  const canManageRequests = hasPermission(Permission.MANAGE_REQUESTS);

  const { data: downloads, error: downloadsError } = useSWR<DownloadsResponse>(
    canManageRequests ? '/api/v1/downloads' : null,
    { refreshInterval: POLLING_INTERVALS.activeDownloads }
  );
  const { data: pendingRequests } = useSWR<PendingRequestsResponse>(
    canManageRequests
      ? '/api/v1/stats/pending-requests?take=6&skip=0'
      : null
  );
  const { data: activity } = useSWR<ActivityItem[]>(
    canManageRequests ? '/api/v1/stats/recent?take=8' : null,
    { refreshInterval: POLLING_INTERVALS.operationsActivity }
  );

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!canManageRequests) {
    return <Error statusCode={403} />;
  }

  const activeDownloads = [
    ...(downloads?.movies ?? []),
    ...(downloads?.tv ?? []),
  ];
  const downloadCount = activeDownloads.length;
  const pendingCount = pendingRequests?.pageInfo.results ?? 0;

  return (
    <>
      <PageTitle title="Operations" />
      <div className="mb-6">
        <Header subtext="Requests, downloads, and recent server activity">
          Operations
        </Header>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-md border border-gray-700 bg-gray-800 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-400">
              Active Downloads
            </span>
            <ArrowDownTrayIcon className="h-5 w-5 text-indigo-400" />
          </div>
          <div className="mt-2 text-3xl font-semibold text-gray-100">
            {downloadCount}
          </div>
        </div>
        <div className="rounded-md border border-gray-700 bg-gray-800 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-400">
              Pending Requests
            </span>
            <ClockIcon className="h-5 w-5 text-yellow-400" />
          </div>
          <div className="mt-2 text-3xl font-semibold text-gray-100">
            {pendingCount}
          </div>
        </div>
        <div className="rounded-md border border-gray-700 bg-gray-800 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-400">
              Recent Activity
            </span>
            <ListBulletIcon className="h-5 w-5 text-green-400" />
          </div>
          <div className="mt-2 text-3xl font-semibold text-gray-100">
            {activity?.length ?? 0}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-100">
              Active Downloads
            </h2>
            <Link href="/downloads">
              <a className="inline-flex items-center text-sm text-indigo-400 hover:text-indigo-300">
                View all
                <ArrowRightCircleIcon className="ml-1 h-4 w-4" />
              </a>
            </Link>
          </div>
          {downloadsError ? (
            <div className="rounded-md border border-red-700 bg-gray-800 p-4 text-sm text-red-300">
              Failed to load downloads
            </div>
          ) : !downloads ? (
            <LoadingSpinner />
          ) : activeDownloads.length === 0 ? (
            <div className="rounded-md border border-gray-700 bg-gray-800 p-6 text-sm text-gray-400">
              No active downloads.
            </div>
          ) : (
            <div className="space-y-3">
              {activeDownloads.slice(0, 6).map((item, index) => (
                <DownloadRow
                  key={`ops-download-${item.mediaType}-${item.externalId}-${index}`}
                  item={item}
                />
              ))}
            </div>
          )}

          {downloads?.recent && downloads.recent.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
                Recent Completions
              </h3>
              <div className="space-y-3">
                {downloads.recent.slice(0, 5).map((item, index) => (
                  <RecentDownloadRow
                    key={`ops-recent-download-${item.mediaType}-${item.externalId}-${index}`}
                    item={item}
                  />
                ))}
              </div>
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-100">
              Pending Requests
            </h2>
            <Link href="/requests?filter=pending">
              <a className="inline-flex items-center text-sm text-indigo-400 hover:text-indigo-300">
                Manage
                <ArrowRightCircleIcon className="ml-1 h-4 w-4" />
              </a>
            </Link>
          </div>
          {!pendingRequests ? (
            <LoadingSpinner />
          ) : pendingRequests.results.length === 0 ? (
            <div className="rounded-md border border-gray-700 bg-gray-800 p-6 text-sm text-gray-400">
              No pending requests.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingRequests.results.map((request) => {
                const routing = formatRequestRouting(request);

                return (
                  <div
                    key={`ops-request-${request.id}`}
                    className="rounded-md border border-gray-700 bg-gray-800 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-100">
                          {request.mediaTitle}
                        </div>
                        <div className="mt-1 text-xs text-gray-400">
                          Requested by {request.user} ·{' '}
                          {formatTime(request.createdAt)}
                          {request.is4k ? ' · 4K' : ''}
                        </div>
                        {routing && (
                          <div className="mt-1 truncate text-xs text-gray-500">
                            {routing}
                          </div>
                        )}
                      </div>
                      <Badge badgeType={getRequestBadge(request.status)}>
                        {formatRequestStatus(request.status)}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-100">
            Recent Activity
          </h2>
          <Link href="/requests?filter=all">
            <a className="inline-flex items-center text-sm text-indigo-400 hover:text-indigo-300">
              Requests
              <ArrowRightCircleIcon className="ml-1 h-4 w-4" />
            </a>
          </Link>
        </div>
        {!activity ? (
          <LoadingSpinner />
        ) : activity.length === 0 ? (
          <div className="rounded-md border border-gray-700 bg-gray-800 p-6 text-sm text-gray-400">
            No recent activity.
          </div>
        ) : (
          <div className="divide-y divide-gray-700 rounded-md border border-gray-700 bg-gray-800">
            {activity.map((item) => (
              <div
                key={`ops-activity-${item.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-gray-100">
                    {item.mediaTitle}
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    {item.user ? `${item.user} · ` : ''}
                    {formatTime(item.occurredAt)}
                  </div>
                </div>
                {item.type === 'request' ? (
                  <Badge badgeType="warning">{item.status ?? 'request'}</Badge>
                ) : item.type === 'watch' ? (
                  <CheckCircleIcon className="h-5 w-5 shrink-0 text-green-400" />
                ) : (
                  <ArrowDownTrayIcon className="h-5 w-5 shrink-0 text-indigo-400" />
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
};

export default Operations;
