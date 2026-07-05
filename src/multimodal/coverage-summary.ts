export const OMNI_CONTROL_COVERAGE = {
  tsxFileCount: 35,
  nativeControls: {
    total: 177,
    covered: 177,
    missing: 0,
  },
  customInteractiveControls: {
    total: 52,
    covered: 52,
    missing: 0,
  },
  manualOnlyScenarioCount: 9,
} as const

export function omniControlCoverageMissingCount(): number {
  return OMNI_CONTROL_COVERAGE.nativeControls.missing + OMNI_CONTROL_COVERAGE.customInteractiveControls.missing
}
