import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttp } from './http/configure-http';
import {
  environmentConfig,
  type EnvironmentConfig,
} from './config/environment.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<EnvironmentConfig>(environmentConfig.KEY);
  configureHttp(app);
  app.enableShutdownHooks();
  await app.listen(config.port);
}

void bootstrap();
