
#property strict
#property description "Multi-timeframe EMA/SMA + OsMA telemetry EA with JSON state export"

#include <Trade/Trade.mqh>

#define TF_COUNT 6
#define MA_COUNT 6
#define MAX_CROSS_EVENTS 80
#define MAX_OSMA_EVENTS 80
#define MAX_REASSESS_EVENTS 120

enum TrendDirection
  {
   TREND_DOWN = -1,
   TREND_FLAT = 0,
   TREND_UP = 1
  };

enum CrossPhase
  {
   PHASE_RUNNING = 0,
   PHASE_FLAT_ABOUT_TO_CROSS = 1,
   PHASE_ABOUT_TO_CONTINUE = 2,
   PHASE_RUNNING_CONTINUED = 3
  };

enum StrategyMode
  {
   STRAT_BASE = 0,
   STRAT_OPTION_V1 = 1
  };

enum InitialSlMode
  {
   SL_ATR = 0,
   SL_EXTREMUM = 1
  };

enum MaId
  {
   MA_EMA150 = 0,
   MA_EMA200 = 1,
   MA_SMA2 = 2,
   MA_SMA5 = 3,
   MA_EMA13 = 4,
   MA_EMA34 = 5
  };

struct CrossEvent
  {
   string pair;
   datetime t;
   double price;
   int bars_since_prev;
   int direction;
   bool has_extremum;
   string extremum_type;
   datetime extremum_t;
   double extremum_price;
  };

struct OsmaEvent
  {
   string event_type;
   datetime t;
   double value;
   int direction;
  };

struct BarStats
  {
   datetime t;
   double curr_height;
   double prev_height;
   double avg_height;
   bool spike;
   double atr;
   string prev_color;
   string curr_color;
   double pct_vs_prev;
   double prev_open;
   double prev_high;
   double prev_low;
   double prev_close;
   double curr_open;
   double curr_high;
   double curr_low;
   double curr_close;
  };

struct TfState
  {
   TrendDirection direction;
   TrendDirection previous_direction;
   int direction_stable_bars;
   bool direction_stabilized;
   CrossPhase phase;

   bool ema1334_just_cross_up;
   bool ema1334_just_cross_down;
   bool ema1334_about_cross_up;
   bool ema1334_about_cross_down;
   double ema1334_about_score;

   bool osma_just_cross_up;
   bool osma_just_cross_down;
   bool osma_about_cross_up;
   bool osma_about_cross_down;
   double osma_about_score;

   bool peak_bottom_reached_1334;
   string peak_bottom_type_1334;

   int bars_after_cross_1334;
   int bars_after_cross_150200;

   double sma2_value;
   double sma5_value;
   double ema150_value;
   double ema200_value;
   double ema13_value;
   double ema34_value;
   datetime optionv1_live_bar_time;

   int bar_pos_vs_ma[MA_COUNT];
   BarStats bars;
  };

struct TfRuntime
  {
   ENUM_TIMEFRAMES tf;
   string tf_name;
   int ma_handles[MA_COUNT];
   int osma_handle;
   int atr_handle;
   datetime last_bar_time;

   int last_cross_bars_total[MA_COUNT][MA_COUNT];
   datetime last_cross_time[MA_COUNT][MA_COUNT];

   CrossEvent cross_events[MAX_CROSS_EVENTS];
   int cross_count;

   OsmaEvent osma_events[MAX_OSMA_EVENTS];
   int osma_count;

   TfState state;
  };

struct ReassessEvent
  {
   datetime t;
   string symbol;
   long position_ticket;
   string reason;
   string previous_sid;
   string new_sid;
  };

input bool InpDryRun = true;
input StrategyMode InpStrategyMode = STRAT_BASE;
input double InpFixedLot = 0.01;
input int InpMinAlignedTF = 4;
input int InpMagic = 13034;
input double InpAtrSpikeK = 2.0;
input int InpAtrPeriod = 14;
input double InpNearCrossThresholdPoints = 80.0;
input int InpConvergenceBars = 3;
input int InpProjectionHorizonBars = 1;
input string InpJsonFile = "ea_multitf_state.json";
input bool InpEnableScalpRules = true;
input bool InpEnableSwingRules = true;
input int InpOsmaSignal = 3;
input int InpOsmaFast = 12;
input int InpOsmaSlow = 59;
input double InpOptionV1NearCrossThresholdPoints = 80.0;
input bool InpOptionV1UseOsmaJustCrossBlock = true;
input bool InpOptionV1UseM1PeakPhaseBlock = true;
input bool InpOptionV1UseM5PeakPhaseBlock = true;
input bool InpOptionV1UseM1M5DirectionBlock = true;
input bool InpV2EnableRiskGuard = true;
input double InpV2MaxEquityDrawdownPct = 20.0;
input double InpV2MaxFloatingLossPct = 8.0;
input double InpV2MaxDepositLoadPct = 12.0;
input int InpV2MaxOpenPositions = 3;
input int InpV2EntryCooldownBarsM1 = 3;
input bool InpV2RequireTrendConsensusM1M5 = true;
input bool InpV2RequireOsmaAgreementM1 = true;
input double InpV2InitialSlAtrMult = 1.2;
input int InpV2TimeStopBarsM1 = 30;
input bool InpV2AutoCloseOnGuardBreach = true;
input bool InpV2UseDynamicLotCap = true;
input double InpV2MaxLotByEquity = 0.01;
input bool InpOptionV1EntryOnFirstBarCloseAfterCross1334 = true;
input InitialSlMode InpInitialSlMode = SL_EXTREMUM;
input double InpExtremumFallbackAtrMult = 1.2;
input int InpExtremumLookbackEvents = 40;

CTrade g_trade;
TfRuntime g_tfs[TF_COUNT];
ReassessEvent g_reassess[MAX_REASSESS_EVENTS];
int g_reassess_count = 0;
CrossEvent g_d1_150200_crosses[4];
int g_d1_150200_count = 0;

string g_last_recommendation = "NONE";
int g_sid_counter = 0;
double g_last_scalp_win = 0.0;
double g_v2_equity_peak = 0.0;
double g_v2_current_equity = 0.0;
double g_v2_current_drawdown_pct = 0.0;
double g_v2_current_floating_profit = 0.0;
double g_v2_current_floating_loss_pct = 0.0;
double g_v2_current_deposit_load_pct = 0.0;
int g_v2_current_open_positions = 0;
bool g_v2_guard_dd = false;
bool g_v2_guard_float = false;
bool g_v2_guard_load = false;
bool g_v2_guard_poscount = false;
bool g_v2_guard_breached = false;
string g_v2_guard_reason = "NONE";
string g_v2_entry_block_reason = "NONE";
bool g_v2_last_risk_guard_pass = true;
bool g_v2_last_cooldown_pass = true;
bool g_v2_last_trend_consensus_pass = true;
bool g_v2_last_osma_pass = true;
datetime g_v2_last_entry_bar_time = 0;
int g_v2_last_entry_direction = 0;
int g_v2_last_entry_bars_total = -1;
string g_v2_last_sl_mode = "ATR";
string g_v2_last_sl_source = "atr";
string g_v2_last_sl_fallback_reason = "NONE";
string g_v2_last_extremum_type = "";
datetime g_v2_last_extremum_time = 0;
double g_v2_last_extremum_price = 0.0;
double g_v2_last_sl_price = 0.0;

const ENUM_TIMEFRAMES TF_VALUES[TF_COUNT] = {PERIOD_M1, PERIOD_M5, PERIOD_M15, PERIOD_H1, PERIOD_H4, PERIOD_D1};
const string TF_NAMES[TF_COUNT] = {"M1", "M5", "M15", "H1", "H4", "D1"};
const int MA_PERIODS[MA_COUNT] = {150, 200, 2, 5, 13, 34};
const ENUM_MA_METHOD MA_METHODS[MA_COUNT] = {MODE_EMA, MODE_EMA, MODE_SMA, MODE_SMA, MODE_EMA, MODE_EMA};
const string MA_NAMES[MA_COUNT] = {"EMA150", "EMA200", "SMA2", "SMA5", "EMA13", "EMA34"};

string JsonEscape(string v)
  {
   string s = v;
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", "\\r");
   StringReplace(s, "\n", "\\n");
   return s;
  }

string BoolJson(bool v)
  {
   return v ? "true" : "false";
  }

string TimeToJson(datetime t)
  {
   return (string)((long)t);
  }

string PhaseToString(CrossPhase p)
  {
   if(p == PHASE_RUNNING) return "Running";
   if(p == PHASE_FLAT_ABOUT_TO_CROSS) return "Flat/AboutToCross";
   if(p == PHASE_ABOUT_TO_CONTINUE) return "AboutToContinue";
   return "RunningContinued";
  }

string TrendToString(TrendDirection d)
  {
   if(d == TREND_UP) return "Up";
   if(d == TREND_DOWN) return "Down";
   return "Flat";
  }

void LogWithPrices(string message)
  {
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   PrintFormat("%s bid=%s ask=%s", message, DoubleToString(bid, _Digits), DoubleToString(ask, _Digits));
  }

string StrategyModeToString(StrategyMode mode)
  {
   if(mode == STRAT_OPTION_V1) return "OptionV1";
   return "Base";
  }

string InitialSlModeToString(InitialSlMode mode)
  {
   if(mode == SL_EXTREMUM) return "EXTREMUM";
   return "ATR";
  }

int SignOf(double v)
  {
   if(v > 0.0) return 1;
   if(v < 0.0) return -1;
   return 0;
  }

bool LoadBuffer(int handle, int count, double &dst[])
  {
   ArrayResize(dst, count);
   ArrayInitialize(dst, 0.0);
   int copied = CopyBuffer(handle, 0, 0, count, dst);
   return copied == count;
  }

bool LoadRates(ENUM_TIMEFRAMES tf, int count, MqlRates &rates[])
  {
   ArrayResize(rates, count);
   int copied = CopyRates(_Symbol, tf, 0, count, rates);
   if(copied != count)
      return false;
   ArraySetAsSeries(rates, true);
   return true;
  }

double NormalizeVolume(double lot)
  {
   double min_lot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double max_lot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0.0)
      step = 0.01;

   double v = MathMin(MathMax(lot, min_lot), max_lot);
   double steps = MathFloor(v / step);
   v = steps * step;
   if(v < min_lot)
      v = min_lot;
   return v;
  }

double ComputeEntryLot()
  {
   double lot = InpFixedLot;
   if(InpV2UseDynamicLotCap)
      lot = MathMin(lot, InpV2MaxLotByEquity);
   return NormalizeVolume(lot);
  }

double NormalizePriceByTick(double price)
  {
   double tick = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tick <= 0.0)
      tick = _Point;
   return MathRound(price / tick) * tick;
  }

bool FindM1CrossEventExtremumForDirection(int direction, double &ext_price, datetime &ext_time, string &ext_type)
  {
   ext_price = 0.0;
   ext_time = 0;
   ext_type = "";

   int scanned = 0;
   string pair1334 = MA_NAMES[MA_EMA13] + "_" + MA_NAMES[MA_EMA34];
   for(int i = g_tfs[0].cross_count - 1; i >= 0; i--)
     {
      CrossEvent ev = g_tfs[0].cross_events[i];
      if(ev.pair != pair1334)
         continue;
      if(scanned >= InpExtremumLookbackEvents)
         break;
      scanned++;
      if(!ev.has_extremum)
         continue;

      if(direction > 0 && ev.extremum_type == "bottom")
        {
         ext_price = ev.extremum_price;
         ext_time = ev.extremum_t;
         ext_type = ev.extremum_type;
         return true;
        }
      if(direction < 0 && ev.extremum_type == "peak")
        {
         ext_price = ev.extremum_price;
         ext_time = ev.extremum_t;
         ext_type = ev.extremum_type;
         return true;
        }
     }
   return false;
  }

