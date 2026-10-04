"""종목별분석 화면에서 쓰는 점수·적정가 계산 로직.

main.py가 yfinance에서 가져온 원본 지표(dict)를 넘기면
0~100 점수와 근거 문구를 돌려준다. 전략별 가중치를 곱해 총점을 내는 것은
프론트(app.js)에서 하므로, 여기서는 카테고리별 점수까지만 계산한다.
"""

import math


def _scale(value, worst, best, lo=0.0, hi=100.0):
    """value를 [worst→best] 구간 기준으로 [lo→hi]에 선형 매핑(클램프).

    worst > best 를 넘기면(예: PER처럼 낮을수록 좋은 지표) 자동으로 방향이 뒤집힌다.
    """
    if value is None or worst == best:
        return None
    t = (value - worst) / (best - worst)
    t = max(0.0, min(1.0, t))
    return lo + t * (hi - lo)


def _weighted_avg(parts):
    """parts: [(score, weight), ...]. None 점수는 제외하고 남은 가중치로 재정규화."""
    valid = [(s, w) for s, w in parts if s is not None and w > 0]
    if not valid:
        return None
    total_w = sum(w for _, w in valid)
    return sum(s * w for s, w in valid) / total_w


def _tag(local_score):
    """개별 지표 점수를 근거 문구의 긍정/위험 라벨로 변환."""
    if local_score is None:
        return None
    if local_score >= 65:
        return 'pos'
    if local_score <= 40:
        return 'risk'
    return None


def _round1(v):
    return round(v, 1) if v is not None else None


def score_value(v):
    """v: pe, forward_pe, peg, pb, ps, ev_ebitda, fcf_yield (전부 None 허용)"""
    parts, reasons = [], []

    peg = v.get('peg')
    if peg is not None:
        s = _scale(peg, worst=3.0, best=0.5)
        parts.append((s, 35))
        reasons.append((f"PEG {peg:.2f}배 (성장률 대비 밸류에이션)", _tag(s)))
    elif v.get('forward_pe') is not None:
        fpe = v['forward_pe']
        s = _scale(fpe, worst=45, best=8)
        parts.append((s, 35))
        reasons.append((f"Forward PER {fpe:.1f}배 (성장률 미반영 단순 비교)", _tag(s)))

    fcf_yield = v.get('fcf_yield')
    if fcf_yield is not None:
        s = _scale(fcf_yield, worst=0, best=8)
        parts.append((s, 25))
        reasons.append((f"FCF Yield {fcf_yield:.1f}%", _tag(s)))

    ev_ebitda = v.get('ev_ebitda')
    if ev_ebitda is not None:
        s = _scale(ev_ebitda, worst=25, best=6)
        parts.append((s, 20))
        reasons.append((f"EV/EBITDA {ev_ebitda:.1f}배", _tag(s)))

    pb = v.get('pb')
    if pb is not None:
        s = _scale(pb, worst=8, best=0.8)
        parts.append((s, 10))
        reasons.append((f"PBR {pb:.2f}배", _tag(s)))

    ps = v.get('ps')
    if ps is not None:
        s = _scale(ps, worst=10, best=0.5)
        parts.append((s, 10))
        reasons.append((f"PSR {ps:.2f}배", _tag(s)))

    return _round1(_weighted_avg(parts)), reasons


def score_growth(g):
    """g: revenue_growth, earnings_growth, forward_eps_growth (%, None 허용)"""
    parts, reasons = [], []

    rg = g.get('revenue_growth')
    if rg is not None:
        s = _scale(rg, worst=-10, best=30)
        parts.append((s, 30))
        reasons.append((f"매출 성장률 {rg:+.1f}%", _tag(s)))

    eg = g.get('earnings_growth')
    if eg is not None:
        s = _scale(eg, worst=-20, best=40)
        parts.append((s, 35))
        reasons.append((f"이익 성장률 {eg:+.1f}%", _tag(s)))

    feg = g.get('forward_eps_growth')
    if feg is not None:
        s = _scale(feg, worst=-10, best=30)
        parts.append((s, 35))
        reasons.append((f"향후 EPS 성장률 전망 {feg:+.1f}%", _tag(s)))

    return _round1(_weighted_avg(parts)), reasons


def score_quality(q):
    """q: gross_margin, operating_margin, net_margin, roe, roa, fcf_margin (%, None 허용)"""
    parts, reasons = [], []

    om = q.get('operating_margin')
    if om is not None:
        s = _scale(om, worst=-10, best=30)
        parts.append((s, 20))
        reasons.append((f"영업이익률 {om:.1f}%", _tag(s)))

    nm = q.get('net_margin')
    if nm is not None:
        s = _scale(nm, worst=-10, best=25)
        parts.append((s, 15))
        reasons.append((f"순이익률 {nm:.1f}%", _tag(s)))

    gm = q.get('gross_margin')
    if gm is not None:
        s = _scale(gm, worst=0, best=60)
        parts.append((s, 10))
        reasons.append((f"매출총이익률 {gm:.1f}%", _tag(s)))

    roe = q.get('roe')
    if roe is not None:
        s = _scale(roe, worst=-10, best=30)
        parts.append((s, 25))
        reasons.append((f"ROE {roe:.1f}%", _tag(s)))

    roa = q.get('roa')
    if roa is not None:
        s = _scale(roa, worst=-5, best=15)
        parts.append((s, 15))
        reasons.append((f"ROA {roa:.1f}%", _tag(s)))

    fcfm = q.get('fcf_margin')
    if fcfm is not None:
        s = _scale(fcfm, worst=-10, best=25)
        parts.append((s, 15))
        reasons.append((f"FCF Margin {fcfm:.1f}%", _tag(s)))

    return _round1(_weighted_avg(parts)), reasons


