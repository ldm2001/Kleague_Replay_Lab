import * as React from "react";
import { images, path } from "../assets";

const services = [
  { title: "판정 후보 탐지", text: "파울과 핸드볼과 차징과 득점 취소 장면을 후보로 모읍니다." },
  { title: "IFAB와 K리그 요강 대조", text: "경기 날짜와 대회에 맞는 규정 판본을 적용합니다." },
  { title: "근거 프레임과 클립", text: "장면 전후의 실제 영상을 결과와 함께 보여줍니다." },
  { title: "낮은 확신도 표시", text: "판단이 어려운 장면을 숨기지 않고 확인 대상으로 남깁니다." },
  { title: "VAR 검토 범위", text: "검토 범주와 문턱과 절차를 분리해 설명합니다." },
  { title: "영상 한계 기록", text: "각도와 속도와 누락 장면을 근거의 한계로 표시합니다." },
] as const;

const cases = [
  { title: "파울", text: "접촉과 강도와 정상 속도 장면을 확인합니다.", tone: "blue", image: images.review.foul },
  { title: "핸드볼", text: "공의 접촉과 팔의 위치와 의도 판단을 분리합니다.", tone: "red", image: images.review.handball },
  { title: "차징과 터치", text: "경합 과정과 마지막 터치를 시간순으로 보여줍니다.", tone: "green", image: images.review.charging },
  { title: "득점 취소", text: "득점 직전 반칙과 VAR 검토 가능성을 대조합니다.", tone: "violet", image: images.review.goal },
] as const;

const help = [
  { number: "01", title: "영상 사실", text: "무엇이 실제로 보이는지 먼저 확인" },
  { number: "02", title: "규정 조건", text: "해당 장면에 적용되는 조항 확인" },
  { number: "03", title: "확신도와 한계", text: "판단 가능한 범위와 불확실성 표시" },
] as const;

export function LandingPage() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="site-brand" href="#top" aria-label="K리그 판정 보조 홈">
          <span className="site-logo-lockup"><img className="site-logo" data-testid="site-logo" src={path(images.brandLight)} alt="K LEAGUE" decoding="async" /><small>Replay Lab</small></span>
        </a>
        <nav className="site-nav" aria-label="주요 메뉴">
          <a href="#solutions">솔루션</a>
          <a href="#services">분석 기능</a>
          <a href="#rules">규정</a>
          <a href="#cases">검토 범위</a>
        </nav>
      </header>

      <main>
        <section className="hero" id="top" aria-labelledby="hero-title">
          <img className="hero-art" data-testid="hero-art" src={path(images.hero)} alt="" aria-hidden="true" decoding="async" fetchPriority="high" />
          <div className="hero-copy">
            <p className="hero-kicker">K리그 경기 영상 판정 보조</p>
            <h1 id="hero-title">경기 판정의<br /> <span>새로운 근거를 열다</span></h1>
            <p>하이라이트 영상 속 판정 장면을 찾고<br />영상 근거와 IFAB와 K리그 규정을 함께 확인합니다.</p>
            <a className="hero-cta" href="/analyze">영상 분석 시작하기 <span aria-hidden="true">→</span></a>
          </div>
          <a className="hero-scroll" href="#solutions" aria-label="주요 솔루션으로 이동">⌄</a>
        </section>

        <section className="section solutions" id="solutions" aria-labelledby="solutions-title">
          <div className="section-heading center"><h2 id="solutions-title">주요 솔루션</h2><p>영상 한 편으로 판정에 필요한 근거를 단계별로 확인합니다.</p></div>
          <div className="solution-showcase">
            <div className="solution-rail" aria-hidden="true"><span>영상 사실</span><span>규정 대조</span><span>증거 결과</span></div>
            <article className="showcase-feature">
              <div className="showcase-visual"><div className="visual-grid" /><div className="visual-ball">●</div><div className="visual-line line-one" /><div className="visual-line line-two" /></div>
              <div className="showcase-copy"><p className="label">Evidence first</p><h3>영상 근거 중심의 판정 보조</h3><p>정상 속도와 리플레이와 다른 각도를 구분하고 확인 가능한 장면만 다음 단계로 전달합니다.</p></div>
            </article>
          </div>
        </section>

        <section className="section services" id="services" aria-labelledby="services-title">
          <div className="section-heading"><h2 id="services-title">주요 분석 기능</h2><p>판정 확인에 필요한 기능을 하나의 흐름으로 연결합니다.</p></div>
          <div className="service-grid">
            {services.map((service, index) => <article className="service-item" key={service.title}><span className="service-icon" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><div><h3>{service.title}</h3><p>{service.text}</p></div><span className="arrow" aria-hidden="true">→</span></article>)}
          </div>
          <a className="text-cta" href="/analyze">영상 분석 시작하기 <span aria-hidden="true">→</span></a>
        </section>

        <section className="section cases" id="cases" aria-labelledby="cases-title">
          <div className="section-heading"><h2 id="cases-title">주요 검토 범위</h2><p>확정 판정이 아니라 영상과 규정에 기반한 보조 의견을 제공합니다.</p></div>
          <div className="case-grid">{cases.map((item) => <article className={`case-card ${item.tone}`} key={item.title}><div className="case-art"><img src={path(item.image)} alt={`${item.title} 판정 예시`} loading="lazy" decoding="async" /></div><h3>{item.title}</h3><p>{item.text}</p><a href="/analyze">분석 흐름 보기 <span aria-hidden="true">→</span></a></article>)}</div>
        </section>

        <section className="section help" id="rules" aria-labelledby="help-title">
          <div className="section-heading"><h2 id="help-title">판정 근거를 한눈에 보기</h2><p>결과를 읽는 순서를 고정해 장면과 규정의 차이를 놓치지 않습니다.</p></div>
          <div className="help-grid">{help.map((item) => <article key={item.number}><strong>{item.number}</strong><h3>{item.title}</h3><p>{item.text}</p><span aria-hidden="true">→</span></article>)}</div>
        </section>

      </main>

      <footer className="site-footer"><div className="footer-brand"><span className="site-mark" aria-hidden="true"><span /></span><strong>K LEAGUE Replay Lab</strong></div><p>영상 근거와 공개 규정을 비교하는 판정 보조 시스템</p><small>공식 판정이 아닌 기술적 보조 의견입니다.</small></footer>
    </div>
  );
}