double ComputeInitialSlPriceAtr(int direction, double ref_price, double atr_mult)
  {
   double atr = g_tfs[0].state.bars.atr;
   double dist = atr * atr_mult;
   if(dist <= 0.0)
      dist = 80.0 * _Point;

   double stop_level = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   if(stop_level > 0.0 && dist < stop_level)
      dist = stop_level;

   if(direction > 0)
      return NormalizePriceByTick(ref_price - dist);
   return NormalizePriceByTick(ref_price + dist);
  }

double ComputeInitialSlPriceExtremum(int direction, double ref_price, bool &used_extremum, string &reject_reason)
  {
   used_extremum = false;
   reject_reason = "NONE";
   double ext_price = 0.0;
   datetime ext_time = 0;
   string ext_type = "";
   bool found = FindM1CrossEventExtremumForDirection(direction, ext_price, ext_time, ext_type);
   if(!found)
     {
      reject_reason = "EXTREMUM_NOT_FOUND_1334";
      return 0.0;
     }

   double min_dist = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   if(min_dist <= 0.0)
      min_dist = _Point;

   double sl = ext_price;
   if(direction > 0)
     {
      if(sl >= ref_price)
        {
         reject_reason = "EXTREMUM_INVALID_STOPLEVEL";
         return 0.0;
        }
      if((ref_price - sl) < min_dist)
        {
         reject_reason = "EXTREMUM_INVALID_STOPLEVEL";
         return 0.0;
        }
      sl = NormalizePriceByTick(sl);
      if(sl >= ref_price)
        {
         reject_reason = "EXTREMUM_INVALID_STOPLEVEL";
         return 0.0;
        }
     }
   else
     {
      if(sl <= ref_price)
        {
         reject_reason = "EXTREMUM_INVALID_STOPLEVEL";
         return 0.0;
        }
      if((sl - ref_price) < min_dist)
        {
         reject_reason = "EXTREMUM_INVALID_STOPLEVEL";
         return 0.0;
        }
      sl = NormalizePriceByTick(sl);
      if(sl <= ref_price)
        {
         reject_reason = "EXTREMUM_INVALID_STOPLEVEL";
         return 0.0;
        }
     }

   used_extremum = true;
   g_v2_last_extremum_type = ext_type;
   g_v2_last_extremum_time = ext_time;
   g_v2_last_extremum_price = ext_price;
   return sl;
  }

double ComputeInitialSlPrice(int direction, double ref_price)
  {
   g_v2_last_sl_mode = InitialSlModeToString(InpInitialSlMode);
   g_v2_last_sl_source = "atr";
   g_v2_last_sl_fallback_reason = "NONE";
   g_v2_last_extremum_type = "";
   g_v2_last_extremum_time = 0;
   g_v2_last_extremum_price = 0.0;

   if(InpInitialSlMode == SL_EXTREMUM)
     {
      bool used_extremum = false;
      string reject_reason = "NONE";
      double sl_ext = ComputeInitialSlPriceExtremum(direction, ref_price, used_extremum, reject_reason);
      if(used_extremum && sl_ext > 0.0)
        {
         g_v2_last_sl_source = "extremum";
         g_v2_last_sl_price = sl_ext;
         return sl_ext;
        }

      double fallback_mult = InpExtremumFallbackAtrMult > 0.0 ? InpExtremumFallbackAtrMult : InpV2InitialSlAtrMult;
      double sl_fb = ComputeInitialSlPriceAtr(direction, ref_price, fallback_mult);
      g_v2_last_sl_source = "fallback_atr";
      g_v2_last_sl_fallback_reason = reject_reason;
      g_v2_last_sl_price = sl_fb;
      return sl_fb;
     }

   double sl = ComputeInitialSlPriceAtr(direction, ref_price, InpV2InitialSlAtrMult);
   g_v2_last_sl_source = "atr";
   g_v2_last_sl_price = sl;
   return sl;
  }

bool CountManagedPositions(int &count, double &floating_profit)
  {
   count = 0;
   floating_profit = 0.0;
   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))
         continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol)
         continue;
      if((int)PositionGetInteger(POSITION_MAGIC) != InpMagic)
         continue;
      count++;
      floating_profit += PositionGetDouble(POSITION_PROFIT);
     }
   return true;
  }

bool RefreshV2RiskState()
  {
   g_v2_current_equity = AccountInfoDouble(ACCOUNT_EQUITY);
   if(g_v2_current_equity <= 0.0)
      g_v2_current_equity = 0.0000001;

   if(g_v2_equity_peak < g_v2_current_equity)
      g_v2_equity_peak = g_v2_current_equity;
   if(g_v2_equity_peak <= 0.0)
      g_v2_equity_peak = g_v2_current_equity;

   int open_count = 0;
   double floating_profit = 0.0;
   CountManagedPositions(open_count, floating_profit);

   g_v2_current_open_positions = open_count;
   g_v2_current_floating_profit = floating_profit;
   g_v2_current_drawdown_pct = ((g_v2_equity_peak - g_v2_current_equity) / g_v2_equity_peak) * 100.0;
   g_v2_current_floating_loss_pct = (floating_profit < 0.0) ? (MathAbs(floating_profit) / g_v2_current_equity) * 100.0 : 0.0;
   g_v2_current_deposit_load_pct = (AccountInfoDouble(ACCOUNT_MARGIN) / g_v2_current_equity) * 100.0;

   g_v2_guard_dd = (g_v2_current_drawdown_pct > InpV2MaxEquityDrawdownPct);
   g_v2_guard_float = (g_v2_current_floating_loss_pct > InpV2MaxFloatingLossPct);
   g_v2_guard_load = (g_v2_current_deposit_load_pct > InpV2MaxDepositLoadPct);
   g_v2_guard_poscount = (g_v2_current_open_positions >= InpV2MaxOpenPositions);
   g_v2_guard_breached = g_v2_guard_dd || g_v2_guard_float || g_v2_guard_load || g_v2_guard_poscount;
   g_v2_guard_reason = "NONE";
   if(g_v2_guard_dd) g_v2_guard_reason = "RISK_GUARD_DD";
   else if(g_v2_guard_float) g_v2_guard_reason = "RISK_GUARD_FLOAT";
   else if(g_v2_guard_load) g_v2_guard_reason = "RISK_GUARD_LOAD";
   else if(g_v2_guard_poscount) g_v2_guard_reason = "RISK_GUARD_POSCOUNT";

   return true;
  }

bool RiskGuardsAllowEntry()
  {
   if(!InpV2EnableRiskGuard)
     {
      g_v2_last_risk_guard_pass = true;
      return true;
     }

   RefreshV2RiskState();
   g_v2_last_risk_guard_pass = !g_v2_guard_breached;
   if(!g_v2_last_risk_guard_pass)
      g_v2_entry_block_reason = g_v2_guard_reason;
   return g_v2_last_risk_guard_pass;
  }

void EmergencyCloseAllManaged(string reason)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))
         continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol)
         continue;
      if((int)PositionGetInteger(POSITION_MAGIC) != InpMagic)
         continue;
      bool closed = g_trade.PositionClose(ticket);
      LogWithPrices(StringFormat("[EXIT-CLOSE] ticket=%I64u reason=%s ok=%s", ticket, reason, closed ? "true" : "false"));
     }
  }

double GetM1LiveOsmaValue()
  {
   double val[];
   ArrayResize(val, 1);
   if(CopyBuffer(g_tfs[0].osma_handle, 0, 0, 1, val) != 1)
      return 0.0;
   return val[0];
  }

bool EntryCooldownPass(int direction)
  {
   int bars_total = iBars(_Symbol, PERIOD_M1);
   datetime bar_time = iTime(_Symbol, PERIOD_M1, 0);

   if(g_v2_last_entry_bar_time == bar_time && g_v2_last_entry_direction == direction)
      return false;

   if(g_v2_last_entry_bars_total >= 0 && (bars_total - g_v2_last_entry_bars_total) < InpV2EntryCooldownBarsM1)
      return false;

   return true;
  }

void AddCrossEvent(int tf_idx, const CrossEvent &ev)
  {
   if(g_tfs[tf_idx].cross_count < MAX_CROSS_EVENTS)
     {
      g_tfs[tf_idx].cross_events[g_tfs[tf_idx].cross_count] = ev;
      g_tfs[tf_idx].cross_count++;
      return;
     }

   for(int i = 1; i < MAX_CROSS_EVENTS; i++)
      g_tfs[tf_idx].cross_events[i - 1] = g_tfs[tf_idx].cross_events[i];

   g_tfs[tf_idx].cross_events[MAX_CROSS_EVENTS - 1] = ev;
  }

void AddOsmaEvent(int tf_idx, const OsmaEvent &ev)
  {
   if(g_tfs[tf_idx].osma_count < MAX_OSMA_EVENTS)
     {
      g_tfs[tf_idx].osma_events[g_tfs[tf_idx].osma_count] = ev;
      g_tfs[tf_idx].osma_count++;
      return;
     }

   for(int i = 1; i < MAX_OSMA_EVENTS; i++)
      g_tfs[tf_idx].osma_events[i - 1] = g_tfs[tf_idx].osma_events[i];

   g_tfs[tf_idx].osma_events[MAX_OSMA_EVENTS - 1] = ev;
  }

void TrackD1Cross150200(const CrossEvent &ev)
  {
   if(g_d1_150200_count < 4)
     {
      g_d1_150200_crosses[g_d1_150200_count] = ev;
      g_d1_150200_count++;
      return;
     }

   for(int i = 1; i < 4; i++)
      g_d1_150200_crosses[i - 1] = g_d1_150200_crosses[i];

   g_d1_150200_crosses[3] = ev;
  }

string PairName(int a, int b)
  {
   return MA_NAMES[a] + "_" + MA_NAMES[b];
  }
void UpdateCrossExtremums(int tf_idx, const MqlRates &rates[])
  {
   if(g_tfs[tf_idx].cross_count <= 0)
      return;

   bool peak = (rates[3].high > rates[1].high && rates[3].high > rates[2].high && rates[3].high > rates[4].high && rates[3].high > rates[5].high);
   bool bottom = (rates[3].low < rates[1].low && rates[3].low < rates[2].low && rates[3].low < rates[4].low && rates[3].low < rates[5].low);
   if(!peak && !bottom)
      return;

   for(int i = g_tfs[tf_idx].cross_count - 1; i >= 0; i--)
     {
      if(g_tfs[tf_idx].cross_events[i].has_extremum)
         continue;
      if(g_tfs[tf_idx].cross_events[i].t >= rates[3].time)
         continue;

      g_tfs[tf_idx].cross_events[i].has_extremum = true;
      g_tfs[tf_idx].cross_events[i].extremum_t = rates[3].time;

      if(peak)
        {
         g_tfs[tf_idx].cross_events[i].extremum_type = "peak";
         g_tfs[tf_idx].cross_events[i].extremum_price = rates[3].high;
        }
      else
        {
         g_tfs[tf_idx].cross_events[i].extremum_type = "bottom";
         g_tfs[tf_idx].cross_events[i].extremum_price = rates[3].low;
        }

      if(g_tfs[tf_idx].cross_events[i].pair == PairName(MA_EMA13, MA_EMA34))
        {
         g_tfs[tf_idx].state.peak_bottom_reached_1334 = true;
         g_tfs[tf_idx].state.peak_bottom_type_1334 = g_tfs[tf_idx].cross_events[i].extremum_type;
        }
      break;
     }
  }

