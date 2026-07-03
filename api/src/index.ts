import { env } from './env.js';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { orgRouter } from './routes/org.js';
import { frameworksRouter } from './routes/frameworks.js';
import { coursesRouter } from './routes/courses.js';
import { cohortsRouter } from './routes/cohorts.js';
import { assessRouter } from './routes/assess.js';
import { errorHandler } from './lib/errors.js';
import { adminLimiter, publicLimiter } from './middleware/rateLimit.js';

const app = express();

const allowedOrigins = new Set([env.adminDashboardOrigin, env.assessmentWebOrigin]);
app.use(
  cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.use(healthRouter);

app.use('/api/v1/auth', publicLimiter, authRouter);
app.use('/api/v1', adminLimiter, orgRouter);
app.use('/api/v1/frameworks', adminLimiter, frameworksRouter);
app.use('/api/v1/courses', adminLimiter, coursesRouter);
app.use('/api/v1/cohorts', adminLimiter, cohortsRouter);
app.use('/api/v1/assess', publicLimiter, assessRouter);

app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`[daprova-api] listening on http://localhost:${env.port}`);
});
