export const buildPlexLaunchUrl = ({
  baseUrl,
  plexToken,
  machineId,
  ratingKey,
}: {
  baseUrl?: string;
  plexToken: string;
  machineId?: string;
  ratingKey?: string;
}): string => {
  const normalizedBaseUrl = (baseUrl || 'https://app.plex.tv/desktop').replace(
    /\/$/,
    ''
  );
  const separator = normalizedBaseUrl.includes('?') ? '&' : '?';
  const tokenQuery = `X-Plex-Token=${encodeURIComponent(plexToken)}`;
  const serverPath = machineId ? `#!/server/${machineId}` : '';
  const detailsPath =
    machineId && ratingKey
      ? `/details?key=${encodeURIComponent(`/library/metadata/${ratingKey}`)}`
      : '';

  return `${normalizedBaseUrl}${separator}${tokenQuery}${serverPath}${detailsPath}`;
};
