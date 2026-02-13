import { types as mediasoupTypes } from 'mediasoup';
import { workerManager } from './worker-manager';
import { logger } from '../config/logger';

// Media codecs configuration
const mediaCodecs: mediasoupTypes.RtpCodecCapability[] = [
    {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
    },
    {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
            'x-google-start-bitrate': 1000,
        },
    },
    {
        kind: 'video',
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
        },
    },
];

class RouterManager {
    private routers = new Map<string, mediasoupTypes.Router>();

    async createRouter(channelId: string): Promise<mediasoupTypes.Router> {
        try {
            const worker = workerManager.getWorker();
            const router = await worker.createRouter({ mediaCodecs });

            this.routers.set(channelId, router);
            logger.info({ channelId }, 'Router created for channel');

            return router;
        } catch (error) {
            logger.error({ error, channelId }, 'Failed to create router');
            throw error;
        }
    }

    getRouter(channelId: string): mediasoupTypes.Router | undefined {
        return this.routers.get(channelId);
    }

    async getOrCreateRouter(channelId: string): Promise<mediasoupTypes.Router> {
        let router = this.getRouter(channelId);
        if (!router) {
            router = await this.createRouter(channelId);
        }
        return router;
    }

    deleteRouter(channelId: string): void {
        const router = this.routers.get(channelId);
        if (router) {
            router.close();
            this.routers.delete(channelId);
            logger.info({ channelId }, 'Router deleted');
        }
    }

    getRtpCapabilities(): mediasoupTypes.RtpCapabilities {
        // Return a sample router's RTP capabilities
        // All routers have the same capabilities
        const router = this.routers.values().next().value;
        if (router) {
            return router.rtpCapabilities;
        }

        // Return default capabilities based on our codecs
        // This is safe because all routers use the same mediaCodecs
        return {
            codecs: mediaCodecs,
            headerExtensions: [],
        };
    }
}

export const routerManager = new RouterManager();
export { mediaCodecs };
