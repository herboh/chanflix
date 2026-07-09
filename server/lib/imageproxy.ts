import logger from '@server/logger';
import axios from 'axios';
import rateLimit, { type rateLimitOptions } from 'axios-rate-limit';
import { createHash } from 'crypto';
import { promises } from 'fs';
import path, { join } from 'path';

type ImageResponse = {
  meta: {
    revalidateAfter: number;
    curRevalidate: number;
    isStale: boolean;
    etag: string;
    extension: string;
    cacheKey: string;
    cacheMiss: boolean;
  };
  imageBuffer: Buffer;
};

const DEFAULT_IMAGE_MAX_AGE = 86400 * 30;
const MIN_IMAGE_BYTES = 32;

type CachedImageFileMeta = {
  maxAge: number;
  expireAt: number;
  etag: string;
  extension: string;
};

const baseCacheDirectory = process.env.CONFIG_DIRECTORY
  ? `${process.env.CONFIG_DIRECTORY}/cache/images`
  : path.join(__dirname, '../../config/cache/images');

export const getImageExtension = (imagePath: string): string => {
  const filename = imagePath.split('?')[0];
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';

  return extension === 'jpeg' ? 'jpg' : extension;
};

export const parseCachedImageFilename = (
  filename: string
): CachedImageFileMeta | null => {
  const parts = filename.split('.');

  if (parts.length < 4) {
    return null;
  }

  const [maxAgeSt, expireAtSt, ...rest] = parts;
  const extension = rest.pop()?.toLowerCase() ?? '';
  const maxAge = Number(maxAgeSt);
  const expireAt = Number(expireAtSt);
  const etag = rest.join('.');

  if (
    !Number.isFinite(maxAge) ||
    maxAge <= 0 ||
    !Number.isFinite(expireAt) ||
    expireAt <= 0 ||
    !extension
  ) {
    return null;
  }

  return {
    maxAge,
    expireAt,
    etag,
    extension: extension === 'jpeg' ? 'jpg' : extension,
  };
};

export const isValidImageBuffer = (
  buffer: Buffer,
  extension?: string,
  contentType?: string
): boolean => {
  if (buffer.length < MIN_IMAGE_BYTES) {
    return false;
  }

  const normalizedExtension = extension?.toLowerCase();
  const normalizedContentType = contentType?.toLowerCase();

  if (
    normalizedContentType &&
    !normalizedContentType.startsWith('image/')
  ) {
    return false;
  }

  const isJpeg =
    buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  const isWebp =
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP';
  const isGif = buffer.toString('ascii', 0, 3) === 'GIF';

  switch (normalizedExtension) {
    case 'jpg':
    case 'jpeg':
      return isJpeg;
    case 'png':
      return isPng;
    case 'webp':
      return isWebp;
    case 'gif':
      return isGif;
    default:
      return isJpeg || isPng || isWebp || isGif;
  }
};

class ImageProxy {
  public static async clearCache(key: string) {
    let deletedImages = 0;
    const cacheDirectory = path.join(baseCacheDirectory, key);

    const files = await promises.readdir(cacheDirectory);

    for (const file of files) {
      const filePath = path.join(cacheDirectory, file);
      const stat = await promises.lstat(filePath);

      if (stat.isDirectory()) {
        const imageFiles = await promises.readdir(filePath);

        for (const imageFile of imageFiles) {
          const imageFilePath = path.join(filePath, imageFile);
          const meta = parseCachedImageFilename(imageFile);
          const now = Date.now();
          const buffer = meta
            ? await promises.readFile(imageFilePath).catch(() => null)
            : null;

          if (
            !meta ||
            !buffer ||
            now > meta.expireAt ||
            !isValidImageBuffer(buffer, meta.extension)
          ) {
            await promises.rm(imageFilePath, { force: true });
            deletedImages += 1;
          }
        }
      }
    }

    logger.info(`Cleared ${deletedImages} stale image(s) from cache`, {
      label: 'Image Cache',
    });
  }

  public static async getImageStats(
    key: string
  ): Promise<{ size: number; imageCount: number }> {
    const cacheDirectory = path.join(baseCacheDirectory, key);

    const imageTotalSize = await ImageProxy.getDirectorySize(cacheDirectory);
    const imageCount = await ImageProxy.getImageCount(cacheDirectory);

    return {
      size: imageTotalSize,
      imageCount,
    };
  }

  private static async getDirectorySize(dir: string): Promise<number> {
    const files = await promises.readdir(dir, {
      withFileTypes: true,
    });

    const paths = files.map(async (file) => {
      const path = join(dir, file.name);

      if (file.isDirectory()) return await ImageProxy.getDirectorySize(path);

      if (file.isFile()) {
        const { size } = await promises.stat(path);

        return size;
      }

      return 0;
    });

    return (await Promise.all(paths))
      .flat(Infinity)
      .reduce((i, size) => i + size, 0);
  }

  private static async getImageCount(dir: string) {
    const files = await promises.readdir(dir);

    return files.length;
  }

  private axios;
  private cacheVersion;
  private key;
  private pendingWrites: Map<string, Promise<ImageResponse | null>> = new Map();

