import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.userId;
    req.userEmail = payload.email;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};
