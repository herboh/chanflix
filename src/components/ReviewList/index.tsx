import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import type { User } from '@server/entity/User';
import Link from 'next/link';
import { defineMessages, FormattedRelativeTime, useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages({
  reviews: 'Recent Reviews',
  reviewsDescription: 'See what others are watching and rating',
  noReviews: 'No reviews yet. Be the first to review something!',
});

interface Media {
  id: number;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
}

interface Review {
  id: number;
  user: User;
  media: Media;
  rating: number;
  content: string | null;
  createdAt: string;
}

interface ReviewResultsResponse {
  pageInfo: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results: Review[];
}

const StarRating = ({ rating }: { rating: number }) => {
  return (
    <div className="flex items-center">
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          className={`text-lg ${
            star <= rating ? 'text-yellow-400' : 'text-gray-600'
          }`}
        >
          ★
        </span>
      ))}
    </div>
  );
};

const ReviewList = () => {
  const intl = useIntl();

  const { data, error } = useSWR<ReviewResultsResponse>(
    '/api/v1/review/recent?take=50'
  );

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.reviews)} />
      <div className="mb-6">
        <Header subtext={intl.formatMessage(messages.reviewsDescription)}>
          {intl.formatMessage(messages.reviews)}
        </Header>
      </div>

      <div className="space-y-4">
        {data?.results.length === 0 ? (
          <div className="rounded-lg bg-gray-800 p-8 text-center text-gray-400">
            {intl.formatMessage(messages.noReviews)}
          </div>
        ) : (
          data?.results.map((review) => (
            <div
              key={review.id}
              className="rounded-lg bg-gray-800 p-4 shadow ring-1 ring-gray-700"
            >
              <div className="flex space-x-4">
                <Link href={`/users/${review.user.id}`}>
                  <a className="flex-shrink-0">
                    <img
                      src={review.user.avatar}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover ring-1 ring-gray-600 transition duration-300 hover:ring-indigo-500"
                    />
                  </a>
                </Link>
                <div className="flex-grow">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Link href={`/users/${review.user.id}`}>
                        <a className="font-medium text-gray-100 hover:text-white hover:underline">
                          {review.user.displayName}
                        </a>
                      </Link>
                      <span className="text-gray-500">reviewed</span>
                      <Link
                        href={`/${review.media.mediaType}/${review.media.tmdbId}`}
                      >
                        <a className="font-medium text-indigo-400 hover:text-indigo-300 hover:underline">
                          a {review.media.mediaType === 'movie' ? 'movie' : 'show'}
                        </a>
                      </Link>
                    </div>
                    <span className="text-sm text-gray-500">
                      <FormattedRelativeTime
                        value={Math.floor(
                          (new Date(review.createdAt).getTime() - Date.now()) /
                            1000
                        )}
                        updateIntervalInSeconds={60}
                        numeric="auto"
                      />
                    </span>
                  </div>
                  <div className="mt-2">
                    <StarRating rating={review.rating} />
                  </div>
                  {review.content && (
                    <p className="mt-2 whitespace-pre-wrap text-gray-300">
                      {review.content}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
};

export default ReviewList;
