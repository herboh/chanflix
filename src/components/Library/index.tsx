import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import {
  FilmIcon,
  TvIcon,
  CheckCircleIcon,
  ClockIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  FolderIcon,
  AdjustmentsHorizontalIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

interface LibraryItem {
  id?: number;
  tmdbId?: number;
  tvdbId?: number;
  ratingKey?: string;
  title: string;
  year?: number;
  mediaType: 'movie' | 'tv';
  status: 'available' | 'pending' | 'processing' | 'partial' | 'unknown';
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

const getStatusBadge = (status: LibraryItem['status']) => {
  switch (status) {
    case 'available':
      return (
        <span className="flex items-center rounded-full bg-green-900/50 px-2 py-1 text-xs text-green-400">
          <CheckCircleIcon className="mr-1 h-3 w-3" />
          Available
        </span>
      );
    case 'pending':
      return (
        <span className="flex items-center rounded-full bg-yellow-900/50 px-2 py-1 text-xs text-yellow-400">
          <ClockIcon className="mr-1 h-3 w-3" />
          Pending
        </span>
      );
    case 'processing':
      return (
        <span className="flex items-center rounded-full bg-blue-900/50 px-2 py-1 text-xs text-blue-400">
          <ArrowPathIcon className="mr-1 h-3 w-3 animate-spin" />
          Processing
        </span>
      );
    case 'partial':
      return (
        <span className="flex items-center rounded-full bg-orange-900/50 px-2 py-1 text-xs text-orange-400">
          <ExclamationTriangleIcon className="mr-1 h-3 w-3" />
          Partial
        </span>
      );
    default:
      return (
        <span className="flex items-center rounded-full bg-gray-700 px-2 py-1 text-xs text-gray-400">
          Unknown
        </span>
      );
  }
};

const LibraryCard = ({ item }: { item: LibraryItem }) => {
  const href = item.tmdbId
    ? `/${item.mediaType}/${item.tmdbId}`
    : '#';

  return (
    <Link href={href}>
      <a className="group block overflow-hidden rounded-lg border border-gray-700 bg-gray-800 transition hover:border-indigo-500 hover:bg-gray-750">
        <div className="aspect-[2/3] w-full bg-gray-900">
          {item.posterPath ? (
            <img
              src={`https://image.tmdb.org/t/p/w300${item.posterPath}`}
              alt={item.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              {item.mediaType === 'movie' ? (
                <FilmIcon className="h-16 w-16 text-gray-700" />
              ) : (
                <TvIcon className="h-16 w-16 text-gray-700" />
              )}
            </div>
          )}
        </div>
        <div className="p-3">
          <div className="mb-2 flex items-start justify-between">
            {item.mediaType === 'movie' ? (
              <FilmIcon className="h-4 w-4 shrink-0 text-indigo-400" />
            ) : (
              <TvIcon className="h-4 w-4 shrink-0 text-purple-400" />
            )}
            {getStatusBadge(item.status)}
          </div>
          <h3 className="truncate font-medium text-gray-100 group-hover:text-indigo-400">
            {item.title}
          </h3>
          {item.year && (
            <p className="text-sm text-gray-500">{item.year}</p>
          )}
        </div>
      </a>
    </Link>
  );
};

const Library = () => {
  const [typeFilter, setTypeFilter] = useState<'all' | 'movie' | 'tv'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'pending'>('all');
  const [page, setPage] = useState(1);
  const pageSize = 24;

  const { data, error, isLoading } = useSWR<LibraryResponse>(
    `/api/v1/library?type=${typeFilter}&status=${statusFilter}&take=${pageSize}&skip=${(page - 1) * pageSize}&sort=added`
  );

  return (
    <>
      <PageTitle title="Library" />
      <div className="mb-6">
        <Header subtext="Browse your media collection">Library</Header>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-gray-700 bg-gray-800 p-4">
        <div className="flex items-center gap-2">
          <AdjustmentsHorizontalIcon className="h-5 w-5 text-gray-400" />
          <span className="text-sm font-medium text-gray-300">Filters:</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => { setTypeFilter('all'); setPage(1); }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              typeFilter === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            All Types
          </button>
          <button
            onClick={() => { setTypeFilter('movie'); setPage(1); }}
            className={`flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition ${
              typeFilter === 'movie'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <FilmIcon className="mr-1.5 h-4 w-4" />
            Movies
          </button>
          <button
            onClick={() => { setTypeFilter('tv'); setPage(1); }}
            className={`flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition ${
              typeFilter === 'tv'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <TvIcon className="mr-1.5 h-4 w-4" />
            TV Shows
          </button>
        </div>

        <div className="h-6 w-px bg-gray-600" />

        <div className="flex gap-2">
          <button
            onClick={() => { setStatusFilter('all'); setPage(1); }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              statusFilter === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            All Status
          </button>
          <button
            onClick={() => { setStatusFilter('available'); setPage(1); }}
            className={`flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition ${
              statusFilter === 'available'
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <CheckCircleIcon className="mr-1.5 h-4 w-4" />
            Available
          </button>
          <button
            onClick={() => { setStatusFilter('pending'); setPage(1); }}
            className={`flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition ${
              statusFilter === 'pending'
                ? 'bg-yellow-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <ClockIcon className="mr-1.5 h-4 w-4" />
            Pending
          </button>
        </div>
      </div>

      {/* Results count */}
      {data && (
        <p className="mb-4 text-sm text-gray-400">
          Showing {data.results.length} of {data.pageInfo.results} items
        </p>
      )}

      {/* Content */}
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
          <p className="mt-4 text-lg font-medium text-gray-300">No items found</p>
          <p className="mt-2 text-gray-500">
            {statusFilter === 'pending'
              ? 'No pending requests'
              : 'Your library is empty or no items match the filters'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {data.results.map((item, index) => (
              <LibraryCard
                key={`${item.ratingKey || item.tmdbId || index}-${item.mediaType}`}
                item={item}
              />
            ))}
          </div>

          {/* Pagination */}
          {data.pageInfo.pages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-2">
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
