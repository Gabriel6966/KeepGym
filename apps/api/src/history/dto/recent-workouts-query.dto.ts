import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class RecentWorkoutsQueryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^[1-9]\d*$/.test(value)
      ? Number(value)
      : value,
  )
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 5;
}
