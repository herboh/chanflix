import Link from 'next/link';
import useSWR from 'swr';
import { StarIcon } from '@heroicons/react/24/solid';
import { ChatBubbleLeftIcon } from '@heroicons/react/24/outline';

interface Review {
  id: number;
  rating: number;
  content: string;
  createdAt: string;
  user: {
    id: number;
    displayName: string;
    avatar?: string;
  };
  media: {
    id: number;
    tmdbId: number;
    mediaType: string;
  };
}

interface ReviewResponse {
  pageInfo: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results: Review[];
}

const formatTimeAgo = (dateString: string): string => {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
};

const LatestReviewWidget = () => {
  const { data, error } = useSWR<ReviewResponse>(
    '/api/v1/review/recent?take=3',
    { refreshInterval: 120000 } // Refresh every 2 minutes
  );

  const isLoading = !data && !error;
  const reviews = data?.results || [];

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center text-lg font-semibold text-gray-100">
          <StarIcon className="mr-2 h-5 w-5 text-yellow-500" />
          Latest Reviews
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
          Unable to load reviews
        </div>
      ) : reviews.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-gray-500">
          <div className="text-center">
            <ChatBubbleLeftIcon className="mx-auto h-8 w-8 text-gray-600" />
            <p className="mt-2">No reviews yet</p>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {reviews.map((review) => (
            <li key={review.id}>
              <Link
                href={`/${review.media.mediaType}/${review.media.tmdbId}`}
                className="block rounded-md p-2 transition hover:bg-gray-700/50"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-gray-200">
                        {review.user.displayName}
                      </span>
                      <div className="flex items-center">
                        {[...Array(5)].map((_, i) => (
                          <StarIcon
                            key={i}
                            className={`h-3 w-3 ${
                              i < review.rating
                                ? 'text-yellow-500'
                                : 'text-gray-600'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                    {review.content && (
                      <p className="mt-1 line-clamp-2 text-xs text-gray-400">
                        {review.content}
                      </p>
                    )}
                  </div>
                  <span className="ml-2 shrink-0 text-xs text-gray-500">
                    {formatTimeAgo(review.createdAt)}
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

export default LatestReviewWidget;