  constructor(
    key: string,
    baseUrl: string,
    options: {
      cacheVersion?: number;
      rateLimitOptions?: rateLimitOptions;
    } = {}
  ) {
    this.cacheVersion = options.cacheVersion ?? 1;
    this.key = key;
    this.axios = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
    });

    if (options.rateLimitOptions) {
      this.axios = rateLimit(this.axios, options.rateLimitOptions);
    }
  }

  public async getImage(path: string): Promise<ImageResponse> {
    const cacheKey = this.getCacheKey(path);

    const imageResponse = await this.get(cacheKey);

    if (!imageResponse) {
      const newImage = await this.getOrSet(path, cacheKey);

      if (!newImage) {
        throw new Error('Failed to load image');
      }

      return newImage;
    }

    // If the image is stale, we will revalidate it in the background.
    if (imageResponse.meta.isStale) {
      this.getOrSet(path, cacheKey).catch((e) => {
        logger.debug('Something went wrong refreshing stale image.', {
          label: 'Image Cache',
          errorMessage: e instanceof Error ? e.message : 'Unknown error',
        });
      });
    }

    return imageResponse;
  }

  private async getOrSet(
    path: string,
    cacheKey: string
  ): Promise<ImageResponse | null> {
    const pendingWrite = this.pendingWrites.get(cacheKey);
    if (pendingWrite) {
      return pendingWrite;
    }

    const writePromise = this.set(path, cacheKey).finally(() => {
      this.pendingWrites.delete(cacheKey);
    });

    this.pendingWrites.set(cacheKey, writePromise);

    return writePromise;
  }

  private async get(cacheKey: string): Promise<ImageResponse | null> {
    try {
      const directory = join(this.getCacheDirectory(), cacheKey);
      const files = await promises.readdir(directory);
      const now = Date.now();

      for (const file of files) {
        const filePath = join(directory, file);
        const meta = parseCachedImageFilename(file);

        if (!meta) {
          await promises.rm(filePath, { force: true });
          continue;
        }

        const buffer = await promises.readFile(filePath);

        if (!isValidImageBuffer(buffer, meta.extension)) {
          await promises.rm(filePath, { force: true });
          logger.warn('Removed invalid cached image response', {
            label: 'Image Cache',
            cacheKey,
          });
          continue;
        }

        return {
          meta: {
            curRevalidate: meta.maxAge,
            revalidateAfter: meta.maxAge * 1000 + now,
            isStale: now > meta.expireAt,
            etag: meta.etag,
            extension: meta.extension,
            cacheKey,
            cacheMiss: false,
          },
          imageBuffer: buffer,
        };
      }
    } catch (e) {
      // No files. Treat as empty cache.
    }

    return null;
  }

  private async set(
    path: string,
    cacheKey: string
  ): Promise<ImageResponse | null> {
    try {
      const directory = join(this.getCacheDirectory(), cacheKey);
      const response = await this.axios.get(path, {
        responseType: 'arraybuffer',
      });

      const buffer = Buffer.from(response.data, 'binary');
      const extension = getImageExtension(path);

      if (
        !isValidImageBuffer(
          buffer,
          extension,
          response.headers['content-type']
        )
      ) {
        throw new Error('Upstream response was not a valid image');
      }

      const maxAge = this.getMaxAge(response.headers['cache-control']);
      const expireAt = Date.now() + maxAge * 1000;
      const etag = (response.headers.etag ?? '').replace(/"/g, '');

      await this.writeToCacheDir(
        directory,
        extension,
        maxAge,
        expireAt,
        buffer,
        etag
      );

      return {
        meta: {
          curRevalidate: maxAge,
          revalidateAfter: expireAt,
          isStale: false,
          etag,
          extension,
          cacheKey,
          cacheMiss: true,
        },
        imageBuffer: buffer,
      };
    } catch (e) {
      logger.debug('Something went wrong caching image.', {
        label: 'Image Cache',
        errorMessage: e.message,
      });
      return null;
    }
  }

  private getMaxAge(cacheControl?: string): number {
    const maxAge = cacheControl
      ?.split(',')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('max-age='))
      ?.split('=')[1];
    const parsedMaxAge = Number(maxAge);

    if (Number.isFinite(parsedMaxAge) && parsedMaxAge > 0) {
      return parsedMaxAge;
    }

    return DEFAULT_IMAGE_MAX_AGE;
  }

  private async writeToCacheDir(
    dir: string,
    extension: string,
    maxAge: number,
    expireAt: number,
    buffer: Buffer,
    etag: string
  ) {
    const filename = join(dir, `${maxAge}.${expireAt}.${etag}.${extension}`);

    await promises.rm(dir, { force: true, recursive: true }).catch(() => {
      // do nothing
    });

    await promises.mkdir(dir, { recursive: true });
    await promises.writeFile(filename, buffer);
  }

  private getCacheKey(path: string) {
    return this.getHash([this.key, this.cacheVersion, path]);
  }

  private getHash(items: (string | number | Buffer)[]) {
    const hash = createHash('sha256');
    for (const item of items) {
      if (typeof item === 'number') hash.update(String(item));
      else {
        hash.update(item);
      }
    }
    // See https://en.wikipedia.org/wiki/Base64#Filenames
    return hash.digest('base64').replace(/\//g, '-');
  }

  private getCacheDirectory() {
    return path.join(baseCacheDirectory, this.key);
  }
}

export default ImageProxy;
