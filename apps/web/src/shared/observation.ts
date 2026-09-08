// 과거 영상 관찰 결과와의 하위 호환 타입
// 현재 자동 처리 Worker는 이 값을 생성하지 않는다
export type SceneObservation = Readonly<{
  // 관찰에 사용한 로컬 모델
  model: string;
  // 확인 가능한 사건 유형
  category: "PUSHING" | "OTHER" | "UNKNOWN";
  // 접촉의 관측 여부
  contact: "YES" | "NO" | "UNKNOWN";
  // 상대 선수 이동 변화
  displacement: "clear" | "none" | "possible" | "uncertain";
  // 모델이 본 카메라 충족도
  camera: "LOW" | "MEDIUM" | "HIGH";
  // 모델 관찰 요약
  summary: string;
  // 실제 입력 프레임 시각
  timestamps: readonly number[];
}>;

// 모델 출력은 경계에서 다시 검증
export const observationData = (value: unknown): value is SceneObservation => {
  // 배열과 빈 응답 차단
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  // 검증할 필드 조회
  const item = value as Record<string, unknown>;
  // 문자열 길이와 허용 어휘와 프레임 시각 확인
  return typeof item.model === "string" && item.model.length > 0 && item.model.length <= 128
    && typeof item.category === "string" && ["PUSHING", "OTHER", "UNKNOWN"].includes(item.category)
    && typeof item.contact === "string" && ["YES", "NO", "UNKNOWN"].includes(item.contact)
    && typeof item.displacement === "string" && ["clear", "none", "possible", "uncertain"].includes(item.displacement)
    && typeof item.camera === "string" && ["LOW", "MEDIUM", "HIGH"].includes(item.camera)
    && typeof item.summary === "string" && item.summary.trim().length > 0 && item.summary.length <= 1200
    && Array.isArray(item.timestamps) && item.timestamps.length > 0 && item.timestamps.length <= 8
    && item.timestamps.every((time) => Number.isSafeInteger(time) && time >= 0);
};
