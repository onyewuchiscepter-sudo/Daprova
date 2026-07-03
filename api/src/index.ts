import { env } from './env.js';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { orgRouter } from './routes/org.js';
import { errorHandler } from './lib/errors.js';
import { adminLimiter, publicLimiter } from './middleware/rateLimit.js';

const app = express();

app.use(
  cors({
    origin: env.adminDashboardOrigin,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.use(healthRouter);

// Public/no-auth assessment endpoints will mount under /api/v1/assess with publicLimiter (added in S3).
app.use('/api/v1/auth', publicLimiter, authRouter);
app.use('/api/v1', adminLimiter, orgRouter);

app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`[daprova-api] listening on http://localhost:${env.port}`);
});