void DetectCrosses(int tf_idx, const double &ma_vals[][8], const MqlRates &rates[])
  {
   g_tfs[tf_idx].state.ema1334_just_cross_up = false;
   g_tfs[tf_idx].state.ema1334_just_cross_down = false;

   int bars_total = Bars(_Symbol, g_tfs[tf_idx].tf);

   for(int a = 0; a < MA_COUNT; a++)
     {
      for(int b = a + 1; b < MA_COUNT; b++)
        {
         double prev_diff = ma_vals[a][2] - ma_vals[b][2];
         double curr_diff = ma_vals[a][1] - ma_vals[b][1];

         int prev_sign = SignOf(prev_diff);
         int curr_sign = SignOf(curr_diff);

         if(prev_sign == 0 || curr_sign == 0 || prev_sign == curr_sign)
            continue;

         CrossEvent ev;
         ev.pair = PairName(a, b);
         ev.t = rates[1].time;
         ev.price = rates[1].close;
         ev.direction = curr_sign;
         ev.has_extremum = false;
         ev.extremum_type = "";
         ev.extremum_t = 0;
         ev.extremum_price = 0.0;

         int last_bars_total = g_tfs[tf_idx].last_cross_bars_total[a][b];
         if(last_bars_total > 0)
            ev.bars_since_prev = MathAbs(bars_total - last_bars_total);
         else
            ev.bars_since_prev = -1;

         g_tfs[tf_idx].last_cross_bars_total[a][b] = bars_total;
         g_tfs[tf_idx].last_cross_time[a][b] = ev.t;

         AddCrossEvent(tf_idx, ev);

         if(a == MA_EMA13 && b == MA_EMA34)
           {
            g_tfs[tf_idx].state.bars_after_cross_1334 = 0;
            g_tfs[tf_idx].state.peak_bottom_reached_1334 = false;
            g_tfs[tf_idx].state.peak_bottom_type_1334 = "";
            if(curr_sign > 0)
               g_tfs[tf_idx].state.ema1334_just_cross_up = true;
            else
               g_tfs[tf_idx].state.ema1334_just_cross_down = true;
           }

         if(a == MA_EMA150 && b == MA_EMA200)
           {
            g_tfs[tf_idx].state.bars_after_cross_150200 = 0;
            if(g_tfs[tf_idx].tf == PERIOD_D1)
               TrackD1Cross150200(ev);
           }
        }
     }
  }

void DetectOsma(int tf_idx, const double &osma[], const MqlRates &rates[])
  {
   g_tfs[tf_idx].state.osma_just_cross_up = false;
   g_tfs[tf_idx].state.osma_just_cross_down = false;

   int prev_sign = SignOf(osma[2]);
   int curr_sign = SignOf(osma[1]);

   if(prev_sign != 0 && curr_sign != 0 && prev_sign != curr_sign)
     {
      OsmaEvent ev;
      ev.event_type = "zero_cross";
      ev.t = rates[1].time;
      ev.value = osma[1];
      ev.direction = curr_sign;
      AddOsmaEvent(tf_idx, ev);

      if(curr_sign > 0)
         g_tfs[tf_idx].state.osma_just_cross_up = true;
      else
         g_tfs[tf_idx].state.osma_just_cross_down = true;
     }

   bool osma_peak = (osma[3] > osma[1] && osma[3] > osma[2] && osma[3] > osma[4] && osma[3] > osma[5]);
   bool osma_bottom = (osma[3] < osma[1] && osma[3] < osma[2] && osma[3] < osma[4] && osma[3] < osma[5]);

   if(osma_peak || osma_bottom)
     {
      OsmaEvent ex;
      ex.event_type = osma_peak ? "peak" : "bottom";
      ex.t = rates[3].time;
      ex.value = osma[3];
      ex.direction = SignOf(osma[3]);
      AddOsmaEvent(tf_idx, ex);
     }
  }

bool IsConverging(const double &vals[], int bars)
  {
   int max_need = bars + 1;
   if(ArraySize(vals) < max_need + 1)
      return false;

   for(int i = 1; i <= bars; i++)
     {
      if(MathAbs(vals[i]) > MathAbs(vals[i + 1]))
         continue;
      return false;
     }
   return true;
  }

void ComputeEma1334State(int tf_idx, const double &ma_vals[][8])
  {
   double diff[10];
   ArrayInitialize(diff, 0.0);
   for(int i = 0; i < 8; i++)
      diff[i] = ma_vals[MA_EMA13][i] - ma_vals[MA_EMA34][i];

   int direction_sign = SignOf(diff[1]);
   g_tfs[tf_idx].state.previous_direction = g_tfs[tf_idx].state.direction;
   if(direction_sign > 0)
      g_tfs[tf_idx].state.direction = TREND_UP;
   else if(direction_sign < 0)
      g_tfs[tf_idx].state.direction = TREND_DOWN;
   else
      g_tfs[tf_idx].state.direction = TREND_FLAT;

   if(g_tfs[tf_idx].state.direction != TREND_FLAT && g_tfs[tf_idx].state.direction == g_tfs[tf_idx].state.previous_direction)
      g_tfs[tf_idx].state.direction_stable_bars++;
   else if(g_tfs[tf_idx].state.direction != TREND_FLAT)
      g_tfs[tf_idx].state.direction_stable_bars = 1;
   else
      g_tfs[tf_idx].state.direction_stable_bars = 0;

   g_tfs[tf_idx].state.direction_stabilized = (g_tfs[tf_idx].state.direction_stable_bars >= InpConvergenceBars);

   double near_threshold = InpNearCrossThresholdPoints * _Point;
   bool near = (MathAbs(diff[1]) <= near_threshold);
   bool converging = IsConverging(diff, InpConvergenceBars);

   double slope = diff[1] - diff[2];
   double projected = diff[1] + slope * InpProjectionHorizonBars;
   bool projection = (SignOf(projected) != SignOf(diff[1])) || (MathAbs(projected) <= near_threshold);

   g_tfs[tf_idx].state.ema1334_about_score = (near ? 0.4 : 0.0) + (converging ? 0.3 : 0.0) + (projection ? 0.3 : 0.0);

   g_tfs[tf_idx].state.ema1334_about_cross_up = (g_tfs[tf_idx].state.ema1334_about_score >= 0.7 && diff[1] < 0.0);
   g_tfs[tf_idx].state.ema1334_about_cross_down = (g_tfs[tf_idx].state.ema1334_about_score >= 0.7 && diff[1] > 0.0);

   if(g_tfs[tf_idx].state.ema1334_about_score >= 0.7)
      g_tfs[tf_idx].state.phase = PHASE_FLAT_ABOUT_TO_CROSS;
   else if(MathAbs(slope) < (near_threshold * 0.5))
      g_tfs[tf_idx].state.phase = PHASE_ABOUT_TO_CONTINUE;
   else if(g_tfs[tf_idx].state.previous_direction == g_tfs[tf_idx].state.direction && g_tfs[tf_idx].state.direction_stabilized)
      g_tfs[tf_idx].state.phase = PHASE_RUNNING_CONTINUED;
   else
      g_tfs[tf_idx].state.phase = PHASE_RUNNING;
  }
void ComputeOsmaState(int tf_idx, const double &osma[])
  {
   double abs_mean = (MathAbs(osma[1]) + MathAbs(osma[2]) + MathAbs(osma[3]) + MathAbs(osma[4]) + MathAbs(osma[5])) / 5.0;
   if(abs_mean <= 0.0)
      abs_mean = 0.0000001;

   bool near = MathAbs(osma[1]) <= (abs_mean * 0.35);
   bool converging = true;
   for(int i = 1; i <= InpConvergenceBars; i++)
     {
      if(MathAbs(osma[i]) > MathAbs(osma[i + 1]))
         continue;
      converging = false;
      break;
     }

   double slope = osma[1] - osma[2];
   double projected = osma[1] + slope * InpProjectionHorizonBars;
   bool projection = (SignOf(projected) != SignOf(osma[1])) || (MathAbs(projected) <= abs_mean * 0.25);

   g_tfs[tf_idx].state.osma_about_score = (near ? 0.4 : 0.0) + (converging ? 0.3 : 0.0) + (projection ? 0.3 : 0.0);
   g_tfs[tf_idx].state.osma_about_cross_up = (g_tfs[tf_idx].state.osma_about_score >= 0.7 && osma[1] < 0.0);
   g_tfs[tf_idx].state.osma_about_cross_down = (g_tfs[tf_idx].state.osma_about_score >= 0.7 && osma[1] > 0.0);
  }

void ComputeBarStats(int tf_idx, const MqlRates &rates[], const double atr_value, const double &ma_vals[][8])
  {
   double curr_h = rates[1].high - rates[1].low;
   double prev_h = rates[2].high - rates[2].low;

   if(g_tfs[tf_idx].state.bars.avg_height <= 0.0)
      g_tfs[tf_idx].state.bars.avg_height = curr_h;
   else
      g_tfs[tf_idx].state.bars.avg_height = (g_tfs[tf_idx].state.bars.avg_height * 0.95) + (curr_h * 0.05);

   g_tfs[tf_idx].state.bars.t = rates[1].time;
   g_tfs[tf_idx].state.bars.curr_height = curr_h;
   g_tfs[tf_idx].state.bars.prev_height = prev_h;
   g_tfs[tf_idx].state.bars.atr = atr_value;
   g_tfs[tf_idx].state.bars.spike = (atr_value > 0.0 && curr_h > atr_value * InpAtrSpikeK);

   if(prev_h > 0.0)
      g_tfs[tf_idx].state.bars.pct_vs_prev = ((curr_h - prev_h) / prev_h) * 100.0;
   else
      g_tfs[tf_idx].state.bars.pct_vs_prev = 0.0;

   g_tfs[tf_idx].state.bars.prev_color = (rates[2].close >= rates[2].open) ? "green" : "red";
   g_tfs[tf_idx].state.bars.curr_color = (rates[1].close >= rates[1].open) ? "green" : "red";

   g_tfs[tf_idx].state.bars.prev_open = rates[2].open;
   g_tfs[tf_idx].state.bars.prev_high = rates[2].high;
   g_tfs[tf_idx].state.bars.prev_low = rates[2].low;
   g_tfs[tf_idx].state.bars.prev_close = rates[2].close;

   g_tfs[tf_idx].state.bars.curr_open = rates[1].open;
   g_tfs[tf_idx].state.bars.curr_high = rates[1].high;
   g_tfs[tf_idx].state.bars.curr_low = rates[1].low;
   g_tfs[tf_idx].state.bars.curr_close = rates[1].close;

   for(int i = 0; i < MA_COUNT; i++)
      g_tfs[tf_idx].state.bar_pos_vs_ma[i] = (rates[1].close >= ma_vals[i][1]) ? 1 : -1;
  }

string BuildSid()
  {
   g_sid_counter++;
   return IntegerToString((int)TimeCurrent()) + "_" + IntegerToString(g_sid_counter);
  }

