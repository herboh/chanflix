import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import Review from '@server/entity/Review';
import notificationManager, { Notification } from '@server/lib/notifications';
import logger from '@server/logger';
import type { EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { EventSubscriber } from 'typeorm';

@EventSubscriber()
export class ReviewSubscriber implements EntitySubscriberInterface<Review> {
  public listenTo(): typeof Review {
    return Review;
  }

  private async sendReviewNotification(entity: Review) {
    let title: string;
    let image: string;
    const tmdb = new TheMovieDb();

    try {
      if (entity.media.mediaType === MediaType.MOVIE) {
        const movie = await tmdb.getMovie({ movieId: entity.media.tmdbId });

        title = `${movie.title}${
          movie.release_date ? ` (${movie.release_date.slice(0, 4)})` : ''
        }`;
        image = `https://image.tmdb.org/t/p/w600_and_h900_bestv2${movie.poster_path}`;
      } else {
        const tvshow = await tmdb.getTvShow({ tvId: entity.media.tmdbId });

        title = `${tvshow.name}${
          tvshow.first_air_date ? ` (${tvshow.first_air_date.slice(0, 4)})` : ''
        }`;
        image = `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tvshow.poster_path}`;
      }

      notificationManager.sendNotification(Notification.REVIEW_CREATED, {
        event: 'New Review',
        subject: title,
        message: entity.content || undefined,
        review: entity,
        media: entity.media,
        image,
        notifyAdmin: true,
        notifySystem: true,
      });
    } catch (e) {
      logger.error('Something went wrong sending review notification(s)', {
        label: 'Notifications',
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
        reviewId: entity.id,
      });
    }
  }

  public afterInsert(event: InsertEvent<Review>): void {
    if (!event.entity) {
      return;
    }

    this.sendReviewNotification(event.entity);
  }
}
