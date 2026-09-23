// 현재 시각 포트
export type Clock = Readonly<{
    // 유효 기한 판단에 사용하는 현재 시각
    now: () => Date;
}>;