bool EntryAllowed(int direction)
  {
   if(g_tfs[0].state.osma_just_cross_up || g_tfs[0].state.osma_just_cross_down)
     {
      LogWithPrices(StringFormat("[ENTRY-BLOCK][BASE] dir=%s reason=M1 OsMA just crossed", direction > 0 ? "BUY" : "SELL"));
      return false;
     }

   bool m1_peak_block = g_tfs[0].state.peak_bottom_reached_1334 && !(g_tfs[0].state.phase == PHASE_FLAT_ABOUT_TO_CROSS || g_tfs[0].state.phase == PHASE_RUNNING_CONTINUED);
   bool m5_peak_block = g_tfs[1].state.peak_bottom_reached_1334 && !(g_tfs[1].state.phase == PHASE_FLAT_ABOUT_TO_CROSS || g_tfs[1].state.phase == PHASE_RUNNING_CONTINUED);

   if(m1_peak_block || m5_peak_block)
     {
      LogWithPrices(StringFormat("[ENTRY-BLOCK][BASE] dir=%s reason=peak/phase block m1=%s m5=%s",
                                 direction > 0 ? "BUY" : "SELL",
                                 m1_peak_block ? "true" : "false",
                                 m5_peak_block ? "true" : "false"));
      return false;
     }

   if(direction > 0 && g_tfs[0].state.direction == TREND_DOWN && g_tfs[1].state.direction == TREND_DOWN)
     {
      LogWithPrices("[ENTRY-BLOCK][BASE] dir=BUY reason=M1+M5 direction both DOWN");
      return false;
     }

   if(direction < 0 && g_tfs[0].state.direction == TREND_UP && g_tfs[1].state.direction == TREND_UP)
     {
      LogWithPrices("[ENTRY-BLOCK][BASE] dir=SELL reason=M1+M5 direction both UP");
      return false;
     }

   return true;
  }

void AddReassessEvent(long ticket, string reason, string prev_sid, string new_sid)
  {
   ReassessEvent ev;
   ev.t = TimeCurrent();
   ev.symbol = _Symbol;
   ev.position_ticket = ticket;
   ev.reason = reason;
   ev.previous_sid = prev_sid;
   ev.new_sid = new_sid;

   if(g_reassess_count < MAX_REASSESS_EVENTS)
     {
      g_reassess[g_reassess_count] = ev;
      g_reassess_count++;
      return;
     }

   for(int i = 1; i < MAX_REASSESS_EVENTS; i++)
      g_reassess[i - 1] = g_reassess[i];

   g_reassess[MAX_REASSESS_EVENTS - 1] = ev;
  }

bool ContainsText(string base, string probe)
  {
   return StringFind(base, probe, 0) >= 0;
  }

void ManagePositions(bool strong_buy, bool strong_sell)
  {
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double trailing_dist = g_tfs[1].state.bars.atr * 0.8;
   if(trailing_dist <= 0.0)
      trailing_dist = 50.0 * _Point;

   RefreshV2RiskState();
   if(InpV2EnableRiskGuard && InpV2AutoCloseOnGuardBreach && (g_v2_guard_dd || g_v2_guard_float || g_v2_guard_load))
     {
      LogWithPrices(StringFormat("[RISK-GUARD] breach=%s dd=%.2f float=%.2f load=%.2f action=close-all",
                                 g_v2_guard_reason,
                                 g_v2_current_drawdown_pct,
                                 g_v2_current_floating_loss_pct,
                                 g_v2_current_deposit_load_pct));
      EmergencyCloseAllManaged(g_v2_guard_reason);
      return;
     }

   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))
         continue;

      if(PositionGetString(POSITION_SYMBOL) != _Symbol)
         continue;

      if((int)PositionGetInteger(POSITION_MAGIC) != InpMagic)
         continue;

      long type = PositionGetInteger(POSITION_TYPE);
      double open_price = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      double profit = PositionGetDouble(POSITION_PROFIT);
      string comment = PositionGetString(POSITION_COMMENT);
      datetime open_time = (datetime)PositionGetInteger(POSITION_TIME);

      if(InpV2TimeStopBarsM1 > 0)
        {
         int age_bars = iBarShift(_Symbol, PERIOD_M1, open_time, false);
         if(age_bars >= InpV2TimeStopBarsM1 && profit <= 0.0)
           {
            bool closed_ts = g_trade.PositionClose(ticket);
            LogWithPrices(StringFormat("[EXIT-CLOSE] ticket=%I64u reason=time-stop ageBars=%d profit=%.2f ok=%s",
                                       ticket, age_bars, profit, closed_ts ? "true" : "false"));
            continue;
           }
        }

      if(profit > 0.0)
        {
         if(type == POSITION_TYPE_BUY)
           {
            double new_sl = bid - trailing_dist;
            if(sl <= 0.0 || new_sl > sl)
              {
               bool modified = g_trade.PositionModify(ticket, new_sl, tp);
               LogWithPrices(StringFormat("[EXIT-RISK] ticket=%I64u type=BUY reason=trail-sl oldSL=%s newSL=%s atr=%s ok=%s",
                                          ticket,
                                          DoubleToString(sl, _Digits),
                                          DoubleToString(new_sl, _Digits),
                                          DoubleToString(g_tfs[1].state.bars.atr, _Digits),
                                          modified ? "true" : "false"));
              }
           }
         else if(type == POSITION_TYPE_SELL)
           {
            double new_sl = ask + trailing_dist;
            if(sl <= 0.0 || new_sl < sl)
              {
               bool modified = g_trade.PositionModify(ticket, new_sl, tp);
               LogWithPrices(StringFormat("[EXIT-RISK] ticket=%I64u type=SELL reason=trail-sl oldSL=%s newSL=%s atr=%s ok=%s",
                                          ticket,
                                          DoubleToString(sl, _Digits),
                                          DoubleToString(new_sl, _Digits),
                                          DoubleToString(g_tfs[1].state.bars.atr, _Digits),
                                          modified ? "true" : "false"));
              }
           }
        }

      bool opposite = ((type == POSITION_TYPE_BUY && strong_sell) || (type == POSITION_TYPE_SELL && strong_buy));
      bool continuation = false;

      if(type == POSITION_TYPE_BUY)
         continuation = (g_tfs[0].state.direction == TREND_UP && g_tfs[1].state.direction == TREND_UP && (g_tfs[0].state.phase == PHASE_RUNNING_CONTINUED || g_tfs[1].state.phase == PHASE_RUNNING_CONTINUED));
      else if(type == POSITION_TYPE_SELL)
         continuation = (g_tfs[0].state.direction == TREND_DOWN && g_tfs[1].state.direction == TREND_DOWN && (g_tfs[0].state.phase == PHASE_RUNNING_CONTINUED || g_tfs[1].state.phase == PHASE_RUNNING_CONTINUED));

      if(opposite)
        {
         if(profit > 0.0 && continuation)
           {
            string prev_sid = "unknown";
            int sid_pos = StringFind(comment, "SID:");
            if(sid_pos >= 0)
              {
               string tail = StringSubstr(comment, sid_pos + 4);
               int sep = StringFind(tail, "|", 0);
               prev_sid = sep > 0 ? StringSubstr(tail, 0, sep) : tail;
              }
            string new_sid = BuildSid();
            AddReassessEvent((long)ticket, "Opposite strong signal but continuation active", prev_sid, new_sid);
            LogWithPrices(StringFormat("[EXIT-HOLD] ticket=%I64u reason=opposite-strong-but-continuation strongBuy=%s strongSell=%s profit=%.2f",
                                       ticket, strong_buy ? "true" : "false", strong_sell ? "true" : "false", profit));
           }
         else
           {
            bool closed = g_trade.PositionClose(ticket);
            LogWithPrices(StringFormat("[EXIT-CLOSE] ticket=%I64u reason=opposite-strong strongBuy=%s strongSell=%s profit=%.2f ok=%s",
                                       ticket, strong_buy ? "true" : "false", strong_sell ? "true" : "false", profit, closed ? "true" : "false"));
            continue;
           }
        }

      if(InpEnableScalpRules && ContainsText(comment, "SCALP"))
        {
         if(profit > 0.0)
           {
            double points = 0.0;
            if(type == POSITION_TYPE_BUY)
               points = (bid - open_price) / _Point;
            else if(type == POSITION_TYPE_SELL)
               points = (open_price - ask) / _Point;

            if(points >= 8.0)
              {
               g_last_scalp_win = MathMax(g_last_scalp_win, profit);
               bool closed = g_trade.PositionClose(ticket);
               LogWithPrices(StringFormat("[EXIT-CLOSE] ticket=%I64u reason=scalp-quick-gain points=%.1f profit=%.2f ok=%s",
                                          ticket, points, profit, closed ? "true" : "false"));
               continue;
              }
           }
         else if(g_last_scalp_win > 0.0 && MathAbs(profit) > g_last_scalp_win)
           {
            bool closed = g_trade.PositionClose(ticket);
            LogWithPrices(StringFormat("[EXIT-CLOSE] ticket=%I64u reason=scalp-loss-guard profit=%.2f lastScalpWin=%.2f ok=%s",
                                       ticket, profit, g_last_scalp_win, closed ? "true" : "false"));
            continue;
           }
        }
     }
  }

bool PlaceEntry(int direction, string ent, string ext, string sig)
  {
   string sid = BuildSid();
   string comment = "SID:" + sid + "|ENT:" + ent + "|EXT:" + ext + "|SIG:" + sig;
   string side = direction > 0 ? "BUY" : "SELL";
   double lot = ComputeEntryLot();
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double px = direction > 0 ? ask : bid;
   double sl = ComputeInitialSlPrice(direction, px);
   double sl_dist_pts = MathAbs(px - sl) / _Point;
   string ext_time_s = g_v2_last_extremum_time > 0 ? TimeToString(g_v2_last_extremum_time, TIME_DATE|TIME_MINUTES|TIME_SECONDS) : "0";

   double margin_req = 0.0;
   ENUM_ORDER_TYPE ot = direction > 0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   if(!OrderCalcMargin(ot, _Symbol, lot, px, margin_req))
     {
      LogWithPrices(StringFormat("[ENTRY-BLOCK] side=%s reason=margin-calc-failed lot=%.2f err=%d", side, lot, GetLastError()));
      return false;
     }
   double free_margin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   if(free_margin <= margin_req * 1.1)
     {
      LogWithPrices(StringFormat("[ENTRY-BLOCK] side=%s reason=insufficient-free-margin lot=%.2f free=%.2f need=%.2f",
                                 side, lot, free_margin, margin_req));
      return false;
     }

   if(InpDryRun)
     {
      g_last_recommendation = (direction > 0 ? "BUY " : "SELL ") + comment;
      LogWithPrices(StringFormat("[ENTRY-DRYRUN] side=%s mode=%s lot=%.2f sl=%s slMode=%s slSource=%s fallbackReason=%s slDistPts=%.1f extType=%s extPrice=%s extTime=%s comment=%s",
                                 side, StrategyModeToString(InpStrategyMode), lot, DoubleToString(sl, _Digits),
                                 g_v2_last_sl_mode, g_v2_last_sl_source, g_v2_last_sl_fallback_reason, sl_dist_pts,
                                 g_v2_last_extremum_type, DoubleToString(g_v2_last_extremum_price, _Digits), ext_time_s, comment));
      return true;
     }

   if(direction > 0)
     {
      bool ok = g_trade.Buy(lot, _Symbol, 0.0, sl, 0.0, comment);
      LogWithPrices(StringFormat("[ENTRY-SEND] side=%s mode=%s lot=%.2f sl=%s slMode=%s slSource=%s fallbackReason=%s slDistPts=%.1f extType=%s extPrice=%s extTime=%s ok=%s retcode=%u comment=%s",
                                 side, StrategyModeToString(InpStrategyMode), lot, DoubleToString(sl, _Digits),
                                 g_v2_last_sl_mode, g_v2_last_sl_source, g_v2_last_sl_fallback_reason, sl_dist_pts,
                                 g_v2_last_extremum_type, DoubleToString(g_v2_last_extremum_price, _Digits), ext_time_s,
                                 ok ? "true" : "false", g_trade.ResultRetcode(), comment));
      if(ok)
        {
         g_v2_last_entry_bar_time = iTime(_Symbol, PERIOD_M1, 0);
         g_v2_last_entry_direction = direction;
         g_v2_last_entry_bars_total = iBars(_Symbol, PERIOD_M1);
        }
      return ok;
     }

   bool ok = g_trade.Sell(lot, _Symbol, 0.0, sl, 0.0, comment);
   LogWithPrices(StringFormat("[ENTRY-SEND] side=%s mode=%s lot=%.2f sl=%s slMode=%s slSource=%s fallbackReason=%s slDistPts=%.1f extType=%s extPrice=%s extTime=%s ok=%s retcode=%u comment=%s",
                              side, StrategyModeToString(InpStrategyMode), lot, DoubleToString(sl, _Digits),
                              g_v2_last_sl_mode, g_v2_last_sl_source, g_v2_last_sl_fallback_reason, sl_dist_pts,
                              g_v2_last_extremum_type, DoubleToString(g_v2_last_extremum_price, _Digits), ext_time_s,
                              ok ? "true" : "false", g_trade.ResultRetcode(), comment));
   if(ok)
     {
      g_v2_last_entry_bar_time = iTime(_Symbol, PERIOD_M1, 0);
      g_v2_last_entry_direction = direction;
      g_v2_last_entry_bars_total = iBars(_Symbol, PERIOD_M1);
     }
   return ok;
  }

