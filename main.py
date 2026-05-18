from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
import yfinance as yf
import httpx
import asyncio
import time
import csv
from io import StringIO
from concurrent.futures import ThreadPoolExecutor

app = FastAPI()
executor = ThreadPoolExecutor(max_workers=20)

_cache: dict = {}

# ─── 한국 주요 종목 로컬 DB ───────────────────────────────────
KR_STOCKS = [
    # KOSPI
    {"symbol": "005930.KS", "name": "삼성전자",           "exchange": "KSE"},
    {"symbol": "000660.KS", "name": "SK하이닉스",         "exchange": "KSE"},
    {"symbol": "207940.KS", "name": "삼성바이오로직스",   "exchange": "KSE"},
    {"symbol": "005380.KS", "name": "현대차",             "exchange": "KSE"},
    {"symbol": "000270.KS", "name": "기아",               "exchange": "KSE"},
    {"symbol": "068270.KS", "name": "셀트리온",           "exchange": "KSE"},
    {"symbol": "035420.KS", "name": "NAVER",              "exchange": "KSE"},
    {"symbol": "051910.KS", "name": "LG화학",             "exchange": "KSE"},
    {"symbol": "006400.KS", "name": "삼성SDI",            "exchange": "KSE"},
    {"symbol": "035720.KS", "name": "카카오",             "exchange": "KSE"},
    {"symbol": "028260.KS", "name": "삼성물산",           "exchange": "KSE"},
    {"symbol": "012330.KS", "name": "현대모비스",         "exchange": "KSE"},
    {"symbol": "003550.KS", "name": "LG",                 "exchange": "KSE"},
    {"symbol": "066570.KS", "name": "LG전자",             "exchange": "KSE"},
    {"symbol": "055550.KS", "name": "신한지주",           "exchange": "KSE"},
    {"symbol": "105560.KS", "name": "KB금융",             "exchange": "KSE"},
    {"symbol": "086790.KS", "name": "하나금융지주",       "exchange": "KSE"},
    {"symbol": "316140.KS", "name": "우리금융지주",       "exchange": "KSE"},
    {"symbol": "032830.KS", "name": "삼성생명",           "exchange": "KSE"},
    {"symbol": "017670.KS", "name": "SK텔레콤",           "exchange": "KSE"},
    {"symbol": "030200.KS", "name": "KT",                 "exchange": "KSE"},
    {"symbol": "033780.KS", "name": "KT&G",               "exchange": "KSE"},
    {"symbol": "034730.KS", "name": "SK",                 "exchange": "KSE"},
    {"symbol": "096770.KS", "name": "SK이노베이션",       "exchange": "KSE"},
    {"symbol": "018260.KS", "name": "삼성SDS",            "exchange": "KSE"},
    {"symbol": "009150.KS", "name": "삼성전기",           "exchange": "KSE"},
    {"symbol": "010950.KS", "name": "S-Oil",              "exchange": "KSE"},
    {"symbol": "000810.KS", "name": "삼성화재",           "exchange": "KSE"},
    {"symbol": "032640.KS", "name": "LG유플러스",         "exchange": "KSE"},
    {"symbol": "090430.KS", "name": "아모레퍼시픽",       "exchange": "KSE"},
    {"symbol": "051900.KS", "name": "LG생활건강",         "exchange": "KSE"},
    {"symbol": "097950.KS", "name": "CJ제일제당",         "exchange": "KSE"},
    {"symbol": "003490.KS", "name": "대한항공",           "exchange": "KSE"},
    {"symbol": "010130.KS", "name": "고려아연",           "exchange": "KSE"},
    {"symbol": "004020.KS", "name": "현대제철",           "exchange": "KSE"},
    {"symbol": "011200.KS", "name": "HMM",                "exchange": "KSE"},
    {"symbol": "128940.KS", "name": "한미약품",           "exchange": "KSE"},
    {"symbol": "009830.KS", "name": "한화솔루션",         "exchange": "KSE"},
    {"symbol": "042660.KS", "name": "한화오션",           "exchange": "KSE"},
    {"symbol": "000100.KS", "name": "유한양행",           "exchange": "KSE"},
    {"symbol": "004170.KS", "name": "신세계",             "exchange": "KSE"},
    {"symbol": "023530.KS", "name": "롯데쇼핑",           "exchange": "KSE"},
    {"symbol": "069960.KS", "name": "현대백화점",         "exchange": "KSE"},
    {"symbol": "000720.KS", "name": "현대건설",           "exchange": "KSE"},
    {"symbol": "271560.KS", "name": "오리온",             "exchange": "KSE"},
    {"symbol": "326030.KS", "name": "SK바이오팜",         "exchange": "KSE"},
    {"symbol": "011170.KS", "name": "롯데케미칼",         "exchange": "KSE"},
    {"symbol": "006800.KS", "name": "미래에셋증권",       "exchange": "KSE"},
    {"symbol": "002790.KS", "name": "아모레G",            "exchange": "KSE"},
    # KOSDAQ
    {"symbol": "247540.KQ", "name": "에코프로비엠",       "exchange": "KOSDAQ"},
    {"symbol": "086520.KQ", "name": "에코프로",           "exchange": "KOSDAQ"},
    {"symbol": "196170.KQ", "name": "알테오젠",           "exchange": "KOSDAQ"},
    {"symbol": "091990.KQ", "name": "셀트리온헬스케어",   "exchange": "KOSDAQ"},
    {"symbol": "263750.KQ", "name": "펄어비스",           "exchange": "KOSDAQ"},
    {"symbol": "293490.KQ", "name": "카카오게임즈",       "exchange": "KOSDAQ"},
    {"symbol": "035900.KQ", "name": "JYP엔터테인먼트",   "exchange": "KOSDAQ"},
    {"symbol": "041510.KQ", "name": "SM엔터테인먼트",     "exchange": "KOSDAQ"},
    {"symbol": "122870.KQ", "name": "와이지엔터테인먼트", "exchange": "KOSDAQ"},
    {"symbol": "145020.KQ", "name": "휴젤",               "exchange": "KOSDAQ"},
    {"symbol": "357780.KQ", "name": "솔브레인",           "exchange": "KOSDAQ"},
    {"symbol": "214150.KQ", "name": "클래시스",           "exchange": "KOSDAQ"},
]

