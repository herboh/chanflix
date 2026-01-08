import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import Review from '@server/entity/Review';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const reviewRoutes = Router();

interface ReviewResultsResponse {
  pageInfo: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results: Review[];
}

// GET /api/v1/review/recent - Get recent reviews
reviewRoutes.get<
  Record<string, never>,
  ReviewResultsResponse,
  Record<string, never>,
  { take?: string; skip?: string }
>('/recent', isAuthenticated(), async (req, res, next) => {
  const reviewRepository = getRepository(Review);

  const take = Number(req.query.take) || 20;
  const skip = Number(req.query.skip) || 0;

  try {
    const [reviews, total] = await reviewRepository.findAndCount({
      order: { createdAt: 'DESC' },
      take,
      skip,
    });

    return res.status(200).json({
      pageInfo: {
        pages: Math.ceil(total / take),
        pageSize: take,
        results: total,
        page: Math.floor(skip / take) + 1,
      },
      results: reviews,
    });
  } catch (e) {
    logger.error('Failed to fetch reviews', {
      label: 'API',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return next({
      status: 500,
      message: 'Failed to fetch reviews.',
    });
  }
});

// GET /api/v1/review/media/:mediaId - Get reviews for a media item
reviewRoutes.get<{ mediaId: string }, ReviewResultsResponse>(
  '/media/:mediaId',
  isAuthenticated(),
  async (req, res, next) => {
    const reviewRepository = getRepository(Review);

    try {
      const [reviews, total] = await reviewRepository.findAndCount({
        where: { media: { id: Number(req.params.mediaId) } },
        order: { createdAt: 'DESC' },
      });

      return res.status(200).json({
        pageInfo: {
          pages: 1,
          pageSize: total,
          results: total,
          page: 1,
        },
        results: reviews,
      });
    } catch (e) {
      logger.error('Failed to fetch media reviews', {
        label: 'API',
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
      });
      return next({
        status: 500,
        message: 'Failed to fetch reviews.',
      });
    }
  }
);

// GET /api/v1/review/user - Get current user's review for a media
reviewRoutes.get<
  Record<string, never>,
  Review | null,
  Record<string, never>,
  { mediaId: string }
>('/user', isAuthenticated(), async (req, res, next) => {
  const reviewRepository = getRepository(Review);

  if (!req.query.mediaId) {
    return next({
      status: 400,
      message: 'mediaId is required.',
    });
  }

  try {
    const review = await reviewRepository.findOne({
      where: {
        user: { id: req.user?.id },
        media: { id: Number(req.query.mediaId) },
      },
    });

    return res.status(200).json(review || null);
  } catch (e) {
    logger.error('Failed to fetch user review', {
      label: 'API',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return next({
      status: 500,
      message: 'Failed to fetch review.',
    });
  }
});

// POST /api/v1/review - Create or update review (upsert)
reviewRoutes.post<
  Record<string, never>,
  Review,
  { mediaId: number; rating: number; content?: string }
>('/', isAuthenticated(), async (req, res, next) => {
  const reviewRepository = getRepository(Review);
  const mediaRepository = getRepository(Media);

  const { mediaId, rating, content } = req.body;

  if (!mediaId) {
    return next({
      status: 400,
      message: 'mediaId is required.',
    });
  }

  if (!rating || rating < 1 || rating > 5) {
    return next({
      status: 400,
      message: 'Rating must be between 1 and 5.',
    });
  }

  try {
    const media = await mediaRepository.findOne({
      where: { id: mediaId },
    });

    if (!media) {
      return next({
        status: 404,
        message: 'Media not found.',
      });
    }

    // Check if user already has a review for this media
    let review = await reviewRepository.findOne({
      where: {
        user: { id: req.user?.id },
        media: { id: mediaId },
      },
    });

    if (review) {
      // Update existing review
      review.rating = rating;
      review.content = content?.trim() || '';
    } else {
      // Create new review
      review = new Review({
        user: req.user,
        media,
        rating,
        content: content?.trim() || '',
      });
    }

    await reviewRepository.save(review);

    // Reload to get eager relations
    const savedReview = await reviewRepository.findOneOrFail({
      where: { id: review.id },
    });

    return res.status(201).json(savedReview);
  } catch (e) {
    logger.error('Failed to save review', {
      label: 'API',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return next({
      status: 500,
      message: 'Failed to save review.',
    });
  }
});

// DELETE /api/v1/review/:reviewId - Delete own review
reviewRoutes.delete<{ reviewId: string }>(
  '/:reviewId',
  isAuthenticated(),
  async (req, res, next) => {
    const reviewRepository = getRepository(Review);

    try {
      const review = await reviewRepository.findOneOrFail({
        where: { id: Number(req.params.reviewId) },
      });

      if (
        !req.user?.hasPermission(Permission.ADMIN) &&
        review.user.id !== req.user?.id
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to delete this review.',
        });
      }

      await reviewRepository.remove(review);

      return res.status(204).send();
    } catch (e) {
      logger.debug('Delete request for review failed', {
        label: 'API',
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
      });
      return next({ status: 404, message: 'Review not found.' });
    }
  }
);

export default reviewRoutes;