bool ShouldOpenBuyBase(int osma_buy, int ema_buy, bool strong_buy)
  {
   bool allowed = EntryAllowed(1);
   bool result = strong_buy && allowed;
   LogWithPrices(StringFormat("[ENTRY-EVAL][BASE] side=BUY strongBuy=%s osmaBuy=%d emaBuy=%d entryAllowed=%s result=%s",
                              strong_buy ? "true" : "false", osma_buy, ema_buy, allowed ? "true" : "false", result ? "true" : "false"));
   return result;
  }

bool ShouldOpenSellBase(int osma_sell, int ema_sell, bool strong_sell)
  {
   bool allowed = EntryAllowed(-1);
   bool result = strong_sell && allowed;
   LogWithPrices(StringFormat("[ENTRY-EVAL][BASE] side=SELL strongSell=%s osmaSell=%d emaSell=%d entryAllowed=%s result=%s",
                              strong_sell ? "true" : "false", osma_sell, ema_sell, allowed ? "true" : "false", result ? "true" : "false"));
   return result;
  }

TrendDirection GetM1TrendOptionV1()
  {
   if(g_tfs[0].state.ema150_value > g_tfs[0].state.ema200_value) return TREND_UP;
   if(g_tfs[0].state.ema150_value < g_tfs[0].state.ema200_value) return TREND_DOWN;
   return TREND_FLAT;
  }

bool RefreshM1LiveOptionV1MAs()
  {
   double v[];
   ArrayResize(v, 1);

   if(CopyBuffer(g_tfs[0].ma_handles[MA_SMA2], 0, 0, 1, v) != 1) return false;
   g_tfs[0].state.sma2_value = v[0];

   if(CopyBuffer(g_tfs[0].ma_handles[MA_SMA5], 0, 0, 1, v) != 1) return false;
   g_tfs[0].state.sma5_value = v[0];

   if(CopyBuffer(g_tfs[0].ma_handles[MA_EMA150], 0, 0, 1, v) != 1) return false;
   g_tfs[0].state.ema150_value = v[0];

   if(CopyBuffer(g_tfs[0].ma_handles[MA_EMA200], 0, 0, 1, v) != 1) return false;
   g_tfs[0].state.ema200_value = v[0];

   if(CopyBuffer(g_tfs[0].ma_handles[MA_EMA13], 0, 0, 1, v) != 1) return false;
   g_tfs[0].state.ema13_value = v[0];

   if(CopyBuffer(g_tfs[0].ma_handles[MA_EMA34], 0, 0, 1, v) != 1) return false;
   g_tfs[0].state.ema34_value = v[0];

   g_tfs[0].state.optionv1_live_bar_time = iTime(_Symbol, PERIOD_M1, 0);
   return true;
  }

bool IsM1TrendUpOptionV1()
  {
   return GetM1TrendOptionV1() == TREND_UP;
  }

bool IsM1TrendDownOptionV1()
  {
   return GetM1TrendOptionV1() == TREND_DOWN;
  }

bool IsM1NearCrossUpTickSideOptionV1()
  {
   double diff = g_tfs[0].state.ema13_value - g_tfs[0].state.ema34_value;
   return (diff < 0.0 && MathAbs(diff) <= InpOptionV1NearCrossThresholdPoints * _Point);
  }

bool IsM1NearCrossDownTickSideOptionV1()
  {
   double diff = g_tfs[0].state.ema13_value - g_tfs[0].state.ema34_value;
   return (diff > 0.0 && MathAbs(diff) <= InpOptionV1NearCrossThresholdPoints * _Point);
  }

bool IsM1Bar0CrossedEma34UpOptionV1()
  {
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ema34 = g_tfs[0].state.ema34_value;
   return (bid >= ema34);
  }

bool IsM1Bar0CrossedEma34DownOptionV1()
  {
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ema34 = g_tfs[0].state.ema34_value;
   return (bid <= ema34);
  }

bool IsM1AboutToCrossUpTickSideOptionV1()
  {
   return IsM1NearCrossUpTickSideOptionV1() && IsM1Bar0CrossedEma34UpOptionV1();
  }

bool IsM1AboutToCrossDownTickSideOptionV1()
  {
   return IsM1NearCrossDownTickSideOptionV1() && IsM1Bar0CrossedEma34DownOptionV1();
  }

bool EntryAllowedOptionV1(int direction)
  {
   g_v2_entry_block_reason = "NONE";
   g_v2_last_risk_guard_pass = true;
   g_v2_last_cooldown_pass = true;
   g_v2_last_trend_consensus_pass = true;
   g_v2_last_osma_pass = true;

   if(!RiskGuardsAllowEntry())
     {
      LogWithPrices(StringFormat("[ENTRY-BLOCK][OPTIONV1] dir=%s reason=%s", direction > 0 ? "BUY" : "SELL", g_v2_entry_block_reason));
      return false;
     }

   bool first_bar_mode = (InpOptionV1EntryOnFirstBarCloseAfterCross1334 && g_tfs[0].state.bars_after_cross_1334 == 1);
   if(!first_bar_mode)
     {
      if(!EntryCooldownPass(direction))
        {
         g_v2_last_cooldown_pass = false;
         g_v2_entry_block_reason = "ENTRY_COOLDOWN";
         LogWithPrices(StringFormat("[ENTRY-BLOCK][OPTIONV1] dir=%s reason=%s", direction > 0 ? "BUY" : "SELL", g_v2_entry_block_reason));
         return false;
        }
     }

   if(InpV2RequireTrendConsensusM1M5)
     {
      TrendDirection d1 = GetM1TrendOptionV1();
      TrendDirection d5 = g_tfs[1].state.direction;
      bool conflict = (direction > 0 && (d1 == TREND_DOWN || d5 == TREND_DOWN)) ||
                      (direction < 0 && (d1 == TREND_UP || d5 == TREND_UP));
      if(conflict)
        {
         g_v2_last_trend_consensus_pass = false;
         g_v2_entry_block_reason = "TREND_CONSENSUS_FAIL";
         LogWithPrices(StringFormat("[ENTRY-BLOCK][OPTIONV1] dir=%s reason=%s", direction > 0 ? "BUY" : "SELL", g_v2_entry_block_reason));
         return false;
        }
     }

   if(InpV2RequireOsmaAgreementM1)
     {
      double osma0 = GetM1LiveOsmaValue();
      bool osma_ok = (direction > 0 && osma0 >= 0.0) || (direction < 0 && osma0 <= 0.0);
      if(!osma_ok)
        {
         g_v2_last_osma_pass = false;
         g_v2_entry_block_reason = "OSMA_CONFLICT";
         LogWithPrices(StringFormat("[ENTRY-BLOCK][OPTIONV1] dir=%s reason=%s osma=%.5f", direction > 0 ? "BUY" : "SELL", g_v2_entry_block_reason, osma0));
         return false;
        }
     }

   if(InpOptionV1UseOsmaJustCrossBlock)
     {
      if(g_tfs[0].state.osma_just_cross_up || g_tfs[0].state.osma_just_cross_down)
        {
         g_v2_entry_block_reason = "LEGACY_OSMA_JUST_CROSS";
         LogWithPrices(StringFormat("[ENTRY-BLOCK][OPTIONV1] dir=%s reason=M1 OsMA just crossed", direction > 0 ? "BUY" : "SELL"));
         return false;
        }
     }

   if(InpOptionV1UseM1PeakPhaseBlock)
     {
      bool m1_peak_block = g_tfs[0].state.peak_bottom_reached_1334 && !(g_tfs[0].state.phase == PHASE_FLAT_ABOUT_TO_CROSS || g_tfs[0].state.phase == PHASE_RUNNING_CONTINUED);
      if(m1_peak_block)
        {
         g_v2_entry_block_reason = "LEGACY_M1_PEAK_PHASE";
         LogWithPrices(StringFormat("[ENTRY-BLOCK][OPTIONV1] dir=%s reason=M1 peak/phase block", direction > 0 ? "BUY" : "SELL"));
         return false;
        }
     }

   if(InpOptionV1UseM5PeakPhaseBlock)
     {
      bool m5_peak_block = g_tfs[1].state.peak_bottom_reached_1334 && !(g_tfs[1].state.phase == PHASE_FLAT_ABOUT_TO_CROSS || g_tfs[1].state.phase == PHASE_RUNNING_CONTINUED);
      if(m5_peak_block)
        {
         g_v2_entry_block_reason = "LEGACY_M5_PEAK_PHASE";
         LogWithPrices(StringFormat("[ENTRY-BLOCK][OPTIONV1] dir=%s reason=M5 peak/phase block", direction > 0 ? "BUY" : "SELL"));
         return false;
        }
     }

   if(InpOptionV1UseM1M5DirectionBlock)
     {
      if(direction > 0 && g_tfs[0].state.direction == TREND_DOWN && g_tfs[1].state.direction == TREND_DOWN)
        {
         g_v2_entry_block_reason = "LEGACY_M1M5_DIR";
         LogWithPrices("[ENTRY-BLOCK][OPTIONV1] dir=BUY reason=M1+M5 direction both DOWN");
         return false;
        }
      if(direction < 0 && g_tfs[0].state.direction == TREND_UP && g_tfs[1].state.direction == TREND_UP)
        {
         g_v2_entry_block_reason = "LEGACY_M1M5_DIR";
         LogWithPrices("[ENTRY-BLOCK][OPTIONV1] dir=SELL reason=M1+M5 direction both UP");
         return false;
        }
     }

   return true;
  }

