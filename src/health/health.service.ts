import { Injectable } from '@nestjs/common';
import { HealthStatusDto } from './dto';

@Injectable()
export class HealthService {
  getStatus(): HealthStatusDto {
    return {
      status: 'ok',
      service: 'gtm-backend',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.0.1',
    };
  }
}
