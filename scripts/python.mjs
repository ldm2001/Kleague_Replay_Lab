// 교차 언어 시험과 파이썬 시험에 공통으로 사용할 실행기 선택
export function python(env = process.env) {
    // 별도 지정이 없을 때 기존 로컬 실행 방식 유지
    if (env.TEST_PYTHON === undefined) return "python3";
    // 지정 경로의 주변 공백 제거
    const value = env.TEST_PYTHON.trim();
    // 잘못된 설정에서 다른 실행기로 조용히 전환하지 않도록 거부
    if (!value) throw new Error("TEST_PYTHON-required");
    // 셸 해석 없이 단일 실행 파일 경로 반환
    return value;
}
