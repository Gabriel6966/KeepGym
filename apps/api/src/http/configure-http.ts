import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import {
  environmentConfig,
  type EnvironmentConfig,
} from '../config/environment.config';

// Shared by bootstrap and HTTP tests so middleware/CORS cannot drift apart.
export function configureHttp(app: INestApplication): void {
  const config = app.get<EnvironmentConfig>(environmentConfig.KEY);
  app.use(cookieParser());
  app.enableCors({ origin: config.frontendOrigin, credentials: true });
}
