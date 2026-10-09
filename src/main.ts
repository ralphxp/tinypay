import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';

async function bootstrap() {
  // rawBody:true preserves the unparsed request body so webhook signature
  // verification (Paystack HMAC-SHA512) can run against exactly the bytes
  // the provider signed.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // AllExceptionsFilter is registered as an APP_FILTER provider (see
  // AppModule) instead of `new`'d here — it now depends on ErrorLogService
  // (injected), which only Nest's DI container can wire up.
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
