import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

// Downloads now live on the Operations page.
const DownloadsPage: NextPage = () => {
  const router = useRouter();

  useEffect(() => {
    router.replace('/operations');
  }, [router]);

  return null;
};

export default DownloadsPage;