def _has_korean(text: str) -> bool:
    return any('가' <= c <= '힣' or 'ㄱ' <= c <= 'ㆎ' for c in text)

def _search_kr_local(q: str) -> list:
    q = q.strip().lower()
    return [
        s for s in KR_STOCKS
        if q in s["name"].lower() or q in s["symbol"].lower()
    ]


def cache_get(key: str, ttl: int):
    entry = _cache.get(key)
    if entry and time.time() - entry[1] < ttl:
        return entry[0]
    return None


def cache_set(key: str, value):
    _cache[key] = (value, time.time())


@app.get("/api/search")
async def search_stocks(q: str):
    cached = cache_get(f"search:{q}", 60)
    if cached is not None:
        return cached

    local_results = _search_kr_local(q) if _has_korean(q) else []
    local_symbols = {r["symbol"] for r in local_results}

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    params = {"q": q, "lang": "ko-KR", "quotesCount": 10, "newsCount": 0}

    yahoo_results = []
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                "https://query1.finance.yahoo.com/v1/finance/search",
                params=params,
                headers=headers,
                timeout=5.0,
            )
            data = resp.json()
            yahoo_results = [
                {
                    "symbol": item["symbol"],
                    "name": item.get("longname") or item.get("shortname") or item["symbol"],
                    "exchange": item.get("exchDisp") or item.get("exchange", ""),
                }
                for item in data.get("quotes", [])
                if item.get("quoteType") in ("EQUITY", "ETF", "FUND")
                and item["symbol"] not in local_symbols
            ]
        except Exception:
            pass

    results = (local_results + yahoo_results)[:8]
    cache_set(f"search:{q}", results)
    return results


def _fetch_price(symbol: str) -> dict:
    ticker = yf.Ticker(symbol)
    fi = ticker.fast_info
    price = fi.last_price
    prev = fi.previous_close
    if price is None or prev is None:
        raise ValueError(f"가격 데이터 없음: {symbol}")
    change = price - prev
    return {
        "symbol": symbol,
        "price": round(price, 2),
        "change": round(change, 2),
        "change_pct": round(change / prev * 100, 2),
        "currency": fi.currency or "USD",
    }


