import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || !Array.isArray(user.roles)) {
      throw new ForbiddenException('Admin access required');
    }
    if (!user.roles.includes('Admin')) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
