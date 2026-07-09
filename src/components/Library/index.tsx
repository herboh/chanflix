import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import RetrySearchButton from '@app/components/Common/RetrySearchButton';
import { Permission, useUser } from '@app/hooks/useUser';
import {
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  FilmIcon,
  FolderIcon,
  TvIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

interface LibraryItem {
  id?: number;
  tmdbId?: number;
  tvdbId?: number;
  ratingKey?: string;
  title: string;
  year?: number;
  mediaType: 'movie' | 'tv';
  status:
    | 'available'
    | 'pending'
    | 'processing'
    | 'stalled'
    | 'partial'
    | 'unknown';
  addedAt?: number;
  posterPath?: string;
}

interface LibraryResponse {
  pageInfo: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results: LibraryItem[];
}

type TypeFilter = 'movie' | 'tv';
type StatusFilter = 'all' | 'available' | 'missing' | 'downloading';
type StatusTone = 'available' | 'missing' | 'downloading';

const getLibraryStatusTone = (status: LibraryItem['status']): StatusTone => {
  if (status === 'available') {
    return 'available';
  }

  if (status === 'processing') {
    return 'downloading';
  }

  return 'missing';
};

const getStatusLabel = (status: LibraryItem['status']) => {
  const tone = getLibraryStatusTone(status);

  switch (tone) {
    case 'available':
      return 'Available';
    case 'downloading':
      return 'Downloading';
    case 'missing':
    default:
      return 'Missing';
  }
};

const getStatusIcon = (status: LibraryItem['status']) => {
  const tone = getLibraryStatusTone(status);

  switch (tone) {
    case 'available':
      return <CheckCircleIcon className="h-4 w-4" />;
    case 'downloading':
      return <ArrowDownTrayIcon className="h-4 w-4 animate-pulse" />;
    case 'missing':
    default:
      return <ExclamationTriangleIcon className="h-4 w-4" />;
  }
};

const getFirstLetter = (title: string) => {
  const first = title.trim().charAt(0).toUpperCase();

  return /^[A-Z]$/.test(first) ? first : '#';
};

const getRowClasses = (status: LibraryItem['status']) => {
  const tone = getLibraryStatusTone(status);
  const base =
    'group flex min-h-[3.75rem] items-center border-l-4 px-3 py-3 transition sm:px-4';

  switch (tone) {
    case 'available':
      return `${base} border-l-green-500/70 bg-gray-800 hover:bg-gray-750`;
    case 'downloading':
      return `${base} border-l-blue-400/80 bg-blue-950/20 hover:bg-blue-950/30`;
    case 'missing':
    default:
      return `${base} border-l-gray-700 bg-gray-800/60 hover:bg-gray-800`;
  }
};

const getStatusBadgeClasses = (status: LibraryItem['status']) => {
  const tone = getLibraryStatusTone(status);
  const base =
    'inline-flex min-w-[6.5rem] items-center justify-center rounded-full px-2 py-1 text-xs font-medium';

  switch (tone) {
    case 'available':
      return `${base} bg-green-900/40 text-green-300 ring-1 ring-green-500/20`;
    case 'downloading':
      return `${base} bg-blue-900/40 text-blue-200 ring-1 ring-blue-400/20`;
    case 'missing':
    default:
      return `${base} bg-gray-900/70 text-gray-500 ring-1 ring-gray-700/70`;
  }
};

const LibraryRow = ({
  item,
  canRetry,
}: {
  item: LibraryItem;
  canRetry: boolean;
}) => {
  const href = item.tmdbId ? `/${item.mediaType}/${item.tmdbId}` : '#';
  const tone = getLibraryStatusTone(item.status);
  const showRetry =
    canRetry &&
    Boolean(item.tmdbId) &&
    (tone === 'missing' || tone === 'downloading');

  return (
    <Link href={href}>
      <a className={getRowClasses(item.status)}>
        <div className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-700 bg-gray-900/70 text-gray-400 sm:mr-4">
          {item.mediaType === 'movie' ? (
            <FilmIcon className="h-5 w-5" />
          ) : (
            <TvIcon className="h-5 w-5" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div
            className={`truncate text-sm font-medium sm:text-base ${
              tone === 'missing'
                ? 'text-gray-400 group-hover:text-gray-200'
                : 'text-gray-100 group-hover:text-indigo-300'
            }`}
          >
            {item.title}
          </div>
          <div className="mt-0.5 flex items-center text-xs text-gray-500">
            <span>{item.mediaType === 'movie' ? 'Movie' : 'Series'}</span>
            {item.year && (
              <>
                <span className="mx-2 h-1 w-1 rounded-full bg-gray-700" />
                <span>{item.year}</span>
              </>
            )}
          </div>
        </div>

        <div className="ml-3 flex shrink-0 items-center gap-2 sm:ml-4">
          <span className={getStatusBadgeClasses(item.status)}>
            <span className="mr-1.5">{getStatusIcon(item.status)}</span>
            <span className="hidden sm:inline">
              {getStatusLabel(item.status)}
            </span>
          </span>
          {showRetry && item.tmdbId && (
            <span className="hidden sm:block">
              <RetrySearchButton
                mediaType={item.mediaType}
                tmdbId={item.tmdbId}
                title={item.title}
                compact
              />
            </span>
          )}
          <ChevronRightIcon className="h-4 w-4 text-gray-600 transition group-hover:text-gray-300" />
        </div>
      </a>
    </Link>
  );
};

const Library = () => {
  const { hasPermission } = useUser();
  const canRetry = hasPermission(Permission.MANAGE_REQUESTS);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('movie');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const pageSize = 250;

  const { data, error, isLoading } = useSWR<LibraryResponse>(
    `/api/v1/library?type=${typeFilter}&status=${statusFilter}&take=${pageSize}&skip=${
      (page - 1) * pageSize
    }&sort=title`
  );

  const groupedResults = useMemo(() => {
    return (data?.results ?? []).reduce<Record<string, LibraryItem[]>>(
      (groups, item) => {
        const letter = getFirstLetter(item.title);

        groups[letter] = groups[letter] ?? [];
        groups[letter].push(item);

        return groups;
      },
      {}
    );
  }, [data?.results]);

  const letters = useMemo(
    () => Object.keys(groupedResults).sort(),
    [groupedResults]
  );

  const setType = (type: TypeFilter) => {
    setTypeFilter(type);
    setPage(1);
  };

  const setStatus = (status: StatusFilter) => {
    setStatusFilter(status);
    setPage(1);
  };

  return (
    <>
      <PageTitle title="Library" />
      <div className="mb-6">
        <Header subtext="Browse your media collection">Library</Header>
      </div>

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="inline-flex w-full rounded-md border border-gray-700 bg-gray-900 p-1 md:w-auto">
          <button
            onClick={() => setType('movie')}
            className={`flex flex-1 items-center justify-center rounded px-3 py-2 text-sm font-medium transition md:flex-none ${
              typeFilter === 'movie'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
            }`}
          >
            <FilmIcon className="mr-1.5 h-4 w-4" />
            Movies
          </button>
          <button
            onClick={() => setType('tv')}
            className={`flex flex-1 items-center justify-center rounded px-3 py-2 text-sm font-medium transition md:flex-none ${
              typeFilter === 'tv'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
            }`}
          >
            <TvIcon className="mr-1.5 h-4 w-4" />
            Series
          </button>
        </div>

        <div className="flex overflow-x-auto rounded-md border border-gray-700 bg-gray-900 p-1">
          {(
            [
              ['all', 'All'],
              ['available', 'Available'],
              ['missing', 'Missing'],
              ['downloading', 'Downloading'],
            ] as [StatusFilter, string][]
          ).map(([status, label]) => (
            <button
              key={status}
              onClick={() => setStatus(status)}
              className={`whitespace-nowrap rounded px-3 py-2 text-sm font-medium transition ${
                statusFilter === status
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {data && (
        <div className="mb-3 flex items-center justify-between text-sm text-gray-400">
          <span>
            {data.pageInfo.results}{' '}
            {typeFilter === 'movie' ? 'movies' : 'series'}
          </span>
          <span>A-Z</span>
        </div>
      )}

      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-gray-700 bg-gray-800 p-12">
          <ExclamationTriangleIcon className="h-12 w-12 text-red-400" />
          <p className="mt-4 text-gray-400">Failed to load library</p>
        </div>
      ) : !data || data.results.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-gray-700 bg-gray-800 p-12">
          <FolderIcon className="h-12 w-12 text-gray-600" />
          <p className="mt-4 text-lg font-medium text-gray-300">
            No items found
          </p>
          <p className="mt-2 text-gray-500">
            No {statusFilter === 'all' ? '' : `${statusFilter} `}
            {typeFilter === 'movie' ? 'movies' : 'series'} matched this view
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-md border border-gray-700">
            {letters.map((letter) => (
              <section key={letter}>
                <div className="border-y border-gray-700 bg-gray-900 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 first:border-t-0 sm:px-4">
                  {letter}
                </div>
                <div className="divide-y divide-gray-700/70">
                  {groupedResults[letter].map((item, index) => (
                    <LibraryRow
                      key={`${
                        item.ratingKey || item.tmdbId || item.id || index
                      }-${item.mediaType}`}
                      item={item}
                      canRetry={canRetry}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {data.pageInfo.pages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <span className="px-4 text-sm text-gray-400">
                Page {page} of {data.pageInfo.pages}
              </span>
              <button
                onClick={() => setPage(Math.min(data.pageInfo.pages, page + 1))}
                disabled={page >= data.pageInfo.pages}
                className="rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
};

export default Library;
