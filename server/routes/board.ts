import { getRepository } from '@server/datasource';
import BoardPost from '@server/entity/BoardPost';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const boardRoutes = Router();

interface BoardPostResultsResponse {
  pageInfo: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results: BoardPost[];
}

// GET /api/v1/board - Get all posts with pagination
boardRoutes.get<
  Record<string, never>,
  BoardPostResultsResponse,
  Record<string, never>,
  { take?: string; skip?: string }
>('/', isAuthenticated(), async (req, res, next) => {
  const boardPostRepository = getRepository(BoardPost);

  const take = Number(req.query.take) || 20;
  const skip = Number(req.query.skip) || 0;

  try {
    const [posts, total] = await boardPostRepository.findAndCount({
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
      results: posts,
    });
  } catch (e) {
    logger.error('Failed to fetch board posts', {
      label: 'API',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return next({
      status: 500,
      message: 'Failed to fetch posts.',
    });
  }
});

// GET /api/v1/board/:postId - Get single post
boardRoutes.get<{ postId: string }, BoardPost>(
  '/:postId',
  isAuthenticated(),
  async (req, res, next) => {
    const boardPostRepository = getRepository(BoardPost);

    try {
      const post = await boardPostRepository.findOneOrFail({
        where: { id: Number(req.params.postId) },
      });

      return res.status(200).json(post);
    } catch (e) {
      logger.debug('Request for unknown board post failed', {
        label: 'API',
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
      });
      return next({ status: 404, message: 'Post not found.' });
    }
  }
);

// POST /api/v1/board - Create new post
boardRoutes.post<Record<string, never>, BoardPost, { message: string }>(
  '/',
  isAuthenticated(),
  async (req, res, next) => {
    const boardPostRepository = getRepository(BoardPost);

    if (!req.body.message || req.body.message.trim().length === 0) {
      return next({
        status: 400,
        message: 'Message is required.',
      });
    }

    try {
      const post = new BoardPost({
        user: req.user,
        message: req.body.message.trim(),
      });

      await boardPostRepository.save(post);

      return res.status(201).json(post);
    } catch (e) {
      logger.error('Failed to create board post', {
        label: 'API',
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
      });
      return next({
        status: 500,
        message: 'Failed to create post.',
      });
    }
  }
);

// PUT /api/v1/board/:postId - Edit own post
boardRoutes.put<{ postId: string }, BoardPost, { message: string }>(
  '/:postId',
  isAuthenticated(),
  async (req, res, next) => {
    const boardPostRepository = getRepository(BoardPost);

    try {
      const post = await boardPostRepository.findOneOrFail({
        where: { id: Number(req.params.postId) },
      });

      if (post.user.id !== req.user?.id) {
        return next({
          status: 403,
          message: 'You can only edit your own posts.',
        });
      }

      if (!req.body.message || req.body.message.trim().length === 0) {
        return next({
          status: 400,
          message: 'Message is required.',
        });
      }

      post.message = req.body.message.trim();
      await boardPostRepository.save(post);

      return res.status(200).json(post);
    } catch (e) {
      logger.debug('Put request for board post failed', {
        label: 'API',
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
      });
      return next({ status: 404, message: 'Post not found.' });
    }
  }
);

// DELETE /api/v1/board/:postId - Delete post (own or admin)
boardRoutes.delete<{ postId: string }>(
  '/:postId',
  isAuthenticated(),
  async (req, res, next) => {
    const boardPostRepository = getRepository(BoardPost);

    try {
      const post = await boardPostRepository.findOneOrFail({
        where: { id: Number(req.params.postId) },
      });

      if (
        !req.user?.hasPermission(Permission.ADMIN) &&
        post.user.id !== req.user?.id
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to delete this post.',
        });
      }

      await boardPostRepository.remove(post);

      return res.status(204).send();
    } catch (e) {
      logger.debug('Delete request for board post failed', {
        label: 'API',
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
      });
      return next({ status: 404, message: 'Post not found.' });
    }
  }
);

export default boardRoutes;
