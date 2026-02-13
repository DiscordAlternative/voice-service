import { config } from '../config';

interface JWTPayload {
    userId: string;
    email?: string;
    iat?: number;
    exp?: number;
}

/**
 * Verify JWT token and extract payload
 * Note: Using a simple implementation for now.
 * In production, use a proper JWT library like 'jsonwebtoken'
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
    try {
        // For now, we'll use Bun's built-in JWT support when available
        // or implement a simple base64 decode for development

        // Split the token
        const parts = token.split('.');
        if (parts.length !== 3) {
            return null;
        }

        // Decode payload (base64url)
        const payload = JSON.parse(
            Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
        );

        // Check expiration
        if (payload.exp && payload.exp < Date.now() / 1000) {
            return null;
        }

        // TODO: Verify signature with JWT_SECRET
        // For now, we trust the token if it's properly formatted

        return payload as JWTPayload;
    } catch (error) {
        return null;
    }
}
