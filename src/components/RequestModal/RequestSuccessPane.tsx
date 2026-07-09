import CachedImage from '@app/components/Common/CachedImage';
import {
  ArrowRightCircleIcon,
  CheckCircleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { MediaRequestStatus } from '@server/constants/media';
import Link from 'next/link';

interface RequestSuccessPaneProps {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title?: string;
  year?: string;
  posterPath?: string;
  status?: MediaRequestStatus;
  seasonCount?: number;
}

const RequestSuccessPane = ({
  mediaType,
  tmdbId,
  title,
  year,
  posterPath,
  status,
  seasonCount,
}: RequestSuccessPaneProps) => {
  const approved = status === MediaRequestStatus.APPROVED;
  const service = mediaType === 'movie' ? 'Radarr' : 'Sonarr';

  return (
    <div className="mt-6 flex items-start space-x-4">
      <div className="relative h-32 w-20 shrink-0 overflow-hidden rounded bg-gray-700">
        {posterPath ? (
          <CachedImage
            src={`https://image.tmdb.org/t/p/w300_and_h450_face${posterPath}`}
            alt=""
            layout="fill"
            objectFit="cover"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-lg font-semibold text-gray-100">
          {title}
          {year ? (
            <span className="ml-2 font-normal text-gray-400">
              ({year.slice(0, 4)})
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex items-center space-x-2 text-sm">
          {approved ? (
            <>
              <CheckCircleIcon className="h-5 w-5 shrink-0 text-green-400" />
              <span className="text-gray-200">
                Approved — sent to {service}, searching now
              </span>
            </>
          ) : (
            <>
              <ClockIcon className="h-5 w-5 shrink-0 text-yellow-400" />
              <span className="text-gray-200">
                Pending approval — an admin will review it soon
              </span>
            </>
          )}
        </div>
        {seasonCount ? (
          <div className="mt-1 text-xs text-gray-400">
            {seasonCount} season{seasonCount > 1 ? 's' : ''} requested
          </div>
        ) : null}
        <Link href={`/${mediaType}/${tmdbId}`}>
          <a className="mt-3 inline-flex items-center text-sm text-indigo-400 hover:text-indigo-300">
            Track progress on the {mediaType === 'movie' ? 'movie' : 'series'}{' '}
            page
            <ArrowRightCircleIcon className="ml-1 h-4 w-4" />
          </a>
        </Link>
      </div>
    </div>
  );
};

export default RequestSuccessPane;
