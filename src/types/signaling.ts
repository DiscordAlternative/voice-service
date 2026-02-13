import type { RTCRtpCapabilities, DtlsParameters, RtpParameters } from 'mediasoup/node/lib/types';

// Client to Server Messages
export type ClientMessage =
    | JoinMessage
    | LeaveMessage
    | CreateTransportMessage
    | ConnectTransportMessage
    | ProduceMessage
    | ConsumeMessage
    | UpdateStateMessage
    | ResumeConsumerMessage;

export interface JoinMessage {
    type: 'join';
    channelId: string;
    rtpCapabilities: RTCRtpCapabilities;
}

export interface LeaveMessage {
    type: 'leave';
    channelId: string;
}

export interface CreateTransportMessage {
    type: 'createTransport';
    direction: 'send' | 'recv';
}

export interface ConnectTransportMessage {
    type: 'connectTransport';
    transportId: string;
    dtlsParameters: DtlsParameters;
}

export interface ProduceMessage {
    type: 'produce';
    transportId: string;
    kind: 'audio' | 'video';
    rtpParameters: RtpParameters;
    producerType?: 'camera' | 'screen'; // For video
}

export interface ConsumeMessage {
    type: 'consume';
    producerId: string;
}

export interface UpdateStateMessage {
    type: 'updateState';
    muted?: boolean;
    deafened?: boolean;
    videoEnabled?: boolean;
}

export interface ResumeConsumerMessage {
    type: 'resumeConsumer';
    consumerId: string;
}

// Server to Client Messages
export type ServerMessage =
    | ConnectedMessage
    | RouterCapabilitiesMessage
    | TransportCreatedMessage
    | ProducedMessage
    | NewProducerMessage
    | ConsumedMessage
    | UserStateUpdateMessage
    | UserJoinedMessage
    | UserLeftMessage
    | ProducerClosedMessage
    | ErrorMessage;

export interface ConnectedMessage {
    type: 'connected';
    connectionId: string;
}

export interface RouterCapabilitiesMessage {
    type: 'routerCapabilities';
    rtpCapabilities: RTCRtpCapabilities;
}

export interface TransportCreatedMessage {
    type: 'transportCreated';
    transportId: string;
    iceParameters: any;
    iceCandidates: any[];
    dtlsParameters: any;
}

export interface ProducedMessage {
    type: 'produced';
    producerId: string;
}

export interface NewProducerMessage {
    type: 'newProducer';
    producerId: string;
    userId: string;
    kind: 'audio' | 'video';
    producerType?: 'camera' | 'screen';
}

export interface ConsumedMessage {
    type: 'consumed';
    consumerId: string;
    producerId: string;
    kind: 'audio' | 'video';
    rtpParameters: RtpParameters;
}

export interface UserStateUpdateMessage {
    type: 'userStateUpdate';
    userId: string;
    muted: boolean;
    deafened: boolean;
    videoEnabled: boolean;
}

export interface UserJoinedMessage {
    type: 'userJoined';
    userId: string;
    username?: string;
}

export interface UserLeftMessage {
    type: 'userLeft';
    userId: string;
}

export interface ProducerClosedMessage {
    type: 'producerClosed';
    producerId: string;
}

export interface ErrorMessage {
    type: 'error';
    message: string;
    code?: string;
}

// State Types
export interface ParticipantState {
    userId: string;
    connectionId: string;
    sendTransportId?: string;
    recvTransportId?: string;
    producers: {
        audio?: string;
        video?: string;
        screen?: string;
    };
    state: {
        muted: boolean;
        deafened: boolean;
        videoEnabled: boolean;
        screenSharing: boolean;
    };
    joinedAt: number;
}

export interface RoomState {
    channelId: string;
    routerId: string;
    participants: Record<string, ParticipantState>;
    createdAt: number;
}

// WebSocket Extension
export interface WSData {
    userId: string;
    connectionId: string;
    channelId?: string;
}