@app.get("/api/price/{symbol}")
async def get_price(symbol: str):
    symbol = symbol.upper()
    cached = cache_get(f"price:{symbol}", 30)
    if cached is not None:
        return cached
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(executor, _fetch_price, symbol)
        cache_set(f"price:{symbol}", result)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _fetch_chart(symbol: str, period: str) -> dict:
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period=period)
    if hist.empty:
        raise ValueError(f"차트 데이터 없음: {symbol}")
    fmt = "%Y-%m-%dT%H:%M:%S" if period in ("1d", "5d") else "%Y-%m-%d"
    return {
        "dates": hist.index.strftime(fmt).tolist(),
        "open":  [round(float(p), 2) for p in hist["Open"]],
        "high":  [round(float(p), 2) for p in hist["High"]],
        "low":   [round(float(p), 2) for p in hist["Low"]],
        "close": [round(float(p), 2) for p in hist["Close"]],
    }


@app.get("/api/chart/{symbol}")
async def get_chart(symbol: str, period: str = "1mo"):
    symbol = symbol.upper()
    cached = cache_get(f"chart:{symbol}:{period}", 300)
    if cached is not None:
        return cached
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(executor, _fetch_chart, symbol, period)
        cache_set(f"chart:{symbol}:{period}", result)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _fetch_usdkrw() -> dict:
    fi = yf.Ticker("KRW=X").fast_info
    return {"rate": round(float(fi.last_price), 2)}


@app.get("/api/fx/usdkrw")
async def get_usdkrw():
    cached = cache_get("fx:usdkrw", 300)
    if cached is not None:
        return cached
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(executor, _fetch_usdkrw)
        cache_set("fx:usdkrw", result)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


SECTOR_ETF_MAP = {
    "Technology":             "XLK",
    "Financial Services":     "XLF",
    "Healthcare":             "XLV",
    "Consumer Cyclical":      "XLY",
    "Consumer Defensive":     "XLP",
    "Industrials":            "XLI",
    "Communication Services": "XLC",
    "Utilities":              "XLU",
    "Real Estate":            "XLRE",
    "Basic Materials":        "XLB",
    "Energy":                 "XLE",
}


def _fetch_valuation(symbol: str) -> dict:
    info  = yf.Ticker(symbol).info
    t     = info.get("trailingPE")
    f     = info.get("forwardPE")
    bv    = info.get("bookValue")
    price = info.get("currentPrice") or info.get("regularMarketPrice")

    # trailingPE 없으면 trailingEps + 현재가로 계산
    if t is None and price:
        teps = info.get("trailingEps")
        if teps and float(teps) > 0:
            t = float(price) / float(teps)

    # forwardPE 없으면 forwardEps + 현재가로 계산
    if f is None and price:
        feps = info.get("forwardEps")
        if feps and float(feps) > 0:
            f = float(price) / float(feps)

    sector     = info.get("sector")
    sector_etf = SECTOR_ETF_MAP.get(sector) if sector else None

    return {
        "symbol":      symbol,
        "trailing_pe": round(float(t),  2) if t  is not None else None,
        "forward_pe":  round(float(f),  2) if f  is not None else None,
        "book_value":  round(float(bv), 2) if bv is not None else None,
        "sector_etf":  sector_etf,
    }


@app.get("/api/valuation/{symbol}")
async def get_valuation(symbol: str):
    symbol = symbol.upper()
    cached = cache_get(f"val:{symbol}", 3600)
    if cached is not None:
        return cached
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(executor, _fetch_valuation, symbol)
        cache_set(f"val:{symbol}", result)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


import datetime