bool ShouldOpenBuyOptionV1(int osma_buy, int ema_buy, bool strong_buy)
  {
   if(!RefreshM1LiveOptionV1MAs())
     {
      LogWithPrices(StringFormat("[ENTRY-BLOCK][OPTIONV1] dir=BUY reason=failed-to-refresh-live-m1-mas err=%d", GetLastError()));
      return false;
     }

   bool trend_up = (g_tfs[0].state.ema150_value > g_tfs[0].state.ema200_value);
   bool first_bar_after_cross = (!InpOptionV1EntryOnFirstBarCloseAfterCross1334) ||
                                (g_tfs[0].state.bars_after_cross_1334 == 1 && g_tfs[0].state.direction == TREND_UP);
   bool cross_trigger_up = first_bar_after_cross;
   bool allowed = EntryAllowedOptionV1(1);
   bool result = trend_up && cross_trigger_up && allowed;
   double diff = g_tfs[0].state.ema13_value - g_tfs[0].state.ema34_value;
   LogWithPrices(StringFormat("[ENTRY-EVAL][OPTIONV1] side=BUY trend(150>200)=%s ema150=%s ema200=%s crossTriggerUp=%s firstBarAfterCross=%s barsAfterCross1334=%d ema13=%s ema34=%s diff=%s filters=%s riskGuardPass=%s cooldownPass=%s trendConsensusPass=%s osmaPass=%s blockReason=%s result=%s liveBarTime=%s tickTime=%s emaShift=0",
                              trend_up ? "true" : "false",
                              DoubleToString(g_tfs[0].state.ema150_value, _Digits),
                              DoubleToString(g_tfs[0].state.ema200_value, _Digits),
                              cross_trigger_up ? "true" : "false",
                              first_bar_after_cross ? "true" : "false",
                              g_tfs[0].state.bars_after_cross_1334,
                              DoubleToString(g_tfs[0].state.ema13_value, _Digits),
                              DoubleToString(g_tfs[0].state.ema34_value, _Digits),
                              DoubleToString(diff, _Digits),
                              allowed ? "true" : "false",
                              g_v2_last_risk_guard_pass ? "true" : "false",
                              g_v2_last_cooldown_pass ? "true" : "false",
                              g_v2_last_trend_consensus_pass ? "true" : "false",
                              g_v2_last_osma_pass ? "true" : "false",
                              g_v2_entry_block_reason,
                              result ? "true" : "false",
                              TimeToString(g_tfs[0].state.optionv1_live_bar_time, TIME_DATE|TIME_MINUTES|TIME_SECONDS),
                              TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES|TIME_SECONDS)));
   return result;
  }

bool ShouldOpenSellOptionV1(int osma_sell, int ema_sell, bool strong_sell)
  {
   if(!RefreshM1LiveOptionV1MAs())
     {
      LogWithPrices(StringFormat("[ENTRY-BLOCK][OPTIONV1] dir=SELL reason=failed-to-refresh-live-m1-mas err=%d", GetLastError()));
      return false;
     }

   bool trend_down = (g_tfs[0].state.ema150_value < g_tfs[0].state.ema200_value);
   bool first_bar_after_cross = (!InpOptionV1EntryOnFirstBarCloseAfterCross1334) ||
                                (g_tfs[0].state.bars_after_cross_1334 == 1 && g_tfs[0].state.direction == TREND_DOWN);
   bool cross_trigger_down = first_bar_after_cross;
   bool allowed = EntryAllowedOptionV1(-1);
   bool result = trend_down && cross_trigger_down && allowed;
   double diff = g_tfs[0].state.ema13_value - g_tfs[0].state.ema34_value;
   LogWithPrices(StringFormat("[ENTRY-EVAL][OPTIONV1] side=SELL trend(150<200)=%s ema150=%s ema200=%s crossTriggerDown=%s firstBarAfterCross=%s barsAfterCross1334=%d ema13=%s ema34=%s diff=%s filters=%s riskGuardPass=%s cooldownPass=%s trendConsensusPass=%s osmaPass=%s blockReason=%s result=%s liveBarTime=%s tickTime=%s emaShift=0",
                              trend_down ? "true" : "false",
                              DoubleToString(g_tfs[0].state.ema150_value, _Digits),
                              DoubleToString(g_tfs[0].state.ema200_value, _Digits),
                              cross_trigger_down ? "true" : "false",
                              first_bar_after_cross ? "true" : "false",
                              g_tfs[0].state.bars_after_cross_1334,
                              DoubleToString(g_tfs[0].state.ema13_value, _Digits),
                              DoubleToString(g_tfs[0].state.ema34_value, _Digits),
                              DoubleToString(diff, _Digits),
                              allowed ? "true" : "false",
                              g_v2_last_risk_guard_pass ? "true" : "false",
                              g_v2_last_cooldown_pass ? "true" : "false",
                              g_v2_last_trend_consensus_pass ? "true" : "false",
                              g_v2_last_osma_pass ? "true" : "false",
                              g_v2_entry_block_reason,
                              result ? "true" : "false",
                              TimeToString(g_tfs[0].state.optionv1_live_bar_time, TIME_DATE|TIME_MINUTES|TIME_SECONDS),
                              TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES|TIME_SECONDS)));
   return result;
  }

bool ShouldOpenBuy(StrategyMode mode, int osma_buy, int ema_buy, bool strong_buy)
  {
   if(mode == STRAT_OPTION_V1)
      return ShouldOpenBuyOptionV1(osma_buy, ema_buy, strong_buy);

   return ShouldOpenBuyBase(osma_buy, ema_buy, strong_buy);
  }

bool ShouldOpenSell(StrategyMode mode, int osma_sell, int ema_sell, bool strong_sell)
  {
   if(mode == STRAT_OPTION_V1)
      return ShouldOpenSellOptionV1(osma_sell, ema_sell, strong_sell);

   return ShouldOpenSellBase(osma_sell, ema_sell, strong_sell);
  }

void EvaluateSignalsAndTrade()
  {
   int osma_buy = 0;
   int osma_sell = 0;
   int ema_buy = 0;
   int ema_sell = 0;

   for(int i = 0; i < TF_COUNT; i++)
     {
      if(g_tfs[i].state.osma_just_cross_up || g_tfs[i].state.osma_about_cross_up) osma_buy++;
      if(g_tfs[i].state.osma_just_cross_down || g_tfs[i].state.osma_about_cross_down) osma_sell++;
      if(g_tfs[i].state.ema1334_just_cross_up || g_tfs[i].state.ema1334_about_cross_up) ema_buy++;
      if(g_tfs[i].state.ema1334_just_cross_down || g_tfs[i].state.ema1334_about_cross_down) ema_sell++;
     }

   bool strong_osma_buy = osma_buy >= InpMinAlignedTF;
   bool strong_osma_sell = osma_sell >= InpMinAlignedTF;
   bool strong_ema_buy = ema_buy >= InpMinAlignedTF;
   bool strong_ema_sell = ema_sell >= InpMinAlignedTF;

   bool strong_buy = (strong_osma_buy || strong_ema_buy) && !(strong_osma_sell && strong_ema_sell);
   bool strong_sell = (strong_osma_sell || strong_ema_sell) && !(strong_osma_buy && strong_ema_buy);
   LogWithPrices(StringFormat("[SIGNAL] mode=%s osmaBuy=%d osmaSell=%d emaBuy=%d emaSell=%d strongBuy=%s strongSell=%s",
                              StrategyModeToString(InpStrategyMode),
                              osma_buy, osma_sell, ema_buy, ema_sell,
                              strong_buy ? "true" : "false",
                              strong_sell ? "true" : "false"));

   ManagePositions(strong_buy, strong_sell);

   if(!RiskGuardsAllowEntry())
     {
      LogWithPrices(StringFormat("[ENTRY-BLOCK] reason=%s dd=%.2f float=%.2f load=%.2f openPos=%d",
                                 g_v2_entry_block_reason,
                                 g_v2_current_drawdown_pct,
                                 g_v2_current_floating_loss_pct,
                                 g_v2_current_deposit_load_pct,
                                 g_v2_current_open_positions));
      return;
     }

   bool should_open_buy = ShouldOpenBuy(InpStrategyMode, osma_buy, ema_buy, strong_buy);
   bool should_open_sell = ShouldOpenSell(InpStrategyMode, osma_sell, ema_sell, strong_sell);

   if(should_open_buy)
     {
      string ent = (MathMax(osma_buy, ema_buy) >= 5) ? "LONGTERM_BUY_ALIGN" : "SCALP_BUY_ALIGN";
      string ext = "EXIT_ON_OPPOSITE_STRONG_OR_PHASE_BREAK";
      string sig = IntegerToString(MathMax(osma_buy, ema_buy));
      PlaceEntry(1, ent, ext, sig);
     }

   if(should_open_sell)
     {
      string ent = (MathMax(osma_sell, ema_sell) >= 5) ? "LONGTERM_SELL_ALIGN" : "SCALP_SELL_ALIGN";
      string ext = "EXIT_ON_OPPOSITE_STRONG_OR_PHASE_BREAK";
      string sig = IntegerToString(MathMax(osma_sell, ema_sell));
      PlaceEntry(-1, ent, ext, sig);
     }
  }
string BuildCrossEventJson(const CrossEvent &ev)
  {
   string s = "{";
   s += "\"pair\":\"" + JsonEscape(ev.pair) + "\",";
   s += "\"time\":" + TimeToJson(ev.t) + ",";
   s += "\"price\":" + DoubleToString(ev.price, _Digits) + ",";
   s += "\"direction\":" + IntegerToString(ev.direction) + ",";
   s += "\"barsSincePrev\":" + IntegerToString(ev.bars_since_prev) + ",";
   s += "\"hasExtremum\":" + BoolJson(ev.has_extremum);
   if(ev.has_extremum)
     {
      s += ",\"extremum\":{";
      s += "\"type\":\"" + ev.extremum_type + "\",";
      s += "\"time\":" + TimeToJson(ev.extremum_t) + ",";
      s += "\"price\":" + DoubleToString(ev.extremum_price, _Digits);
      s += "}";
     }
   s += "}";
   return s;
  }

string BuildOsmaEventJson(const OsmaEvent &ev)
  {
   string s = "{";
   s += "\"type\":\"" + JsonEscape(ev.event_type) + "\",";
   s += "\"time\":" + TimeToJson(ev.t) + ",";
   s += "\"value\":" + DoubleToString(ev.value, 8) + ",";
   s += "\"direction\":" + IntegerToString(ev.direction);
   s += "}";
   return s;
  }

