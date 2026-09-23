// 내부 실패 단계와 안전한 작업 식별자 계약 정의
export type ResultDiagnostic = Readonly<{
    // 실패한 내부 처리 단계
    stage: "PREFLIGHT" | "OBJECTS" | "ADMISSION" | "EVALUATION" | "PERSISTENCE";
    // 형식 검사를 통과한 작업 식별자
    jobId: string;
    // 양의 정수로 확인된 작업 판본
    jobRevision: number;
}>;

// 원본 예외를 받지 않는 내부 진단 기능 계약 정의
// 동기 작업은 짧게 제한하고 비동기 완료는 결과 처리에서 기다리지 않음
export type Diagnostic = (value: ResultDiagnostic) => void | Promise<void>;

// 진단 전송의 동기 및 비동기 실패를 결과 처리와 분리
export const notice = (value: ResultDiagnostic, sink: Diagnostic | undefined): void => {
    // 동기 진단 실패의 독립 경계 설정
    try {
        // 진단 완료를 기다리지 않고 비동기 실패만 처리
        void Promise.resolve(sink?.(value)).catch(() => {
            // 비동기 진단 실패가 원본 결과를 가리지 않도록 무시
        });
    } catch {
        // 동기 진단 실패가 원본 결과를 가리지 않도록 무시
    }
};

// 진단 기능의 실패와 무관하게 원본 예외 보존
export const diagnostic = async <T>(
    value: ResultDiagnostic,
    sink: Diagnostic | undefined,
    operation: () => T | Promise<T>
): Promise<T> => {
    // 처리 단계의 동기 및 비동기 예외 포착
    try {
        // 처리 결과를 기다린 뒤 반환
        return await operation();
    } catch (error) {
        // 원본 오류와 비밀값 없이 단계 정보만 전송
        notice(value, sink);
        // 동일한 원본 예외 반환
        throw error;
    }
};
