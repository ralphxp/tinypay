import { Module } from '@nestjs/common';
import { UserService } from './user.service.js';
import { EnrollmentService } from './enrollment.service.js';
import { EnrollmentGuard } from './enrollment.guard.js';

@Module({
  providers: [UserService, EnrollmentService, EnrollmentGuard],
  exports: [UserService, EnrollmentService, EnrollmentGuard],
})
export class IdentityModule {}