string BuildBarStatsJson(const BarStats &b)
  {
   string s = "{";
   s += "\"time\":" + TimeToJson(b.t) + ",";
   s += "\"currentHeight\":" + DoubleToString(b.curr_height, _Digits) + ",";
   s += "\"averageHeight\":" + DoubleToString(b.avg_height, _Digits) + ",";
   s += "\"spike\":" + BoolJson(b.spike) + ",";
   s += "\"atr\":" + DoubleToString(b.atr, _Digits) + ",";
   s += "\"current\":{";
   s += "\"color\":\"" + b.curr_color + "\",";
   s += "\"open\":" + DoubleToString(b.curr_open, _Digits) + ",";
   s += "\"high\":" + DoubleToString(b.curr_high, _Digits) + ",";
   s += "\"low\":" + DoubleToString(b.curr_low, _Digits) + ",";
   s += "\"close\":" + DoubleToString(b.curr_close, _Digits);
   s += "},";
   s += "\"previous\":{";
   s += "\"color\":\"" + b.prev_color + "\",";
   s += "\"height\":" + DoubleToString(b.prev_height, _Digits) + ",";
   s += "\"pctVsPrevBar\":" + DoubleToString(b.pct_vs_prev, 2) + ",";
   s += "\"open\":" + DoubleToString(b.prev_open, _Digits) + ",";
   s += "\"high\":" + DoubleToString(b.prev_high, _Digits) + ",";
   s += "\"low\":" + DoubleToString(b.prev_low, _Digits) + ",";
   s += "\"close\":" + DoubleToString(b.prev_close, _Digits);
   s += "}";
   s += "}";
   return s;
  }

void WriteJsonState()
  {
   RefreshV2RiskState();

   string json = "{";

   json += "\"meta\":{";
   json += "\"symbol\":\"" + JsonEscape(_Symbol) + "\",";
   json += "\"magic\":" + IntegerToString(InpMagic) + ",";
   json += "\"dryRun\":" + BoolJson(InpDryRun) + ",";
   json += "\"strategyMode\":\"" + StrategyModeToString(InpStrategyMode) + "\",";
   json += "\"optionV1\":{";
   json += "\"m1Trend\":\"" + TrendToString(GetM1TrendOptionV1()) + "\",";
   json += "\"nearCrossThresholdPoints\":" + DoubleToString(InpOptionV1NearCrossThresholdPoints, 1) + ",";
   json += "\"aboutToCrossUpTickSide\":" + BoolJson(IsM1AboutToCrossUpTickSideOptionV1()) + ",";
   json += "\"aboutToCrossDownTickSide\":" + BoolJson(IsM1AboutToCrossDownTickSideOptionV1()) + ",";
   json += "\"useOsmaBlock\":" + BoolJson(InpOptionV1UseOsmaJustCrossBlock) + ",";
   json += "\"useM1PeakPhaseBlock\":" + BoolJson(InpOptionV1UseM1PeakPhaseBlock) + ",";
   json += "\"useM5PeakPhaseBlock\":" + BoolJson(InpOptionV1UseM5PeakPhaseBlock) + ",";
   json += "\"useDirectionBlock\":" + BoolJson(InpOptionV1UseM1M5DirectionBlock);
   json += "},";
   json += "\"v2Risk\":{";
   json += "\"enabled\":" + BoolJson(InpV2EnableRiskGuard) + ",";
   json += "\"maxEquityDrawdownPct\":" + DoubleToString(InpV2MaxEquityDrawdownPct, 2) + ",";
   json += "\"maxFloatingLossPct\":" + DoubleToString(InpV2MaxFloatingLossPct, 2) + ",";
   json += "\"maxDepositLoadPct\":" + DoubleToString(InpV2MaxDepositLoadPct, 2) + ",";
   json += "\"maxOpenPositions\":" + IntegerToString(InpV2MaxOpenPositions) + ",";
   json += "\"entryCooldownBarsM1\":" + IntegerToString(InpV2EntryCooldownBarsM1) + ",";
   json += "\"requireTrendConsensusM1M5\":" + BoolJson(InpV2RequireTrendConsensusM1M5) + ",";
   json += "\"requireOsmaAgreementM1\":" + BoolJson(InpV2RequireOsmaAgreementM1) + ",";
    json += "\"initialSlMode\":\"" + InitialSlModeToString(InpInitialSlMode) + "\",";
   json += "\"initialSlAtrMult\":" + DoubleToString(InpV2InitialSlAtrMult, 2) + ",";
   json += "\"extremumFallbackAtrMult\":" + DoubleToString(InpExtremumFallbackAtrMult, 2) + ",";
   json += "\"extremumLookbackEvents\":" + IntegerToString(InpExtremumLookbackEvents) + ",";
   json += "\"timeStopBarsM1\":" + IntegerToString(InpV2TimeStopBarsM1) + ",";
   json += "\"autoCloseOnGuardBreach\":" + BoolJson(InpV2AutoCloseOnGuardBreach) + ",";
   json += "\"useDynamicLotCap\":" + BoolJson(InpV2UseDynamicLotCap) + ",";
   json += "\"maxLotByEquity\":" + DoubleToString(InpV2MaxLotByEquity, 2);
   json += "},";
   json += "\"updatedAt\":" + TimeToJson(TimeCurrent()) + ",";
   json += "\"recommendation\":\"" + JsonEscape(g_last_recommendation) + "\"";
   json += "},";

   json += "\"historical\":{";

   json += "\"ema150_200_d1_crosses\":[";
   for(int i = 0; i < g_d1_150200_count; i++)
     {
      if(i > 0) json += ",";
      json += BuildCrossEventJson(g_d1_150200_crosses[i]);
     }
   json += "],";

   json += "\"per_tf\":{";
   for(int tfi = 0; tfi < TF_COUNT; tfi++)
     {
      if(tfi > 0) json += ",";
      json += "\"" + g_tfs[tfi].tf_name + "\":{";

      json += "\"crosses\":[";
      int c_start = MathMax(0, g_tfs[tfi].cross_count - 10);
      for(int i = c_start; i < g_tfs[tfi].cross_count; i++)
        {
         if(i > c_start) json += ",";
         json += BuildCrossEventJson(g_tfs[tfi].cross_events[i]);
        }
      json += "],";

      json += "\"osmaEvents\":[";
      int o_start = MathMax(0, g_tfs[tfi].osma_count - 10);
      for(int i = o_start; i < g_tfs[tfi].osma_count; i++)
        {
         if(i > o_start) json += ",";
         json += BuildOsmaEventJson(g_tfs[tfi].osma_events[i]);
        }
      json += "],";

      json += "\"barStats\":" + BuildBarStatsJson(g_tfs[tfi].state.bars);
      json += "}";
     }
   json += "}";

   json += "},";

   json += "\"live\":{";
   json += "\"per_tf_state\":{";
   for(int tfi = 0; tfi < TF_COUNT; tfi++)
     {
      if(tfi > 0) json += ",";
      json += "\"" + g_tfs[tfi].tf_name + "\":{";
      json += "\"direction\":\"" + TrendToString(g_tfs[tfi].state.direction) + "\",";
      json += "\"phase\":\"" + PhaseToString(g_tfs[tfi].state.phase) + "\",";
      json += "\"directionStabilized\":" + BoolJson(g_tfs[tfi].state.direction_stabilized) + ",";
      json += "\"ema1334AboutScore\":" + DoubleToString(g_tfs[tfi].state.ema1334_about_score, 4) + ",";
      json += "\"osmaAboutScore\":" + DoubleToString(g_tfs[tfi].state.osma_about_score, 4) + ",";
      json += "\"barsAfterCross1334\":" + IntegerToString(g_tfs[tfi].state.bars_after_cross_1334) + ",";
      json += "\"barsAfterCross150200\":" + IntegerToString(g_tfs[tfi].state.bars_after_cross_150200) + ",";
      json += "\"barPosVsMAs\":{";
      for(int m = 0; m < MA_COUNT; m++)
        {
         if(m > 0) json += ",";
         json += "\"" + MA_NAMES[m] + "\":" + IntegerToString(g_tfs[tfi].state.bar_pos_vs_ma[m]);
        }
      json += "}";
      json += "}";
     }
   json += "},";
   int osma_buy = 0;
   int osma_sell = 0;
   int ema_buy = 0;
   int ema_sell = 0;

   json += "\"signals\":{";
   json += "\"aligned\":{";

   string osma_buy_tfs = "";
   string osma_sell_tfs = "";
   string ema_buy_tfs = "";
   string ema_sell_tfs = "";

   for(int i = 0; i < TF_COUNT; i++)
     {
      if(g_tfs[i].state.osma_just_cross_up || g_tfs[i].state.osma_about_cross_up)
        {
         osma_buy++;
         if(osma_buy_tfs != "") osma_buy_tfs += ",";
         osma_buy_tfs += g_tfs[i].tf_name;
        }
      if(g_tfs[i].state.osma_just_cross_down || g_tfs[i].state.osma_about_cross_down)
        {
         osma_sell++;
         if(osma_sell_tfs != "") osma_sell_tfs += ",";
         osma_sell_tfs += g_tfs[i].tf_name;
        }

      if(g_tfs[i].state.ema1334_just_cross_up || g_tfs[i].state.ema1334_about_cross_up)
        {
         ema_buy++;
         if(ema_buy_tfs != "") ema_buy_tfs += ",";
         ema_buy_tfs += g_tfs[i].tf_name;
        }
      if(g_tfs[i].state.ema1334_just_cross_down || g_tfs[i].state.ema1334_about_cross_down)
        {
         ema_sell++;
         if(ema_sell_tfs != "") ema_sell_tfs += ",";
         ema_sell_tfs += g_tfs[i].tf_name;
        }
     }

   json += "\"osmaBuy\":" + IntegerToString(osma_buy) + ",";
   json += "\"osmaSell\":" + IntegerToString(osma_sell) + ",";
   json += "\"emaBuy\":" + IntegerToString(ema_buy) + ",";
   json += "\"emaSell\":" + IntegerToString(ema_sell);
   json += "},";

   json += "\"strong\":{";
   json += "\"osmaBuy\":" + BoolJson(osma_buy >= InpMinAlignedTF) + ",";
   json += "\"osmaSell\":" + BoolJson(osma_sell >= InpMinAlignedTF) + ",";
   json += "\"emaBuy\":" + BoolJson(ema_buy >= InpMinAlignedTF) + ",";
   json += "\"emaSell\":" + BoolJson(ema_sell >= InpMinAlignedTF);
   json += "},";

   json += "\"tfLists\":{";
   json += "\"osmaBuy\":\"" + osma_buy_tfs + "\",";
   json += "\"osmaSell\":\"" + osma_sell_tfs + "\",";
   json += "\"emaBuy\":\"" + ema_buy_tfs + "\",";
   json += "\"emaSell\":\"" + ema_sell_tfs + "\"";
   json += "}";
   json += "},";

   json += "\"risk\":{";
   json += "\"equityPeak\":" + DoubleToString(g_v2_equity_peak, 2) + ",";
   json += "\"currentEquity\":" + DoubleToString(g_v2_current_equity, 2) + ",";
   json += "\"drawdownPct\":" + DoubleToString(g_v2_current_drawdown_pct, 2) + ",";
   json += "\"floatingProfit\":" + DoubleToString(g_v2_current_floating_profit, 2) + ",";
   json += "\"floatingLossPct\":" + DoubleToString(g_v2_current_floating_loss_pct, 2) + ",";
   json += "\"depositLoadPct\":" + DoubleToString(g_v2_current_deposit_load_pct, 2) + ",";
   json += "\"openPositions\":" + IntegerToString(g_v2_current_open_positions) + ",";
   json += "\"guardBreached\":" + BoolJson(g_v2_guard_breached) + ",";
   json += "\"guardReason\":\"" + JsonEscape(g_v2_guard_reason) + "\"";
   json += "},";

   json += "\"entryGate\":{";
   json += "\"riskGuardPass\":" + BoolJson(g_v2_last_risk_guard_pass) + ",";
   json += "\"cooldownPass\":" + BoolJson(g_v2_last_cooldown_pass) + ",";
   json += "\"trendConsensusPass\":" + BoolJson(g_v2_last_trend_consensus_pass) + ",";
   json += "\"osmaPass\":" + BoolJson(g_v2_last_osma_pass) + ",";
   json += "\"blockReason\":\"" + JsonEscape(g_v2_entry_block_reason) + "\",";
   json += "\"lastSlMode\":\"" + JsonEscape(g_v2_last_sl_mode) + "\",";
   json += "\"lastSlSource\":\"" + JsonEscape(g_v2_last_sl_source) + "\",";
   json += "\"lastSlFallbackReason\":\"" + JsonEscape(g_v2_last_sl_fallback_reason) + "\",";
   json += "\"lastSlPrice\":" + DoubleToString(g_v2_last_sl_price, _Digits) + ",";
   json += "\"lastExtremum\":{";
   json += "\"type\":\"" + JsonEscape(g_v2_last_extremum_type) + "\",";
   json += "\"time\":" + TimeToJson(g_v2_last_extremum_time) + ",";
   json += "\"price\":" + DoubleToString(g_v2_last_extremum_price, _Digits);
   json += "},";
   json += "\"lastEntryBarTime\":" + TimeToJson(g_v2_last_entry_bar_time) + ",";
   json += "\"lastEntryDirection\":" + IntegerToString(g_v2_last_entry_direction);
   json += "},";

   json += "\"bar_monitor\":{";
   json += "\"previous_bar\":{";
   json += "\"color\":\"" + g_tfs[0].state.bars.prev_color + "\",";
   json += "\"height\":" + DoubleToString(g_tfs[0].state.bars.prev_height, _Digits) + ",";
   json += "\"open\":" + DoubleToString(g_tfs[0].state.bars.prev_open, _Digits) + ",";
   json += "\"high\":" + DoubleToString(g_tfs[0].state.bars.prev_high, _Digits) + ",";
   json += "\"low\":" + DoubleToString(g_tfs[0].state.bars.prev_low, _Digits) + ",";
   json += "\"close\":" + DoubleToString(g_tfs[0].state.bars.prev_close, _Digits);
   json += "},";
   json += "\"current_bar\":{";
   json += "\"color\":\"" + g_tfs[0].state.bars.curr_color + "\",";
   json += "\"height\":" + DoubleToString(g_tfs[0].state.bars.curr_height, _Digits) + ",";
   json += "\"pctVsPrevBar\":" + DoubleToString(g_tfs[0].state.bars.pct_vs_prev, 2) + ",";
   json += "\"open\":" + DoubleToString(g_tfs[0].state.bars.curr_open, _Digits) + ",";
   json += "\"high\":" + DoubleToString(g_tfs[0].state.bars.curr_high, _Digits) + ",";
   json += "\"low\":" + DoubleToString(g_tfs[0].state.bars.curr_low, _Digits) + ",";
   json += "\"close\":" + DoubleToString(g_tfs[0].state.bars.curr_close, _Digits);
   json += "}";
   json += "}";

   json += "},";

   json += "\"positions\":{";
   json += "\"open\":[";
   bool first_pos = true;
   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))
         continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol)
         continue;
      if((int)PositionGetInteger(POSITION_MAGIC) != InpMagic)
         continue;

      if(!first_pos) json += ",";
      first_pos = false;

      json += "{";
      json += "\"ticket\":" + IntegerToString((int)ticket) + ",";
      json += "\"type\":" + IntegerToString((int)PositionGetInteger(POSITION_TYPE)) + ",";
      json += "\"profit\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2) + ",";
      json += "\"comment\":\"" + JsonEscape(PositionGetString(POSITION_COMMENT)) + "\"";
      json += "}";
     }
   json += "],";

   json += "\"reassessments\":[";
   for(int i = 0; i < g_reassess_count; i++)
     {
      if(i > 0) json += ",";
      json += "{";
      json += "\"time\":" + TimeToJson(g_reassess[i].t) + ",";
      json += "\"symbol\":\"" + JsonEscape(g_reassess[i].symbol) + "\",";
      json += "\"positionTicket\":" + IntegerToString((int)g_reassess[i].position_ticket) + ",";
      json += "\"reason\":\"" + JsonEscape(g_reassess[i].reason) + "\",";
      json += "\"previousSid\":\"" + JsonEscape(g_reassess[i].previous_sid) + "\",";
      json += "\"newSid\":\"" + JsonEscape(g_reassess[i].new_sid) + "\"";
      json += "}";
     }
   json += "]";
   json += "}";

   json += "}";

   int h = FileOpen(InpJsonFile, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
     {
      LogWithPrices(StringFormat("Failed to open JSON file: %s err=%d", InpJsonFile, GetLastError()));
      return;
     }

   FileWriteString(h, json);
   FileClose(h);
  }
