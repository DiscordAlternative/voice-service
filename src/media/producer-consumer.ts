import { types as mediasoupTypes, RtpParameters } from 'mediasoup';
import { logger } from '../config/logger';

export async function createProducer(
    transport: mediasoupTypes.WebRtcTransport,
    kind: 'audio' | 'video',
    rtpParameters: RtpParameters,
    userId: string,
    channelId: string,
    producerType?: 'camera' | 'screen'
): Promise<mediasoupTypes.Producer> {
    try {
        const producer = await transport.produce({
            kind,
            rtpParameters,
            appData: { userId, channelId, producerType: producerType || 'camera' },
        });

        producer.on('transportclose', () => {
            logger.info({ producerId: producer.id, userId }, 'Producer transport closed');
            producer.close();
        });

        producer.on('close', () => {
            logger.info({ producerId: producer.id, userId, kind }, 'Producer closed');
        });

        logger.info({ producerId: producer.id, userId, kind, producerType }, 'Producer created');
        return producer;
    } catch (error) {
        logger.error({ error, userId, kind }, 'Failed to create producer');
        throw error;
    }
}

export async function createConsumer(
    transport: mediasoupTypes.WebRtcTransport,
    producer: mediasoupTypes.Producer,
    rtpCapabilities: mediasoupTypes.RtpCapabilities,
    userId: string
): Promise<mediasoupTypes.Consumer> {
    try {
        const router = transport.appData.router as mediasoupTypes.Router;

        if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) {
            throw new Error('Cannot consume this producer');
        }

        const consumer = await transport.consume({
            producerId: producer.id,
            rtpCapabilities,
            paused: true, // Start paused, client will resume
            appData: { userId, producerId: producer.id },
        });

        consumer.on('transportclose', () => {
            logger.info({ consumerId: consumer.id, userId }, 'Consumer transport closed');
            consumer.close();
        });

        consumer.on('producerclose', () => {
            logger.info({ consumerId: consumer.id, userId }, 'Consumer producer closed');
            consumer.close();
        });

        consumer.on('close', () => {
            logger.info({ consumerId: consumer.id, userId }, 'Consumer closed');
        });

        logger.info({ consumerId: consumer.id, userId, producerId: producer.id }, 'Consumer created');
        return consumer;
    } catch (error) {
        logger.error({ error, userId, producerId: producer.id }, 'Failed to create consumer');
        throw error;
    }
}
