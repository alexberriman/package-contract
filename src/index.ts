export {
  type CreateDiagnosticOptions,
  compareDiagnostics,
  createDiagnostic,
  type Diagnostic,
  type DiagnosticInput,
  type DiagnosticSeverity,
  type FilePosition,
  type FileRange,
} from "./core/diagnostic.js";
export type { PackageInput } from "./core/input.js";
export type {
  PackageReport,
  ReportEnvironment,
} from "./core/report.js";
export type {
  EvaluationState,
  NotEvaluatedReason,
  ProbeResult,
} from "./core/result.js";
export {
  type TestPackageOptions,
  testPackage,
} from "./core/test-package.js";
export {
  type ConsumerProfile,
  type ConsumerProfileInput,
  defineConsumer,
  type RuntimeInput,
} from "./profiles/consumer.js";
