import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { corsOrigins } from './common/cors.config';
import { getSmsTestModeConfig } from './sms/sms-test-mode';

async function bootstrap() {
  // Validate SMS test mode before anything can serve traffic. This throws if
  // SMS_TEST_MODE is set on a production build, so a misconfigured deploy
  // fails loudly at boot instead of silently weakening verification.
  getSmsTestModeConfig();

  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`OvrLap Backend running at http://localhost:${port}`);
}

void bootstrap();
