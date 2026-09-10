import { Module } from '@nestjs/common';
import { UserService } from './user.service.js';
import { EnrollmentService } from './enrollment.service.js';
import { KycService } from './kyc.service.js';

@Module({
  providers: [UserService, EnrollmentService, KycService],
  exports: [UserService, EnrollmentService, KycService],
})
export class IdentityModule {}
