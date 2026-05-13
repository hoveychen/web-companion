import jwt from 'jsonwebtoken';

export const JWT_SECRET =
  process.env['REFERENCE_BACKEND_SECRET'] ?? 'dev-secret-DO-NOT-USE-IN-PROD';

export interface VerifiedToken {
  userId: string;
}

export function verifyToken(rawToken: string): VerifiedToken | null {
  try {
    const decoded = jwt.verify(rawToken, JWT_SECRET, { algorithms: ['HS256'] });
    if (
      decoded &&
      typeof decoded === 'object' &&
      'userId' in decoded &&
      typeof (decoded as { userId: unknown }).userId === 'string'
    ) {
      return { userId: (decoded as { userId: string }).userId };
    }
    return null;
  } catch {
    return null;
  }
}
