import Slider from '@app/components/Slider';
import TitleCard from '@app/components/TitleCard';
import { ArrowRightCircleIcon } from '@heroicons/react/24/outline';
import { MediaStatus } from '@server/constants/media';
import Link from 'next/link';
import useSWR from 'swr';

interface LibraryItem {
  id?: number;
  tmdbId?: number;
  title: string;
  year?: number;
  mediaType: 'movie' | 'tv';
  status: 'available' | 'pending' | 'processing' | 'partial' | 'unknown';
  posterPath?: string;
}

interface LibraryResponse {
  results: LibraryItem[];
}

interface LibrarySliderProps {
  type: 'movie' | 'tv';
  title: string;
  sliderKey: string;
}

const LibrarySlider = ({ type, title, sliderKey }: LibrarySliderProps) => {
  const { data, error } = useSWR<LibraryResponse>(
    `/api/v1/library?type=${type}&status=available&take=20&sort=added`
  );

  const items = (data?.results ?? []).filter((item) => item.tmdbId);

  if ((data && items.length === 0) || error) {
    return null;
  }

  return (
    <div className="mb-8">
      <div className="slider-header">
        <Link href={`/library?type=${type}&status=available`}>
          <a className="slider-title min-w-0 pr-16">
            <span className="truncate">{title}</span>
            <ArrowRightCircleIcon />
          </a>
        </Link>
      </div>
      <Slider
        sliderKey={sliderKey}
        isLoading={!data}
        items={items.map((item) => (
          <TitleCard
            key={`library-${type}-${item.tmdbId}`}
            id={item.tmdbId as number}
            image={item.posterPath}
            title={item.title}
            year={item.year ? item.year.toString() : undefined}
            mediaType={item.mediaType}
            status={MediaStatus.AVAILABLE}
          />
        ))}
      />
    </div>
  );
};

export default LibrarySlider;
