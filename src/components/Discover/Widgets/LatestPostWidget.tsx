import Link from 'next/link';
import useSWR from 'swr';
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/solid';
import { ChatBubbleOvalLeftIcon } from '@heroicons/react/24/outline';

interface BoardPost {
  id: number;
  message: string;
  createdAt: string;
  user: {
    id: number;
    displayName: string;
    avatar?: string;
  };
}

interface BoardResponse {
  pageInfo: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results: BoardPost[];
}

const formatTimeAgo = (dateString: string): string => {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
};

const LatestPostWidget = () => {
  const { data, error } = useSWR<BoardResponse>(
    '/api/v1/board?take=3',
    { refreshInterval: 60000 } // Refresh every minute
  );

  const isLoading = !data && !error;
  const posts = data?.results || [];

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center text-lg font-semibold text-gray-100">
          <ChatBubbleLeftRightIcon className="mr-2 h-5 w-5 text-green-500" />
          Message Board
        </h2>
        <Link
          href="/community"
          className="text-xs text-indigo-400 hover:text-indigo-300"
        >
          View all
        </Link>
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-gray-400" />
        </div>
      ) : error ? (
        <div className="flex h-32 items-center justify-center text-sm text-gray-500">
          Unable to load posts
        </div>
      ) : posts.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-gray-500">
          <div className="text-center">
            <ChatBubbleOvalLeftIcon className="mx-auto h-8 w-8 text-gray-600" />
            <p className="mt-2">No posts yet</p>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {posts.map((post) => (
            <li key={post.id}>
              <Link
                href="/community"
                className="block rounded-md p-2 transition hover:bg-gray-700/50"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-gray-200">
                      {post.user.displayName}
                    </span>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-400">
                      {post.message}
                    </p>
                  </div>
                  <span className="ml-2 shrink-0 text-xs text-gray-500">
                    {formatTimeAgo(post.createdAt)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default LatestPostWidget;