MACRO_INDICATORS = [
    {"symbol": "^TNX",     "name": "미국 10년 국채금리",  "category": "금리"},
    {"symbol": "^FVX",     "name": "미국 5년 국채금리",   "category": "금리"},
    {"symbol": "^IRX",     "name": "미국 3개월 국채금리", "category": "금리"},
    {"symbol": "^TYX",     "name": "미국 30년 국채금리",  "category": "금리"},
    {"symbol": "DX-Y.NYB", "name": "달러 인덱스 DXY",     "category": "통화"},
    {"symbol": "KRW=X",    "name": "달러/원 환율",        "category": "환율"},
    {"symbol": "JPY=X",    "name": "달러/엔 환율",        "category": "환율"},
    {"symbol": "CNY=X",    "name": "달러/위안 환율",      "category": "환율"},
    {"symbol": "EURUSD=X", "name": "유로/달러",           "category": "환율"},
    {"symbol": "^VIX",     "name": "VIX 공포지수",        "category": "심리"},
    {"symbol": "^MOVE",    "name": "MOVE 채권변동성",      "category": "심리"},
    {"symbol": "GC=F",     "name": "금 선물",             "category": "원자재"},
    {"symbol": "CL=F",     "name": "WTI 원유",            "category": "원자재"},
    {"symbol": "NG=F",     "name": "천연가스",            "category": "원자재"},
    {"symbol": "HG=F",     "name": "구리 선물",           "category": "원자재"},
    {"symbol": "SI=F",     "name": "은 선물",             "category": "원자재"},
    {"symbol": "BTC-USD",  "name": "비트코인",            "category": "암호화폐"},
    {"symbol": "ETH-USD",  "name": "이더리움",            "category": "암호화폐"},
]


@app.get("/api/macro/search")
async def search_macro(q: str):
    q_lower = q.strip().lower()
    return [
        m for m in MACRO_INDICATORS
        if q_lower in m["name"].lower()
        or q_lower in m["symbol"].lower()
        or q_lower in m["category"].lower()
    ][:8]

_SECTOR_CHART_INTERVAL = {
    '1mo': '1d', '3mo': '1d', '6mo': '1wk',
    '1y':  '1wk', '3y': '1mo', '5y':  '1mo',
}

def _fetch_sector_chart(period: str) -> dict:
    interval = _SECTOR_CHART_INTERVAL.get(period, '1mo')
    symbols  = ['XLRE','XLU','XLC','XLK','XLF','XLV','XLI','XLP','XLY','XLB','XLE']
    dates    = None
    series   = {}
    for sym in symbols:
        try:
            hist = yf.Ticker(sym).history(period=period, interval=interval)
            if hist.empty:
                continue
            if dates is None:
                dates = hist.index.strftime('%Y-%m-%d').tolist()
            closes = [float(c) for c in hist['Close']]
            base   = closes[0]
            if base == 0:
                continue
            series[sym] = [round(c / base * 100, 2) for c in closes]
        except Exception:
            continue
    return {'dates': dates or [], 'series': series}


@app.get("/api/sector-chart")
async def get_sector_chart(period: str = '1y'):
    if period not in _SECTOR_CHART_INTERVAL:
        period = '1y'
    cached = cache_get(f"sector-chart:{period}", 3600)
    if cached is not None:
        return cached
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(executor, _fetch_sector_chart, period)
        cache_set(f"sector-chart:{period}", result)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _fetch_performance(symbol: str) -> dict:
    hist = yf.Ticker(symbol).history(period='2y', interval='1d')
    if hist.empty:
        return {'symbol': symbol}

    current   = float(hist['Close'].iloc[-1])
    now_ts    = hist.index[-1]
    offsets   = {'5d': 5, '1mo': 30, '3mo': 91, '6mo': 182, '1y': 365, '2y': 730}
    result    = {'symbol': symbol}

    for key, days in offsets.items():
        target = now_ts - datetime.timedelta(days=days)
        past   = hist.loc[hist.index <= target]
        if not past.empty:
            past_price  = float(past['Close'].iloc[-1])
            result[key] = round((current - past_price) / past_price * 100, 2)
        else:
            result[key] = None

    return result


@app.get("/api/performance/{symbol}")
async def get_performance(symbol: str):
    symbol = symbol.upper()
    cached = cache_get(f"perf:{symbol}", 300)
    if cached is not None:
        return cached
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(executor, _fetch_performance, symbol)
        cache_set(f"perf:{symbol}", result)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sector-performance")
async def get_sector_performance():
    symbols = ['XLRE','XLU','XLC','XLK','XLF','XLV','XLI','XLP','XLY','XLB','XLE']
    cached = cache_get("sector-perf-all", 300)
    if cached is not None:
        return cached
    loop = asyncio.get_running_loop()
    tasks = [loop.run_in_executor(executor, _fetch_performance, sym) for sym in symbols]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    data = {}
    for sym, r in zip(symbols, results):
        if not isinstance(r, Exception):
            data[sym] = r
    cache_set("sector-perf-all", data)
    return data


