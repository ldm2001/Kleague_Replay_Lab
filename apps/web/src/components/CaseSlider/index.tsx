"use client";

// 화면 구성에 필요한 기능과 공유 자료 형식 읽음
import * as React from "react";
import { useRef, useState } from "react";

// 검토 범위 카드 한 건의 읽기 전용 자료 형식 정의
export type CaseItem = Readonly<{
    // 카드 제목 형식 정의
    title: string;
    // 카드 설명 형식 정의
    text: string;
    // 카드 색상 구분 형식 정의
    tone: string;
    // 카드 이미지 주소 형식 정의
    image: string;
}>;

// 화면 구성에 필요한 읽기 전용 입력 속성 형식 정의
type Props = Readonly<{ items: readonly CaseItem[] }>;

// 검토 범위 슬라이더
export function CaseSlider({ items }: Props) {
    // 현재 이동 위치
    const [index, setIndex] = useState(0);
    // 목록 참조
    const list = useRef<HTMLDivElement>(null);

    // 목록 이동
    const slide = (direction: -1 | 1) => {
        // 이동 가능한 카드 범위 계산
        const next = Math.min(Math.max(index + direction, 0), Math.max(items.length - 1, 0));
        // 첫 카드 너비 조회
        const width = list.current?.firstElementChild?.getBoundingClientRect().width || 320;
        // 카드 목록을 부드럽게 이동
        list.current?.scrollBy({ left: direction * (width + 20), behavior: "smooth" });
        // 현재 카드 위치 저장
        setIndex(next);
    };

    // 검토 범위 반환
    return (
        <div className="case-slider">
            {/* 검토 범위 이전 다음 이동의 화면 묶음 표시 */}
            <div className="case-slider-controls" aria-label="검토 범위 이동">
                {/* 이전 카드 이동 */}
                <button
                    type="button"
                    // 보조 기술이 읽을 화면 요소 이름 지정
                    aria-label="이전 검토 범위"
                    // 클릭 시 연결된 화면 동작 실행
                    onClick={() => slide(-1)}
                    // 진행 상태와 선택 조건에 따라 입력 잠금
                    disabled={index === 0}
                >
                    ←
                </button>
                {/* 다음 카드 이동 */}
                <button
                    type="button"
                    // 보조 기술이 읽을 화면 요소 이름 지정
                    aria-label="다음 검토 범위"
                    // 클릭 시 연결된 화면 동작 실행
                    onClick={() => slide(1)}
                    // 진행 상태와 선택 조건에 따라 입력 잠금
                    disabled={index >= items.length - 1}
                >
                    →
                </button>
            </div>
            {/* 검토 범위 카드 목록의 화면 묶음 표시 */}
            <div className="case-grid" ref={list} role="list">
                {items.map((item) => (
                    <article className={`case-card ${item.tone}`} key={item.title} role="listitem">
                        {/* 검토 예시 이미지의 화면 묶음 표시 */}
                        <div className="case-art">
                            {/* 검토 범위의 이미지 표시 */}
                            <img
                                // 표시할 영상이나 이미지 주소 연결
                                src={item.image}
                                // 이미지를 볼 수 없을 때 사용할 설명 연결
                                alt={`${item.title} 판정 예시`}
                                // 화면 접근 시 필요한 이미지를 늦게 읽도록 지정
                                loading="lazy"
                                // 이미지 해독으로 화면 갱신이 막히지 않도록 지정
                                decoding="async"
                            />
                        </div>
                        {/* 검토 범위의 항목 제목 표시 */}
                        <h3>{item.title}</h3>
                        {/* 검토 범위의 안내 문구 표시 */}
                        <p>{item.text}</p>
                        {/* 분석 흐름 보기의 이동 링크 표시 */}
                        <a href="/analyze">
                            분석 흐름 보기 <span aria-hidden="true">→</span>
                        </a>
                    </article>
                ))}
            </div>
        </div>
    );
}
