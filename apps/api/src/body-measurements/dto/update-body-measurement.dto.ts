import { CreateBodyMeasurementDto } from './create-body-measurement.dto';

// All fields are already individually optional/nullable. The service validates
// the resulting locked record, rather than requiring a metric in the PATCH.
export class UpdateBodyMeasurementDto extends CreateBodyMeasurementDto {}
