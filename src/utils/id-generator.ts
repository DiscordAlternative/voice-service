import { nanoid } from 'nanoid';

/**
 * Generate a unique ID for connections, transports, etc.
 */
export function generateId(): string {
    return nanoid(21);
}
