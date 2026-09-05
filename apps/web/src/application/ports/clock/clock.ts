// 현재 시각 포트
export type Clock = Readonly<{
  now: () => Date;
}>;
