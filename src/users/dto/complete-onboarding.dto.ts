import { Equals, IsBoolean } from 'class-validator';

export class CompleteOnboardingDto {
  @IsBoolean()
  @Equals(true, { message: 'hasCompletedOnboarding must be true' })
  hasCompletedOnboarding: boolean;
}
