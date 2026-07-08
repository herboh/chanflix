import { ServerIcon } from '@heroicons/react/24/outline';
import type { StatusResponse } from '@server/interfaces/api/settingsInterfaces';
import Link from 'next/link';
import useSWR from 'swr';

interface VersionStatusProps {
  onClick?: () => void;
}

const VersionStatus = ({ onClick }: VersionStatusProps) => {
  const { data } = useSWR<StatusResponse>('/api/v1/status', {
    refreshInterval: 5 * 60 * 1000,
  });

  if (!data) {
    return null;
  }

  return (
    <Link href="/settings/about">
      <a
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onClick) {
            onClick();
          }
        }}
        role="button"
        tabIndex={0}
        className="mx-2 flex items-center rounded-lg bg-gray-900 p-2 text-xs text-gray-300 ring-1 ring-gray-700 transition duration-300 hover:bg-gray-800"
      >
        <ServerIcon className="h-6 w-6" />
        <div className="flex min-w-0 flex-1 flex-col truncate px-2 last:pr-0">
          <span className="font-bold">Chanflix</span>
          <span className="truncate">
            <code className="bg-transparent p-0">
              {data.version.replace('develop-', '')}
            </code>
          </span>
        </div>
      </a>
    </Link>
  );
};

export default VersionStatus;
