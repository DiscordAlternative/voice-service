import { types as mediasoupTypes } from 'mediasoup';
import { config } from '../config';
import { logger } from '../config/logger';

export async function createWebRtcTransport(
    router: mediasoupTypes.Router,
    direction: 'send' | 'recv'
): Promise<mediasoupTypes.WebRtcTransport> {
    try {
        const transport = await router.createWebRtcTransport({
            listenIps: [
                {
                    ip: '0.0.0.0',
                    announcedIp: config.publicIp,
                },
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: 1000000,
            minimumAvailableOutgoingBitrate: 600000,
            maxSctpMessageSize: 262144,
            enableSctp: false,
        });

        transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'closed') {
                transport.close();
            }
        });

        transport.on('close', () => {
            logger.info({ transportId: transport.id, direction }, 'Transport closed');
        });

        logger.info({ transportId: transport.id, direction }, 'WebRTC transport created');
        return transport;
    } catch (error) {
        logger.error({ error, direction }, 'Failed to create WebRTC transport');
        throw error;
    }
}
