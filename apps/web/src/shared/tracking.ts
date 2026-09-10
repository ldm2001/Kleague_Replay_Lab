export type TrackingSummary = Readonly<{
  version: "ball-path-v1";
  coverage: "COMPLETE" | "PARTIAL";
  sampleCount: number;
  selectedCount: number;
  cameraCount: number;
  motionOnsetsMs: readonly number[];
}>;

// Worker와 저장소 모두의 경계에서 수량과 원본 시간 범위를 재검증한다
export function trackingData(value: unknown, startMs: number, endMs: number): value is TrackingSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000;
  return item.version === "ball-path-v1" && (item.coverage === "COMPLETE" || item.coverage === "PARTIAL") &&
    count(item.sampleCount) && count(item.selectedCount) && count(item.cameraCount) &&
    item.cameraCount <= item.selectedCount && item.selectedCount <= item.sampleCount &&
    Array.isArray(item.motionOnsetsMs) && item.motionOnsetsMs.length <= Math.floor(item.cameraCount / 2) &&
    item.motionOnsetsMs.every((time, index, times) => typeof time === "number" && Number.isSafeInteger(time) &&
      time >= startMs && time <= endMs && (index === 0 || time > times[index - 1]));
}
