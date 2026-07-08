import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import dataSource, { getRepository } from '@server/datasource';
import DownloadHistory from '@server/entity/DownloadHistory';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { uniqWith } from 'lodash';

interface EpisodeNumberResult {
  seasonNumber: number;
  episodeNumber: number;
  absoluteEpisodeNumber: number;
  id: number;
}
export interface DownloadingItem {
  mediaType: MediaType;
  externalId: number;
  size: number;
  sizeLeft: number;
  status: string;
  timeLeft: string;
  estimatedCompletionTime: Date;
  title: string;
  episode?: EpisodeNumberResult;
}

export interface RecentDownloadItem extends DownloadingItem {
  completedAt: Date;
  serverId: number;
  outcome: 'completed' | 'cleared';
}

export class DownloadTracker {
  private radarrServers: Record<number, DownloadingItem[]> = {};
  private sonarrServers: Record<number, DownloadingItem[]> = {};
  private recentDownloads: RecentDownloadItem[] = [];

  protected getDownloadKey(item: DownloadingItem): string {
    return [
      item.mediaType,
      item.externalId,
      item.title,
      item.episode?.id ?? '',
    ].join(':');
  }

  private getHistoryKey(serverId: number, item: DownloadingItem): string {
    return `${serverId}:${this.getDownloadKey(item)}`;
  }

  private historyToRecentDownload(item: DownloadHistory): RecentDownloadItem {
    return {
      mediaType: item.mediaType,
      externalId: item.externalId,
      size: item.size,
      sizeLeft: item.sizeLeft,
      status: item.status,
      timeLeft: item.timeLeft,
      estimatedCompletionTime: item.estimatedCompletionTime,
      title: item.title,
      episode: item.episodeId
        ? {
            seasonNumber: item.seasonNumber ?? 0,
            episodeNumber: item.episodeNumber ?? 0,
            absoluteEpisodeNumber: item.absoluteEpisodeNumber ?? 0,
            id: item.episodeId,
          }
        : undefined,
      completedAt: item.completedAt,
      serverId: item.serverId,
      outcome: item.outcome,
    };
  }

  protected async persistRecentDownload(item: RecentDownloadItem): Promise<void> {
    if (!dataSource.isInitialized) {
      return;
    }

    const repository = getRepository(DownloadHistory);
    const downloadKey = this.getHistoryKey(item.serverId, item);
    const existing = await repository.findOne({ where: { downloadKey } });

    await repository.save(
      new DownloadHistory({
        ...(existing ?? {}),
        downloadKey,
        serverId: item.serverId,
        mediaType: item.mediaType,
        externalId: item.externalId,
        title: item.title,
        size: item.size,
        sizeLeft: item.sizeLeft,
        status: item.status,
        timeLeft: item.timeLeft,
        estimatedCompletionTime: item.estimatedCompletionTime,
        completedAt: item.completedAt,
        outcome: item.outcome,
        seasonNumber: item.episode?.seasonNumber,
        episodeNumber: item.episode?.episodeNumber,
        absoluteEpisodeNumber: item.episode?.absoluteEpisodeNumber,
        episodeId: item.episode?.id,
      })
    );
  }

  protected recordQueueTransitions(
    serverId: number,
    previousItems: DownloadingItem[] = [],
    nextItems: DownloadingItem[] = []
  ): void {
    const nextKeys = new Set(nextItems.map((item) => this.getDownloadKey(item)));
    const now = new Date();

    previousItems
      .filter((item) => !nextKeys.has(this.getDownloadKey(item)))
      .forEach((item) => {
        const outcome: RecentDownloadItem['outcome'] =
          item.status.toLowerCase() === 'completed' || item.sizeLeft <= 0
            ? 'completed'
            : 'cleared';
        const key = this.getHistoryKey(serverId, item);
        const recentDownload = {
          ...item,
          completedAt: now,
          serverId,
          outcome,
        };

        this.recentDownloads = [
          recentDownload,
          ...this.recentDownloads.filter(
            (download) =>
              this.getHistoryKey(download.serverId, download) !== key
          ),
        ].slice(0, 50);

        this.persistRecentDownload(recentDownload).catch((e) => {
          logger.warn('Failed to persist download history item', {
            label: 'Download Tracker',
            errorMessage: e instanceof Error ? e.message : 'Unknown error',
          });
        });
      });
  }

  public getMovieProgress(
    serverId: number,
    externalServiceId: number
  ): DownloadingItem[] {
    if (!this.radarrServers[serverId]) {
      return [];
    }

    return this.radarrServers[serverId].filter(
      (item) => item.externalId === externalServiceId
    );
  }

  public getSeriesProgress(
    serverId: number,
    externalServiceId: number
  ): DownloadingItem[] {
    if (!this.sonarrServers[serverId]) {
      return [];
    }

    return this.sonarrServers[serverId].filter(
      (item) => item.externalId === externalServiceId
    );
  }

  public getAllDownloads(): { movies: DownloadingItem[]; tv: DownloadingItem[] } {
    const movies: DownloadingItem[] = [];
    const tv: DownloadingItem[] = [];

    // Collect all movie downloads from all Radarr servers
    Object.values(this.radarrServers).forEach((serverDownloads) => {
      serverDownloads.forEach((download) => {
        // Avoid duplicates by checking if we already have this item
        if (!movies.some((m) => m.externalId === download.externalId && m.title === download.title)) {
          movies.push(download);
        }
      });
    });

    // Collect all TV downloads from all Sonarr servers
    Object.values(this.sonarrServers).forEach((serverDownloads) => {
      serverDownloads.forEach((download) => {
        // For TV, include episode info in dedup check
        if (!tv.some((t) =>
          t.externalId === download.externalId &&
          t.title === download.title &&
          t.episode?.id === download.episode?.id
        )) {
          tv.push(download);
        }
      });
    });

    // Sort by estimated completion time
    movies.sort((a, b) => a.estimatedCompletionTime.getTime() - b.estimatedCompletionTime.getTime());
    tv.sort((a, b) => a.estimatedCompletionTime.getTime() - b.estimatedCompletionTime.getTime());

    return { movies, tv };
  }

