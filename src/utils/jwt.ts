import jwt from 'jsonwebtoken';

const WEAK_PLACEHOLDERS = [
  'change-this-to-a-long-random-secret-in-production',
  'change-this-refresh-secret-in-production',
];

function loadSecret(envVar: string): string {
  const val = process.env[envVar];
  if (!val) throw new Error(`${envVar} is not set`);
  if (WEAK_PLACEHOLDERS.includes(val)) {
    throw new Error(`${envVar} is using a placeholder value. Generate a strong secret with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`);
  }
  if (val.length < 32) {
    throw new Error(`${envVar} must be at least 32 characters`);
  }
  return val;
}

const JWT_SECRET         = loadSecret('JWT_SECRET');
const JWT_REFRESH_SECRET = loadSecret('JWT_REFRESH_SECRET');

export interface JwtPayload {
  userId: string;
  email: string;
}

export const signAccessToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
};

export const signRefreshToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '90d' });
};

export const verifyAccessToken = (token: string): JwtPayload => {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
};

export const verifyRefreshToken = (token: string): JwtPayload => {
  return jwt.verify(token, JWT_REFRESH_SECRET) as JwtPayload;
};
