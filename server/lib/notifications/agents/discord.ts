import { IssueStatus, IssueTypeName } from '@server/constants/issue';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import type { NotificationAgentDiscord } from '@server/lib/settings';
import { getSettings, NotificationAgentKey } from '@server/lib/settings';
import logger from '@server/logger';
import axios from 'axios';
import {
  hasNotificationType,
  Notification,
  shouldSendAdminNotification,
} from '..';
import type { NotificationAgent, NotificationPayload } from './agent';
import { BaseAgent } from './agent';

enum EmbedColors {
  DEFAULT = 0,
  AQUA = 1752220,
  GREEN = 3066993,
  BLUE = 3447003,
  PURPLE = 10181046,
  GOLD = 15844367,
  ORANGE = 15105570,
  RED = 15158332,
  GREY = 9807270,
  DARKER_GREY = 8359053,
  NAVY = 3426654,
  DARK_AQUA = 1146986,
  DARK_GREEN = 2067276,
  DARK_BLUE = 2123412,
  DARK_PURPLE = 7419530,
  DARK_GOLD = 12745742,
  DARK_ORANGE = 11027200,
  DARK_RED = 10038562,
  DARK_GREY = 9936031,
  LIGHT_GREY = 12370112,
  DARK_NAVY = 2899536,
  LUMINOUS_VIVID_PINK = 16580705,
  DARK_VIVID_PINK = 12320855,
}

interface DiscordImageEmbed {
  url?: string;
  proxy_url?: string;
  height?: number;
  width?: number;
}

interface Field {
  name: string;
  value: string;
  inline?: boolean;
}
interface DiscordRichEmbed {
  title?: string;
  type?: 'rich'; // Always rich for webhooks
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: {
    text: string;
    icon_url?: string;
    proxy_icon_url?: string;
  };
  image?: DiscordImageEmbed;
  thumbnail?: DiscordImageEmbed;
  provider?: {
    name?: string;
    url?: string;
  };
  author?: {
    name?: string;
    url?: string;
    icon_url?: string;
    proxy_icon_url?: string;
  };
  fields?: Field[];
}

interface DiscordWebhookPayload {
  embeds: DiscordRichEmbed[];
  username?: string;
  avatar_url?: string;
  tts: boolean;
  content?: string;
  allowed_mentions?: {
    parse?: ('users' | 'roles' | 'everyone')[];
    roles?: string[];
    users?: string[];
  };
}

const DISCORD_MIN_SEND_INTERVAL_MS = 500;
const DISCORD_MAX_RETRIES = 3;

