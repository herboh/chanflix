import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import { useState } from 'react';
import { useToasts } from 'react-toast-notifications';

interface RetrySearchButtonProps {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title?: string;
  compact?: boolean;
}

/**
 * Triggers a Radarr/Sonarr search command for media that is stuck or
 * missing. Only useful to users with MANAGE_REQUESTS; callers should
 * permission-gate rendering.
 */
const RetrySearchButton = ({
  mediaType,
  tmdbId,
  title,
  compact = false,
}: RetrySearchButtonProps) => {
  const { addToast } = useToasts();
  const [isSearching, setIsSearching] = useState(false);

  const retry = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isSearching) {
      return;
    }

    setIsSearching(true);

    try {
      const response = await axios.post<{ triggered: string[] }>(
        '/api/v1/downloads/retry',
        { mediaType, tmdbId }
      );

      addToast(
        `Search triggered${title ? ` for ${title}` : ''} on ${response.data.triggered.join(', ')}.`,
        { appearance: 'success', autoDismiss: true }
      );
    } catch (error) {
      const message =
        axios.isAxiosError(error) && error.response?.data?.message
          ? error.response.data.message
          : 'Failed to trigger search.';

      addToast(message, { appearance: 'error', autoDismiss: true });
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <button
      onClick={retry}
      disabled={isSearching}
      title="Trigger a new Radarr/Sonarr search"
      className={`inline-flex items-center rounded-md border border-gray-600 bg-gray-700 font-medium text-gray-200 transition hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 ${
        compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
      }`}
    >
      <MagnifyingGlassIcon
        className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} ${
          isSearching ? 'animate-pulse' : ''
        } mr-1`}
      />
      {isSearching ? 'Searching…' : 'Retry'}
    </button>
  );
};

export default RetrySearchButton;
