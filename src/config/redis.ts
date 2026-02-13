import Redis from 'ioredis';
import { config } from './index';
import { logger } from './logger';

class RedisClient {
    private static instance: Redis | null = null;

    static getInstance(): Redis {
        if (!RedisClient.instance) {
            RedisClient.instance = new Redis(config.redisUrl, {
                retryStrategy: (times) => {
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                },
                maxRetriesPerRequest: 3,
            });

            RedisClient.instance.on('connect', () => {
                logger.info('Redis connected');
            });

            RedisClient.instance.on('error', (err) => {
                logger.error({ err }, 'Redis connection error');
            });

            RedisClient.instance.on('close', () => {
                logger.warn('Redis connection closed');
            });
        }

        return RedisClient.instance;
    }

    static async disconnect(): Promise<void> {
        if (RedisClient.instance) {
            await RedisClient.instance.quit();
            RedisClient.instance = null;
            logger.info('Redis disconnected');
        }
    }
}

export const redis = RedisClient.getInstance();
export { RedisClient };
