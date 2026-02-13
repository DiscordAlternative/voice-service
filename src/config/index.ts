export const config = {
    port: parseInt(process.env.PORT || '3003'),
    nodeEnv: process.env.NODE_ENV || 'development',

    // WebRTC
    publicIp: process.env.PUBLIC_IP || '127.0.0.1',
    rtcMinPort: parseInt(process.env.RTC_MIN_PORT || '40000'),
    rtcMaxPort: parseInt(process.env.RTC_MAX_PORT || '49999'),

    // TURN/STUN
    turnUsername: process.env.TURN_USERNAME || 'voice-user',
    turnCredential: process.env.TURN_CREDENTIAL || 'secure-password',
    turnPort: parseInt(process.env.TURN_PORT || '3478'),

    // Redis
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

    // JWT
    jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production',

    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',
};