  public async getRecentDownloads(): Promise<RecentDownloadItem[]> {
    if (!dataSource.isInitialized) {
      return this.recentDownloads;
    }

    try {
      const persistedHistory = await getRepository(DownloadHistory).find({
        order: { completedAt: 'DESC' },
        take: 50,
      });

      this.recentDownloads = persistedHistory.map((item) =>
        this.historyToRecentDownload(item)
      );
    } catch (e) {
      logger.warn('Failed to load persisted download history', {
        label: 'Download Tracker',
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
      });
    }

    return this.recentDownloads;
  }

  public async resetDownloadTracker() {
    this.radarrServers = {};
    this.sonarrServers = {};
  }

  public updateDownloads() {
    this.updateRadarrDownloads();
    this.updateSonarrDownloads();
  }

  private async updateRadarrDownloads() {
    const settings = getSettings();

    // Remove duplicate servers
    const filteredServers = uniqWith(settings.radarr, (radarrA, radarrB) => {
      return (
        radarrA.hostname === radarrB.hostname &&
        radarrA.port === radarrB.port &&
        radarrA.baseUrl === radarrB.baseUrl
      );
    });

    // Load downloads from Radarr servers
    Promise.all(
      filteredServers.map(async (server) => {
        if (server.syncEnabled) {
          const radarr = new RadarrAPI({
            apiKey: server.apiKey,
            url: RadarrAPI.buildUrl(server, '/api/v3'),
          });

          try {
            const queueItems = await radarr.getQueue();
            const nextDownloads = queueItems.map((item) => ({
              externalId: item.movieId,
              estimatedCompletionTime: new Date(item.estimatedCompletionTime),
              mediaType: MediaType.MOVIE,
              size: item.size,
              sizeLeft: item.sizeleft,
              status: item.status,
              timeLeft: item.timeleft,
              title: item.title,
            }));

            this.recordQueueTransitions(
              server.id,
              this.radarrServers[server.id],
              nextDownloads
            );

            this.radarrServers[server.id] = nextDownloads;

            if (queueItems.length > 0) {
              logger.debug(
                `Found ${queueItems.length} item(s) in progress on Radarr server: ${server.name}`,
                { label: 'Download Tracker' }
              );
            }
          } catch {
            logger.error(
              `Unable to get queue from Radarr server: ${server.name}`,
              {
                label: 'Download Tracker',
              }
            );
          }

          // Duplicate this data to matching servers
          const matchingServers = settings.radarr.filter(
            (rs) =>
              rs.hostname === server.hostname &&
              rs.port === server.port &&
              rs.baseUrl === server.baseUrl &&
              rs.id !== server.id
          );

          if (matchingServers.length > 0) {
            logger.debug(
              `Matching download data to ${matchingServers.length} other Radarr server(s)`,
              { label: 'Download Tracker' }
            );
          }

          matchingServers.forEach((ms) => {
            if (ms.syncEnabled) {
              this.radarrServers[ms.id] = this.radarrServers[server.id];
            }
          });
        }
      })
    );
  }

  private async updateSonarrDownloads() {
    const settings = getSettings();

    // Remove duplicate servers
    const filteredServers = uniqWith(settings.sonarr, (sonarrA, sonarrB) => {
      return (
        sonarrA.hostname === sonarrB.hostname &&
        sonarrA.port === sonarrB.port &&
        sonarrA.baseUrl === sonarrB.baseUrl
      );
    });

    // Load downloads from Sonarr servers
    Promise.all(
      filteredServers.map(async (server) => {
        if (server.syncEnabled) {
          const sonarr = new SonarrAPI({
            apiKey: server.apiKey,
            url: SonarrAPI.buildUrl(server, '/api/v3'),
          });

          try {
            const queueItems = await sonarr.getQueue();
            const nextDownloads = queueItems.map((item) => ({
              externalId: item.seriesId,
              estimatedCompletionTime: new Date(item.estimatedCompletionTime),
              mediaType: MediaType.TV,
              size: item.size,
              sizeLeft: item.sizeleft,
              status: item.status,
              timeLeft: item.timeleft,
              title: item.title,
              episode: item.episode,
            }));

            this.recordQueueTransitions(
              server.id,
              this.sonarrServers[server.id],
              nextDownloads
            );

            this.sonarrServers[server.id] = nextDownloads;

            if (queueItems.length > 0) {
              logger.debug(
                `Found ${queueItems.length} item(s) in progress on Sonarr server: ${server.name}`,
                { label: 'Download Tracker' }
              );
            }
          } catch {
            logger.error(
              `Unable to get queue from Sonarr server: ${server.name}`,
              {
                label: 'Download Tracker',
              }
            );
          }

          // Duplicate this data to matching servers
          const matchingServers = settings.sonarr.filter(
            (ss) =>
              ss.hostname === server.hostname &&
              ss.port === server.port &&
              ss.baseUrl === server.baseUrl &&
              ss.id !== server.id
          );

          if (matchingServers.length > 0) {
            logger.debug(
              `Matching download data to ${matchingServers.length} other Sonarr server(s)`,
              { label: 'Download Tracker' }
            );
          }

          matchingServers.forEach((ms) => {
            if (ms.syncEnabled) {
              this.sonarrServers[ms.id] = this.sonarrServers[server.id];
            }
          });
        }
      })
    );
  }
}

const downloadTracker = new DownloadTracker();

export default downloadTracker;
