# MQL5 MTF OsMA EMA Telemetry EA

This repository contains the Expert Advisor:

- `MTF_OsMA_EMA_Telemetry_EA.mq5`

## What signals are followed

The EA computes signals on these timeframes:

- `M1, M5, M15, H1, H4, D1`

Indicators used per timeframe:

- `EMA(150), EMA(200), EMA(13), EMA(34)`
- `SMA(2), SMA(5)`
- `OsMA` via `iOsMA(fast=12, slow=59, signal=3)`

### Signal primitives

For each timeframe, the EA builds these directional signal flags:

1. `ema1334_just_cross_up` / `ema1334_just_cross_down`
2. `ema1334_about_cross_up` / `ema1334_about_cross_down`
3. `osma_just_cross_up` / `osma_just_cross_down`
4. `osma_about_cross_up` / `osma_about_cross_down`

`about_cross_*` is score-based (0.0 to 1.0), combining:

- Near-distance condition
- Convergence over recent bars
- One-bar projection

`about_cross_*` becomes active when score `>= 0.7`.

### Strong alignment signals

Across all 6 timeframes, the EA counts aligned bullish/bearish conditions:

- `osma_buy`, `osma_sell`
- `ema_buy`, `ema_sell`

Then it defines:

- `strong_osma_buy = osma_buy >= InpMinAlignedTF`
- `strong_osma_sell = osma_sell >= InpMinAlignedTF`
- `strong_ema_buy = ema_buy >= InpMinAlignedTF`
- `strong_ema_sell = ema_sell >= InpMinAlignedTF`

Default: `InpMinAlignedTF = 4`.

Composite trade intents:

- `strong_buy = (strong_osma_buy || strong_ema_buy) && !(strong_osma_sell && strong_ema_sell)`
- `strong_sell = (strong_osma_sell || strong_ema_sell) && !(strong_osma_buy && strong_ema_buy)`

## What triggers opening positions

The EA opens positions in `EvaluateSignalsAndTrade()`:

1. If `strong_buy && EntryAllowed(1)` then it calls `PlaceEntry(BUY, ...)`.
2. If `strong_sell && EntryAllowed(-1)` then it calls `PlaceEntry(SELL, ...)`.

`EntryAllowed(direction)` blocks entries when:

1. M1 OsMA just crossed this bar (`osma_just_cross_up/down`).
2. M1 or M5 EMA13/34 has already reached peak/bottom and phase is not:
- `PHASE_FLAT_ABOUT_TO_CROSS`
- `PHASE_RUNNING_CONTINUED`
3. Buy is blocked if both M1 and M5 directions are `DOWN`.
4. Sell is blocked if both M1 and M5 directions are `UP`.

Entry tagging:

- If alignment strength `>= 5`: `LONGTERM_*_ALIGN`
- Else: `SCALP_*_ALIGN`
- Position comment format:
`SID:<id>|ENT:<entryStrategy>|EXT:<exitStrategy>|SIG:<strength>`

Important runtime switch:

- If `InpDryRun = true`, `PlaceEntry()` does not send orders (it only records recommendation text).
- For real orders, set `InpDryRun = false`.
- Entry strategy mode is selected with `InpStrategyMode`:
- `STRAT_BASE` keeps current entry logic.
- `STRAT_OPTION_V1` uses M1 trend + M1 pre-cross rules (below).

## OptionV1 Entry Strategy

`STRAT_OPTION_V1` is an M1-only entry model.

### Buy entry

All must be true:

1. M1 trend up: `EMA150 > EMA200`.
2. M1 about-to-cross up (tick-side): `EMA13 < EMA34` and `abs(EMA13-EMA34) <= InpOptionV1NearCrossThresholdPoints * _Point`.
3. `EntryAllowedOptionV1(+1)` passes optional protection filters.

### Sell entry

All must be true:

1. M1 trend down: `EMA150 < EMA200`.
2. M1 about-to-cross down (tick-side): `EMA13 > EMA34` and `abs(EMA13-EMA34) <= InpOptionV1NearCrossThresholdPoints * _Point`.
3. `EntryAllowedOptionV1(-1)` passes optional protection filters.

### OptionV1 inputs

- `InpOptionV1NearCrossThresholdPoints=80.0`
- `InpOptionV1UseOsmaJustCrossBlock=true`
- `InpOptionV1UseM1PeakPhaseBlock=true`
- `InpOptionV1UseM5PeakPhaseBlock=true`
- `InpOptionV1UseM1M5DirectionBlock=true`

These blocks mirror legacy protections and can be disabled individually for testing.

### Scope note

OptionV1 changes entry conditions only. Position exit/risk management remains unchanged (`ManagePositions`).

## What triggers closing positions

Position management runs every signal cycle in `ManagePositions(strong_buy, strong_sell)`.

### 1. Opposite strong signal

For each open position on the same symbol/magic:

- Buy position + `strong_sell` -> opposite signal
- Sell position + `strong_buy` -> opposite signal

If opposite signal appears:

1. If position is profitable and continuation conditions hold (M1 and M5 trend/phase continued), it is kept and reassessment is logged.
2. Otherwise, position is closed immediately.

### 2. Profit-protection SL updates

If position profit is positive:

- Trailing-like stop is moved using `M5 ATR * 0.8` (fallback `50 * _Point`).
- Buy: SL moved up to `Bid - trailing_dist`.
- Sell: SL moved down to `Ask + trailing_dist`.

### 3. Scalp-specific exits

Applied only when position comment contains `SCALP` and `InpEnableScalpRules=true`:

1. Close on quick gain: if profit distance reaches `>= 8 points`.
2. Loss guard: if current scalp loss exceeds previous recorded scalp win, close.

## Notes

- Orders are market orders from `CTrade.Buy/Sell` with lot `InpFixedLot`.
- No fixed TP/SL is set at entry; management is signal and risk-rule driven.
- JSON telemetry is written to `MQL5/Files` (`InpJsonFile`) and includes live signal states and position metadata.

## JSON Structure (`InpJsonFile`)

Top-level keys:

1. `meta`
- `symbol`, `magic`, `dryRun`, `strategyMode`, `updatedAt`, `recommendation`
- `optionV1` diagnostics:
  - `m1Trend`
  - `nearCrossThresholdPoints`
  - `aboutToCrossUpTickSide`, `aboutToCrossDownTickSide`
  - `useOsmaBlock`, `useM1PeakPhaseBlock`, `useM5PeakPhaseBlock`, `useDirectionBlock`
2. `historical`
- `ema150_200_d1_crosses` (latest capped list)
- `per_tf` object keyed by timeframe (`M1`,`M5`,`M15`,`H1`,`H4`,`D1`)
  - `crosses[]`
  - `osmaEvents[]`
  - `barStats`
3. `live`
- `per_tf_state` by timeframe:
  - `direction`, `phase`, `directionStabilized`
  - `ema1334AboutScore`, `osmaAboutScore`
  - `barsAfterCross1334`, `barsAfterCross150200`
  - `barPosVsMAs`
- `signals`
  - `aligned` (raw counts)
  - `strong` (thresholded by `InpMinAlignedTF`)
  - `tfLists` (CSV timeframe lists for each signal bucket)
- `bar_monitor`
  - `previous_bar` (OHLC + color/height)
  - `current_bar` (OHLC + color/height + `pctVsPrevBar`)
4. `positions`
- `open[]` (filtered by current symbol and `InpMagic`)
- `reassessments[]`

Compact example:

```json
{
  "meta": {
    "symbol": "BTCUSD#",
    "magic": 13034,
    "dryRun": true,
    "strategyMode": "Base",
    "optionV1": {
      "m1Trend": "Flat",
      "nearCrossThresholdPoints": 80.0,
      "aboutToCrossUpTickSide": false,
      "aboutToCrossDownTickSide": false,
      "useOsmaBlock": true,
      "useM1PeakPhaseBlock": true,
      "useM5PeakPhaseBlock": true,
      "useDirectionBlock": true
    },
    "updatedAt": 1738972800,
    "recommendation": "BUY SID:..."
  },
  "historical": {
    "ema150_200_d1_crosses": [
      {
        "pair": "EMA150_EMA200",
        "time": 1738886400,
        "price": 98500.12,
        "direction": 1,
        "barsSincePrev": 42,
        "hasExtremum": true
      }
    ],
    "per_tf": {
      "M1": {
        "crosses": [],
        "osmaEvents": [],
        "barStats": {
          "time": 1738972740,
          "currentHeight": 12.5,
          "averageHeight": 8.9,
          "spike": false
        }
      }
    }
  },
  "live": {
    "per_tf_state": {
      "M1": {
        "direction": "Up",
        "phase": "Running",
        "directionStabilized": true,
        "ema1334AboutScore": 0.4,
        "osmaAboutScore": 0.7
      }
    },
    "signals": {
      "aligned": { "osmaBuy": 4, "osmaSell": 1, "emaBuy": 4, "emaSell": 0 },
      "strong": { "osmaBuy": true, "osmaSell": false, "emaBuy": true, "emaSell": false },
      "tfLists": { "osmaBuy": "M1,M5,M15,H1", "emaBuy": "M1,M5,M15,H1" }
    },
    "bar_monitor": {
      "previous_bar": { "color": "green", "height": 10.0 },
      "current_bar": { "color": "red", "height": 8.0, "pctVsPrevBar": -20.0 }
    }
  },
  "positions": {
    "open": [
      {
        "ticket": 123456,
        "type": 0,
        "profit": 12.34,
        "comment": "SID:...|ENT:...|EXT:...|SIG:..."
      }
    ],
    "reassessments": []
  }
}
```

## Build

Compile with MetaEditor from your MT5 terminal data folder.