bool UpdateTimeframe(int tf_idx)
  {
   MqlRates rates[];
   if(!LoadRates(g_tfs[tf_idx].tf, 8, rates))
      return false;

   datetime closed_bar_time = rates[1].time;
   if(g_tfs[tf_idx].last_bar_time == closed_bar_time)
      return false;

   g_tfs[tf_idx].last_bar_time = closed_bar_time;

   double ma_vals[MA_COUNT][8];
   for(int m = 0; m < MA_COUNT; m++)
     {
      double tmp[];
      if(!LoadBuffer(g_tfs[tf_idx].ma_handles[m], 8, tmp))
         return false;
      for(int j = 0; j < 8; j++)
         ma_vals[m][j] = tmp[j];
     }

   double osma[];
   if(!LoadBuffer(g_tfs[tf_idx].osma_handle, 8, osma))
      return false;

   double atr_buf[];
   if(!LoadBuffer(g_tfs[tf_idx].atr_handle, 8, atr_buf))
      return false;

   if(g_tfs[tf_idx].state.bars_after_cross_1334 >= 0)
      g_tfs[tf_idx].state.bars_after_cross_1334++;
   if(g_tfs[tf_idx].state.bars_after_cross_150200 >= 0)
      g_tfs[tf_idx].state.bars_after_cross_150200++;

   DetectCrosses(tf_idx, ma_vals, rates);
   UpdateCrossExtremums(tf_idx, rates);
   DetectOsma(tf_idx, osma, rates);

   ComputeEma1334State(tf_idx, ma_vals);
   ComputeOsmaState(tf_idx, osma);
   ComputeBarStats(tf_idx, rates, atr_buf[1], ma_vals);
   g_tfs[tf_idx].state.sma2_value = ma_vals[MA_SMA2][1];
   g_tfs[tf_idx].state.sma5_value = ma_vals[MA_SMA5][1];
   g_tfs[tf_idx].state.ema150_value = ma_vals[MA_EMA150][1];
   g_tfs[tf_idx].state.ema200_value = ma_vals[MA_EMA200][1];
   g_tfs[tf_idx].state.ema13_value = ma_vals[MA_EMA13][1];
   g_tfs[tf_idx].state.ema34_value = ma_vals[MA_EMA34][1];

   return true;
  }

int OnInit()
  {
   g_trade.SetExpertMagicNumber(InpMagic);
   g_v2_current_equity = AccountInfoDouble(ACCOUNT_EQUITY);
   g_v2_equity_peak = g_v2_current_equity;
   g_v2_entry_block_reason = "NONE";
   g_v2_guard_reason = "NONE";
   g_v2_last_entry_bar_time = 0;
   g_v2_last_entry_direction = 0;
   g_v2_last_entry_bars_total = -1;

   for(int i = 0; i < TF_COUNT; i++)
     {
      g_tfs[i].tf = TF_VALUES[i];
      g_tfs[i].tf_name = TF_NAMES[i];
      g_tfs[i].osma_handle = INVALID_HANDLE;
      g_tfs[i].atr_handle = INVALID_HANDLE;
      g_tfs[i].cross_count = 0;
      g_tfs[i].osma_count = 0;
      g_tfs[i].last_bar_time = 0;
      g_tfs[i].state.direction = TREND_FLAT;
      g_tfs[i].state.previous_direction = TREND_FLAT;
      g_tfs[i].state.phase = PHASE_RUNNING;
      g_tfs[i].state.direction_stable_bars = 0;
      g_tfs[i].state.bars_after_cross_1334 = -1;
      g_tfs[i].state.bars_after_cross_150200 = -1;
      g_tfs[i].state.peak_bottom_reached_1334 = false;
      g_tfs[i].state.peak_bottom_type_1334 = "";
      g_tfs[i].state.bars.avg_height = 0.0;
      g_tfs[i].state.sma2_value = 0.0;
      g_tfs[i].state.sma5_value = 0.0;
      g_tfs[i].state.ema150_value = 0.0;
      g_tfs[i].state.ema200_value = 0.0;
      g_tfs[i].state.ema13_value = 0.0;
      g_tfs[i].state.ema34_value = 0.0;
      g_tfs[i].state.optionv1_live_bar_time = 0;

      for(int a = 0; a < MA_COUNT; a++)
        {
         for(int b = 0; b < MA_COUNT; b++)
           {
            g_tfs[i].last_cross_bars_total[a][b] = -1;
            g_tfs[i].last_cross_time[a][b] = 0;
           }
        }

      for(int m = 0; m < MA_COUNT; m++)
        {
         g_tfs[i].ma_handles[m] = iMA(_Symbol, g_tfs[i].tf, MA_PERIODS[m], 0, MA_METHODS[m], PRICE_CLOSE);
         if(g_tfs[i].ma_handles[m] == INVALID_HANDLE)
           {
            LogWithPrices(StringFormat("Failed iMA handle tf=%s ma=%s err=%d", g_tfs[i].tf_name, MA_NAMES[m], GetLastError()));
            return INIT_FAILED;
           }
        }

      g_tfs[i].osma_handle = iOsMA(_Symbol, g_tfs[i].tf, InpOsmaFast, InpOsmaSlow, InpOsmaSignal, PRICE_CLOSE);
      if(g_tfs[i].osma_handle == INVALID_HANDLE)
        {
         LogWithPrices(StringFormat("Failed iOsMA handle tf=%s err=%d", g_tfs[i].tf_name, GetLastError()));
         return INIT_FAILED;
        }

      g_tfs[i].atr_handle = iATR(_Symbol, g_tfs[i].tf, InpAtrPeriod);
      if(g_tfs[i].atr_handle == INVALID_HANDLE)
        {
         LogWithPrices(StringFormat("Failed iATR handle tf=%s err=%d", g_tfs[i].tf_name, GetLastError()));
         return INIT_FAILED;
        }
     }

   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   for(int i = 0; i < TF_COUNT; i++)
     {
      for(int m = 0; m < MA_COUNT; m++)
        {
         if(g_tfs[i].ma_handles[m] != INVALID_HANDLE)
            IndicatorRelease(g_tfs[i].ma_handles[m]);
        }

      if(g_tfs[i].osma_handle != INVALID_HANDLE)
         IndicatorRelease(g_tfs[i].osma_handle);
      if(g_tfs[i].atr_handle != INVALID_HANDLE)
         IndicatorRelease(g_tfs[i].atr_handle);
     }
  }

void OnTick()
  {
   bool changed = false;
   for(int i = 0; i < TF_COUNT; i++)
     {
      if(UpdateTimeframe(i))
         changed = true;
     }

   if(changed)
     {
      EvaluateSignalsAndTrade();
      WriteJsonState();
     }
  }