class DiscordAgent
  extends BaseAgent<NotificationAgentDiscord>
  implements NotificationAgent
{
  private queue: Promise<boolean> = Promise.resolve(true);
  private lastSendAt = 0;

  protected getSettings(): NotificationAgentDiscord {
    if (this.settings) {
      return this.settings;
    }

    const settings = getSettings();

    return settings.notifications.agents.discord;
  }

  public buildEmbed(
    type: Notification,
    payload: NotificationPayload
  ): DiscordRichEmbed {
    const { applicationUrl } = getSettings().main;

    let color = EmbedColors.DARK_PURPLE;
    const fields: Field[] = [];

    if (payload.request) {
      fields.push({
        name: 'Requested By',
        value: payload.request.requestedBy.displayName,
        inline: true,
      });

      let status = '';
      switch (type) {
        case Notification.MEDIA_PENDING:
          color = EmbedColors.ORANGE;
          status = 'Pending Approval';
          break;
        case Notification.MEDIA_APPROVED:
        case Notification.MEDIA_AUTO_APPROVED:
          color = EmbedColors.PURPLE;
          status = 'Processing';
          break;
        case Notification.MEDIA_AVAILABLE:
          color = EmbedColors.GREEN;
          status = 'Available';
          break;
        case Notification.MEDIA_DECLINED:
          color = EmbedColors.RED;
          status = 'Declined';
          break;
        case Notification.MEDIA_FAILED:
          color = EmbedColors.RED;
          status = 'Failed';
          break;
      }

      if (status) {
        fields.push({
          name: 'Request Status',
          value: status,
          inline: true,
        });
      }
    } else if (payload.comment) {
      fields.push({
        name: `Comment from ${payload.comment.user.displayName}`,
        value: payload.comment.message,
        inline: false,
      });
    } else if (payload.issue) {
      fields.push(
        {
          name: 'Reported By',
          value: payload.issue.createdBy.displayName,
          inline: true,
        },
        {
          name: 'Issue Type',
          value: IssueTypeName[payload.issue.issueType],
          inline: true,
        },
        {
          name: 'Issue Status',
          value:
            payload.issue.status === IssueStatus.OPEN ? 'Open' : 'Resolved',
          inline: true,
        }
      );

      switch (type) {
        case Notification.ISSUE_CREATED:
        case Notification.ISSUE_REOPENED:
          color = EmbedColors.RED;
          break;
        case Notification.ISSUE_COMMENT:
          color = EmbedColors.ORANGE;
          break;
        case Notification.ISSUE_RESOLVED:
          color = EmbedColors.GREEN;
          break;
      }
    } else if (payload.review) {
      color = EmbedColors.GOLD;
      fields.push(
        {
          name: 'Reviewed By',
          value: payload.review.user.displayName,
          inline: true,
        },
        {
          name: 'Rating',
          value: '⭐'.repeat(payload.review.rating),
          inline: true,
        }
      );
    }

    for (const extra of payload.extra ?? []) {
      fields.push({
        name: extra.name,
        value: extra.value,
        inline: true,
      });
    }

    const url = applicationUrl
      ? payload.issue
        ? `${applicationUrl}/issues/${payload.issue.id}`
        : payload.media
        ? `${applicationUrl}/${payload.media.mediaType}/${payload.media.tmdbId}`
        : undefined
      : undefined;

    return {
      title: payload.subject,
      url,
      description: payload.message,
      color,
      timestamp: new Date().toISOString(),
      author: payload.event
        ? {
            name: payload.event,
          }
        : undefined,
      fields,
      thumbnail: {
        url: payload.image,
      },
    };
  }

  public shouldSend(): boolean {
    const settings = this.getSettings();

    if (settings.enabled && settings.options.webhookUrl) {
      return true;
    }

    return false;
  }

  public async send(
    type: Notification,
    payload: NotificationPayload
  ): Promise<boolean> {
    const settings = this.getSettings();

    if (
      !payload.notifySystem ||
      !hasNotificationType(type, settings.types ?? 0)
    ) {
      return true;
    }

    logger.debug('Queueing Discord notification', {
      label: 'Notifications',
      type: Notification[type],
      subject: payload.subject,
    });

    const nextJob = this.queue.then(() =>
      this.sendQueuedNotification(type, payload)
    );

    this.queue = nextJob.catch(() => false);

    return nextJob;
  }

  private async sendQueuedNotification(
    type: Notification,
    payload: NotificationPayload
  ): Promise<boolean> {
    const settings = this.getSettings();
    const userMentions: string[] = [];

    try {
      if (settings.options.enableMentions) {
        if (payload.notifyUser) {
          if (
            payload.notifyUser.settings?.hasNotificationType(
              NotificationAgentKey.DISCORD,
              type
            ) &&
            payload.notifyUser.settings.discordId
          ) {
            userMentions.push(`<@${payload.notifyUser.settings.discordId}>`);
          }
        }

        if (payload.notifyAdmin) {
          const userRepository = getRepository(User);
          const users = await userRepository.find();

          userMentions.push(
            ...users
              .filter(
                (user) =>
                  user.settings?.hasNotificationType(
                    NotificationAgentKey.DISCORD,
                    type
                  ) &&
                  user.settings.discordId &&
                  shouldSendAdminNotification(type, user, payload)
              )
              .map((user) => `<@${user.settings?.discordId}>`)
          );
        }
      }

      await this.postWebhookWithBackoff(settings.options.webhookUrl, {
        username: settings.options.botUsername
          ? settings.options.botUsername
          : getSettings().main.applicationTitle,
        avatar_url: settings.options.botAvatarUrl,
        embeds: [this.buildEmbed(type, payload)],
        content: userMentions.join(' '),
      } as DiscordWebhookPayload);

      return true;
    } catch (e) {
      logger.error('Error sending Discord notification', {
        label: 'Notifications',
        type: Notification[type],
        subject: payload.subject,
        errorMessage: e.message,
        response: e.response?.data,
      });

      return false;
    }
  }

  private async postWebhookWithBackoff(
    webhookUrl: string,
    payload: DiscordWebhookPayload
  ): Promise<void> {
    let attempt = 0;

    while (attempt <= DISCORD_MAX_RETRIES) {
      await this.waitForQueuePace();

      try {
        await axios.post(webhookUrl, payload, {
          timeout: 10000,
        });
        this.lastSendAt = Date.now();
        return;
      } catch (e) {
        if (!axios.isAxiosError(e) || e.response?.status !== 429) {
          throw e;
        }

        attempt += 1;

        const retryAfterMs = this.getDiscordRetryAfter(e.response.data);
        logger.warn('Discord webhook rate limited; retrying notification', {
          label: 'Notifications',
          retryAfterMs,
          attempt,
        });

        await this.sleep(retryAfterMs);
      }
    }

    throw new Error('Discord webhook rate limit retry budget exhausted');
  }

  private async waitForQueuePace(): Promise<void> {
    const elapsed = Date.now() - this.lastSendAt;
    if (elapsed >= DISCORD_MIN_SEND_INTERVAL_MS) {
      return;
    }

    await this.sleep(DISCORD_MIN_SEND_INTERVAL_MS - elapsed);
  }

  private getDiscordRetryAfter(responseData: unknown): number {
    const retryAfter =
      typeof responseData === 'object' &&
      responseData !== null &&
      'retry_after' in responseData
        ? Number(responseData.retry_after)
        : 1;

    if (!Number.isFinite(retryAfter) || retryAfter <= 0) {
      return 1000;
    }

    return retryAfter > 100 ? retryAfter : retryAfter * 1000;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default DiscordAgent;
