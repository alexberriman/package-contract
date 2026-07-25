export {
  type ComparePackagesOptions,
  type ComparisonReport,
  comparePackages,
  type UnchangedDiagnostic,
} from "./core/compare-packages.js";
export {
  type ConsumerProfileId,
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
export type { PackedFile } from "./core/pack.js";
export type {
  PackageReport,
  ReportEnvironment,
  RuntimePlatform,
} from "./core/report.js";
export {
  type MaterializeReproductionOptions,
  materializeReproduction,
  type Reproduction,
} from "./core/reproduction.js";
export type {
  EvaluationState,
  NotEvaluatedReason,
  ProbeResult,
} from "./core/result.js";
export {
  type TestPackageOptions,
  testPackage,
} from "./core/test-package.js";
export type {
  IncumbentFinding,
  IncumbentTool,
} from "./integrations/types.js";
export {
  type ConsumerProfile,
  type ConsumerProfileInput,
  defineConsumer,
  type RuntimeInput,
} from "./profiles/consumer.js";
export { renderHumanComparison } from "./reporters/comparison.js";
export { renderGitHubReport } from "./reporters/github.js";
export { renderHumanReport } from "./reporters/human.js";
export {
  serializeJson,
  serializeJsonReport,
} from "./reporters/json.js";
