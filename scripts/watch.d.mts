// 감시 스크립트의 타입 계약 정의

// 외부 명령 실행 결과이며 실행 불가와 시간 초과는 종료 코드 없음
export interface Result {
    code: number | null;
    out: string;
    err: string;
}

// 파일 식별 번호와 크기
export interface Mark {
    inode: number;
    size: number;
}

// 시험에서 가짜로 바꿀 수 있는 명령 실행과 파일 접근과 시계
export interface Host {
    run(file: string, args: string[], limit: number): Result;
    stat(path: string): Mark | null;
    read(path: string): string | null;
    part(path: string, start: number, end: number): Uint8Array;
    save(path: string, text: string): void;
    now(): Date;
    print(line: string): void;
    warn(line: string): void;
}

// 임대 조회문 생성
export function query(now: string): string;

// 직접 실행 여부 확인
export function entry(url: string, path: string | undefined): boolean;

// 한 회차 점검 실행과 종료 코드 반환
export function watch(argv: string[], host?: Host): number;