async def _fetch_fred_series(series_id: str, limit: int) -> list:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        text = resp.text
    reader = csv.reader(StringIO(text))
    next(reader)
    rows = []
    for row in reader:
        if len(row) < 2 or row[1] in ('.', ''):
            continue
        try:
            rows.append({'t': row[0], 'v': float(row[1])})
        except ValueError:
            continue
    return rows[-limit:]


@app.get("/api/yield-history")
async def get_yield_history(period: str = "1y"):
    limit_map = {'1m': 22, '3m': 65, '6m': 130, '1y': 252, '3y': 756, '5y': 1260}
    limit = limit_map.get(period, 252)
    cache_key = f"yield-history:{period}"
    cached = cache_get(cache_key, 3600)
    if cached is not None:
        return cached

    series_map = {'2Y': 'DGS2', '3Y': 'DGS3', '5Y': 'DGS5', '10Y': 'DGS10'}
    tasks = [_fetch_fred_series(sid, limit) for sid in series_map.values()]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    raw = {}
    for key, result in zip(series_map.keys(), results):
        raw[key] = result if not isinstance(result, Exception) else []

    two_y = {r['t']: r['v'] for r in raw.get('2Y', [])}
    ten_y = {r['t']: r['v'] for r in raw.get('10Y', [])}
    common = sorted(set(two_y) & set(ten_y))
    spread = [{'t': d, 'v': round(two_y[d] - ten_y[d], 4)} for d in common[-limit:]]

    data = {
        '2Y': raw.get('2Y', []),
        '3Y': raw.get('3Y', []),
        '5Y': raw.get('5Y', []),
        '10Y': raw.get('10Y', []),
        'spread': spread,
    }
    cache_set(cache_key, data)
    return data


def _fetch_yield(symbol: str):
    try:
        t = yf.Ticker(symbol)
        hist = t.history(period="5d")
        if hist.empty:
            return None
        return float(hist['Close'].iloc[-1])
    except Exception:
        return None


@app.get("/api/yield-curve")
async def get_yield_curve():
    symbols = ['^IRX', '^FVX', '^TNX', '^TYX']
    cached = cache_get("yield-curve", 600)
    if cached is not None:
        return cached
    loop = asyncio.get_running_loop()
    tasks = [loop.run_in_executor(executor, _fetch_yield, sym) for sym in symbols]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    data = {}
    for sym, r in zip(symbols, results):
        data[sym] = r if not isinstance(r, Exception) else None
    cache_set("yield-curve", data)
    return data


def _fetch_sector_period_return(sym: str, period: str):
    period_map = {'1W': '5d', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y'}
    yf_period = period_map.get(period, '1mo')
    try:
        t = yf.Ticker(sym)
        hist = t.history(period=yf_period)
        if hist.empty or len(hist) < 2:
            return None
        start = float(hist['Close'].iloc[0])
        end = float(hist['Close'].iloc[-1])
        return round((end - start) / start * 100, 2)
    except Exception:
        return None


@app.get("/api/sector-heatmap")
async def get_sector_heatmap():
    symbols = ['XLRE', 'XLU', 'XLC', 'XLK', 'XLF', 'XLV', 'XLI', 'XLP', 'XLY', 'XLB', 'XLE']
    periods = ['1W', '1M', '3M', '6M', '1Y']
    cached = cache_get("sector-heatmap", 600)
    if cached is not None:
        return cached
    loop = asyncio.get_running_loop()
    tasks = []
    for sym in symbols:
        for p in periods:
            tasks.append(loop.run_in_executor(executor, _fetch_sector_period_return, sym, p))
    results = await asyncio.gather(*tasks, return_exceptions=True)
    data = {}
    idx = 0
    for sym in symbols:
        data[sym] = {}
        for p in periods:
            r = results[idx]
            data[sym][p] = r if not isinstance(r, Exception) else None
            idx += 1
    cache_set("sector-heatmap", data)
    return data


app.mount("/", StaticFiles(directory="static", html=True), name="static")
