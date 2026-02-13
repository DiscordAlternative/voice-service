import * as mediasoup from 'mediasoup';
import { types as mediasoupTypes } from 'mediasoup';
import os from 'os';
import { config } from '../config';
import { logger } from '../config/logger';

class WorkerManager {
    private workers: mediasoupTypes.Worker[] = [];
    private nextWorkerIdx = 0;

    async initialize(): Promise<void> {
        const numWorkers = os.cpus().length;
        logger.info(`Creating ${numWorkers} MediaSoup workers`);

        for (let i = 0; i < numWorkers; i++) {
            const worker = await mediasoup.createWorker({
                logLevel: 'warn',
                rtcMinPort: config.rtcMinPort,
                rtcMaxPort: config.rtcMaxPort,
                logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp'],
            });

            worker.on('died', () => {
                logger.error(`MediaSoup worker ${worker.pid} died, restarting...`);
                setTimeout(() => this.createWorker(i), 2000);
            });

            this.workers[i] = worker;
            logger.info(`MediaSoup worker ${worker.pid} created`);
        }
    }

    private async createWorker(index: number): Promise<void> {
        try {
            const worker = await mediasoup.createWorker({
                logLevel: 'warn',
                rtcMinPort: config.rtcMinPort,
                rtcMaxPort: config.rtcMaxPort,
                logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp'],
            });

            worker.on('died', () => {
                logger.error(`MediaSoup worker ${worker.pid} died, restarting...`);
                setTimeout(() => this.createWorker(index), 2000);
            });

            this.workers[index] = worker;
            logger.info(`MediaSoup worker ${worker.pid} restarted`);
        } catch (error) {
            logger.error({ error }, 'Failed to create worker');
        }
    }

    getWorker(): mediasoupTypes.Worker {
        const worker = this.workers[this.nextWorkerIdx];
        this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;
        return worker;
    }

    async close(): Promise<void> {
        logger.info('Closing all MediaSoup workers');
        for (const worker of this.workers) {
            worker.close();
        }
        this.workers = [];
    }
}

export const workerManager = new WorkerManager();
