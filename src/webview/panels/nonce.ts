import { randomBytes } from 'crypto';

// CSP nonces must be unpredictable; 128 bits matches the CSP Level 3 recommendation.
export function createNonce(): string {
    return randomBytes(16).toString('base64');
}
