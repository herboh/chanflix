// Function to generate and open authenticated Plex URL
export const openPlexLibrary = (serverID: string, plexToken: string): void => {
  const baseUrl = "https://app.plex.tv/desktop/";
  const plexUrl = `${baseUrl}#!/server/${serverID}/details?token=${plexToken}`;
  window.open(plexUrl, "_blank");
};
