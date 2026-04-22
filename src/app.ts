import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth.routes';
import metricsRoutes from './routes/metrics.routes';
import goalsRoutes from './routes/goals.routes';
import devicesRoutes, { consentRouter } from './routes/devices.routes';
import profileRoutes from './routes/profile.routes';
import statsRoutes from './routes/stats.routes';
import ratingRoutes from './routes/rating.routes';
import workoutRoutes from './routes/workout.routes';
import stepsRoutes from './routes/steps.routes';

const app = express();

app.use(helmet());

// CORS allow-list is configurable via CORS_ORIGINS (comma-separated) in .env.
// Use "*" to allow all origins (dev only). Requests without an Origin header
// (native mobile apps, curl, server-to-server) are always allowed — CORS is
// a browser-only protection.
const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes('*')) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);
app.use(express.json());

app.use('/auth', authRoutes);

app.use('/users/:user_id/metrics', authMiddleware, metricsRoutes);
app.use('/users/:user_id/workouts', authMiddleware, workoutRoutes);
app.use('/users/:user_id/goals', authMiddleware, goalsRoutes);
app.use('/users/:user_id/devices', authMiddleware, devicesRoutes);
app.use('/users/:user_id/consents', authMiddleware, consentRouter);
app.use('/users/:user_id/profile', authMiddleware, profileRoutes);
app.get('/users/:user_id/export', authMiddleware, (req, res, next) => {
  import('./controllers/profile.controller').then(({ exportData }) => exportData(req as never, res)).catch(next);
});

app.use('/users/:user_id/steps', stepsRoutes);
app.use('/stats', statsRoutes);
app.use('/ratings', ratingRoutes);
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use(errorHandler);

export default app;
