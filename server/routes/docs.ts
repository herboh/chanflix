import { isAuthenticated } from '@server/middleware/auth';
import logger from '@server/logger';
import { Router } from 'express';
import fs from 'fs';
import path from 'path';

const docsRoutes = Router();

const DOCS_DIR = path.join(__dirname, '../../src/docs');

const validDocs = ['user-guide', 'faq'];

docsRoutes.get('/:docId', isAuthenticated(), async (req, res, next) => {
  const { docId } = req.params;

  if (!validDocs.includes(docId)) {
    return next({
      status: 404,
      message: 'Document not found.',
    });
  }

  try {
    const filePath = path.join(DOCS_DIR, `${docId}.md`);
    const content = fs.readFileSync(filePath, 'utf-8');

    return res.status(200).json({ content });
  } catch (e) {
    logger.error('Failed to read documentation file', {
      label: 'API',
      docId,
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return next({
      status: 500,
      message: 'Failed to load documentation.',
    });
  }
});

export default docsRoutes;
