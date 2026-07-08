import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import axios from 'axios';
import rateLimit from 'axios-rate-limit';
import type NodeCache from 'node-cache';
import logger from '@server/logger';

// 5 minute default TTL (in seconds)
const DEFAULT_TTL = 300;

// 10 seconds default rolling buffer (in ms)
const DEFAULT_ROLLING_BUFFER = 10000;
const DEFAULT_TIMEOUT = 10000;
const DEFAULT_RETRIES = 2;
const MAX_LAST_KNOWN_CACHE_ITEMS = 500;

interface ExternalAPIOptions {
  nodeCache?: NodeCache;
  headers?: Record<string, unknown>;
  rateLimit?: {
    maxRPS: number;
    maxRequests: number;
  };
  timeout?: number;
  retries?: number;
}

class ExternalAPI {
  protected axios: AxiosInstance;
  private baseUrl: string;
  private cache?: NodeCache;
  private lastKnownCache = new Map<string, unknown>();
  private retries: number;

  constructor(
    baseUrl: string,
    params: Record<string, unknown>,
    options: ExternalAPIOptions = {}
  ) {
    this.axios = axios.create({
      baseURL: baseUrl,
      params,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options.headers,
      },
    });

    if (options.rateLimit) {
      this.axios = rateLimit(this.axios, {
        maxRequests: options.rateLimit.maxRequests,
        maxRPS: options.rateLimit.maxRPS,
      });
    }

    this.baseUrl = baseUrl;
    this.cache = options.nodeCache;
    this.retries = options.retries ?? DEFAULT_RETRIES;
  }

  protected async get<T>(
    endpoint: string,
    config?: AxiosRequestConfig,
    ttl?: number
  ): Promise<T> {
    const cacheKey = this.serializeCacheKey(endpoint, config?.params);
    const cachedItem = this.cache?.get<T>(cacheKey);
    if (cachedItem !== undefined) {
      return cachedItem;
    }

    try {
      const response = await this.requestWithRetry<T>(() =>
        this.axios.get<T>(endpoint, config)
      );

      if (this.cache) {
        this.setCache(cacheKey, response.data, ttl);
      }

      return response.data;
    } catch (e) {
      const staleItem =
        this.cache?.get<T>(cacheKey) ?? this.getLastKnownCacheItem<T>(cacheKey);
      if (staleItem !== undefined) {
        logger.warn('Serving stale cached API response after request failure', {
          label: 'External API',
          endpoint,
          errorMessage: e instanceof Error ? e.message : 'Unknown error',
        });
        return staleItem;
      }

      throw e;
    }
  }

  protected async post<T>(
    endpoint: string,
    data: Record<string, unknown>,
    config?: AxiosRequestConfig,
    ttl?: number
  ): Promise<T> {
    const cacheKey = this.serializeCacheKey(endpoint, {
      config: config?.params,
      data,
    });
    const cachedItem = this.cache?.get<T>(cacheKey);
    if (cachedItem !== undefined) {
      return cachedItem;
    }

    const response = await this.requestWithRetry<T>(() =>
      this.axios.post<T>(endpoint, data, config)
    );

    if (this.cache) {
      this.setCache(cacheKey, response.data, ttl);
    }

    return response.data;
  }

  protected async getRolling<T>(
    endpoint: string,
    config?: AxiosRequestConfig,
    ttl?: number
  ): Promise<T> {
    const cacheKey = this.serializeCacheKey(endpoint, config?.params);
    const cachedItem = this.cache?.get<T>(cacheKey);

    if (cachedItem !== undefined) {
      const keyTtl = this.cache?.getTtl(cacheKey) ?? 0;

      // If the item has passed our rolling check, fetch again in background
      if (
        keyTtl - (ttl ?? DEFAULT_TTL) * 1000 <
        Date.now() - DEFAULT_ROLLING_BUFFER
      ) {
        this.axios
          .get<T>(endpoint, config)
          .then((response) => {
            this.setCache(cacheKey, response.data, ttl);
          })
          .catch((e) => {
            logger.warn('Failed to refresh rolling API cache entry', {
              label: 'External API',
              endpoint,
              errorMessage: e instanceof Error ? e.message : 'Unknown error',
            });
          });
      }
      return cachedItem;
    }

    const response = await this.requestWithRetry<T>(() =>
      this.axios.get<T>(endpoint, config)
    );

    if (this.cache) {
      this.setCache(cacheKey, response.data, ttl);
    }

    return response.data;
  }

  private serializeCacheKey(
    endpoint: string,
    params?: Record<string, unknown>
  ) {
    if (!params) {
      return `${this.baseUrl}${endpoint}`;
    }

    return `${this.baseUrl}${endpoint}${JSON.stringify(params)}`;
  }

  private setCache<T>(cacheKey: string, data: T, ttl?: number): void {
    this.setLastKnownCacheItem(cacheKey, data);

    if (ttl === undefined) {
      this.cache?.set(cacheKey, data);
      return;
    }

    this.cache?.set(cacheKey, data, ttl);
  }

  private setLastKnownCacheItem<T>(cacheKey: string, data: T): void {
    this.lastKnownCache.delete(cacheKey);
    this.lastKnownCache.set(cacheKey, data);

    while (this.lastKnownCache.size > MAX_LAST_KNOWN_CACHE_ITEMS) {
      const oldestKey = this.lastKnownCache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.lastKnownCache.delete(oldestKey);
    }
  }

  private getLastKnownCacheItem<T>(cacheKey: string): T | undefined {
    if (!this.lastKnownCache.has(cacheKey)) {
      return undefined;
    }

    return this.lastKnownCache.get(cacheKey) as T | undefined;
  }

  private async requestWithRetry<T>(
    request: () => Promise<{ data: T }>
  ): Promise<{ data: T }> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        return await request();
      } catch (e) {
        lastError = e;

        if (attempt === this.retries || !this.shouldRetry(e)) {
          break;
        }

        await this.sleep(this.getRetryDelay(e, attempt));
      }
    }

    throw lastError;
  }

  private shouldRetry(e: unknown): boolean {
    if (!axios.isAxiosError(e)) {
      return false;
    }

    const status = e.response?.status;
    return (
      !status ||
      status === 408 ||
      status === 425 ||
      status === 429 ||
      status >= 500
    );
  }

  private getRetryDelay(e: unknown, attempt: number): number {
    if (axios.isAxiosError(e)) {
      const retryAfter = e.response?.headers?.['retry-after'];
      const retryAfterSeconds = Array.isArray(retryAfter)
        ? Number(retryAfter[0])
        : Number(retryAfter);

      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return Math.min(retryAfterSeconds * 1000, 30000);
      }
    }

    return Math.min(500 * 2 ** attempt, 5000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default ExternalAPI;