def score_stability(s_):
    """s_: debt_to_equity, current_ratio, quick_ratio, net_debt_to_ebitda (None 허용)

    은행·보험·증권 등 금융업은 일반 제조업과 재무구조가 근본적으로 달라
    (레버리지 자체가 사업모델) 이 공식을 그대로 적용하면 왜곡되므로,
    호출부(main.py)에서 sector가 금융업이면 net_debt_to_ebitda·current_ratio 등을
    넘기지 않도록 걸러준다.
    """
    parts, reasons = [], []

    de = s_.get('debt_to_equity')
    if de is not None:
        s = _scale(de, worst=250, best=0)
        parts.append((s, 30))
        reasons.append((f"부채비율(D/E) {de:.0f}%", _tag(s)))

    cr = s_.get('current_ratio')
    if cr is not None:
        s = _scale(cr, worst=0.5, best=2.5)
        parts.append((s, 20))
        reasons.append((f"유동비율 {cr:.2f}", _tag(s)))

    qr = s_.get('quick_ratio')
    if qr is not None:
        s = _scale(qr, worst=0.3, best=2.0)
        parts.append((s, 15))
        reasons.append((f"당좌비율 {qr:.2f}", _tag(s)))

    nde = s_.get('net_debt_to_ebitda')
    if nde is not None:
        s = _scale(nde, worst=6, best=-2)
        parts.append((s, 35))
        reasons.append((f"Net Debt/EBITDA {nde:.1f}배", _tag(s)))

    return _round1(_weighted_avg(parts)), reasons


def score_shareholder(sr):
    """sr: dividend_yield, payout_ratio (%, None 허용)"""
    dy = sr.get('dividend_yield')
    payout = sr.get('payout_ratio')

    if dy is None and payout is None:
        return None, [("배당 관련 데이터가 제공되지 않습니다.", None)]

    parts, reasons = [], []

    if dy is not None and dy > 0:
        s = _scale(dy, worst=0, best=5)
        parts.append((s, 55))
        reasons.append((f"배당수익률 {dy:.1f}%", _tag(s)))
    else:
        parts.append((0, 55))
        reasons.append(("배당을 지급하지 않는 종목", 'risk'))

    if payout is not None:
        s = max(0.0, 100 - abs(payout - 40) * 1.5)
        parts.append((s, 45))
        reasons.append((f"배당성향 {payout:.0f}%", _tag(s)))

    return _round1(_weighted_avg(parts)), reasons


def fair_value(price, trailing_pe, forward_pe, trailing_eps, book_value,
                target_mean, target_low, target_high):
    """여러 적정가 산출 방식을 모아 bear/base/bull 요약을 만든다."""
    methods = []

    if price and trailing_pe and forward_pe and forward_pe > 0:
        fv = price * (trailing_pe / forward_pe)
        # forwardPE가 forwardEps 없이 내려오는 등 데이터 신뢰도가 낮은 케이스가 있어,
        # 현재가 대비 0.3~3배를 벗어나는 비현실적인 값은 방식에서 제외
        if 0.3 * price <= fv <= 3 * price:
            methods.append({'key': 'forwardPe', 'label': 'Forward PER 기준', 'value': round(fv, 2)})

    if trailing_eps and book_value and trailing_eps > 0 and book_value > 0:
        fv = math.sqrt(22.5 * trailing_eps * book_value)
        methods.append({'key': 'graham', 'label': 'Graham 공식', 'value': round(fv, 2)})

    if target_mean:
        methods.append({'key': 'analystTarget', 'label': '애널리스트 목표가 평균', 'value': round(target_mean, 2)})

    if not methods or not price:
        return {'methods': methods, 'bear': None, 'base': None, 'bull': None,
                'upsidePercent': None, 'marginOfSafety': None}

    values = [m['value'] for m in methods]
    bear_candidates = values + ([target_low] if target_low else [])
    bull_candidates = values + ([target_high] if target_high else [])
    base = sum(values) / len(values)
    bear = min(bear_candidates)
    bull = max(bull_candidates)
    upside = (base - price) / price * 100
    margin = (base - price) / base * 100 if base else None

    return {
        'methods': methods,
        'bear': round(bear, 2),
        'base': round(base, 2),
        'bull': round(bull, 2),
        'upsidePercent': round(upside, 2),
        'marginOfSafety': round(margin, 2) if margin is not None else None,
    }


def split_reasons(*reason_lists):
    """카테고리별 (text, polarity) 리스트들을 모아 상위 긍정/위험 요인을 뽑는다."""
    positive, risk = [], []
    for reasons in reason_lists:
        for text, polarity in reasons:
            if polarity == 'pos':
                positive.append(text)
            elif polarity == 'risk':
                risk.append(text)
    return positive[:6], risk[:6]


def reason_texts(reasons):
    return [text for text, _ in reasons]
