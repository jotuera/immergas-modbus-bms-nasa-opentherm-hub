// "Kalibracja / Calibration": the key boiler + heat-pump parameters in three columns - the model value for a heat pump
// with underfloor heating, the value set now, and a recommendation computed from live data:
//  - compressor cycles of the last 24 h (hub "Operating state" history: CH starts per hour, median run length),
//  - rooms with their own thermostats (climate entities, option `rooms`, otherwise detected): how far below target.
// A differing recommendation has a two-tap "Set" button. Options: max_floor_entity (shared with the curve card),
// rooms, cheap_hours - cheaper tariff windows, e.g. "13:00-15:00,22:00-06:00" (G12), used for the DHW schedule
// (default: the hub's "Cheap tariff hours"), optimized_since (default: the hub's "Compare from"), variant combo / pro, design_outdoor
// (design outdoor temperature for the building heat loss row, default -18).
// Schedules: CH - with room thermostats a fixed setpoint (MANUAL) suits a slow floor best, otherwise AUTO with Eco at
// most 1 K under Comfort; DHW - the calendar used on most days should heat inside the cheap windows (or in 1-2 short
// windows when no tariff is given).
import { hubNote, HubCard, html, css, nothing, c, ca, register } from "../base";
import { Key } from "../names";
import { Seg, segments, median, isIdle, isDhw, isDefrost, hasBoiler, hpHeating } from "./timers";

type Row = {
  k?: Key; entity?: string; code: string; name: [string, string]; unit: string; d?: number;
  model: number | string; why: [string, string];
  rec: number | string; reason: [string, string];
  kind?: "number" | "select" | "switch" | "info" | "custom"; value?: number | string; ok?: boolean;
  labels?: Record<string, string>; setFn?: (v: string) => void; has?: boolean; group?: string;
};

const H = 3600e3;
const stStart = (x: any): number => (typeof x.start === "number" ? x.start : Date.parse(x.start));
/** hours of [a, b) that have a row in every listed statistic. A statistic with a longer history (merged, imported)
 *  must not be divided by the shorter ones; a statistic with no rows at all is ignored */
const commonHours = (r: any, ids: string[], a: number, b: number): Set<number> => {
  const sets = ids.filter((id) => r[id]?.length).map((id) => new Set<number>(r[id].map(stStart).filter((t: number) => t >= a && t < b)));
  return new Set<number>(sets.length ? [...sets[0]].filter((t) => sets.every((x) => x.has(t))) : []);
};
/** totals of one comparison period from the hourly long-term statistics */
type Period = { from: number; h: number; hdd: number; elec: number; gas: number; heat: number; starts: number; run: number; out: number };
/** totals of one comparison period for Immergas Dominus (+ optional energy meters from the card options) */
type DomPeriod = { from: number; h: number; hdd: number; out: number; chH: number; starts: number; dhw: number; dev: number; elec: number; gas: number };
const GROUPS: [string, string, string][] = [
  ["cyc", "Taktowanie", "Cycling"], ["use", "Sposób pracy", "How it runs"], ["ch", "Ogrzewanie i krzywa", "Heating and curve"],
  ["dhw", "Ciepła woda", "Hot water"], ["pump", "Pompa obiegowa", "Circulation pump"], ["int", "Współpraca z kotłem", "Boiler integration"],
  ["cool", "Chłodzenie", "Cooling"], ["other", "Pozostałe", "Other"],
];
/** last night-mode window: start/end, mean outdoor temperature, median room change, compressor share of the window */
type Night = { t0: number; t1: number; out: number; dRoom: number; run: number; n: number; learned: boolean };
/** findings from 24 h of history that the boiler display does not show */
type Hidden = {
  defrosts: number; outMean: number;      // defrost cycles (5-min gaps merged) and mean outdoor temperature
  evap: number;                           // median outdoor - evaporator (D74) while the compressor runs, K
  standby: number;                        // median electrical power with the compressor stopped, W
  tankLoss: number; tankHours: number;    // cylinder cooling without DHW heating at night, K/h, and over how long
  gasWarm: number;                        // minutes of gas space heating above I10 + 2 K
  dischargeMax: number;                   // highest discharge temperature (D73) while running, °C
};

/** a room thermostat that heated most of the last 24 h and still only holds its target: its loop gets too little water */
type Starved = { id: string; share: number };

class ImmergasCalibrationCard extends HubCard {
  private hist: { at: number; st: Seg[]; night?: Night | null; dT?: number; flow?: number; pw?: number; lpm?: number; starved?: Starved[]; x?: Hidden } | null = null;
  private eff: { at: number; split: number; t0: number; before: Period; after: Period } | null = null;
  private effLoading = false;
  /** Immergas Dominus before / after: no energy on the bus, so heating hours, starts and room deviation per period */
  private effDom: { at: number; split: number; t0: number; before: DomPeriod; after: DomPeriod } | null = null;
  /** building heat loss: one point per full heating day [indoor - outdoor K, heat kWh] from the daily statistics */
  private loss: { at: number; pts: [number, number][] } | null = null;
  private lossLoading = false;
  private loading = false;

  getCardSize() { return 8; }

  private async load() {
    if (this.loading || !this.idx) return;
    this.loading = true;
    try {
      const end = Date.now(), id = this.eid("state"), i1 = this.eid("tw1"), i2 = this.eid("tw2"), ip = this.eid("heat_power"), iq = this.eid("d14");
      const r = id ? await this.hass.callWS({ type: "history/history_during_period", start_time: new Date(end - 24 * H).toISOString(),
        end_time: new Date(end).toISOString(), entity_ids: [id, i1, i2, ip, iq].filter(Boolean), minimal_response: true, no_attributes: true, significant_changes_only: false }) : {};
      const st = segments(r[id ?? ""] ?? [], end);
      // flow - return while the heat pump heats CH, skipping the first minute of every run
      const num = (e?: string) => (r[e ?? ""] ?? []).map((x: any) => [Math.round((x.lc ?? x.lu ?? 0) * 1000), parseFloat(x.s)] as [number, number]).filter((x: [number, number]) => !isNaN(x[1]));
      const p1 = num(i1), p2 = num(i2), pp = num(ip), pq = num(iq);
      const at = (pts: [number, number][], t: number) => { let v = NaN; for (const [tt, vv] of pts) { if (tt <= t) v = vv; else break; } return v; };
      const dts: number[] = [], fls: number[] = [], pws: number[] = [], lps: number[] = [];
      for (const g of st) if (hpHeating(g.s))
        for (let t = g.t0 + 60e3; t < g.t1; t += 30e3) {
          const a = at(p2, t), b = at(p1, t), w = at(pp, t), q = at(pq, t);
          if (!isNaN(a) && !isNaN(b)) { dts.push(a - b); fls.push(a); }
          if (w > 0) pws.push(w);
          if (q > 0) lps.push(q);
        }
      const x = await this.loadHidden(end, st).catch(() => undefined);
      this.hist = { at: end, st, night: await this.lastNight(end, st).catch(() => null), dT: dts.length ? median(dts) : NaN, flow: fls.length ? median(fls) : NaN,
        pw: pws.length ? median(pws) : NaN, lpm: lps.length ? median(lps) : NaN, starved: await this.starved(end).catch(() => []), x };
    } catch { this.hist = { at: Date.now(), st: [] }; }
    this.loading = false;
    this.requestUpdate();
  }

  /** start of the before / after comparison: option optimized_since, else the hub's "Compare from" (NaN when unset) */
  private since(): number {
    const v = Date.parse(String(this.config.optimized_since ?? this.s("compare_since") ?? "").replace(" ", "T"));
    return v > Date.UTC(2020, 0, 1) ? v : NaN;
  }
  /** cheaper tariff windows "HH:MM-HH:MM,...": option cheap_hours, else the hub's "Cheap tariff hours" */
  private get cheapHours(): string {
    const v = this.config.cheap_hours ?? this.s("cheap_hours") ?? "";
    return this.bad("cheap_hours") && !this.config.cheap_hours ? "" : String(v);
  }

  /** before / after comparison: option optimized_since (date-time of the change), else the last 7 days against the
   *  7 days before; both periods at most 7 days long, from hourly statistics */
  private async loadEff() {
    if (this.effLoading || !this.idx) return;
    this.effLoading = true;
    try {
      const now = Date.now(), cfg = this.since();
      const split = !isNaN(cfg) && cfg < now ? cfg : now - 7 * 24 * H, t0 = split - 7 * 24 * H;
      const keys: Key[] = ["elec_total", "gas_total", "heat_total", "starts", "run_total", "outdoor"];
      const ids = keys.map((k) => this.eid(k)).filter(Boolean) as string[];
      const r = await this.hass.callWS({ type: "recorder/statistics_during_period", start_time: new Date(t0).toISOString(), end_time: new Date(now).toISOString(),
        statistic_ids: ids, period: "hour", types: ["change", "mean"], units: {} });
      const per = (a: number, b: number): Period => {
        const hours = commonHours(r, ids, a, b), inPeriod = (x: any) => hours.has(stStart(x));
        const p: Period = { from: hours.size ? Math.min(...hours) : a, h: hours.size, hdd: 0, elec: 0, gas: 0, heat: 0, starts: 0, run: 0, out: NaN };
        const sum = (k: Key) => (r[this.eid(k) ?? ""] ?? []).filter(inPeriod).reduce((acc: number, x: any) => acc + (x.change ?? 0), 0);
        const outs = (r[this.eid("outdoor") ?? ""] ?? []).filter((x: any) => inPeriod(x) && x.mean !== null);
        p.hdd = outs.reduce((acc: number, x: any) => acc + Math.max(0, 18 - x.mean) / 24, 0);
        p.out = outs.length ? outs.reduce((acc: number, x: any) => acc + x.mean, 0) / outs.length : NaN;
        p.elec = sum("elec_total"); p.gas = sum("gas_total"); p.heat = sum("heat_total"); p.starts = sum("starts"); p.run = sum("run_total");
        return p;
      };
      this.eff = { at: now, split, t0, before: per(t0, split), after: per(split, now) };
    } catch { this.eff = null; }
    this.effLoading = false;
    this.requestUpdate();
  }

  /** daily heat (heat pump + boiler gas) against indoor - outdoor for the last 60 days; days warmer than 15 °C outside,
   *  the first (partial) day and today are left out */
  private async loadLoss() {
    if (this.lossLoading || !this.idx || !this.eid("heat_total") || !this.eid("outdoor")) return;
    this.lossLoading = true;
    try {
      const now = Date.now(), keys: Key[] = ["heat_total", "gas_total", "outdoor", "zone1"];
      const r = await this.hass.callWS({ type: "recorder/statistics_during_period", start_time: new Date(now - 60 * 24 * H).toISOString(),
        end_time: new Date(now).toISOString(), statistic_ids: keys.map((k) => this.eid(k)).filter(Boolean), period: "day", types: ["change", "mean"], units: {} });
      const by = (k: Key) => new Map<number, any>((r[this.eid(k) ?? ""] ?? []).map((x: any) => [typeof x.start === "number" ? x.start : Date.parse(x.start), x]));
      const heat = by("heat_total"), gas = by("gas_total"), out = by("outdoor"), zone = by("zone1");
      const pg = this.n("price_gas"), kg = this.n("gas_cost"), gasKwh = pg > 0 && kg > 0 ? pg / kg : 10.6;
      const days = [...heat.keys()].sort((a, b) => a - b).slice(1).filter((t) => t + 24 * H <= now);
      const pts: [number, number][] = [];
      for (const t of days) {
        const o = out.get(t)?.mean, tin = zone.get(t)?.mean ?? 21;
        if (o === undefined || o === null || o > 15) continue;
        pts.push([tin - o, (heat.get(t)?.change ?? 0) + (gas.get(t)?.change ?? 0) * gasKwh]);
      }
      this.loss = { at: now, pts };
    } catch { this.loss = { at: Date.now(), pts: [] }; }
    this.lossLoading = false;
    this.requestUpdate();
  }

  /** Immergas Dominus before / after: heating hours (ch_heating_time_today), CH starts, DHW cycles, room deviation and
   *  the outdoor mean from hourly statistics; options energy_entity (kWh) / gas_entity (m3) add metered energy */
  private async loadEffDom() {
    if (this.effLoading || !this.idx || !this.eid("dom_ch_time_today")) return;
    this.effLoading = true;
    try {
      const now = Date.now(), cfg = this.since();
      const split = !isNaN(cfg) && cfg < now ? cfg : now - 7 * 24 * H, t0 = split - 7 * 24 * H;
      const keys: Key[] = ["dom_ch_time_today", "dom_starts_today", "dom_dhw_cycles", "dom_room_dev", "dom_dd_today", "outdoor"];
      const extra = [this.config.energy_entity, this.config.gas_entity].filter((x) => typeof x === "string" && x) as string[];
      const ids = [...keys.map((k) => this.eid(k)).filter(Boolean) as string[], ...extra];
      const r = await this.hass.callWS({ type: "recorder/statistics_during_period", start_time: new Date(t0).toISOString(), end_time: new Date(now).toISOString(),
        statistic_ids: ids, period: "hour", types: ["change", "mean"], units: {} });
      const per = (a: number, b: number): DomPeriod => {
        // the outdoor mean counts only where it exists at all in this period: before 1.5.4 Dominus kept no outdoor statistics
        const outId = this.eid("outdoor"), hasOut = !!outId && (r[outId] ?? []).some((x: any) => stStart(x) >= a && stStart(x) < b);
        const need = [this.eid("dom_ch_time_today"), this.eid("dom_starts_today"), ...extra, ...(hasOut ? [outId] : [])].filter(Boolean) as string[];
        const hours = commonHours(r, need, a, b);
        const pts = (id?: string) => (r[id ?? ""] ?? []).filter((x: any) => hours.has(stStart(x)));
        const sum = (id?: string) => pts(id).reduce((acc: number, x: any) => acc + Math.max(0, x.change ?? 0), 0);
        const means = (id?: string) => pts(id).filter((x: any) => x.mean !== null && x.mean !== undefined).map((x: any) => x.mean as number);
        const outs = means(this.eid("outdoor")), devs = means(this.eid("dom_room_dev"));
        return {
          from: hours.size ? Math.min(...hours) : a, h: hours.size, out: outs.length ? outs.reduce((x, y) => x + y, 0) / outs.length : NaN,
          // degree days from the outdoor mean; Dominus before 1.5.4 kept no outdoor statistics - then its own counter
          hdd: outs.length ? outs.reduce((acc, m) => acc + Math.max(0, 18 - m) / 24, 0) : sum(this.eid("dom_dd_today")),
          chH: sum(this.eid("dom_ch_time_today")), starts: sum(this.eid("dom_starts_today")), dhw: sum(this.eid("dom_dhw_cycles")),
          dev: devs.length ? devs.reduce((x, y) => x + y, 0) / devs.length : NaN,
          elec: this.config.energy_entity ? sum(this.config.energy_entity) : NaN, gas: this.config.gas_entity ? sum(this.config.gas_entity) : NaN,
        };
      };
      this.effDom = { at: now, split, t0, before: per(t0, split), after: per(split, now) };
    } catch { this.effDom = null; }
    this.effLoading = false;
    this.requestUpdate();
  }

  /** "Optimisation effectiveness" for Immergas Dominus: heating hours per degree day, CH starts, run length, room
   *  deviation, DHW cycles and the optional metered energy per degree day */
  private effDomView() {
    const e = this.effDom;
    if (!e || e.before.h < 6) return nothing;
    const m = (p: DomPeriod) => {
      const d = p.h / 24;
      return {
        hHdd: p.hdd > 0.5 ? p.chH / p.hdd : NaN, startsD: d > 0 ? p.starts / d : NaN, run: p.starts > 0 ? p.chH * 60 / p.starts : NaN,
        dev: isNaN(p.dev) ? NaN : Math.abs(p.dev), dhwD: d > 0 ? p.dhw / d : NaN,
        elecHdd: p.hdd > 0.5 && !isNaN(p.elec) ? p.elec / p.hdd : NaN, gasHdd: p.hdd > 0.5 && !isNaN(p.gas) ? p.gas / p.hdd : NaN,
      };
    };
    const b = m(e.before), a = m(e.after);
    const rows: [string, string, number, number, number, boolean, number, [string, string]][] = [
      ["hHdd", "h/°C·d", 2, b.hHdd, a.hHdd, true, 0.4, ["Godziny grzania na stopniodzień", "Heating hours per degree day"]],
      ["startsD", this.t("/dobę", "/day"), 1, b.startsD, a.startsD, true, 0.2, ["Starty grzania CO na dobę", "CH starts per day"]],
      ["run", "min", 1, b.run, a.run, false, 0.1, ["Średnia długość grzania CO", "Average CH run length"]],
      ["dev", "K", 2, b.dev, a.dev, true, 0.3, ["Odchyłka pokoju od zadanej", "Room deviation from target"]],
      ["dhwD", this.t("/dobę", "/day"), 1, b.dhwD, a.dhwD, true, 0, ["Cykle CWU na dobę", "DHW cycles per day"]],
      ...(this.config.energy_entity ? [["elecHdd", "kWh/°C·d", 2, b.elecHdd, a.elecHdd, true, 0, ["Prąd na stopniodzień", "Electricity per degree day"]] as [string, string, number, number, number, boolean, number, [string, string]]] : []),
      ...(this.config.gas_entity ? [["gasHdd", "m³/°C·d", 3, b.gasHdd, a.gasHdd, true, 0, ["Gaz na stopniodzień", "Gas per degree day"]] as [string, string, number, number, number, boolean, number, [string, string]]] : []),
    ];
    let wsum = 0, score = 0;
    const pct = (x: number, y: number, low: boolean) => isNaN(x) || isNaN(y) || x === 0 ? NaN : (low ? (x - y) / x : (y - x) / x) * 100;
    const items = rows.map(([id, unit, d, x, y, low, w, name]) => {
      // a deviation under 0,2 K is comfort either way: no percentage
      const p = id === "dev" && Math.max(x, y) < 0.2 ? 0 : pct(x, y, low);
      if (!isNaN(p) && w > 0) { score += w * Math.max(-100, Math.min(100, p)); wsum += w; }
      return { id, unit, d, x, y, p, name };
    });
    const total = wsum > 0 ? score / wsum : NaN, hrs = e.after.h, enough = hrs >= 24 && e.after.hdd >= 1;
    const day = (t: number) => new Date(t).toLocaleString(this.loc, { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
    const col = (p: number) => isNaN(p) ? "overlay1" : p > 2 ? "green" : p < -2 ? "red" : "yellow";
    const sgn = (p: number) => isNaN(p) ? "–" : (p > 0 ? "+" : "") + this.f(p, 0) + " %";
    return html`
      <div class="grp">${this.t("Skuteczność optymalizacji", "Optimisation effectiveness")}</div>
      <div class="th"></div><div class="th c">${this.t("Przed", "Before")}</div><div class="th c">${this.t("Po", "After")}</div><div class="th c">${this.t("Zmiana", "Change")}</div>
      ${items.map((i) => html`
        <div class="pn">${this.t(i.name[0], i.name[1])}</div>
        <div class="cell"><div class="v">${isNaN(i.x) ? "–" : this.f(i.x, i.d, i.d) + (i.unit ? " " + i.unit : "")}</div></div>
        <div class="cell"><div class="v">${isNaN(i.y) ? "–" : this.f(i.y, i.d, i.d) + (i.unit ? " " + i.unit : "")}</div></div>
        <div class="cell rec" style="background:${ca(col(i.p), 0.1)};border-color:${ca(col(i.p), 0.35)}"><div class="v" style="color:${c(col(i.p))}">${sgn(i.p)}</div></div>`)}
      <div class="pn" style="font-size:13px">${this.t("Skuteczność łącznie", "Overall effectiveness")}</div>
      <div class="cell" style="grid-column: span 2"><div class="why">${this.t("ważona: godziny grzania/stopniodzień 40 %, odchyłka pokoju 30 %, starty/dobę 20 %, długość grzania 10 %",
        "weighted: heating hours/degree day 40 %, room deviation 30 %, starts/day 20 %, run length 10 %")}</div></div>
      <div class="cell rec" style="background:${ca(col(total), 0.18)};border-color:${ca(col(total), 0.6)}"><div class="v" style="font-size:18px;color:${c(col(total))}">${sgn(total)}</div>
        ${enough ? nothing : html`<div class="why">${this.t("wstępnie – mało danych", "preliminary – little data")}</div>`}</div>
      <div class="effn">${this.t("Przed", "Before")}: ${day(e.before.from)} – ${day(e.split)} (${this.f(e.before.h / 24, 1, 1)} ${this.t("dnia", "days")}, ${this.f(e.before.out, 1, 1)} °C,
        ${this.f(e.before.hdd, 1, 1)} ${this.t("stopniodni", "degree days")}) · ${this.t("Po", "After")}: ${this.t("od", "since")} ${day(e.split)} (${this.f(hrs, 0)} h, ${this.f(e.after.out, 1, 1)} °C,
        ${this.f(e.after.hdd, 1, 1)} ${this.t("stopniodni", "degree days")}).
        ${!isNaN(this.since()) ? "" : this.t("Bez daty zmiany (opcja optimized_since): ostatnie 7 dni wobec poprzednich 7.", "Without a change date (option optimized_since): the last 7 days against the 7 before.")}
        ${enough ? "" : this.t(" Wynik wiarygodny po co najmniej dobie od zmiany.", " Reliable after at least a day since the change.")}
        ${this.t("Dominus nie mierzy energii – porównanie z czasu grzania; licznik prądu / gazu dodasz opcjami energy_entity / gas_entity.",
          "Dominus does not measure energy – the comparison uses heating time; add a power / gas meter with the energy_entity / gas_entity options.")}</div>`;
  }

  /** "Optimisation effectiveness": metrics before / after with % change and a weighted overall score */
  private effView() {
    const e = this.eff;
    if (!e || e.before.h < 6) return nothing;
    const pe = this.n("price_elec"), pg = this.n("price_gas"), kg = this.n("gas_cost");
    const gasKwh = pg > 0 && kg > 0 ? pg / kg : 10.6; // kWh of heat per m3 of gas, from the hub's own gas heat cost
    const m = (p: Period) => {
      const cost = p.elec * (pe || 0) + p.gas * (pg || 0), heatAll = p.heat + p.gas * gasKwh;
      return {
        costHdd: p.hdd > 0.5 ? cost / p.hdd : NaN, costKwh: heatAll > 1 ? cost / heatAll : NaN,
        elecHdd: p.hdd > 0.5 ? p.elec / p.hdd : NaN, gasHdd: p.hdd > 0.5 ? p.gas / p.hdd : NaN,
        cop: p.elec > 0.5 ? p.heat / p.elec : NaN, startsH: p.h > 0 ? p.starts / p.h : NaN, cycle: p.starts > 0 ? p.run * 60 / p.starts : NaN,
      };
    };
    const b = m(e.before), a = m(e.after);
    // metric, unit, decimals, better when lower, weight in the overall score
    const rows: [string, string, number, number, number, boolean, number, [string, string]][] = [
      ["costHdd", `${this.currency}/°C·d`, 2, b.costHdd, a.costHdd, true, 0.3, ["Koszt ogrzewania na stopniodzień", "Heating cost per degree day"]],
      ["costKwh", `${this.currency}/kWh`, 3, b.costKwh, a.costKwh, true, 0.2, ["Koszt 1 kWh ciepła (pompa + gaz)", "Cost of 1 kWh of heat (pump + gas)"]],
      ["elecHdd", "kWh/°C·d", 2, b.elecHdd, a.elecHdd, true, 0, ["Prąd na stopniodzień", "Electricity per degree day"]],
      ["gasHdd", "m³/°C·d", 3, b.gasHdd, a.gasHdd, true, 0, ["Gaz na stopniodzień", "Gas per degree day"]],
      ["cop", "", 2, b.cop, a.cop, false, 0.2, ["COP pompy (ciepło ÷ prąd)", "Heat-pump COP (heat ÷ electricity)"]],
      ["startsH", "/h", 2, b.startsH, a.startsH, true, 0.2, ["Starty sprężarki na godzinę", "Compressor starts per hour"]],
      ["cycle", "min", 1, b.cycle, a.cycle, false, 0.1, ["Średnia długość cyklu sprężarki", "Average compressor cycle length"]],
    ];
    let wsum = 0, score = 0;
    const pct = (x: number, y: number, low: boolean) => isNaN(x) || isNaN(y) || x === 0 ? NaN : (low ? (x - y) / x : (y - x) / x) * 100;
    // too little gas for a percentage: show the absolute difference instead
    const fewGas = e.before.gas < 0.5 || e.after.gas < 0.5;
    const items = rows.map(([id, unit, d, x, y, low, w, name]) => {
      const p = id === "gasHdd" && fewGas ? NaN : pct(x, y, low);
      if (!isNaN(p) && w > 0) { score += w * Math.max(-100, Math.min(100, p)); wsum += w; }
      return { id, unit, d, x, y, p, name };
    });
    const total = wsum > 0 ? score / wsum : NaN, hrs = e.after.h, enough = hrs >= 24 && e.after.hdd >= 1;
    const day = (t: number) => new Date(t).toLocaleString(this.loc, { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
    const col = (p: number) => isNaN(p) ? "overlay1" : p > 2 ? "green" : p < -2 ? "red" : "yellow";
    const sgn = (p: number) => isNaN(p) ? "–" : (p > 0 ? "+" : "") + this.f(p, 0) + " %";
    return html`
      <div class="grp">${this.t("Skuteczność optymalizacji", "Optimisation effectiveness")}</div>
      <div class="th"></div><div class="th c">${this.t("Przed", "Before")}</div><div class="th c">${this.t("Po", "After")}</div><div class="th c">${this.t("Zmiana", "Change")}</div>
      ${items.map((i) => html`
        <div class="pn">${this.t(i.name[0], i.name[1])}</div>
        <div class="cell"><div class="v">${isNaN(i.x) ? "–" : this.f(i.x, i.d, i.d) + (i.unit ? " " + i.unit : "")}</div></div>
        <div class="cell"><div class="v">${isNaN(i.y) ? "–" : this.f(i.y, i.d, i.d) + (i.unit ? " " + i.unit : "")}</div></div>
        <div class="cell rec" style="background:${ca(col(i.p), 0.1)};border-color:${ca(col(i.p), 0.35)}"><div class="v" style="color:${c(col(i.p))}">${i.id === "gasHdd" && fewGas
          ? (e.after.gas - e.before.gas >= 0 ? "+" : "") + this.f(e.after.gas - e.before.gas, 2, 2) + " m³" : sgn(i.p)}</div>
          ${i.id === "gasHdd" && fewGas ? html`<div class="why">${this.t("za mało gazu na %", "too little gas for %")}</div>` : nothing}
          ${i.id === "costHdd" && i.p < -2 && (items.find((x) => x.id === "costKwh")?.p ?? 0) > 2 ? html`<div class="why">${this.t("ciepło tańsze, ale oddano go więcej (wyższe nastawy pokoi)", "heat is cheaper, but more of it was delivered (higher room targets)")}</div>` : nothing}</div>`)}
      <div class="pn" style="font-size:13px">${this.t("Skuteczność łącznie", "Overall effectiveness")}</div>
      <div class="cell" style="grid-column: span 2"><div class="why">${this.t("ważona: koszt/stopniodzień 30 %, koszt kWh ciepła 20 %, COP 20 %, starty/h 20 %, długość cyklu 10 %",
        "weighted: cost/degree day 30 %, heat kWh cost 20 %, COP 20 %, starts/h 20 %, cycle length 10 %")}</div></div>
      <div class="cell rec" style="background:${ca(col(total), 0.18)};border-color:${ca(col(total), 0.6)}"><div class="v" style="font-size:18px;color:${c(col(total))}">${sgn(total)}</div>
        ${enough ? nothing : html`<div class="why">${this.t("wstępnie – mało danych", "preliminary – little data")}</div>`}</div>
      <div class="effn">${this.t("Przed", "Before")}: ${day(e.before.from)} – ${day(e.split)} (${this.f(e.before.h / 24, 1, 1)} ${this.t("dnia", "days")}, ${this.f(e.before.out, 1, 1)} °C,
        ${this.f(e.before.hdd, 1, 1)} ${this.t("stopniodni", "degree days")}) · ${this.t("Po", "After")}: ${this.t("od", "since")} ${day(e.split)} (${this.f(hrs, 0)} h, ${this.f(e.after.out, 1, 1)} °C,
        ${this.f(e.after.hdd, 1, 1)} ${this.t("stopniodni", "degree days")}).
        ${!isNaN(this.since()) ? "" : this.t("Bez daty „Porównanie od” w hubie: ostatnie 7 dni wobec poprzednich 7.", "Without the hub's “Compare from” date: the last 7 days against the 7 before.")}
        ${enough ? "" : this.t(" Wynik wiarygodny po co najmniej dobie od zmiany.", " Reliable after at least a day since the change.")}
        ${this.t("Normalizacja pogodą: stopniodni (18 °C − średnia godzinowa). Gaz to szacunek huba.", "Weather normalisation: degree days (18 °C − hourly mean). Gas is the hub's estimate.")}</div>`;
  }

  /** the last finished night-mode window (U11 history, else the night_start / night_stop options) and how it went */
  private async lastNight(end: number, st: Seg[]): Promise<Night | null> {
    const u = this.eid("u11"), o = this.eid("outdoor");
    const ids = [u, o].filter(Boolean) as string[];
    if (!ids.length) return null;
    const r = await this.hass.callWS({ type: "history/history_during_period", start_time: new Date(end - 36 * H).toISOString(),
      end_time: new Date(end).toISOString(), entity_ids: ids, minimal_response: true, no_attributes: true, significant_changes_only: false });
    let win: [number, number] | null = null, learned = true;
    const on = segments(r[u ?? ""] ?? [], end).filter((g) => g.s === "on" && g.t1 < end - 60e3 && g.t1 - g.t0 >= 30 * 60e3);
    if (on.length) win = [on[on.length - 1].t0, on[on.length - 1].t1];
    else {
      const a = this.timeOpt("night_start"), b = this.timeOpt("night_stop");
      if (a === null || b === null) return null;
      learned = false;
      const d = new Date(end); d.setHours(0, 0, 0, 0);
      for (let k = 0; k < 3 && !win; k++) {
        const s0 = d.getTime() - k * 86400e3 + a * 60000, s1 = s0 + (((b - a + 1440) % 1440) || 1440) * 60000;
        if (s1 < end) win = [s0, s1];
      }
      if (!win) return null;
    }
    const [t0, t1] = win;
    const outs = (r[o ?? ""] ?? []).map((x: any) => [Math.round((x.lc ?? x.lu ?? 0) * 1000), parseFloat(x.s)] as [number, number]).filter((x: [number, number]) => !isNaN(x[1]));
    const inWin = outs.filter(([t]) => t >= t0 && t <= t1).map(([, v]) => v), before = outs.filter(([t]) => t < t0).pop();
    const outVals = inWin.length ? inWin : before ? [before[1]] : [];
    const out = outVals.length ? outVals.reduce((x, y) => x + y, 0) / outVals.length : NaN;
    // compressor share of the window
    let runMs = 0;
    for (const g of st) if (!isIdle(g.s)) runMs += Math.max(0, Math.min(g.t1, t1) - Math.max(g.t0, t0));
    // room temperatures at the window start and end (climate history with attributes)
    const rooms = this.rooms().map((x) => x.id);
    let dRoom = NaN;
    if (rooms.length) {
      const h = await this.hass.callWS({ type: "history/history_during_period", start_time: new Date(t0 - 2 * H).toISOString(),
        end_time: new Date(t1 + 10 * 60e3).toISOString(), entity_ids: rooms, minimal_response: false, no_attributes: false, significant_changes_only: false });
      const at = (list: any[], t: number) => {
        let v = NaN, cur = NaN;
        for (const x of list) {
          const tt = Math.round((x.lu ?? x.lc ?? 0) * 1000), a = x.a ?? x.attributes;
          if (a && a.current_temperature !== undefined) cur = parseFloat(a.current_temperature);
          if (tt <= t) v = cur; else break;
        }
        return v;
      };
      const ds = rooms.map((e) => at(h[e] ?? [], t1) - at(h[e] ?? [], t0)).filter((v) => !isNaN(v));
      dRoom = ds.length ? median(ds) : NaN;
    }
    return { t0, t1, out, dRoom, run: runMs / (t1 - t0), n: rooms.length, learned };
  }

  /** 24 h of outdoor, evaporator, discharge, power, cylinder and boiler history -> Hidden */
  private async loadHidden(end: number, st: Seg[]): Promise<Hidden> {
    const keys: Key[] = ["outdoor", "d74", "d73", "elec_power", "tank", "hz"];
    const ids = keys.map((k) => this.eid(k));
    const r = await this.hass.callWS({ type: "history/history_during_period", start_time: new Date(end - 24 * H).toISOString(),
      end_time: new Date(end).toISOString(), entity_ids: ids.filter(Boolean), minimal_response: true, no_attributes: true, significant_changes_only: false });
    const series = (i: number) => (r[ids[i] ?? ""] ?? []).map((p: any) => [Math.round((p.lc ?? p.lu ?? 0) * 1000), parseFloat(p.s)] as [number, number])
      .filter((p: [number, number]) => !isNaN(p[1]));
    const [out, evap, dis, pw, tank, hz] = keys.map((_, i) => series(i));
    const valueAt = (pts: [number, number][], t: number) => { let v = NaN; for (const [tt, vv] of pts) { if (tt > t) break; v = vv; } return v; };
    const t0 = end - 24 * H, step = 60e3;
    const evapD: number[] = [], stand: number[] = [], outs: number[] = [];
    let dischargeMax = NaN, gasWarm = 0;
    const i10 = this.n("i10");
    for (const g of st) {
      const a = Math.max(g.t0, t0), b = Math.min(g.t1, end);
      if (b <= a) continue;
      const running = !isIdle(g.s) && !isDefrost(g.s) && !(hasBoiler(g.s) && !hpHeating(g.s) && !isDhw(g.s));
      for (let t = a; t < b; t += step) {
        const o = valueAt(out, t), f = valueAt(hz, t);
        if (!isNaN(o)) outs.push(o);
        if (running && f > 0 && t - g.t0 > 5 * 60e3) {
          const e = valueAt(evap, t), d = valueAt(dis, t);
          if (!isNaN(o) && !isNaN(e)) evapD.push(o - e);
          if (!isNaN(d) && !(d <= dischargeMax)) dischargeMax = d;
        }
        if (isIdle(g.s) && t - g.t0 > 10 * 60e3 && !(f > 0)) { const p = valueAt(pw, t); if (!isNaN(p)) stand.push(p); }
        if (hasBoiler(g.s) && !isDhw(g.s) && !isNaN(i10) && o > i10 + 2) gasWarm += step / 60e3;
      }
    }
    // defrost cycles: defrost segments closer than 5 min are one cycle
    let defrosts = 0, lastEnd = -Infinity;
    for (const g of st) if (g.t0 > t0 && isDefrost(g.s)) { if (g.t0 - lastEnd > 5 * 60e3) defrosts++; lastEnd = g.t1; }
    // cylinder at night: the longest stretch between 00:00 and 05:00 without DHW heating, starting 90 min after a cycle
    // (right after heating the probe still falls while the water in the cylinder evens out)
    let tankLoss = NaN, tankHours = 0;
    const night = new Date(end); night.setHours(0, 0, 0, 0);
    const n0 = night.getTime() > end - 5 * H ? night.getTime() - 24 * H : night.getTime(), n1 = n0 + 5 * H;
    let from = n0;
    const stretches: [number, number][] = [];
    for (const g of st.filter((x) => isDhw(x.s) && x.t1 > n0 && x.t0 < n1)) { stretches.push([from, g.t0]); from = g.t1 + 90 * 60e3; }
    stretches.push([from, n1]);
    const best = stretches.filter(([a, b]) => b - a >= 2 * H).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
    if (best) {
      const ta = valueAt(tank, best[0]), tb = valueAt(tank, best[1]);
      if (!isNaN(ta) && !isNaN(tb)) { tankHours = (best[1] - best[0]) / H; tankLoss = (ta - tb) / tankHours; }
    }
    return { defrosts, outMean: outs.length ? outs.reduce((a, b) => a + b, 0) / outs.length : NaN, evap: evapD.length ? median(evapD) : NaN,
      standby: stand.length ? median(stand) : NaN, tankLoss, tankHours, gasWarm, dischargeMax };
  }

  /** rooms with own thermostats: option `rooms`, else climate entities that heat (not the hub's own, target >= 19 °C) */
  /** rooms whose thermostat heated >= 85 % of the last 24 h and are not above the target now (hvac_action history) */
  private async starved(end: number): Promise<Starved[]> {
    const rooms = this.rooms();
    if (!rooms.length) return [];
    const from = end - 24 * H;
    const r = await this.hass.callWS({ type: "history/history_during_period", start_time: new Date(from).toISOString(), end_time: new Date(end).toISOString(),
      entity_ids: rooms.map((x) => x.id), minimal_response: false, no_attributes: false, significant_changes_only: false }) as Record<string, any[]>;
    return rooms.map((room) => {
      const list = r[room.id] ?? [];
      let on = 0;
      list.forEach((x, i) => {
        const t0 = Math.max(from, Math.round((x.lu ?? x.lc ?? 0) * 1000)), t1 = i + 1 < list.length ? Math.round((list[i + 1].lu ?? list[i + 1].lc ?? 0) * 1000) : end;
        if ((x.a ?? x.attributes)?.hvac_action === "heating") on += Math.max(0, t1 - t0);
      });
      return { id: room.id, share: on / (24 * H), ok: room.t - room.set <= 0.3 };
    }).filter((x) => x.share >= 0.85 && x.ok).map(({ id, share }) => ({ id, share })).sort((a, b) => b.share - a.share);
  }

  private rooms() {
    const ids: string[] = this.config.rooms ?? Object.keys(this.hass.states).filter((e) => {
      if (!e.startsWith("climate.") || e.includes("immergas")) return false;
      const a = this.hass.states[e].attributes ?? {};
      return (a.hvac_modes ?? []).includes("heat") && a.current_temperature !== undefined;
    });
    return ids.map((e) => this.hass.states[e]).filter((s) => s && s.state !== "off" && parseFloat(s.attributes?.temperature) >= 19)
      .map((s) => ({ id: s.entity_id, t: parseFloat(s.attributes.current_temperature), set: parseFloat(s.attributes.temperature), heat: s.attributes.hvac_action === "heating" }));
  }

  private stats() {
    const st = this.hist?.st ?? [], now = Date.now(), t0 = now - 24 * H;
    // CH right after DHW is the same compressor run (no new start); cycles cut by a hub reboot have no real length
    const co = st.filter((g, i) => g.t0 > t0 && hpHeating(g.s) && !(i > 0 && isDhw(st[i - 1].s)));
    // one DHW cycle = DHW segments closer than 15 min (a short status flicker splits a cycle into several segments)
    let dhwN = 0, lastEnd = -Infinity;
    for (const g of st) if (g.t0 > t0 && isDhw(g.s)) { if (g.t0 - lastEnd > 15 * 60e3) dhwN++; lastEnd = g.t1; }
    const span = Math.max(1, (now - Math.max(t0, st[0]?.t0 ?? t0)) / H);
    const coShare = co.reduce((a, g) => a + (Math.min(g.t1, now) - g.t0), 0) / (span * H);
    return { coShare, coPerH: co.length / span, coRun: median(co.slice(0, -1).filter((g) => !g.cut).map((g) => (g.t1 - g.t0) / 60000)), dhwPerDay: dhwN * 24 / span, n: co.length };
  }

  private rows(): Row[] {
    const S = this.stats(), rooms = this.rooms(), thermostats = rooms.length > 0;
    const deficit = thermostats ? median(rooms.map((r) => r.set - r.t)) : NaN;
    const cold = deficit > 0.5, warm = deficit < -0.5, short = S.coRun > 0 && S.coRun < 5, long = S.coRun >= 15;
    const r05 = this.n("r05"), r04 = this.n("r04");
    // after a change of the curve the last 24 h describe the old settings: wait 12 h before recommending again
    const changed = (["r05", "r04", "u03", "room_mod"] as Key[]).map((k) => Date.parse(this.so(k)?.last_changed ?? "") || 0)
      .filter((t) => Date.now() - t < 12 * H).sort().pop();
    const wait = changed ? Math.round((Date.now() - changed) / H * 10) / 10 : NaN;
    const floorE = this.opt("max_floor_entity"), floor = floorE ? parseFloat(this.hass.states[floorE]?.state) : NaN;
    const cap = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const f = (v: number, d = 1) => this.f(v, d, 0);
    // what +1 of a curve parameter does to the water at the current outdoor temperature (curve points R02 / R03 from the
    // hub config numbers, as on the Curve card): U03 shifts all of it, R05 weighs in when mild, R04 when cold
    const cxa = this.n("hub_r02"), cxb = this.n("hub_r03"), cOut = this.n("outdoor");
    const cfrac = isNaN(cxa) || isNaN(cxb) || isNaN(cOut) || cxb <= cxa ? NaN : cap((cOut - cxa) / (cxb - cxa), 0, 1);
    const perOne = (why: [string, string], dv: number): [string, string] => isNaN(cfrac) ? why
      : [`${why[0]} · +1 = +${f(dv, 1)} °C wody przy ${f(cOut, 1)} °C na zewnątrz`, `${why[1]} · +1 = +${f(dv, 1)} °C of water at ${f(cOut, 1)} °C outdoor`];

    // CH curve foot (R05): short cycles with cold rooms -> warmer water; long cycles with warm rooms -> cooler
    const r05rec = isNaN(r05) || !isNaN(wait) ? r05 : short && cold ? cap(r05 + 2, 20, 28) : long && warm ? cap(r05 - 1, 20, 28) : r05;
    const r05why: [string, string] = !isNaN(wait) ? [`krzywą zmieniono ${f(wait)} h temu – oceń po dobie`, `the curve changed ${f(wait)} h ago – judge after a day`]
      : short && cold ? [`cykle ~${f(S.coRun)} min, pokoje ${f(deficit)} K poniżej nastaw → cieplejsza woda`, `cycles ~${f(S.coRun)} min, rooms ${f(deficit)} K below target → warmer water`]
      : long && warm ? [`długie cykle, pokoje ${f(-deficit)} K ponad nastawy → chłodniej`, `long cycles, rooms ${f(-deficit)} K above target → cooler`]
      : [isNaN(S.coRun) ? "za mało danych z 24 h" : `cykle ~${f(S.coRun)} min, pokoje ${thermostats ? f(deficit) + " K od nastaw" : "bez termostatów"} – bez zmian`,
        isNaN(S.coRun) ? "not enough data from 24 h" : `cycles ~${f(S.coRun)} min, rooms ${thermostats ? f(deficit) + " K from target" : "without thermostats"} – keep`];
    // CH curve top (R04): keep the slope ~10 K above the foot, at most 5 K under the floor limit
    const r04hi = isNaN(floor) ? 40 : floor - 5;
    const r04rec = isNaN(r04) || !isNaN(wait) ? r04 : cap(Math.max(r04, (isNaN(r05rec) ? r05 : r05rec) + 10), 30, r04hi);
    const modOn = (() => { const o: string[] = this.attr("room_mod", "options") ?? []; return o.length === 2 && this.s("room_mod") === o[1]; })();
    const modOpts: string[] = this.attr("room_mod", "options") ?? [];
    const maxSet = thermostats ? Math.max(...rooms.map((r) => r.set)) : NaN;
    const z = this.n("zone1_set");
    // T05 = minimum pause between CH starts: 15 min, which is also the most the boiler takes over T-/T+ (a write of
    // 16-20 min is rejected with Modbus exception 3); a shorter pause brings nothing for a slow floor
    const T05_MAX = 15;
    const t05 = this.n("t05"), t05rec = isNaN(t05) ? NaN : T05_MAX;
    // DHW heated by the gas boiler (I01 on, source "boiler"): the setpoint does not cost heat-pump COP - 45-55 °C is fine
    const dhwGas = !!this.eid("i01") && this.on("i01") && this.dhwSource().cur === "boiler";
    const dhw = this.n("dhw_set"), dhwRec = isNaN(dhw) ? NaN : dhwGas ? (dhw > 55 ? 55 : dhw < 45 ? 45 : dhw) : dhw > 50 ? 48 : dhw < 45 ? 45 : dhw;
    const t02 = this.n("t02"), t02rec = isNaN(t02) ? NaN : S.dhwPerDay > 4 ? cap(Math.max(t02, 7), 0, 20) : t02 < 4 ? 5 : t02;

    // cycling: read-only rows - model, measured, and what to do about it
    const starts = this.n("starts"), later = !isNaN(wait) ? this.t(" (najpierw oceń zmianę krzywej po dobie)", " (first judge the curve change after a day)") : "";
    const cycTxt: [string, string] = S.coPerH > 3 ? (!isNaN(t05) && t05 < T05_MAX ? ["podnieś R05 o 2 K i T05 do 15 min", "raise R05 by 2 K and T05 to 15 min"]
      : ["podnieś R05 o 2 K (T05 ma już maks. 15 min)", "raise R05 by 2 K (T05 is already at its 15 min maximum)"])
      : short ? ["cieplejsza woda: R05 +2 K (dłuższe cykle)", "warmer water: R05 +2 K (longer cycles)"] : ["w normie", "fine"];
    // the cycling rows name R05 (+2 K) and T05 (15 min): give them a Set button when the entities exist (after a recent
    // curve change the text still says to wait - the button stays, the user decides and confirms)
    const r05up = this.eid("r05") && !isNaN(r05) && cap(r05 + 2, 20, 28) !== r05 ? cap(r05 + 2, 20, 28) : NaN;
    const setR05 = (t05too: boolean) => isNaN(r05up) ? undefined : () => {
      this.call("number", "set_value", "r05", { value: r05up });
      if (t05too && this.eid("t05") && !isNaN(t05) && t05 < T05_MAX) this.call("number", "set_value", "t05", { value: T05_MAX });
    };
    const info: Row[] = [
      { code: "", name: ["Taktowanie: starty CO na godzinę", "Cycling: CH starts per hour"], unit: "/h", d: 1, kind: "info",
        model: "≤ 1,5 /h", why: ["mniej startów = dłuższa żywotność sprężarki i lepszy COP", "fewer starts = longer compressor life and better COP"],
        value: S.coPerH, ok: !(S.coPerH > 1.5), setFn: S.coPerH > 3 ? setR05(true) : short ? setR05(false) : undefined, rec: (S.coPerH > 1.5 ? "" : "✓ ") + this.t(cycTxt[0], cycTxt[1]) + later,
        reason: [`średnio z ${S.n} startów CO w 24 h`, `average of ${S.n} CH starts in 24 h`] },
      { code: "", name: ["Taktowanie: długość cyklu CO", "Cycling: CH cycle length"], unit: "min", d: 1, kind: "info",
        model: "≥ 10 min", why: ["sprężarka rozgrzewa się i modulując pracuje wydajnie", "the compressor warms up and runs efficiently modulating"],
        value: S.coRun, ok: !(S.coRun < 10), setFn: S.coRun < 10 ? setR05(false) : undefined, rec: S.coRun < 10 ? this.t("R05 +2 K – woda za blisko temperatury powrotu", "R05 +2 K – water too close to the return temperature") + later : this.t("✓ w normie", "✓ fine"),
        reason: ["mediana cykli pompy w CO z 24 h", "median of the heat-pump CH cycles in 24 h"] },
      ...(!isNaN(starts) ? [{ code: "", name: ["Starty sprężarki dziś", "Compressor starts today"], unit: "×", d: 0, kind: "info",
        model: "≤ 30", why: ["łącznie CO i CWU od północy", "CH and DHW together since midnight"],
        value: starts, ok: starts <= 30, rec: starts > 30 ? this.t("ogranicz taktowanie CO (wiersze wyżej)", "reduce CH cycling (rows above)") : this.t("✓ w normie", "✓ fine"),
        reason: ["licznik huba", "hub counter"] } as Row] : []),
      { code: "", name: ["Cykle CWU na dobę", "DHW cycles per day"], unit: "×", d: 1, kind: "info",
        model: "≤ 3", why: ["każdy cykl CWU to start sprężarki i przerwa w CO", "each DHW cycle is a compressor start and a pause in CH"],
        value: S.dhwPerDay, ok: !(S.dhwPerDay > 3), rec: S.dhwPerDay > 3 ? (this.n("t02") >= 7 ? this.t("T02 już 7 K – oceń po dobie; skróć harmonogram CWU", "T02 already 7 K – judge after a day; shorten the DHW schedule")
          : this.t("większa histereza T02 (wiersz niżej)", "larger T02 hysteresis (row below)")) : this.t("✓ w normie", "✓ fine"),
        reason: ["z 24 h, przerwy < 15 min scalone", "from 24 h, gaps < 15 min merged"] },
    ];
    // heat source CH / DHW: heat pump vs gas from the COP and the prices (break-even COP = electricity price / gas heat cost)
    const pe = this.n("price_elec"), kg = this.n("gas_cost"), be = pe > 0 && kg > 0 ? pe / kg : NaN;
    const copCo = this.n("cop_today"), dc = [this.n("dhw_cop_flow"), this.n("dhw_cop_tank")].filter((v) => v > 0);
    const copDhw = dc.length ? dc.reduce((a, b) => a + b, 0) / dc.length : NaN;
    const L = { auto: "AUTO", boiler: this.t("Kotłem", "Boiler"), hp: this.t("Pompą", "Heat pump") };
    const pick = (cop: number, cheap: string, mid: string) => isNaN(cop) || isNaN(be) ? "" : cop >= be * 1.1 ? cheap : cop <= be * 0.9 ? "boiler" : mid;
    const save = (cop: number) => isNaN(cop) || isNaN(be) ? "" : cop >= be ? this.t(`pompa ${Math.round((1 - be / cop) * 100)}% taniej`, `heat pump ${Math.round((1 - be / cop) * 100)}% cheaper`)
      : this.t(`gaz ${Math.round((1 - cop / be) * 100)}% taniej`, `gas ${Math.round((1 - cop / be) * 100)}% cheaper`);
    const co = this.coSource(), dh = this.dhwSource();
    const coRec = pick(copCo, "auto", co.cur), dhRec = pick(copDhw, "hp", "auto");
    const band = (cop: number) => cop < be * 1.1 && cop > be * 0.9;
    const tail = (cop: number, rec: string, pl: string, en: string) => band(cop) ? this.t("; podobny koszt – bez zmian", "; similar cost – keep") : rec === "auto" ? this.t(pl, en) : "";
    const src: Row[] = ([
      { code: "", name: ["Źródło ciepła CO", "CH heat source"], unit: "", kind: "custom", labels: L, setFn: co.set, has: co.has && !co.bad,
        model: this.t("najtańsze", "cheapest"), why: [`próg opłacalności COP ${this.f(be, 1, 1)} (prąd ${this.f(pe, 2, 2)} / ciepło z gazu ${this.f(kg, 2, 2)} ${this.currency}/kWh)`,
          `break-even COP ${this.f(be, 1, 1)} (electricity ${this.f(pe, 2, 2)} / gas heat ${this.f(kg, 2, 2)} ${this.currency}/kWh)`],
        value: co.cur, rec: coRec || co.cur,
        reason: isNaN(copCo) ? ["czeka na COP z pracy", "waiting for the COP"] : [`COP dziś ${this.f(copCo, 1, 1)} vs próg ${this.f(be, 1, 1)} → ${save(copCo)}${tail(copCo, coRec, "; kocioł tylko w mrozy (I10)", "; boiler only in frost (I10)")}`,
          `COP today ${this.f(copCo, 1, 1)} vs break-even ${this.f(be, 1, 1)} → ${save(copCo)}${tail(copCo, coRec, "; kocioł tylko w mrozy (I10)", "; boiler only in frost (I10)")}`] },
      { code: "", name: ["Źródło ciepła CWU", "DHW heat source"], unit: "", kind: "custom", labels: L, setFn: dh.set, has: dh.has && !dh.bad,
        model: this.t("najtańsze", "cheapest"), why: ["CWU grzeje do ~50 °C, więc COP pompy jest niższy niż w CO", "DHW heats to ~50 °C, so the heat-pump COP is lower than in CH"],
        value: dh.cur, rec: dhRec || dh.cur,
        reason: isNaN(copDhw) ? ["czeka na cykl CWU pompą", "waiting for a heat-pump DHW cycle"] : [`COP ostatniego cyklu ${this.f(copDhw, 1, 1)} vs próg ${this.f(be, 1, 1)} → ${save(copDhw)}${tail(copDhw, dhRec, "", "")}`,
          `last cycle COP ${this.f(copDhw, 1, 1)} vs break-even ${this.f(be, 1, 1)} → ${save(copDhw)}${tail(copDhw, dhRec, "", "")}`] },
    ] as Row[]).filter((r) => r.has);
    // schedules
    const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const mm = (v?: string) => { if (!v || !/^\d\d:\d\d/.test(v)) return null; const m = +v.slice(0, 2) * 60 + +v.slice(3, 5); return m >= 1439 ? 1440 : m; };
    const hm = (m: number) => m >= 1440 ? "24:00" : String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
    const calOf = (k: string) => { const v = this.s(k as Key) ?? ""; const n = parseInt(v.replace(/\D/g, ""), 10); return n >= 1 && n <= 4 ? n : 0; };
    const ranges = (cal: number) => {
      const out: [number, number][] = [];
      for (let z = 1; z <= 4; z++) {
        const a = mm(this.s(`k${cal}z${z}on` as Key)), b = mm(this.s(`k${cal}z${z}off` as Key));
        if (a !== null && b !== null && b > a) out.push([a, b]);
      }
      return out;
    };
    const minutes = (rs: [number, number][]) => { const m = new Uint8Array(1440); for (const [a, b] of rs) for (let i = a; i < Math.min(b, 1440); i++) m[i] = 1; return m; };
    const fmtR = (rs: [number, number][]) => rs.length ? rs.map(([a, b]) => hm(a) + "–" + hm(b)).join(", ") : this.t("brak zakresów", "no ranges");
    // cheap tariff windows (wrap over midnight is split)
    const cheap: [number, number][] = [];
    for (const w of this.cheapHours.split(",")) {
      const m = w.trim().match(/^(\d\d?:\d\d)\s*-\s*(\d\d?:\d\d)$/);
      if (!m) continue;
      const a = mm(m[1].padStart(5, "0")), b = mm(m[2].padStart(5, "0"));
      if (a === null || b === null) continue;
      if (b > a) cheap.push([a, b]); else { cheap.push([a, 1440]); if (b > 0) cheap.push([0, b]); }
    }
    const cheapTxt = this.cheapHours.split(",").map((w) => w.trim().replace(/\s*-\s*/, "–")).filter(Boolean).join(", ");
    const sched: Row[] = [];
    if (this.eid("prog_mode")) {
      const po: string[] = this.attr("prog_mode", "options") ?? [], pAuto = po.length === 2 && this.s("prog_mode") === po[1];
      const ce = this.n("comfort_heat") - this.n("eco_heat");
      const recAuto = !thermostats, ft = this.floorType(), sbK = this.setbackK();
      sched.push({ k: "prog_mode", code: "", name: ["Harmonogram CO (program czasowy)", "CH schedule (time program)"], unit: "", kind: "select",
        model: thermostats ? po[0] ?? "MANUAL" : po[1] ?? "AUTO",
        why: thermostats ? (ft === "dry" ? ["system suchy reaguje szybko, ale pokoje regulują termostaty – obniżki ustawiaj w nich", "a dry system reacts fast, but the rooms have thermostats – set setbacks in them"]
            : ft === "anhydrite" ? ["anhydryt reaguje szybciej, ale mało magazynuje, a pokoje regulują termostaty – stała nastawa, w nich najwyżej krótkie obniżki 2–3 h o ≤ 1 K", "anhydrite reacts faster but stores little, and the rooms have thermostats – a fixed setpoint, in them at most short 2–3 h setbacks of ≤ 1 K"]
            : ["podłogówka jest wolna, a pokoje regulują termostaty – stała nastawa bez obniżeń", "a floor is slow and the rooms have thermostats – a fixed setpoint without setbacks"])
          : ft === "dry" ? ["Komfort / Eko wg pory dnia, Eko najwyżej 2 K niżej (system suchy szybko się nagrzewa)", "Comfort / Eco by time of day, Eco at most 2 K lower (a dry system reheats fast)"]
          : ["Komfort / Eko wg pory dnia, Eko najwyżej 1 K niżej (podłoga długo się nagrzewa)", "Comfort / Eco by time of day, Eco at most 1 K lower (a floor reheats slowly)"],
        rec: recAuto ? po[1] ?? "Auto" : po[0] ?? "Ręcznie",
        reason: thermostats ? [`${rooms.length} termostatów pokojowych – harmonogram ustawiaj w nich`, `${rooms.length} room thermostats – schedule them instead`]
          : pAuto && ce > sbK + 0.5 ? [`Eko o ${this.f(ce, 1, 1)} K niżej – podnieś Eko do Komfort − ${sbK} K`, `Eco ${this.f(ce, 1, 1)} K lower – raise Eco to Comfort − ${sbK} K`]
          : [`obniżka nocna do ${sbK} K oszczędza bez taktowania rano`, `a night setback up to ${sbK} K saves without morning cycling`] });
    }
    const dhwCals = DAYS.map((d) => calOf("cwu_" + d)).filter((n) => n > 0);
    if (dhwCals.length) {
      const cnt: Record<number, number> = {};
      for (const n of dhwCals) cnt[n] = (cnt[n] ?? 0) + 1;
      const cal = +Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0], rs = ranges(cal), on = minutes(rs);
      const hours = on.reduce((a, b) => a + b, 0) / 60;
      let outside = 0;
      if (cheap.length) { const ch = minutes(cheap); for (let i = 0; i < 1440; i++) if (on[i] && !ch[i]) outside++; }
      const ok = cheap.length ? outside <= 30 : hours <= 6;
      sched.push({ code: "", name: ["Harmonogram CWU", "DHW schedule"], unit: "", kind: "info",
        model: cheap.length ? cheapTxt : this.t("1–2 okna po ~2 h", "1–2 windows of ~2 h"),
        why: cheap.length ? ["grzej wodę w tańszej taryfie", "heat water in the cheaper tariff"]
          : ["krótkie okna przed poborem = mniej cykli CWU; przy taryfie dwustrefowej wpisz jej godziny w hubie (Tania taryfa – godziny)",
            "short windows before use = fewer DHW cycles; for a two-rate tariff enter its hours in the hub (Cheap tariff hours)"],
        value: this.t("Kal. ", "Cal. ") + cal + ": " + fmtR(rs), ok,
        setFn: cheap.length && !ok && cheap.length <= 4 && !DAYS.some((d) => calOf("co_" + d) === cal) ? () => {
          // write the cheap windows into the DHW calendar's 4 ranges; unused ranges get ON = OFF (empty), like the panel
          const t = (m: number) => (m >= 1440 ? "23:59" : hm(m)) + ":00", sorted = [...cheap].sort((a, b) => a[0] - b[0]);
          for (let z = 1; z <= 4; z++) {
            const r = sorted[z - 1], end = sorted[sorted.length - 1][1];
            this.call("time", "set_value", `k${cal}z${z}on` as Key, { time: t(r ? r[0] : end) });
            this.call("time", "set_value", `k${cal}z${z}off` as Key, { time: t(r ? r[1] : end) });
          }
        } : undefined,
        rec: ok ? this.t("✓ w normie", "✓ fine") : cheap.length ? this.t("zakresy Kal. " + cal + ": " + cheapTxt, "Cal. " + cal + " ranges: " + cheapTxt)
          : this.t("skróć do 1–2 okien (np. 05:00–07:00, 17:00–19:00)", "shorten to 1–2 windows (e.g. 05:00–07:00, 17:00–19:00)"),
        reason: cheap.length ? [`${this.f(hours, 1, 0)} h dziennie, ${this.f(outside / 60, 1, 0)} h poza tanią taryfą · ${this.f(S.dhwPerDay, 1, 0)} cykli/dobę`,
          `${this.f(hours, 1, 0)} h a day, ${this.f(outside / 60, 1, 0)} h outside the cheap tariff · ${this.f(S.dhwPerDay, 1, 0)} cycles/day`]
          : [`${this.f(hours, 1, 0)} h dziennie · ${this.f(S.dhwPerDay, 1, 0)} cykli/dobę`, `${this.f(hours, 1, 0)} h a day · ${this.f(S.dhwPerDay, 1, 0)} cycles/day`] });
    }
    // night mode (U11): lower compressor capacity = better COP and quieter, as long as the house keeps its temperature
    const nt = this.hist?.night, outNow = this.n("outdoor");
    if (this.eid("u11") && nt) {
      const hhmm = (t: number) => new Date(t).toLocaleTimeString(this.loc, { hour: "2-digit", minute: "2-digit" });
      const cold = nt.out < 3 || nt.dRoom <= -0.4 || (nt.run > 0.85 && nt.dRoom < -0.1);
      const mild = nt.out >= 5 && !(nt.dRoom < -0.2);
      const tonightCold = !isNaN(outNow) && outNow < 3;
      const ok = !cold && !tonightCold;
      const recTxt = cold ? this.t("wyłącz U11 na chłodne noce – pompa nie nadąża", "switch U11 off for cold nights – the heat pump cannot keep up")
        : tonightCold ? this.t(`dziś ${this.f(outNow, 1, 1)} °C – rozważ wyłączenie na tę noc`, `${this.f(outNow, 1, 1)} °C today – consider switching it off tonight`)
        : mild ? this.t("✓ zostaw – noc łagodna, niższe Hz = lepszy COP", "✓ keep – mild night, lower Hz = better COP")
        : this.t("✓ zostaw i obserwuj spadek temperatur", "✓ keep and watch the room temperatures");
      sched.push({ code: "U11", name: ["Tryb nocny (funkcja nocna)", "Night mode (night function)"], unit: "", kind: "info",
        model: this.t("wł. przy nocach ≥ 5 °C", "on for nights ≥ 5 °C"),
        why: ["ograniczona moc sprężarki: wyższy COP i ciszej; wyłącz, gdy w nocy zaczyna brakować mocy (pokoje spadają > 0,4 K)",
          "limited compressor power: higher COP and quieter; switch off when nights start to lack power (rooms drop > 0.4 K)"],
        value: this.t("ostatnio ", "last ") + hhmm(nt.t0) + "–" + hhmm(nt.t1) + (nt.learned ? "" : this.t(" (z opcji)", " (from options)")), ok, rec: recTxt,
        reason: [`ostatnia noc: zewn. ${this.f(nt.out, 1, 1)} °C, pokoje ${isNaN(nt.dRoom) ? "–" : (nt.dRoom > 0 ? "+" : "") + this.f(nt.dRoom, 1, 1) + " K"}, sprężarka ${Math.round(nt.run * 100)} % okna · ustawia się na piecu (U11–U13)`,
          `last night: outdoor ${this.f(nt.out, 1, 1)} °C, rooms ${isNaN(nt.dRoom) ? "–" : (nt.dRoom > 0 ? "+" : "") + this.f(nt.dRoom, 1, 1) + " K"}, compressor ${Math.round(nt.run * 100)} % of the window · set on the boiler (U11–U13)`] });
    }
    // FR - compressor frequency limit (F1/F2): lower Hz = better COP and quieter, but less power;
    // it does not limit DHW. Off when it is cold, the rooms lag behind or the compressor already runs most of the time.
    const extra: Row[] = [];
    // P07 - outdoor probe correction copied from the boiler menu (hub config number): informative
    if (this.eid("hub_p07")) {
      const p07 = this.n("hub_p07"), sg = p07 > 0 ? "+" : "";
      extra.push({ k: "hub_p07", code: "P07", name: ["Korekta sondy zewnętrznej", "Outdoor probe correction"], unit: "K", d: 0, kind: "info", group: "other",
        model: "0 K", why: ["korekta przesuwa całą krzywą – lepiej dobrze umieścić sondę", "a correction shifts the whole curve – better place the probe well"], value: p07, ok: !(p07 !== 0),
        rec: isNaN(p07) || p07 === 0 ? this.t("✓ bez korekty", "✓ no correction") : this.t(`sonda skorygowana o ${sg}${this.f(p07, 0)} K – sprawdź jej umiejscowienie`, `probe corrected by ${sg}${this.f(p07, 0)} K – check its placement`),
        reason: ["kopia z menu pieca; temperatura zewnętrzna (D06) jest już skorygowana", "copy of the boiler menu; the outdoor temperature (D06) is already corrected"] });
    }
    if (this.eid("f_fr")) {
      const frOn = this.on("f_fr"), lim = this.n("f_lim");
      const short2 = deficit > 0.5 || S.coShare > 0.7 || (!isNaN(outNow) && outNow < 2);
      const easy = !isNaN(outNow) && outNow >= 5 && !(deficit > 0.3) && !(S.coShare > 0.5);
      const rec = short2 ? "off" : easy ? "on" : frOn ? "on" : "off";
      extra.push({ k: "f_fr", code: "FR", name: ["Ograniczenie częstotliwości sprężarki", "Compressor frequency limit"], unit: "", kind: "switch",
        model: this.t("wł. przy cieple, wył. w chłody", "on when mild, off when cold"),
        why: [`limit ${this.f(lim, 0)} Hz: wyższy COP i ciszej, ale mniej mocy (CWU bez limitu)`, `limit ${this.f(lim, 0)} Hz: higher COP and quieter, but less power (DHW not limited)`],
        rec, reason: short2 ? [`brakuje mocy: pokoje ${this.f(deficit, 1, 1)} K poniżej nastaw, praca CO ${Math.round(S.coShare * 100)} % doby, zewn. ${this.f(outNow, 1, 1)} °C`,
            `short of power: rooms ${this.f(deficit, 1, 1)} K below target, CH running ${Math.round(S.coShare * 100)} % of the day, outdoor ${this.f(outNow, 1, 1)} °C`]
          : easy ? [`zapas mocy: zewn. ${this.f(outNow, 1, 1)} °C, pokoje przy nastawach, praca CO ${Math.round(S.coShare * 100)} % doby`, `power to spare: outdoor ${this.f(outNow, 1, 1)} °C, rooms at target, CH running ${Math.round(S.coShare * 100)} % of the day`]
          : ["warunki pośrednie – bez zmian", "in between – keep"] });
    }
    // anti-legionella P15: needed when the cylinder is kept below ~55 °C; the cycle belongs in the cheap tariff
    if (this.eid("p15")) {
      const dset = this.n("dhw_set"), needed = isNaN(dset) || dset < 55, legT = this.timeOpt("legionella_time");
      let inCheap = true;
      if (legT !== null && cheap.length) inCheap = cheap.some(([a, b]) => legT >= a && legT < b);
      const p15On = this.on("p15"), rec = needed ? "on" : "off";
      const when = legT === null ? "" : (this.dayName(this.dayOpt("legionella_day")) + " " + hm(legT));
      extra.push({ k: "p15", code: "P15", name: ["Anty-legionella", "Anti-legionella"], unit: "", kind: "switch",
        model: this.t("wł. przy CWU < 55 °C", "on with DHW < 55 °C"),
        why: ["raz na jakiś czas zasobnik do ~60 °C zabija bakterie Legionella; przy niższej nastawie to konieczne", "now and then the cylinder at ~60 °C kills Legionella; needed with a lower setpoint"],
        rec, reason: !needed ? ["nastawa CWU ≥ 55 °C – woda i tak jest dezynfekowana", "DHW setpoint ≥ 55 °C – the water is disinfected anyway"]
          : p15On && !inCheap ? [`nastawa ${this.f(dset, 0)} °C · termin ${when} poza tanią taryfą – przesuń na ${cheapTxt}`, `setpoint ${this.f(dset, 0)} °C · slot ${when} outside the cheap tariff – move it to ${cheapTxt}`]
          : [`nastawa CWU ${this.f(dset, 0)} °C${when ? " · termin " + when + (cheap.length ? (inCheap ? " (tania taryfa)" : "") : "") : ""}`,
            `DHW setpoint ${this.f(dset, 0)} °C${when ? " · slot " + when + (cheap.length ? (inCheap ? " (cheap tariff)" : "") : "") : ""}`] });
    }
    // CH setpoint in the rooms (room thermostats): 21 °C is the comfort model, every 1 K more costs ~6 % of heating;
    // a high hold (e.g. 23 °C to keep the floor loops open) is recommended down to 22 °C once the rooms are near it
    if (thermostats) {
      const tg = median(rooms.map((r) => r.set)), tMed = median(rooms.map((r) => r.t));
      const recT = tg > 22 && tMed >= 21 ? 22 : tg < 20 ? 21 : tg;
      const same = rooms.filter((r) => Math.abs(r.set - tg) < 0.01);
      extra.unshift({ code: "", name: ["Nastawa CO w pokojach (termostaty)", "CH setpoint in the rooms (thermostats)"], unit: "°C", d: 1, kind: "custom",
        model: 21, why: ["komfort; każdy 1 K więcej to ok. 6 % więcej ciepła", "comfort; each 1 K more is about 6 % more heat"],
        value: tg, rec: recT, has: true,
        setFn: recT !== tg ? () => same.forEach((r) => this.hass.callService("climate", "set_temperature", { entity_id: r.id, temperature: recT })) : undefined,
        reason: recT < tg ? [`${same.length} termostatów na ${this.f(tg, 1, 1)} °C, pokoje już ~${this.f(tMed, 1, 1)} °C – 22 °C nadal trzyma pętle otwarte, ok. ${Math.round((tg - recT) * 6)} % taniej`,
            `${same.length} thermostats at ${this.f(tg, 1, 1)} °C, rooms already ~${this.f(tMed, 1, 1)} °C – 22 °C still keeps the loops open, about ${Math.round((tg - recT) * 6)} % cheaper`]
          : recT > tg ? ["poniżej 20 °C – ryzyko wychłodzenia i długiego dogrzewania", "below 20 °C – risk of cooling down and long reheating"]
          : [`mediana nastaw ${this.f(tg, 1, 1)} °C, pokoje ~${this.f(tMed, 1, 1)} °C – bez zmian`, `median target ${this.f(tg, 1, 1)} °C, rooms ~${this.f(tMed, 1, 1)} °C – keep`] });
    }
    return [
      ...info,
      ...src,
      ...sched,
      ...extra,
      { k: "r05", code: "R05", name: ["Minimalne zasilanie CO (stopa krzywej)", "Minimum CH flow (curve foot)"], unit: "°C", d: 0,
        model: 25, why: perOne(["podłogówka: ~25 °C przy cieple na zewnątrz", "underfloor: ~25 °C in mild weather"], cfrac), rec: r05rec, reason: r05why },
      { k: "r04", code: "R04", name: ["Maksymalne zasilanie CO (szczyt krzywej)", "Maximum CH flow (curve top)"], unit: "°C", d: 0,
        model: isNaN(floor) ? 35 : Math.min(35, floor - 5), why: perOne(["podłogówka: 35 °C w mrozy, z zapasem do limitu podłogi", "underfloor: 35 °C in frost, with margin to the floor limit"], 1 - cfrac),
        rec: r04rec, reason: !isNaN(wait) ? r05why : [`ok. 10 K nad stopą krzywej${isNaN(floor) ? "" : `, max ${f(r04hi, 0)} °C (limit podłogi ${f(floor, 0)} − 5)`}`, `about 10 K above the curve foot${isNaN(floor) ? "" : `, max ${f(r04hi, 0)} °C (floor limit ${f(floor, 0)} − 5)`}`] },
      { k: "u03", code: "U03", name: ["Przesunięcie krzywej", "Curve offset"], unit: "K", d: 0,
        model: 0, why: perOne(["krzywą stroi się R04 / R05, offset zostaje 0", "tune the curve with R04 / R05, keep the offset at 0"], 1),
        rec: 0, reason: ["0 – korekta przez R05", "0 – correct with R05"] },
      { k: "room_mod", code: "", name: ["Modulacja z sondą pokojową", "Room probe modulation"], unit: "", kind: "select",
        model: thermostats ? modOpts[0] ?? "NIE" : modOpts[1] ?? "TAK", why: thermostats ? ["pokoje regulują własne termostaty – panel nie może zaniżać zasilania", "rooms have own thermostats – the panel must not lower the flow"]
          : ["bez termostatów pokojowych panel koryguje zasilanie", "without room thermostats the panel corrects the flow"],
        rec: thermostats ? modOpts[0] ?? "NIE" : modOpts[1] ?? "TAK", reason: thermostats ? [`${rooms.length} termostatów pokojowych`, `${rooms.length} room thermostats`] : ["brak termostatów pokojowych", "no room thermostats"] },
      { k: "zone1_set", code: "", name: ["Nastawa Strefy 1 (panel)", "Zone 1 setpoint (panel)"], unit: "°C", d: 1,
        model: 21, why: ["komfort pokojowy", "room comfort"],
        rec: modOn && thermostats ? maxSet : z, reason: modOn && thermostats ? ["przy modulacji: nie niżej niż najwyższa nastawa termostatów", "with modulation: not below the highest thermostat target"]
          : ["bez modulacji nie wpływa na zasilanie – bez zmian", "without modulation it does not change the flow – keep"] },
      { k: "t05", code: "T05", name: ["Zegar uruchamiania CO", "CH ignition timer"], unit: "min", d: 0,
        model: 15, why: ["pompa ciepła: najwyżej ~3 starty na godzinę", "heat pump: at most ~3 starts per hour"],
        rec: t05rec, reason: [`${this.f(S.coPerH, 1, 1)} startu CO na godzinę (24 h)${S.coPerH > 3 ? " – 15 min to maks. kotła, dalej R05" : " – 15 min chroni przed taktowaniem"}`, `${this.f(S.coPerH, 1, 1)} CH starts per hour (24 h)${S.coPerH > 3 ? " – 15 min is the boiler maximum, then R05" : " – 15 min guards against cycling"}`] },
      { k: "t07", code: "T07", name: ["Opóźnienie żądania z termostatu", "Room thermostat request delay"], unit: "s", d: 0,
        model: 0, why: ["bez opóźnienia – termostaty i tak pracują wolno", "no delay – the thermostats are slow anyway"], rec: 0, reason: ["0 s", "0 s"] },
      { k: "dhw_set", code: "D05", name: ["Nastawa CWU", "DHW setpoint"], unit: "°C", d: 1,
        model: dhwGas ? 50 : 48, why: dhwGas ? ["CWU kotłem: nastawa nie zmienia COP pompy; powyżej 55 °C rosną straty zasobnika i osad", "DHW by the boiler: the setpoint does not affect the heat-pump COP; above 55 °C cylinder losses and scale grow"]
          : ["pompa: każdy 1 K więcej to ~3 % gorszy COP; legionella osobno (P15)", "heat pump: each 1 K more costs ~3 % COP; legionella separately (P15)"],
        rec: dhwRec, reason: dhwGas ? (dhw > 55 ? ["powyżej 55 °C – straty zasobnika", "above 55 °C – cylinder losses"] : ["CWU kotłem, 45–55 °C – bez zmian", "DHW by the boiler, 45–55 °C – keep"])
          : dhw > 50 ? ["powyżej 50 °C pompa grzeje drogo", "above 50 °C the heat pump heats expensively"] : ["w zakresie 45–50 °C – bez zmian", "within 45–50 °C – keep"] },
      { k: "t02", code: "T02", name: ["Histereza CWU", "DHW hysteresis"], unit: "K", d: 0,
        model: 5, why: ["większa histereza = rzadsze, dłuższe cykle CWU", "larger hysteresis = fewer, longer DHW cycles"],
        rec: t02rec, reason: [`${this.f(S.dhwPerDay, 1, 0)} cykli CWU na dobę`, `${this.f(S.dhwPerDay, 1, 0)} DHW cycles per day`] },
      { k: "i10", code: "I10", name: ["Kocioł CO poniżej temp. zewn.", "Boiler CH below outdoor temp."], unit: "°C", d: 0,
        model: -5, why: ["punkt biwalentny: poniżej COP pompy < progu opłacalności gazu", "bivalent point: below it the COP falls under the gas break-even"],
        rec: this.n("i10"), reason: ["ustalone z cen prądu i gazu – bez zmian", "set from electricity and gas prices – keep"] },
      ...(this.eid("floor_type") ? [{ k: "floor_type", code: "", name: ["Rodzaj posadzki", "Floor screed type"], unit: "", kind: "select", group: "ch",
        model: this.s("floor_type") ?? "", why: ["jak szybko podłoga przyjmuje i oddaje ciepło: limit podłogi, obniżki, harmonogram CO i I04", "how fast the floor takes and gives back heat: floor limit, setbacks, CH schedule and I04"],
        rec: this.s("floor_type") ?? "", reason: ["ustaw zgodnie z budową podłogi", "set it to how the floor is built"] } as Row] : []),
      ...(floorE && this.hass.states[floorE] ? [(() => {
        const ft = this.floorType(), fm = ft === "dry" ? 40 : 45;
        const why: [string, string] = ft === "dry" ? ["system suchy (płyty, panele): do ~40 °C", "dry system (boards, panels): up to ~40 °C"]
          : ft === "cement" ? ["jastrych cementowy: do ~45 °C (decyduje wykończenie podłogi)", "cement screed: up to ~45 °C (the floor finish decides)"]
          : ["jastrych anhydrytowy: do ~45 °C", "anhydrite screed: up to ~45 °C"];
        return { entity: floorE, code: "", name: ["Limit zasilania podłogi", "Floor flow limit"], unit: "°C", d: 0, model: fm, why,
          rec: floor > fm ? fm : floor, reason: floor > fm ? [`powyżej ~${fm} °C dla tej posadzki`, `above ~${fm} °C for this screed`] : ["bez zmian", "keep"] } as Row;
      })()] : []),
      ...this.moreRows(S, thermostats, r05),
      { k: "dew_corr", code: "", name: ["Korekcja punktu rosy", "Dew point correction"], unit: "", kind: "switch",
        model: "on", why: ["chroni podłogę przed wykropleniem przy chłodzeniu", "protects the floor from condensation when cooling"], rec: "on", reason: ["zawsze włączona", "always on"] },
    ].map((r) => ({ ...r, kind: (r as Row).kind ?? "number" })) as Row[];
  }

  /** A04 (maximum pump speed) from the flow - return ΔT while heating: ΔT < 2 K = too much flow (−10 %, not below 60 %),
   *  ΔT > 6 K = too little (+10 %); with short compressor cycles keep the high flow (the curve first) */
  private a04Rec(S: ReturnType<ImmergasCalibrationCard["stats"]>): { rec: number; reason: [string, string] } {
    const a04 = this.n("a04"), dT = this.hist?.dT ?? NaN, short = S.coRun > 0 && S.coRun < 5;
    if (short) return { rec: 100, reason: ["krótkie cykle – nie zmniejszaj przepływu", "short cycles – do not reduce the flow"] };
    if (isNaN(a04) || isNaN(dT)) return { rec: a04, reason: ["bez zmian", "keep"] };
    const f1 = this.f(dT, 1, 1), low = this.dtLow(), sv = this.hist?.starved ?? [];
    if (dT < low && sv.length) {
      const nm = this.roomName(sv[0].id), pc = Math.round(sv[0].share * 100);
      return { rec: a04, reason: [`${nm} grzeje ${pc}% doby – przepływu nie zmniejszaj`, `${nm} heats ${pc}% of the day – do not reduce the flow`] };
    }
    if (dT < low) return { rec: Math.max(60, a04 - 10), reason: [`ΔT w CO ${f1} K – przepływ za duży`, `CH ΔT ${f1} K – too much flow`] };
    if (dT > 6) return { rec: Math.min(100, a04 + 10), reason: [`ΔT w CO ${f1} K – przepływ za mały`, `CH ΔT ${f1} K – too little flow`] };
    if (dT < 2) {
      const kw = this.f((this.hist?.pw ?? NaN) / 1000, 1, 1);
      return { rec: a04, reason: [`ΔT w CO ${f1} K przy ${kw} kW – przy niskiej mocy normalna`, `CH ΔT ${f1} K at ${kw} kW – normal at low output`] };
    }
    return { rec: a04, reason: [`ΔT w CO ${f1} K – w normie`, `CH ΔT ${f1} K – fine`] };
  }
  /** lowest healthy ΔT: 2 K at 5 kW of heat and more, proportionally less when the compressor modulates low (min 0,8 K) -
   *  the same flow carries less heat, so a small ΔT at 2 kW is not too much flow */
  private dtLow() {
    const pw = this.hist?.pw ?? NaN;
    return isNaN(pw) ? 2 : Math.min(2, Math.max(0.8, 2 * pw / 5000));
  }
  /** screed type from the hub select (option index 0 cement, 1 anhydrite, 2 dry system); "" when not set */
  private floorType(): "" | "cement" | "anhydrite" | "dry" {
    const o: string[] = this.attr("floor_type", "options") ?? [], i = o.indexOf(this.s("floor_type") ?? "");
    return i === 0 ? "cement" : i === 1 ? "anhydrite" : i === 2 ? "dry" : "";
  }
  /** largest setback a floor tolerates without a long reheat (K) */
  private setbackK() { return this.floorType() === "dry" ? 2 : 1; }

  private roomName(id: string) {
    return String(this.hass.states[id]?.attributes?.friendly_name ?? id).replace(/^(regulator|termostat|thermostat)\s+/i, "");
  }

  /** settings that are only on other cards: DHW Comfort / Eco, outing targets, force boiler, gas estimate,
   *  zone 1 humidity source */
  private extraRows(): Row[] {
    const rows: Row[] = [];
    const com = this.n("dhw_comfort_dd"), eco = this.n("dhw_eco_dd");
    if (!isNaN(com)) {
      const rec = com < 48 ? 48 : com > 55 ? 55 : com;
      rows.push({ k: "dhw_comfort_dd", code: "", name: ["CWU Komfort", "DHW Comfort"], unit: "°C", d: 0, group: "dhw",
        model: "48–55 °C", why: ["wygodny prysznic; powyżej 55 °C pompa grzeje drogo", "a comfortable shower; above 55 °C the heat pump heats expensively"],
        rec, reason: rec === com ? ["w zakresie – bez zmian", "within range – keep"] : com < 48 ? ["za chłodno na wygodny prysznic", "too cool for a comfortable shower"]
          : ["wyżej grzeje drogo – resztę zrobi anty-legionella", "higher is expensive – leave the rest to anti-legionella"] });
    }
    if (!isNaN(com) && !isNaN(eco)) {
      const gap = com - eco, rec = gap < 3 ? com - 3 : gap > 8 ? com - 5 : eco;
      rows.push({ k: "dhw_eco_dd", code: "", name: ["CWU Eko", "DHW Eco"], unit: "°C", d: 0, group: "dhw",
        model: this.t("Komfort − 3…8 K", "Comfort − 3…8 K"), why: ["poza godzinami zasobnik tylko podtrzymuje ciepło", "outside the schedule the cylinder only keeps warm"],
        rec, reason: rec === eco ? [`różnica ${this.f(gap, 0)} K – bez zmian`, `difference ${this.f(gap, 0)} K – keep`]
          : gap < 3 ? ["prawie jak Komfort – mała oszczędność", "almost like Comfort – little saving"] : ["za nisko – woda wystygnie przed Komfortem", "too low – the water cools before Comfort"] });
    }
    // outing targets: frost protection with the least energy (water heating, room heating, DHW cylinder)
    const out: [Key, string, [string, string], number, number, number][] = [
      ["fsv5013", "5013", ["Wyjazd: woda grzanie", "Outing: heating water"], 15, 15, 25],
      ["fsv5014", "5014", ["Wyjazd: pokój grzanie", "Outing: room heating"], 16, 12, 18],
      ["fsv5019", "5019", ["Wyjazd: zasobnik CWU", "Outing: DHW cylinder"], 30, 25, 40],
    ];
    for (const [k, code, name, model, lo, hi] of out) {
      const v = this.n(k);
      if (isNaN(v)) continue;
      const rec = v < lo ? lo : v > hi ? hi : v;
      rows.push({ k, code: "FSV " + code, name, unit: "°C", d: 0, group: "other", model,
        why: ["ochrona przed mrozem przy najmniejszym zużyciu", "frost protection with the least energy"],
        rec, reason: rec === v ? ["bez zmian", "keep"] : v < lo ? ["za nisko – ryzyko wychłodzenia", "too low – risk of cooling down"] : ["za wysoko – po co grzać pusty dom", "too high – no need to heat an empty house"] });
    }
    if (this.eid("force_boiler")) rows.push({ k: "force_boiler", code: "", name: ["Wymuś grzanie kotłem", "Force boiler heating"], unit: "", kind: "switch", group: "int",
      model: "off", why: ["tylko na chwilę, np. przy awarii pompy", "only briefly, e.g. when the heat pump fails"], rec: "off",
      reason: this.on("force_boiler") ? ["włączone – całe CO idzie z gazu", "on – all CH comes from gas"] : ["wyłączone", "off"] });
    const gc = this.n("gas_cal_co"), gw = this.n("gas_cal_dhw");
    if (this.hasGas && !isNaN(gc) && !isNaN(gw)) rows.push({ code: "", name: ["Szacowanie gazu (m³/h CO / CWU)", "Gas estimate (m³/h CH / DHW)"], unit: "", kind: "info", group: "other",
      model: this.t("jak licznik", "like the meter"), why: ["hub szacuje gaz z czasu pracy kotła", "the hub estimates gas from the boiler runtime"],
      value: `${this.f(gc, 2, 1)} / ${this.f(gw, 2, 1)}`, ok: true,
      rec: this.t("✓ raz w sezonie porównaj z licznikiem", "✓ compare with the meter once a season"),
      reason: ["różnica licznika ÷ przyrost „Gaz szacowane zużycie” × obie wartości", "meter difference ÷ increase of “Gas estimated consumption” × both values"] });
    const ho: string[] = this.attr("hum_src", "options") ?? [], hs = this.s("hum_src") ?? "";
    if (ho.length > 1 && hs) rows.push({ k: "hum_src", code: "", name: ["Źródło wilgotności strefy 1", "Zone 1 humidity source"], unit: "", kind: "select", group: "cool",
      model: this.t("czujnik w strefie", "a sensor in the zone"), why: ["korekcja punktu rosy liczy z tej wilgotności", "the dew point correction uses this humidity"],
      rec: hs === ho[0] ? ho[1] : hs, reason: hs === ho[0] ? ["panel mierzy wilgotność w jednym miejscu", "the panel measures humidity in one place"] : ["bez zmian", "keep"] });
    return rows;
  }

  /** the remaining Atom parameters: system mode, fixed flow, outdoor probe, zone sources, Comfort / Eco presets, pump
   *  speeds, boiler integration (I03-I09), cooling curve and humidity, boost duration, venting, T04 */
  private moreRows(S: ReturnType<ImmergasCalibrationCard["stats"]>, thermostats: boolean, r05: number): Row[] {
    const outNow = this.n("outdoor"), cool = this.s("mode") === ((this.attr("mode", "options") ?? []) as string[])[2];
    const mo: string[] = this.attr("mode", "options") ?? [], curMode = this.s("mode") ?? "";
    const modeRec = mo.length === 4 ? (outNow < 13 ? mo[3] : outNow > 17 && curMode === mo[3] ? mo[1] : curMode) : curMode;
    const r01o: string[] = this.attr("r01", "options") ?? [];
    const i01on = this.on("i01");
    const ch = this.n("comfort_heat"), eh = this.n("eco_heat"), cc = this.n("comfort_cool"), ec = this.n("eco_cool");
    // screed: largest setback and how long the heat pump runs alone before the boiler joins (I04, min)
    const sbK = this.setbackK(), i04m = { dry: 60, anhydrite: 90, cement: 120, "": 120 }[this.floorType()];
    const r12 = this.n("r12"), r13 = this.n("r13");
    const noEff = (on: boolean): [string, string] => on ? ["", ""] : [" (teraz bez wpływu)", " (no effect now)"];
    const rows: Row[] = [
      { k: "mode", code: "", name: ["Tryb pracy systemu", "System operating mode"], unit: "", kind: "select", group: "use",
        model: this.t("Zima < 13 °C, Lato > 17 °C", "Winter < 13 °C, Summer > 17 °C"),
        why: ["CO tylko wtedy, gdy na zewnątrz chłodno; w lecie tylko CWU", "CH only when it is cool outside; DHW only in summer"],
        rec: modeRec, reason: [`na zewnątrz ${this.f(outNow, 1, 1)} °C`, `outdoor ${this.f(outNow, 1, 1)} °C`] },
      { k: "r01", code: "R01", name: ["Sonda temperatury zewnętrznej", "Outdoor temperature probe"], unit: "", kind: "select", group: "ch",
        model: r01o[1] ?? "OU", why: ["krzywa grzewcza wymaga temperatury zewnętrznej; sonda jednostki zewnętrznej jest na miejscu", "the heating curve needs the outdoor temperature; the outdoor unit probe is in place"],
        rec: r01o[1] ?? this.s("r01") ?? "", reason: ["krzywa R04 / R05 działa tylko z sondą", "the R04 / R05 curve works only with a probe"] },
      { k: "set_flow", code: "", name: ["Stała temperatura zasilania strefy 1", "Zone 1 fixed flow temperature"], unit: "°C", d: 0, group: "ch",
        model: isNaN(r05) ? 30 : r05 + 5, why: ["używana bez krzywej (R01 = OFF); przy sondzie zasilanie liczy krzywa", "used without the curve (R01 = OFF); with a probe the curve sets the flow"],
        rec: this.n("set_flow"), reason: this.s("r01") === r01o[0] ? ["R01 = OFF – ta wartość steruje zasilaniem", "R01 = OFF – this value drives the flow"] : ["z sondą bez wpływu – bez zmian", "no effect with a probe – keep"] },
      { k: "comfort_heat", code: "", name: ["Komfort – grzanie", "Comfort – heating"], unit: "°C", d: 1, group: "ch",
        model: 21, why: ["temperatura komfortu w programie AUTO", "comfort temperature in the AUTO program"], rec: isNaN(ch) ? NaN : ch < 20 || ch > 22 ? 21 : ch,
        reason: [ch < 20 || ch > 22 ? "poza zakresem 20–22 °C" : "w zakresie 20–22 °C", ch < 20 || ch > 22 ? "outside 20–22 °C" : "within 20–22 °C"] },
      { k: "eco_heat", code: "", name: ["Eko – grzanie", "Eco – heating"], unit: "°C", d: 1, group: "ch",
        model: isNaN(ch) ? 21 - sbK : ch - sbK, why: this.floorType() === "dry" ? ["najwyżej 2 K poniżej Komfortu – system suchy szybko się nagrzewa", "at most 2 K under Comfort – a dry system reheats fast"]
          : ["najwyżej 1 K poniżej Komfortu – podłoga długo się nagrzewa", "at most 1 K under Comfort – a floor reheats slowly"],
        rec: isNaN(ch) || isNaN(eh) ? eh : ch - eh > sbK + 0.5 ? ch - sbK : eh, reason: [`różnica ${this.f(ch - eh, 1, 1)} K`, `difference ${this.f(ch - eh, 1, 1)} K`] },
      { k: "temp_src", code: "", name: ["Źródło temperatury strefy 1", "Zone 1 temperature source"], unit: "", kind: "select", group: "ch",
        model: this.t("piętro najwolniej się grzejące", "the slowest-heating floor"),
        why: ["temperatura strefy dla panelu i modulacji; przy termostatach pokojowych tylko informacyjnie", "zone temperature for the panel and modulation; with room thermostats informative only"],
        rec: this.s("temp_src") ?? "", reason: thermostats ? ["modulacja wyłączona – bez zmian", "modulation off – keep"] : ["bez zmian", "keep"] },
      { k: "boost_min", code: "", name: ["Czas wymuszenia CWU", "DHW boost duration"], unit: "min", d: 0, group: "dhw",
        model: 30, why: ["pompa grzeje zasobnik ~25–40 min", "the heat pump heats the cylinder in ~25–40 min"],
        rec: this.n("boost_min") < 25 ? 30 : this.n("boost_min"), reason: [this.n("boost_min") < 25 ? "za krótko na pełny cykl pompą" : "wystarcza na pełny cykl", this.n("boost_min") < 25 ? "too short for a full heat-pump cycle" : "enough for a full cycle"] },
      { k: "i03", code: "I03", name: ["Kocioł dołącza do CWU po", "Boiler joins DHW after"], unit: "min", d: 0, group: "dhw",
        model: 15, why: ["wartość Immergasa; 1 min = CWU od razu kotłem" + noEff(i01on)[0], "Immergas default; 1 min = DHW by the boiler at once" + noEff(i01on)[1]],
        rec: this.n("i03"), reason: i01on ? ["ustawiane przyciskiem źródła CWU", "set by the DHW source buttons"] : ["I01 OFF (CWU pompą) – bez wpływu", "I01 OFF (DHW by heat pump) – no effect"] },
      { k: "i09", code: "I09", name: ["CWU kotłem poniżej temp. zewn.", "DHW by boiler below outdoor temp."], unit: "°C", d: 0, group: "dhw",
        model: -5, why: ["jak I10: przy mrozie CWU taniej z gazu" + noEff(i01on)[0], "like I10: in frost DHW is cheaper from gas" + noEff(i01on)[1]],
        // DHW chosen "by the boiler" (I03 = 1 min): the threshold only decides whether the heat pump even starts first -
        // a high I09 (e.g. 30 °C) is the intended "always gas", so it is kept
        rec: !i01on ? this.n("i09") : this.dhwSource().cur === "boiler" ? this.n("i09") : -5,
        reason: !i01on ? ["I01 OFF – bez wpływu", "I01 OFF – no effect"]
          : this.dhwSource().cur === "boiler" ? ["CWU kotłem (I03 = 1 min) – wysoki próg = zawsze gaz, bez zmian", "DHW by the boiler (I03 = 1 min) – a high threshold means always gas, keep"]
          : ["integracja CWU włączona – próg jak dla CO", "DHW integration on – same threshold as CH"] },
      { k: "a03", code: "A03", name: ["Pompa obiegowa – minimalna prędkość", "Circulation pump – minimum speed"], unit: "%", d: 0, group: "pump",
        model: 55, why: ["dolna granica modulacji pompy", "lower limit of the pump modulation"], rec: this.n("a03"), reason: ["bez zmian", "keep"] },
      { k: "a04", code: "A04", name: ["Pompa obiegowa – maksymalna prędkość", "Circulation pump – maximum speed"], unit: "%", d: 0, group: "pump",
        model: 100, why: ["duży przepływ trzyma niższe zasilanie = dłuższe cykle sprężarki", "high flow keeps the flow temperature lower = longer compressor cycles"],
        ...this.a04Rec(S) },
      { k: "i02", code: "I02", name: ["Integracja z kotłem (CO)", "Boiler integration (CH)"], unit: "", kind: "switch", group: "int",
        model: "on", why: ["kocioł jako zapas w mrozy (I10)", "the boiler as a backup in frost (I10)"], rec: "on", reason: ["bez kotła pompa sama w mrozy", "without the boiler the heat pump is alone in frost"] },
      { k: "i04", code: "I04", name: ["Kocioł dołącza do CO po", "Boiler joins CH after"], unit: "min", d: 0, group: "int",
        model: i04m, why: this.floorType() === "dry" ? ["system suchy reaguje szybko – kocioł może dołączyć wcześniej", "a dry system reacts fast – the boiler may join earlier"]
          : this.floorType() === "anhydrite" ? ["anhydryt reaguje szybciej niż cement – nie wołaj kotła za wcześnie", "anhydrite reacts faster than cement – do not call the boiler too early"]
          : ["podłoga jest wolna – nie wołaj kotła za wcześnie", "a floor is slow – do not call the boiler too early"], rec: this.n("i04") < i04m / 2 ? i04m : this.n("i04"),
        reason: [this.n("i04") < i04m / 2 ? "za szybko jak na tę podłogę" : "w porządku dla tej podłogi", this.n("i04") < i04m / 2 ? "too quick for this floor" : "fine for this floor"] },
      { k: "i05", code: "I05", name: ["Tryb aktywacji integracji", "Integration activation mode"], unit: "", kind: "select", group: "int",
        model: (this.attr("i05", "options") ?? [])[1] ?? "MA", why: ["ręczny próg I10 z cen prądu i gazu", "manual I10 threshold from the prices"], rec: (this.attr("i05", "options") ?? [])[1] ?? this.s("i05") ?? "", reason: ["próg I10 ustalony świadomie", "I10 set on purpose"] },
      { k: "i07", code: "I07", name: ["Przedział aktywacji", "Activation band"], unit: "K", d: 0, group: "int",
        model: 5, why: ["od I10 do I10 + I07 pompa, gaz dołącza po I04", "from I10 to I10 + I07 heat pump, gas joins after I04"], rec: this.n("i07"), reason: ["wartość Immergasa – bez zmian", "Immergas default – keep"] },
      { k: "comfort_cool", code: "", name: ["Komfort – chłodzenie", "Comfort – cooling"], unit: "°C", d: 1, group: "cool",
        model: 24, why: ["24–25 °C: chłodno, bez ryzyka rosy na podłodze", "24–25 °C: cool without dew on the floor"], rec: cc < 23 ? 24 : cc,
        reason: cc < 23 ? [`${this.f(cc, 1, 1)} °C to za nisko dla chłodzenia podłogą${cool ? "" : " (teraz bez wpływu)"}`, `${this.f(cc, 1, 1)} °C is too low for floor cooling${cool ? "" : " (no effect now)"}`] : ["w porządku", "fine"] },
      { k: "eco_cool", code: "", name: ["Eko – chłodzenie", "Eco – cooling"], unit: "°C", d: 1, group: "cool",
        model: 26, why: ["Eko przy chłodzeniu jest wyżej niż Komfort", "in cooling Eco is above Comfort"], rec: ec < (cc < 23 ? 24 : cc) + 1 ? (cc < 23 ? 24 : cc) + 2 : ec,
        reason: ["Komfort + 2 K", "Comfort + 2 K"] },
      { k: "r12", code: "R12", name: ["Minimalne zasilanie chłodzenia", "Minimum cooling flow"], unit: "°C", d: 0, group: "cool",
        model: 18, why: ["podłoga: nie zimniej niż ~18 °C (rosa)", "floor: not colder than ~18 °C (dew)"], rec: r12 < 18 ? 18 : r12, reason: [r12 < 18 ? "ryzyko wykroplenia" : "w porządku", r12 < 18 ? "condensation risk" : "fine"] },
      { k: "r13", code: "R13", name: ["Maksymalne zasilanie chłodzenia", "Maximum cooling flow"], unit: "°C", d: 0, group: "cool",
        model: 22, why: ["przy umiarkowanym upale wystarczy cieplejsza woda", "warmer water is enough in moderate heat"], rec: r13 < Math.max(r12, 18) + 2 ? Math.max(r12, 18) + 4 : r13,
        reason: ["min. 2 K nad R12", "at least 2 K above R12"] },
      { k: "u07", code: "U07", name: ["Wilgotność zadana strefy 1", "Zone 1 humidity setpoint"], unit: "%", d: 0, group: "cool",
        model: 50, why: ["40–60 % to komfort; przy chłodzeniu wpływa na punkt rosy", "40–60 % is comfortable; in cooling it shifts the dew point"], rec: this.n("u07") > 60 || this.n("u07") < 40 ? 50 : this.n("u07"),
        reason: ["w zakresie 40–60 %", "within 40–60 %"] },
      { k: "a12", code: "A12", name: ["Auto-odpowietrzanie przy starcie", "Auto venting at power-up"], unit: "", kind: "switch", group: "other",
        model: "on", why: ["usuwa powietrze po każdym włączeniu pieca", "removes air after every boiler power-up"], rec: "on", reason: ["zostaw włączone", "keep on"] },
      { k: "vent_start", code: "", name: ["Odpowietrzanie teraz", "Venting now"], unit: "", kind: "switch", group: "other",
        model: "off", why: ["tylko na chwilę po pracach przy instalacji – piec wtedy nie grzeje", "only briefly after work on the system – the boiler does not heat meanwhile"], rec: "off",
        reason: this.on("vent_start") ? ["włączone – piec nie grzeje", "on – the boiler does not heat"] : ["wyłączone", "off"] },
      { k: "t04", code: "T04", name: ["Parametr nieopisany", "Undocumented parameter"], unit: "", d: 0, group: "other",
        model: "–", why: ["znaczenie nieznane", "meaning unknown"], rec: this.n("t04"), reason: ["nie zmieniaj", "do not change"] },
      ...this.extraRows(),
    ];
    rows.push(...this.diagRows(S, thermostats));
    return rows.map((r) => ({ ...r, kind: r.kind ?? "number" }));
  }

  /** diagnostics from live data: heat spread between floors, pump flow-return difference, COP against a model,
   *  DHW COP, outing mode vs. vacation, night capacity limit */
  private diagRows(S: ReturnType<ImmergasCalibrationCard["stats"]>, thermostats: boolean): Row[] {
    const out: Row[] = [], h = this.hass, f1 = (v: number) => this.f(v, 1, 1);
    // floors: room thermostat -> area (entity or device) -> floor
    if (thermostats && h.floors && h.areas) {
      const byFloor: Record<string, number[]> = {};
      for (const r of this.rooms()) {
        const ent = h.entities?.[r.id], area = ent?.area_id ?? h.devices?.[ent?.device_id]?.area_id, fl = area ? h.areas[area]?.floor_id : undefined;
        const name = fl ? h.floors[fl]?.name ?? fl : undefined;
        if (name) (byFloor[name] ??= []).push(r.set - r.t);
      }
      const fl = Object.entries(byFloor).map(([n, v]) => [n, median(v)] as [string, number]).sort((a, b) => b[1] - a[1]);
      if (fl.length >= 2) {
        const spread = fl[0][1] - fl[fl.length - 1][1], worst = fl[0][0];
        out.push({ code: "", name: ["Rozkład ciepła między piętrami", "Heat spread between floors"], unit: "", kind: "info", group: "ch",
          model: "≤ 0,5 K", why: ["różnica niedogrzania pięter; większa = nierówny przepływ na rozdzielaczach", "difference in under-heating of the floors; larger = uneven manifold flow"],
          value: fl.map(([n, v]) => `${n} ${v > 0 ? "−" : "+"}${f1(Math.abs(v))} K`).join(" · "), ok: spread <= 0.5,
          rec: spread > 0.5 ? this.t(`${worst} dogrzewa się wolniej – zwiększ przepływ na jego rozdzielaczu, sprawdź siłowniki`, `${worst} heats slower – raise the flow on its manifold, check the actuators`) : this.t("✓ równo", "✓ even"),
          reason: [`różnica ${f1(spread)} K (mediana nastawa − temperatura na piętrze)`, `difference ${f1(spread)} K (median target − temperature per floor)`] });
      }
    }
    // flow - return while heating
    const dT = this.hist?.dT ?? NaN;
    if (!isNaN(dT)) {
      const short = S.coRun > 0 && S.coRun < 5, a04 = this.n("a04"), aRec = this.a04Rec(S).rec, low = this.dtLow(), sv = this.hist?.starved ?? [];
      const pw = this.hist?.pw ?? NaN, lph = this.hist?.lpm ?? NaN;
      const at = isNaN(pw) ? ["", ""] : [` przy ${this.f(pw / 1000, 1, 1)} kW${isNaN(lph) ? "" : ` i ${this.f(lph, 0, 0)} l/h`}`, ` at ${this.f(pw / 1000, 1, 1)} kW${isNaN(lph) ? "" : ` and ${this.f(lph, 0, 0)} l/h`}`];
      out.push({ code: "", name: ["ΔT zasilanie – powrót w pracy CO", "Flow – return ΔT while heating"], unit: "K", d: 1, kind: "info", group: "pump",
        model: this.t("3–5 K przy pełnej mocy", "3–5 K at full output"), why: ["przy niskiej mocy sprężarki ten sam przepływ daje mniejszą ΔT", "at low compressor output the same flow gives a smaller ΔT"], value: dT, ok: dT >= low && dT <= 6,
        rec: dT < low ? (short ? this.t("przepływ duży, ale przy krótkich cyklach zostaw – najpierw krzywa", "high flow, but keep it while cycles are short – the curve first")
            : sv.length ? this.t(`zostaw A04 – ${this.roomName(sv[0].id)} grzeje ${Math.round(sv[0].share * 100)}% doby, brakuje mu wody`, `keep A04 – ${this.roomName(sv[0].id)} heats ${Math.round(sv[0].share * 100)}% of the day, it lacks water`)
            : this.t(`zmniejsz A04 do ${Math.max(60, a04 - 10)} %`, `lower A04 to ${Math.max(60, a04 - 10)} %`))
          : dT < 2 ? this.t("✓ niska moc – mała ΔT jest normalna", "✓ low output – a small ΔT is normal")
          : dT > 6 ? this.t("za mały przepływ – podnieś A03 / A04, sprawdź filtr", "too little flow – raise A03 / A04, check the filter") : this.t("✓ w normie", "✓ fine"),
        reason: [`mediana z pracy pompy w CO, 24 h${at[0]}`, `median while the heat pump heats CH, 24 h${at[1]}`],
        // the same change as the A04 row: Set writes the recommended A04
        setFn: this.eid("a04") && !isNaN(aRec) && aRec !== a04 ? () => this.call("number", "set_value", "a04", { value: aRec }) : undefined });
    }
    // COP today against a model: ~45 % of Carnot at the median flow and the outdoor temperature (capped at 6)
    const cop = this.n("cop_today"), tout = this.n("outdoor"), tf = this.hist?.flow ?? this.n("d04");
    if (cop > 0 && !isNaN(tout) && tf > tout + 3) {
      const model = Math.min(6, 0.45 * (tf + 273.15) / (tf - tout)), ok = cop >= model * 0.6;
      out.push({ code: "", name: ["COP pompy dziś", "Heat-pump COP today"], unit: "", d: 1, kind: "info", group: "cyc",
        model: "≈ " + f1(model), why: [`dla zasilania ~${this.f(tf, 0)} °C i ${f1(tout)} °C na zewnątrz (45 % Carnota)`, `for ~${this.f(tf, 0)} °C flow and ${f1(tout)} °C outdoor (45 % of Carnot)`],
        value: cop, ok, rec: ok ? this.t("✓ w normie", "✓ fine") : this.t("straty na taktowaniu i CWU – dłuższe cykle (R05), niższa nastawa CWU", "losses on cycling and DHW – longer cycles (R05), lower DHW setpoint"),
        reason: [`${Math.round(cop / model * 100)} % modelu (COP dziś zawiera też CWU)`, `${Math.round(cop / model * 100)} % of the model (today's COP includes DHW)`] });
    }
    // DHW COP of the last cycle
    const dc = [this.n("dhw_cop_flow"), this.n("dhw_cop_tank")].filter((v) => v > 0), copD = dc.length ? dc.reduce((a, b) => a + b, 0) / dc.length : NaN;
    if (!isNaN(copD)) {
      const dset = this.n("dhw_set");
      out.push({ code: "", name: ["COP ciepłej wody (ostatni cykl)", "Hot water COP (last cycle)"], unit: "", d: 1, kind: "info", group: "dhw",
        model: "≥ 2,5", why: ["pompa przy ~50 °C i 5–15 °C na zewnątrz", "heat pump at ~50 °C and 5–15 °C outdoor"], value: copD, ok: copD >= 2.5,
        rec: copD >= 2.5 ? this.t("✓ w normie", "✓ fine") : dset > 46 ? this.t(`obniż nastawę CWU do 45–46 °C (teraz ${this.f(dset, 0)} °C)`, `lower the DHW setpoint to 45–46 °C (now ${this.f(dset, 0)} °C)`)
          : this.t("niska – sprawdź wężownicę i czas cyklu", "low – check the coil and the cycle time"),
        reason: ["średnia metody przepływu i zasobnika", "mean of the flow and cylinder methods"] });
    }
    const x = this.hist?.x;
    if (x) {
      // defrosting: normal below ~3 °C, rare above ~7 °C; frequent in mild weather = coil or airflow problem
      if (!isNaN(x.outMean)) {
        const mild = x.outMean > 5, many = mild ? x.defrosts > 4 : x.defrosts > 30;
        out.push({ code: "", name: ["Odszranianie (24 h)", "Defrosting (24 h)"], unit: "×", d: 0, kind: "info", group: "other",
          model: mild ? "≤ 4" : "≤ 30", why: ["szron rośnie przy 0–5 °C i wilgoci; przy dodatniej pogodzie odszraniania prawie nie ma", "frost grows at 0–5 °C in humid air; in mild weather defrosting is rare"],
          value: x.defrosts, ok: !many,
          rec: many ? this.t("częste jak na tę pogodę – wyczyść parownik, sprawdź odpływ skroplin i czy nic nie zasłania jednostki", "frequent for this weather – clean the coil, check the condensate drain and that nothing blocks the unit")
            : this.t("✓ w normie", "✓ fine"),
          reason: [`średnio ${f1(x.outMean)} °C na zewnątrz`, `mean ${f1(x.outMean)} °C outdoor`] });
      }
      // evaporator approach: outdoor air - coil temperature while running
      if (!isNaN(x.evap)) {
        const hi = x.evap > 10;
        out.push({ code: "", name: ["Parownik – różnica do powietrza", "Evaporator – difference to the air"], unit: "K", d: 1, kind: "info", group: "other",
          model: "3–8 K", why: ["czysty parownik przy dobrym przepływie powietrza jest kilka K zimniejszy od powietrza", "a clean coil with good airflow is a few K colder than the air"],
          value: x.evap, ok: !hi,
          rec: hi ? this.t("za duża – brudny lub oszroniony parownik, słaby wentylator albo mało czynnika (serwis)", "too large – dirty or iced coil, weak fan or low refrigerant (service)")
            : this.t("✓ w normie", "✓ fine"),
          reason: ["mediana z pracy sprężarki, 24 h", "median while the compressor runs, 24 h"] });
      }
      // discharge temperature
      if (!isNaN(x.dischargeMax)) {
        const hot = x.dischargeMax > 110;
        out.push({ code: "D73", name: ["Temperatura tłoczenia – maksimum", "Discharge temperature – maximum"], unit: "°C", d: 0, kind: "info", group: "other",
          model: "< 110 °C", why: ["przy ładowaniu CWU 90–105 °C to norma; wyżej sprężarka ogranicza moc dla ochrony", "90–105 °C is normal while heating DHW; above it the compressor limits its power to protect itself"],
          value: x.dischargeMax, ok: !hot,
          rec: hot ? this.t("wysoka – sprawdź przepływ wody (filtr, A04) i nastawę CWU; trwale wysoka = mało czynnika", "high – check the water flow (filter, A04) and the DHW setpoint; high all the time = low refrigerant")
            : this.t("✓ w normie", "✓ fine"),
          reason: ["z pracy sprężarki, 24 h", "while the compressor runs, 24 h"] });
      }
      // standby power of the outdoor unit
      // the bus power reading of some units is 0 when stopped - then the standby power is not measured
      if (x.standby >= 1) {
        const price = this.n("price_elec"), month = x.standby * 24 * 30 / 1000, high = x.standby > 60;
        out.push({ code: "", name: ["Pobór w postoju", "Standby power"], unit: "W", d: 0, kind: "info", group: "use",
          model: "≤ 30 W", why: ["elektronika jednostki; więcej = grzałka karteru / tacy ociekowej", "unit electronics; more = crankcase / drip-tray heater"],
          value: x.standby, ok: !high,
          rec: high ? this.t("wysoki – grzałki jednostki zewnętrznej pracują także w cieple; sprawdź ich ustawienia (FSV) z serwisem", "high – outdoor-unit heaters run in mild weather too; check their settings (FSV) with the service")
            : this.t("✓ w normie", "✓ fine"),
          reason: [`~${this.f(month, 0)} kWh/mies.${price > 0 ? ` ≈ ${this.f(month * price, 0)} ${this.currency}` : ""}`, `~${this.f(month, 0)} kWh/month${price > 0 ? ` ≈ ${this.f(month * price, 0)} ${this.currency}` : ""}`] });
      }
      // cylinder heat loss at night
      if (!isNaN(x.tankLoss)) {
        const vol = this.n("tank_vol"), watts = vol > 0 ? x.tankLoss * vol * 1.163 : NaN, bad = x.tankLoss > 0.5;
        out.push({ code: "", name: ["Straty zasobnika CWU w nocy", "DHW cylinder loss at night"], unit: "K/h", d: 2, kind: "info", group: "dhw",
          model: "≤ 0,3 K/h", why: ["dobrze izolowany zasobnik bez cyrkulacji traci kilka dziesiątych K na godzinę", "a well insulated cylinder without circulation loses a few tenths of a K per hour"],
          value: x.tankLoss, ok: !bad,
          rec: bad ? this.t("duże – wyłącz cyrkulację CWU w nocy (harmonogram pompki), sprawdź izolację i zawór zwrotny", "large – stop the DHW circulation at night (pump timer), check the insulation and the check valve")
            : this.t("✓ w normie", "✓ fine"),
          reason: [`${this.f(x.tankHours, 1, 1)} h bez grzania CWU${!isNaN(watts) ? ` · ~${this.f(watts, 0)} W` : ""} (pobór wody też obniża)`, `${this.f(x.tankHours, 1, 1)} h without DHW heating${!isNaN(watts) ? ` · ~${this.f(watts, 0)} W` : ""} (water use also lowers it)`] });
      }
      // gas space heating in mild weather
      if (this.eid("boiler_running") && !isNaN(this.n("i10"))) {
        const warm = x.gasWarm > 15;
        out.push({ code: "", name: ["Kocioł w CO przy łagodnej pogodzie", "Boiler heating in mild weather"], unit: "min", d: 0, kind: "info", group: "int",
          model: "0 min", why: ["powyżej progu I10 pompa sama powinna pokryć zapotrzebowanie", "above I10 the heat pump alone should cover the demand"],
          value: x.gasWarm, ok: !warm,
          rec: warm ? this.t("kocioł dołączał mimo ciepła – wydłuż I04 albo obniż krzywą (R04/R05)", "the boiler joined although it was mild – lengthen I04 or lower the curve (R04/R05)")
            : this.t("✓ w normie", "✓ fine"),
          reason: [`czas kotła w CO przy temp. > I10 + 2 K (${this.f(this.n("i10") + 2, 0)} °C), 24 h`, `boiler CH time at > I10 + 2 K (${this.f(this.n("i10") + 2, 0)} °C), 24 h`] });
      }
    }
    // outing mode should follow the vacation
    if (this.eid("f_outing")) {
      const away = h.states["input_boolean.auto_pompa_urlop_aktywny"]?.state === "on";
      out.push({ k: "f_outing", code: "", name: ["Tryb wyjazdowy (F1/F2)", "Outing mode (F1/F2)"], unit: "", kind: "switch", group: "use",
        model: this.t("wł. tylko podczas wyjazdu", "on only while away"), why: ["obniżone nastawy FSV 5011–5019 na czas nieobecności", "lowered FSV 5011–5019 targets while away"],
        rec: away ? "on" : "off", reason: away ? ["urlop aktywny", "vacation active"] : ["domownicy w domu", "people at home"] });
    }
    // night capacity limit (set on the boiler with U11)
    const np = this.n("night_pct"), nt = this.hist?.night;
    if (!isNaN(np) && np > 0) {
      const drop = nt && nt.dRoom <= -0.3;
      out.push({ code: "", name: ["Nocny limit wydajności", "Night capacity limit"], unit: "%", d: 0, kind: "info", group: "use",
        model: "30–50 %", why: ["niżej = ciszej i lepszy COP, ale mniej mocy w nocy", "lower = quieter and better COP, but less power at night"], value: np, ok: !drop,
        rec: drop ? this.t("pokoje spadały w nocy – podnieś limit na piecu", "rooms dropped at night – raise the limit on the boiler") : this.t("✓ wystarcza", "✓ enough"),
        reason: nt ? [`ostatnia noc: pokoje ${nt.dRoom > 0 ? "+" : ""}${f1(nt.dRoom)} K`, `last night: rooms ${nt.dRoom > 0 ? "+" : ""}${f1(nt.dRoom)} K`] : ["brak danych z nocy", "no night data"] });
    }
    // building heat loss coefficient: slope of daily heat against indoor - outdoor (the intercept takes DHW and gains)
    const lp = this.loss?.pts ?? [];
    if (this.loss) {
      const n = lp.length, mx = n ? lp.reduce((a, p) => a + p[0], 0) / n : NaN, my = n ? lp.reduce((a, p) => a + p[1], 0) / n : NaN;
      const sxx = lp.reduce((a, p) => a + (p[0] - mx) ** 2, 0), b = sxx > 0 ? lp.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / sxx : NaN;
      const sst = lp.reduce((a, p) => a + (p[1] - my) ** 2, 0), sse = lp.reduce((a, p) => a + (p[1] - (my + b * (p[0] - mx))) ** 2, 0);
      const r2 = sst > 0 ? 1 - sse / sst : NaN, spread = n ? Math.max(...lp.map((p) => p[0])) - Math.min(...lp.map((p) => p[0])) : 0;
      const ready = n >= 10 && spread >= 5 && b > 0 && r2 >= 0.5, ua = b * 1000 / 24;
      const area = this.n("heated_area"), dsg = Number(this.config.design_outdoor ?? -18), tin = isNaN(this.n("zone1_set")) ? 21 : this.n("zone1_set"), kw = ua * (tin - dsg) / 1000;
      out.push({ code: "", name: ["Straty ciepła budynku", "Building heat loss"], unit: "W/K", d: 0, kind: "info", group: "ch",
        model: this.t("z danych", "from data"), why: ["ciepło pompy i kotła na dobę względem różnicy dom − zewnątrz (60 dni); im mniej, tym lepiej ocieplony dom",
          "heat-pump and boiler heat per day against indoor − outdoor (60 days); lower = better insulated"],
        // W/m2 at the design temperature: ~40 well insulated, 60-80 typical older house, 100+ poorly insulated
        value: ready ? Math.round(ua) : "…", ok: true,
        rec: ready ? this.t(`przy ${dsg} °C ok. ${this.f(kw, 1, 1)} kW`, `at ${dsg} °C about ${this.f(kw, 1, 1)} kW`)
          + (area > 0 ? this.t(` (${this.f(kw * 1000 / area, 0)} W/m², ${this.f(area, 0)} m²)`, ` (${this.f(kw * 1000 / area, 0)} W/m², ${this.f(area, 0)} m²)`) : "") : this.t("zbieram dane", "collecting data"),
        reason: ready ? [`${n} dni grzania, R² ${this.f(r2, 2, 2)} – moc potrzebna przy temperaturze projektowej`, `${n} heating days, R² ${this.f(r2, 2, 2)} – power needed at the design temperature`]
          : [`${n}/10 dni grzania, rozrzut temperatur ${this.f(spread, 0)}/5 K`, `${n}/10 heating days, temperature spread ${this.f(spread, 0)}/5 K`] });
    }
    return out;
  }

  /** Immergas Dominus: what the module reads over TCP plus the integration's statistics (1.3.0) - the curve offset first */
  private domRows(): Row[] {
    const out: Row[] = [], f1 = (v: number) => this.f(v, 1, 1);
    // U03 from the 1 h room deviation while the zone asks for heat
    const u = this.so("u03"), uv = this.n("u03"), step = u?.attributes?.step ?? 1, dev = this.n("dom_room_dev"), share = this.n("dom_ch_share");
    const clamp = (v: number) => Math.min(u?.attributes?.max ?? 10, Math.max(u?.attributes?.min ?? -10, v));
    // judge the curve only when the boiler really heats (>= 10 % of the day): a warm room with the burner idle is not
    // the curve's fault, and the 1 h mean right after a restart is too short
    const enough = share >= 10;
    const uRec = isNaN(dev) || isNaN(uv) || !enough ? uv : dev > 0.5 ? clamp(uv - step) : dev < -0.5 ? clamp(uv + step) : uv;
    out.push({ k: "u03", code: "U03", name: ["Offset krzywej grzewczej", "Heating curve offset"], unit: "°C", d: 1, kind: "number", group: "ch",
      model: this.t("pokój ±0,5 K od zadanej", "room within ±0.5 K of the target"),
      why: this.allSet("dom_r02", "dom_r03", "r04", "r05") && !isNaN(this.n("outdoor"))
        ? (() => {
          // same curve as the Curve card: flat R04 below R02, linear to R05 at R03, flat above; U03 adds its value in °C
          const xa = this.n("dom_r02"), xb = this.n("dom_r03"), hi = this.n("r04"), lo = this.n("r05"), out = this.n("outdoor"), off = isNaN(uv) ? 0 : uv;
          const raw = out <= xa ? hi : out >= xb ? lo : hi + (lo - hi) * (out - xa) / (xb - xa);
          const flow = Math.max(lo, Math.min(hi, raw + off)), up = Math.max(lo, Math.min(hi, raw + off + step));
          return [`+1 U03 = +1 °C wody; przy ${f1(out)} °C na zewnątrz zasilanie ${f1(flow)} → ${f1(up)} °C (krzywa R02–R05)`,
            `+1 U03 = +1 °C of water; at ${f1(out)} °C outdoor the flow goes ${f1(flow)} → ${f1(up)} °C (curve R02–R05)`] as [string, string];
        })()
        : ["przesuwa całą krzywą: +1 = cieplejsza woda przy każdej temperaturze zewnętrznej (wpisz R02–R05, by zobaczyć ile)", "shifts the whole curve: +1 = warmer water at every outdoor temperature (enter R02–R05 to see how much)"],
      rec: uRec, reason: isNaN(dev) ? ["brak danych o odchyłce (statystyki Dominusa 1.3.0)", "no deviation data (Dominus 1.3.0 statistics)"]
        : [`pokój ${dev > 0 ? "+" : ""}${f1(dev)} K od zadanej (średnia 1 h)${isNaN(share) ? "" : `, grzanie ${this.f(share, 0)} % doby`}${enough ? "" : " – za mało grzania, by ocenić krzywą"}`,
          `room ${dev > 0 ? "+" : ""}${f1(dev)} K from the target (1 h mean)${isNaN(share) ? "" : `, heating ${this.f(share, 0)} % of the day`}${enough ? "" : " – too little heating to judge the curve"}`] });
    // heating curve R04 / R05 (declared copy of the boiler menu R): the same 1 h room deviation and >= 10 % heating
    // rule as U03; in mild weather the foot R05 carries the flow, in the cold the top R04
    const cooling = this.s("mode") === "cooling", out_ = this.n("outdoor");
    const xa = this.n("dom_r02"), xb = this.n("dom_r03"), mid = isNaN(xa) || isNaN(xb) ? 5 : (xa + xb) / 2, mild = !isNaN(out_) && out_ > mid;
    const menuR: [string, string] = [" – zmień w menu R pieca, encja to tylko kopia", " – change it in the boiler menu R, the entity is only the copy"];
    const unset = (k: Key, code: string, name: [string, string], group: string): Row => ({ k, code, name, unit: "", kind: "info", group, value: "–", ok: true,
      model: "–", why: ["Dominus nie czyta menu R – przepisz wartość z pieca", "Dominus does not read the menu R – copy the value from the boiler"],
      rec: this.t("nie ustawione – wpisz z pieca", "not set – enter it from the boiler"), reason: ["", ""] });
    const curveRow = (k: Key, code: string, name: [string, string], model: number, why: [string, string], move: number, txt: [string, string]): Row =>
      this.isSet(k) ? { k, code, name, unit: "°C", d: 0, kind: "number", group: "ch", model, why, rec: this.n(k) + move,
        reason: [txt[0] + (move ? menuR[0] : ""), txt[1] + (move ? menuR[1] : "")] } : unset(k, code, name, "ch");
    const devTxt: [string, string] = isNaN(dev) ? ["brak danych o odchyłce", "no deviation data"]
      : [`pokój ${dev > 0 ? "+" : ""}${f1(dev)} K od zadanej, grzanie ${isNaN(share) ? "–" : this.f(share, 0)} % doby, na zewnątrz ${f1(out_)} °C${enough ? "" : " – za mało grzania, by ocenić"}`,
        `room ${dev > 0 ? "+" : ""}${f1(dev)} K from the target, heating ${isNaN(share) ? "–" : this.f(share, 0)} % of the day, outdoor ${f1(out_)} °C${enough ? "" : " – too little heating to judge"}`];
    const curveMove = !enough || isNaN(dev) ? 0 : dev > 0.5 ? -1 : dev < -0.5 ? 1 : 0;
    out.push(curveRow("r05", "R05", ["Minimalne zasilanie CO (stopa krzywej)", "Minimum CH flow (curve foot)"], 25,
      ["podłogówka: ~25 °C przy cieple na zewnątrz; liczy się, gdy na zewnątrz łagodnie", "underfloor: ~25 °C in mild weather; matters when it is mild outside"],
      mild ? curveMove : 0, devTxt));
    out.push(curveRow("r04", "R04", ["Maksymalne zasilanie CO (szczyt krzywej)", "Maximum CH flow (curve top)"], 35,
      ["podłogówka: 35 °C w mrozy; liczy się, gdy na zewnątrz zimno", "underfloor: 35 °C in frost; matters when it is cold outside"],
      mild ? 0 : curveMove, devTxt));
    if (!this.allSet("dom_r02", "dom_r03")) out.push(unset("dom_r02", "R02/R03", ["Punkty krzywej (temp. zewnętrzne)", "Curve points (outdoor temperatures)"], "ch"));
    // cooling curve R12 / R13 (declared), like the hub cooling rows; outside the cooling season only informative
    const r12 = this.n("r12"), r13 = this.n("r13"), offTxt: [string, string] = [" (informacyjnie – poza sezonem chłodzenia)", " (informative – outside the cooling season)"];
    const coolRow = (k: Key, code: string, name: [string, string], model: number, why: [string, string], rec: number, reason: [string, string]): Row =>
      this.isSet(k) ? { k, code, name, unit: "°C", d: 0, kind: "number", group: "cool", model, why, rec: cooling ? rec : this.n(k),
        reason: cooling ? [reason[0] + (rec !== this.n(k) ? menuR[0] : ""), reason[1] + (rec !== this.n(k) ? menuR[1] : "")] : [reason[0] + offTxt[0], reason[1] + offTxt[1]] }
        : unset(k, code, name, "cool");
    out.push(coolRow("r12", "R12", ["Minimalne zasilanie chłodzenia", "Minimum cooling flow"], 18, ["podłoga: nie zimniej niż ~18 °C (rosa)", "floor: not colder than ~18 °C (dew)"],
      r12 < 18 ? 18 : r12, [r12 < 18 ? "ryzyko wykroplenia" : "w porządku", r12 < 18 ? "condensation risk" : "fine"]));
    out.push(coolRow("r13", "R13", ["Maksymalne zasilanie chłodzenia", "Maximum cooling flow"], 22, ["przy umiarkowanym upale wystarczy cieplejsza woda", "warmer water is enough in moderate heat"],
      r13 < Math.max(r12, 18) + 2 ? Math.max(r12, 18) + 4 : r13, ["min. 2 K nad R12", "at least 2 K above R12"]));
    if (!this.allSet("dom_r10", "dom_r11")) out.push(unset("dom_r10", "R10/R11", ["Punkty krzywej chłodzenia (temp. zewnętrzne)", "Cooling curve points (outdoor temperatures)"], "cool"));
    // flow setpoint 2217 (written to the boiler over TCP): underfloor <= 35 °C, not above the curve top R04 + 2
    const fl = this.n("dom_flow_target"), cap = this.isSet("r04") ? Math.min(35, this.n("r04") + 2) : 35;
    if (this.eid("dom_flow_target")) out.push({ k: "dom_flow_target", code: "", name: ["Zadana zasilania strefy 1", "Zone 1 flow setpoint"], unit: "°C", d: 0, kind: "number", group: "ch",
      model: `≤ ${this.f(cap, 0)} °C`,
      why: ["podłogówka: woda nie cieplejsza niż szczyt krzywej R04 (+2 K)", "underfloor: water not warmer than the curve top R04 (+2 K)"],
      rec: fl > cap ? cap : fl,
      reason: fl > cap ? [`${this.f(fl, 0)} °C to więcej niż ${this.f(cap, 0)} °C – zapis idzie do kotła`, `${this.f(fl, 0)} °C is above ${this.f(cap, 0)} °C – written to the boiler`] : ["w porządku", "fine"] });
    // humidity setpoint 2216: dew-point protection in cooling, model 50-60 %, outside 45-65 % move into range
    const hu = this.n("dom_hum_target"), huRec = hu < 45 ? 50 : hu > 65 ? 60 : hu;
    if (this.eid("dom_hum_target")) out.push({ k: "dom_hum_target", code: "", name: ["Zadana wilgotności strefy 1", "Zone 1 humidity setpoint"], unit: "%", d: 0, kind: "number", group: "cool",
      model: "50–60 %", why: ["ochrona przed rosą przy chłodzeniu podłogowym", "dew-point protection with floor cooling"],
      rec: cooling ? huRec : hu,
      reason: cooling ? (huRec !== hu ? ["poza zakresem 45–65 %", "outside 45–65 %"] : ["w porządku", "fine"]) : [offTxt[0].trim(), offTxt[1].trim()] });
    // cycling of the boiler from the heating-demand edges
    const sh = this.n("dom_starts_h"), st = this.n("dom_starts_today"), many = sh > 3;
    if (this.eid("dom_starts_h")) out.push({ code: "", name: ["Taktowanie: starty grzania na godzinę", "Cycling: heating starts per hour"], unit: "/h", d: 0, kind: "info", group: "cyc",
      model: "≤ 3 /h", why: this.isSet("dom_t05")
        ? [`mniej startów = mniej strat i zużycia; minutnik T05 ${this.f(this.n("dom_t05"), 0)} min (maks. ~${this.f(60 / Math.max(1, this.n("dom_t05")), 0)} startów/h)`,
          `fewer starts = fewer losses and less wear; start timer T05 ${this.f(this.n("dom_t05"), 0)} min (max. ~${this.f(60 / Math.max(1, this.n("dom_t05")), 0)} starts/h)`] as [string, string]
        : ["kocioł gazowy: mniej startów = mniej strat i zużycia", "gas boiler: fewer starts = fewer losses and less wear"], value: sh, ok: !many,
      rec: many ? this.t("za często – obniż offset (U03) albo zadaną zasilania", "too often – lower the offset (U03) or the flow setpoint") : this.t("✓ w normie", "✓ fine"),
      reason: [`dziś ${isNaN(st) ? "–" : this.f(st, 0)} startów`, `${isNaN(st) ? "–" : this.f(st, 0)} starts today`] });
    // DHW cycles
    const dc = this.n("dom_dhw_cycles"), dd = this.n("dom_dhw_last_dur"), dr = this.n("dom_dhw_last_rise"), dmany = dc > 3;
    if (this.eid("dom_dhw_cycles")) out.push({ code: "", name: ["Cykle CWU dziś", "DHW cycles today"], unit: "×", d: 0, kind: "info", group: "dhw",
      model: "≤ 3", why: ["każdy cykl CWU to przerwa w grzaniu domu", "every DHW cycle pauses the space heating"], value: dc, ok: !dmany,
      rec: dmany ? this.t("dużo – obniż nastawę CWU albo skróć kalendarz CWU", "many – lower the DHW setpoint or shorten the DHW calendar") : this.t("✓ w normie", "✓ fine"),
      reason: [`ostatni cykl ${isNaN(dd) ? "–" : this.f(dd, 0)} min, zasobnik +${isNaN(dr) ? "–" : f1(dr)} K`, `last cycle ${isNaN(dd) ? "–" : this.f(dd, 0)} min, cylinder +${isNaN(dr) ? "–" : f1(dr)} K`] });
    // Comfort - Eco gap from the time to reach the target
    const ttt = this.n("dom_ttt"), ce = this.n("comfort_heat"), ee = this.n("eco_heat"), gap = ce - ee, slow = ttt > 60 && gap > 0.5;
    if (this.eid("eco_heat")) out.push({ k: "eco_heat", code: "", name: ["Program CO: Eko grzanie", "CH program: Eco heating"], unit: "°C", d: 1, kind: "number", group: "use",
      model: this.t("zadana w ≤ 60 min po fazie Komfort", "target within ≤ 60 min after Comfort starts"),
      why: ["duża różnica Komfort–Eko = długie dogrzewanie rano", "a large Comfort–Eco gap = long reheating in the morning"],
      rec: slow ? ee + 0.5 : ee,
      reason: [`dojście do zadanej ${isNaN(ttt) ? "–" : this.f(ttt, 0)} min, różnica Komfort–Eko ${isNaN(gap) ? "–" : f1(gap)} K`,
        `reached the target in ${isNaN(ttt) ? "–" : this.f(ttt, 0)} min, Comfort–Eco gap ${isNaN(gap) ? "–" : f1(gap)} K`] });
    // --- offline parameters (copies of the boiler menu typed in by hand): T02, T05, U11, P15/P13, I04/I10, A31, P07 ---
    // a recommendation on a copy means "change it in the boiler menu"; Set only updates the copy
    const menuP: [string, string] = [" – zmień w menu pieca, encja to tylko kopia", " – change it in the boiler menu, the entity is only the copy"];
    const withMenu = (txt: [string, string], changed: boolean): [string, string] => changed ? [txt[0] + menuP[0], txt[1] + menuP[1]] : txt;
    const offUnset = (k: Key, code: string, name: [string, string], group: string): Row => ({ k, code, name, unit: "", kind: "info", group, value: "–", ok: true,
      model: "–", why: ["Dominus nie czyta tego ustawienia – przepisz je z menu pieca (karta Parametry pieca)", "Dominus cannot read this setting – copy it from the boiler menu (Boiler parameters card)"],
      rec: this.t("nie ustawione – wpisz z pieca", "not set – enter it from the boiler"), reason: ["", ""] });
    const dset = this.n("dhw_set");
    // T02 DHW thermostat: a heat pump wants a wider hysteresis (5-7 K) - fewer, longer DHW cycles
    if (this.eid("dom_t02")) {
      if (!this.isSet("dom_t02")) out.push(offUnset("dom_t02", "T02", ["Termostat CWU (histereza)", "DHW thermostat (hysteresis)"], "dhw"));
      else {
        const t02 = this.n("dom_t02"), rec = dc > 3 && t02 < 5 ? 5 : t02, start = isNaN(dset) ? "–" : this.f(dset - t02, 0), cyc = isNaN(dc) ? "–" : this.f(dc, 0);
        out.push({ k: "dom_t02", code: "T02", name: ["Termostat CWU (histereza)", "DHW thermostat (hysteresis)"], unit: "K", d: 0, kind: "number", group: "dhw",
          model: "5–7 K", why: ["pompa ciepła: szersza histereza = rzadsze, dłuższe cykle CWU", "heat pump: a wider hysteresis = fewer, longer DHW cycles"], rec,
          reason: withMenu(rec !== t02
            ? [`${cyc} cykli CWU dziś przy T02 ${this.f(t02, 0)} K – cykl startuje już przy ${start} °C`, `${cyc} DHW cycles today with T02 ${this.f(t02, 0)} K – a cycle starts already at ${start} °C`]
            : [`cykl CWU startuje przy ≤ ${start} °C · dziś ${cyc} cykli`, `a DHW cycle starts at ≤ ${start} °C · ${cyc} cycles today`], rec !== t02) });
      }
    }
    // T05 CH start timer: the minimum pause between CH starts caps the cycling
    if (this.eid("dom_t05")) {
      if (!this.isSet("dom_t05")) out.push(offUnset("dom_t05", "T05", ["Minutnik startów CO", "CH start timer"], "cyc"));
      else {
        const t05 = this.n("dom_t05"), rec = many && t05 < 10 ? 10 : t05, cap = this.f(60 / Math.max(1, t05), 0), now = isNaN(sh) ? "–" : this.f(sh, 0);
        out.push({ k: "dom_t05", code: "T05", name: ["Minutnik startów CO", "CH start timer"], unit: "min", d: 0, kind: "number", group: "cyc",
          model: "≥ 10 min", why: ["minimalna przerwa między startami CO – dłuższa = mniej taktowania", "the minimum pause between CH starts – longer = less cycling"], rec,
          reason: withMenu([`${now} startów/h, minutnik pozwala na ~${cap}/h`, `${now} starts/h, the timer allows ~${cap}/h`], rec !== t05) });
      }
    }
    // U11 night function: worth it on mild nights (quieter, lower power); on frosty nights the rooms cool down
    const tm = (k: Key) => { const v = this.s(k) ?? ""; return /^\d\d:\d\d/.test(v) ? v.slice(0, 5) : "–"; };
    if (this.eid("u11")) {
      if (!this.allSet("u12", "u13")) out.push(offUnset("u12", "U11", ["Tryb nocny (funkcja nocna)", "Night mode (night function)"], "use"));
      else {
        const mean = parseFloat(this.attr("dom_auto_season", "outdoor_mean_24h")), ref = isNaN(mean) ? out_ : mean, cur = this.on("u11") ? "on" : "off";
        const rec = isNaN(ref) ? cur : ref >= 5 ? "on" : "off";
        out.push({ k: "u11", code: "U11", name: ["Tryb nocny (funkcja nocna)", "Night mode (night function)"], unit: "", kind: "switch", group: "use",
          model: this.t("wł. przy nocach ≥ 5 °C", "on for nights ≥ 5 °C"),
          why: ["ogranicza moc nocą: ciszej i oszczędniej, ale w mrozy dom wychładza się", "limits the power at night: quieter and cheaper, but in frost the house cools down"], rec,
          reason: withMenu([`${isNaN(mean) ? "teraz" : "średnia 24 h"} ${f1(ref)} °C · okno ${tm("u12")}–${tm("u13")}`, `${isNaN(mean) ? "now" : "24 h mean"} ${f1(ref)} °C · window ${tm("u12")}–${tm("u13")}`], rec !== cur) });
      }
    }
    // P15 anti-legionella: needed with a DHW setpoint below 55 °C; P13 2-3 h; the slot belongs in the cheap tariff
    if (this.eid("p15")) {
      if (!this.allSet("p16", "p17", "p13")) out.push(offUnset("p16", "P15", ["Anty-legionella", "Anti-legionella"], "dhw"));
      else {
        const mm = (v: string) => /^\d\d?:\d\d/.test(v) ? +v.split(":")[0] * 60 + +v.split(":")[1].slice(0, 2) : null;
        const cheap: [number, number][] = [], cheapOpt = String(this.config.cheap_hours ?? "");
        for (const w of cheapOpt.split(",")) {
          const m = w.trim().match(/^(\d\d?:\d\d)\s*-\s*(\d\d?:\d\d)$/), a = m ? mm(m[1]) : null, b = m ? mm(m[2]) : null;
          if (a === null || b === null) continue;
          if (b > a) cheap.push([a, b]); else { cheap.push([a, 1440]); if (b > 0) cheap.push([0, b]); }
        }
        const legT = this.timeOpt("legionella_time"), inCheap = legT === null || !cheap.length || cheap.some(([a, b]) => legT >= a && legT < b);
        const cur = this.on("p15") ? "on" : "off", rec = isNaN(dset) ? cur : dset < 55 ? "on" : dset >= 60 ? "off" : cur;
        const when = `${this.dayName(this.dayOpt("legionella_day"))} ${tm("p16")}`, ds = this.f(dset, 0);
        out.push({ k: "p15", code: "P15", name: ["Anty-legionella", "Anti-legionella"], unit: "", kind: "switch", group: "dhw",
          model: this.t("wł. przy CWU < 55 °C", "on with DHW < 55 °C"),
          why: ["raz na jakiś czas zasobnik do ~60 °C zabija bakterie Legionella; przy niższej nastawie to konieczne", "now and then the cylinder at ~60 °C kills Legionella; needed with a lower setpoint"], rec,
          reason: withMenu(rec !== cur
            ? (rec === "on" ? [`nastawa CWU ${ds} °C – poniżej 55 °C dezynfekcja jest potrzebna`, `DHW setpoint ${ds} °C – below 55 °C disinfection is needed`]
              : [`nastawa CWU ${ds} °C – woda i tak jest dezynfekowana`, `DHW setpoint ${ds} °C – the water is disinfected anyway`])
            : !inCheap ? [`termin ${when} poza tanią taryfą (${cheapOpt}) – przesuń START P16`, `slot ${when} outside the cheap tariff (${cheapOpt}) – move START P16`]
            : [`nastawa CWU ${ds} °C · termin ${when}`, `DHW setpoint ${ds} °C · slot ${when}`], rec !== cur || !inCheap) });
        const p13 = this.n("p13"), r13 = p13 > 3 ? 3 : p13 < 2 ? 2 : p13;
        out.push({ k: "p13", code: "P13", name: ["Anty-legionella: czas cyklu", "Anti-legionella: cycle duration"], unit: "h", d: 0, kind: "number", group: "dhw",
          model: "2–3 h", why: ["dłuższy cykl to więcej energii bez dodatkowego efektu", "a longer cycle costs energy with no extra benefit"], rec: r13,
          reason: withMenu([`cykl od ${tm("p16")} przez ${this.f(p13, 0)} h`, `cycle from ${tm("p16")} for ${this.f(p13, 0)} h`], r13 !== p13) });
      }
    }
    // boiler integration (Magis Combo, I02 declared on): I04 = how long the heat pump works alone before the boiler
    // may join, I10 = outdoor temperature below which the boiler heats - Dominus has no COP or prices, so informative
    if (this.eid("dom_int_ch") && this.on("dom_int_ch")) {
      const i10 = this.n("dom_i10"), colder = this.isSet("dom_i10") && !isNaN(out_) && out_ < i10 + 3;
      if (!this.isSet("dom_i04")) out.push(offUnset("dom_i04", "I04", ["Maks. czas oczekiwania na kocioł (CO)", "Max. wait for the boiler (CH)"], "int"));
      else {
        const i04 = this.n("dom_i04"), cold = !isNaN(dev) && dev < -0.5 && colder && share >= 30, rec = cold && i04 > 30 ? 30 : i04;
        out.push({ k: "dom_i04", code: "I04", name: ["Maks. czas oczekiwania na kocioł (CO)", "Max. wait for the boiler (CH)"], unit: "min", d: 0, kind: "number", group: "int",
          model: "30–60 min", why: ["krócej = kocioł szybciej pomaga pompie, gdy w mrozy dom nie nadąża", "shorter = the boiler helps the heat pump sooner when the house lags in frost"], rec,
          reason: withMenu(cold
            ? [`pokój ${f1(dev)} K od zadanej przy ${f1(out_)} °C na zewnątrz, grzanie ${this.f(share, 0)} % doby`, `room ${f1(dev)} K from the target at ${f1(out_)} °C outdoor, heating ${this.f(share, 0)} % of the day`]
            : ["dom nadąża – bez zmian", "the house keeps up – no change"], rec !== i04) });
      }
      if (!this.isSet("dom_i10")) out.push(offUnset("dom_i10", "I10", ["Temperatura aktywacji kotła", "Boiler activation temperature"], "int"));
      else out.push({ k: "dom_i10", code: "I10", name: ["Temperatura aktywacji kotła", "Boiler activation temperature"], unit: "°C", d: 0, kind: "info", group: "int",
        model: "−5…0 °C", why: ["poniżej tej temperatury zewnętrznej grzeje kocioł (Magis Combo)", "below this outdoor temperature the boiler heats (Magis Combo)"], value: i10, ok: true,
        rec: this.t("informacyjnie", "informative"),
        reason: ["Dominus nie zna COP ani cen – opłacalność gazu i pompy policzy hub", "Dominus knows no COP or prices – the hub compares gas and heat-pump cost"] });
    }
    // A31 room control: RT (thermostat only) leaves no room temperature for the curve / U03 calibration
    if (this.eid("dom_a31")) {
      if (!this.isSet("dom_a31")) out.push(offUnset("dom_a31", "A31", ["Sterowanie pokojowe", "Room control"], "other"));
      else {
        const a31 = this.s("dom_a31")!, noRoom = this.bad("zone1"), rec = a31 === "rt" && noRoom ? "rpt" : a31;
        out.push({ k: "dom_a31", code: "A31", name: ["Sterowanie pokojowe", "Room control"], unit: "", kind: "select", group: "other",
          labels: { rp: "RP", rpt: "RPT", rt: "RT" }, model: "rpt",
          why: ["panel strefy daje temperaturę pokoju – bez niej kalibracja krzywej nie działa", "the zone panel gives the room temperature – without it the curve calibration cannot work"], rec,
          reason: withMenu(rec !== a31 ? ["RT bez temperatury pokoju – podłącz panel strefy (RPT)", "RT with no room temperature – connect a zone panel (RPT)"]
            : [noRoom ? "brak temperatury pokoju" : "temperatura pokoju dociera", noRoom ? "no room temperature" : "the room temperature arrives"], rec !== a31) });
      }
    }
    // P07 outdoor probe correction: informative - the outdoor temperature over TCP is already corrected
    if (this.eid("dom_p07")) {
      if (!this.isSet("dom_p07")) out.push(offUnset("dom_p07", "P07", ["Korekta sondy zewnętrznej", "Outdoor probe correction"], "other"));
      else {
        const p07 = this.n("dom_p07"), sg = p07 > 0 ? "+" : "";
        out.push({ k: "dom_p07", code: "P07", name: ["Korekta sondy zewnętrznej", "Outdoor probe correction"], unit: "K", d: 0, kind: "info", group: "other",
          model: "0 K", why: ["korekta przesuwa całą krzywą – lepiej dobrze umieścić sondę", "a correction shifts the whole curve – better place the probe well"], value: p07, ok: p07 === 0,
          rec: p07 === 0 ? this.t("✓ bez korekty", "✓ no correction") : this.t(`sonda skorygowana o ${sg}${this.f(p07, 0)} K – sprawdź jej umiejscowienie`, `probe corrected by ${sg}${this.f(p07, 0)} K – check its placement`),
          reason: ["temperatura po TCP jest już skorygowana", "the temperature over TCP is already corrected"] });
      }
    }
    // efficiency (informative)
    const hdd = this.n("dom_h_per_dd"), ddm = this.n("dom_dd_month");
    if (this.eid("dom_h_per_dd")) out.push({ code: "", name: ["Godziny grzania na stopniodzień", "Heating hours per degree day"], unit: "h/°C·d", d: 2, kind: "info", group: "other",
      model: this.t("porównuj przed i po zmianie", "compare before and after a change"),
      why: ["mniej godzin na stopniodzień = dom potrzebuje mniej grzania", "fewer hours per degree day = the house needs less heating"], value: hdd, ok: true,
      rec: this.t("informacyjnie", "informative"),
      reason: [`w tym miesiącu ${isNaN(ddm) ? "–" : f1(ddm)} stopniodni`, `${isNaN(ddm) ? "–" : f1(ddm)} degree days this month`] });
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // OpenTherm (Dominus OT / ESP OpenTherm hub), gas boiler BMS (gb_) and MAGIS M (mt_): recommendations from the
  // Today analysis (ot_computed / ot_analytics, gb_analytics, mt_analytics) and the device profile
  // ---------------------------------------------------------------------------------------------------------------
  /** which row set: the Magis hub, Dominus Modbus, OpenTherm (Dominus or the ESP hub), the gas boiler BMS or MAGIS M */
  private get calMode(): "hub" | "dom" | "ot" | "gb" | "mt" {
    if (this.gbx) return "gb";
    if (this.mtx) return "mt";
    if (this.ot) return "ot";
    return this.dominus ? "dom" : "hub";
  }
  private fine() { return this.t("✓ w normie", "✓ fine"); }
  /** the entity takes a value from the card (a number / select / switch), not only a reading or a declared sensor */
  private canSet(k: Key, dom: "number" | "select" | "switch") {
    const id = this.eid(k) ?? "";
    return dom === "number" ? /^(number|input_number)\./.test(id) : dom === "select" ? /^(select|input_select)\./.test(id) : /^(switch|input_boolean)\./.test(id);
  }
  /** a measured value judged against the model: shown only when its entity exists */
  private infoRow(k: Key, group: string, name: [string, string], unit: string, d: number, model: string, why: [string, string],
    bad: (v: number) => boolean, rec: [string, string], reason: [string, string] = ["", ""]): Row | null {
    if (!this.eid(k)) return null;
    const v = this.n(k), b = !isNaN(v) && bad(v);
    return { code: "", name, unit, d, kind: "info", group, model, why, value: v, ok: !b,
      rec: isNaN(v) ? this.t("brak danych (jeszcze)", "no data (yet)") : b ? this.t(rec[0], rec[1]) : rec[0] ? this.fine() : this.t("informacyjnie", "informative"), reason };
  }
  /** a setting with a recommended number; a read-only one (sensor, declared copy without a number) becomes informative */
  private setRow(k: Key, code: string, group: string, name: [string, string], unit: string, d: number, model: number | string,
    why: [string, string], rec: number, reason: [string, string], menu = false): Row | null {
    if (!this.eid(k)) return null;
    const v = this.n(k), mn = +(this.attr(k, "min") ?? -1e9), mx = +(this.attr(k, "max") ?? 1e9);
    const r = isNaN(rec) || isNaN(v) ? v : Math.min(isNaN(mx) ? 1e9 : mx, Math.max(isNaN(mn) ? -1e9 : mn, rec));
    const changed = !isNaN(r) && !isNaN(v) && Math.abs(r - v) > 0.01;
    const rs: [string, string] = changed && menu ? [reason[0] + " – zmień w menu urządzenia, encja to tylko kopia", reason[1] + " – change it in the device menu, the entity is only the copy"] : reason;
    if (this.canSet(k, "number")) return { k, code, name, unit, d, kind: "number", group, model, why, rec: r, reason: rs };
    return { k, code, name, unit, d, kind: "info", group, model: typeof model === "number" ? this.f(model, d, d) + (unit ? " " + unit : "") : model, why,
      value: v, ok: !changed, rec: changed ? "→ " + this.f(r, d, d) + (unit ? " " + unit : "") : this.fine(), reason: rs };
  }
  /** a switch with a recommended state (informative when it cannot be switched from Home Assistant) */
  private swRow(k: Key, code: string, group: string, name: [string, string], model: string, why: [string, string], recOn: boolean | null, reason: [string, string]): Row | null {
    if (!this.eid(k)) return null;
    const cur = this.on(k) ? "on" : "off", rec = recOn === null ? cur : recOn ? "on" : "off";
    if (this.canSet(k, "switch")) return { k, code, name, unit: "", kind: "switch", group, model, why, rec, reason };
    return { k, code, name, unit: "", kind: "info", group, model, why, value: cur === "on" ? this.t("wł.", "on") : this.t("wył.", "off"), ok: rec === cur,
      rec: rec === cur ? this.fine() : rec === "on" ? this.t("→ włącz", "→ switch on") : this.t("→ wyłącz", "→ switch off"), reason };
  }
  /** the device profile the recommendations are based on (first row of "Other") */
  private profileRow(k: Key | undefined, name: string, hint: [string, string]): Row {
    return { k, code: "", name: ["Profil urządzenia", "Device profile"], unit: "", kind: "info", group: "other", model: "–",
      why: ["kody i parametry w wierszach wyżej zależą od profilu", "the codes and parameters in the rows above depend on the profile"],
      value: name, ok: true, rec: this.t(hint[0], hint[1]), reason: ["", ""] };
  }
  private dhwSetRow(group = "dhw", hp = false): Row | null {
    const ds = this.n("dhw_set"), hi = hp ? 52 : 55, rec = ds > hi ? (hp ? 50 : 50) : ds;
    return this.setRow("dhw_set", "", group, ["Nastawa CWU", "DHW setpoint"], "°C", 0, hp ? "45–50 °C" : "45–55 °C",
      hp ? ["pompa ciepła: każdy stopień wyżej obniża COP CWU", "heat pump: every degree higher lowers the DHW COP"]
        : ["wyższa nastawa = większe straty zasobnika i mniej kondensacji przy CWU", "a higher setpoint = more cylinder loss and less condensing on DHW"],
      rec, ds > hi ? [`${this.f(ds, 0)} °C to więcej niż potrzeba`, `${this.f(ds, 0)} °C is more than needed`] : ["w porządku", "fine"]);
  }

  private otRows(): Row[] {
    const P = this.otProfile, esp = this.esp, f1 = (v: number) => this.f(v, 1, 1);
    const names: Record<string, string> = { zeus25: "VICTRIX ZEUS 25 / OMNIA / OMNIA V2 / TT", maior: "VICTRIX MAIOR TT", tera: "VICTRIX TERA V2 / V3", hybrid: "VICTRIX HYBRID / HYBRID PLUS", classic: "VICTRIX EXA 24 X / 28 / 32, NIKE 24 ECO",
      superior: "VICTRIX ZEUS Superior", hercules: "HERCULES Condensing", generic: this.t("ogólny (OpenTherm)", "generic (OpenTherm)") };
    const gt = P === "zeus25" || P === "maior", tg = P === "tera" || P === "hybrid", sup = P === "superior" || P === "hercules";
    const cMax: Record<string, string> = { zeus25: "t1", maior: "t1", tera: "t1", hybrid: "t1", classic: "S6", superior: "P66/B", hercules: "P66/B", generic: "" };
    const out: (Row | null)[] = [];
    // --- cycling: starts per hour, short burns, average burn; the anti-cycling parameter of the menu family ---
    const sh = this.n("ot_burn_h"), st = this.n("ot_burn_today"), avg = this.n("oa_burn_avg"), mm = this.n("oa_minmod_share");
    const cycRec: [string, string] = gt ? ["za często – wydłuż t5 (blokada zapłonu CO) albo obniż krzywą", "too often – lengthen t5 (CH ignitions timer) or lower the curve"]
      : tg ? ["za często – wydłuż t4 (blokada zapłonu CO) albo obniż krzywą", "too often – lengthen t4 (CH ignitions timer) or lower the curve"]
      : sup ? ["za często – obniż krzywą P66 / maks. moc CO (M3) albo nastawę CO", "too often – lower the P66 curve / CH max. output (M3) or the CH setpoint"]
      : P === "classic" ? ["za często – obniż maks. moc CO (menu P) albo krzywą", "too often – lower the CH max. output (menu P) or the curve"]
      : esp ? ["za często – obniż maks. modulację huba albo krzywą", "too often – lower the hub max. modulation or the curve"]
      : ["za często – obniż krzywą albo nastawę CO", "too often – lower the curve or the CH setpoint"];
    out.push(this.infoRow("ot_burn_h", "cyc", ["Taktowanie: starty palnika na godzinę", "Cycling: burner starts per hour"], "/h", 0, "≤ 3 /h",
      ["kocioł kondensacyjny: mniej startów = mniej strat i zużycia", "condensing boiler: fewer starts = fewer losses and less wear"], (v) => v > 3, cycRec,
      [`dziś ${isNaN(st) ? "–" : this.f(st, 0)} startów, średnie palenie ${isNaN(avg) ? "–" : f1(avg)} min`, `${isNaN(st) ? "–" : this.f(st, 0)} starts today, average burn ${isNaN(avg) ? "–" : f1(avg)} min`]));
    out.push(this.infoRow("oa_burn_avg", "cyc", ["Średnie palenie", "Average burn"], "min", 1, "≥ 10 min",
      ["krótkie palenia = kocioł za duży na obecne obciążenie", "short burns = the boiler is too big for the current load"], (v) => v < 10,
      mm > 70 ? ["krótko na min. mocy – kocioł nie zejdzie niżej, wydłuż przerwy (t5 / histereza)", "short at min. output – the boiler cannot go lower, lengthen the pauses (t5 / hysteresis)"]
        : ["krótko – obniż maks. moc CO", "short – lower the CH max. output"],
      [`na min. modulacji ${isNaN(mm) ? "–" : this.f(mm, 0)} % palenia`, `${isNaN(mm) ? "–" : this.f(mm, 0)} % of the burn at min. modulation`]));
    out.push(this.infoRow("oa_short_burns", "cyc", ["Krótkie palenia dziś", "Short burns today"], "×", 0, "≤ 6", ["palenie < 5 min", "a burn < 5 min"], (v) => v > 6, cycRec));
    if (gt) { const t5 = this.n("ot_t5"); out.push(this.setRow("ot_t5", "t5", "cyc", ["Blokada ponownego zapłonu CO", "CH ignitions timer"], "min", 0, "≥ 3 min",
      ["minimalna przerwa między zapłonami CO", "the minimum pause between CH ignitions"], sh > 3 && t5 < 6 ? 6 : t5,
      [`${isNaN(sh) ? "–" : this.f(sh, 0)} startów/h`, `${isNaN(sh) ? "–" : this.f(sh, 0)} starts/h`], !esp)); }
    if (esp) { const mx = this.n("ot_max_mod"); out.push(this.setRow("ot_max_mod", "", "cyc", ["Maks. modulacja huba", "Hub max. modulation"], "%", 0, "60–100 %",
      ["niższa = dłuższe, spokojniejsze palenia przy małym obciążeniu", "lower = longer, calmer burns at a low load"], sh > 3 && mm < 50 && mx > 60 ? mx - 10 : mx,
      [`${isNaN(sh) ? "–" : this.f(sh, 0)} startów/h, na min. modulacji ${isNaN(mm) ? "–" : this.f(mm, 0)} %`, `${isNaN(sh) ? "–" : this.f(sh, 0)} starts/h, ${isNaN(mm) ? "–" : this.f(mm, 0)} % at min. modulation`])); }
    // --- heating curve: the Dominus OTC (offset) or the hub regulator (curve points, room correction) ---
    const cond = this.n("oa_condensing_share");
    if (!esp) {
      const dev = this.n("oa_room_dev"), off = this.n("ot_offset"), step = +(this.attr("ot_offset", "step") ?? 1) || 1;
      const wx = this.on("ot_out_sensor") || !this.eid("ot_out_sensor");
      out.push(this.setRow("ot_offset", "", "ch", ["Offset krzywej (regulator Dominusa)", "Curve offset (Dominus regulator)"], "°C", 1,
        this.t("pokój ±0,5 K od zadanej", "room within ±0.5 K of the target"),
        ["przesuwa całą krzywą OTC: +1 = cieplejsza woda", "shifts the whole OTC curve: +1 = warmer water"],
        !wx || isNaN(dev) ? off : dev > 0.5 ? off - step : dev < -0.5 ? off + step : off,
        !wx ? ["sonda zewnętrzna wyłączona – regulator nie liczy krzywej", "outdoor sensor off – the regulator computes no curve"]
          : isNaN(dev) ? ["brak odchyłki pokoju (Dominus 1.6.14)", "no room deviation (Dominus 1.6.14)"]
          : [`pokój ${dev > 0 ? "+" : ""}${f1(dev)} K od zadanej (1 h)`, `room ${dev > 0 ? "+" : ""}${f1(dev)} K from the target (1 h)`]));
    } else {
      const room = this.n("zone1"), tgt = this.n("ot_room_set"), dev = room - tgt, out_ = this.n("outdoor"), oc = this.n("ot_c_oc"), ow = this.n("ot_c_ow");
      const mild = !isNaN(out_) && !isNaN(oc) && !isNaN(ow) ? out_ > (oc + ow) / 2 : !isNaN(out_) && out_ > 5;
      const mv = isNaN(dev) ? 0 : dev > 0.5 ? -1 : dev < -0.5 ? 1 : 0, txt: [string, string] = isNaN(dev) ? ["brak temperatury pokoju", "no room temperature"]
        : [`pokój ${dev > 0 ? "+" : ""}${f1(dev)} K od zadanej, na zewnątrz ${f1(out_)} °C`, `room ${dev > 0 ? "+" : ""}${f1(dev)} K from the target, outdoor ${f1(out_)} °C`];
      out.push(this.setRow("ot_c_fw", "", "ch", ["Krzywa: zasilanie przy najwyższej temp.", "Curve: flow at the warmest"], "°C", 0, "25–35 °C",
        ["stopa krzywej – liczy się, gdy na zewnątrz łagodnie", "the curve foot – matters in mild weather"], this.n("ot_c_fw") + (mild ? mv : 0), txt));
      out.push(this.setRow("ot_c_fc", "", "ch", ["Krzywa: zasilanie przy najniższej temp.", "Curve: flow at the coldest"], "°C", 0, this.t("≤ 60 °C (kondensacja)", "≤ 60 °C (condensing)"),
        ["szczyt krzywej – liczy się w mrozy", "the curve top – matters in frost"], this.n("ot_c_fc") + (mild ? 0 : mv), txt));
      const g = this.n("ot_gain");
      out.push(this.setRow("ot_gain", "", "ch", ["Korekta pokojowa", "Room correction"], "°C/°C", 1, "2–4",
        ["o ile °C podnieść wodę na 1 °C brakującą w pokoju", "how many °C of water per 1 °C missing in the room"], g > 6 && this.n("ot_burn_h") > 3 ? 4 : g < 1 ? 2 : g,
        g > 6 ? ["duża korekta rozkołysuje regulację", "a large correction makes the control swing"] : ["w porządku", "fine"]));
    }
    out.push(this.infoRow("oa_condensing_share", "ch", ["Praca kondensacyjna dziś", "Condensing today"], "%", 0, "≥ 70 %",
      ["powrót poniżej ~55 °C = kocioł odzyskuje ciepło spalin", "return below ~55 °C = the boiler recovers the flue heat"], (v) => v < 50,
      ["mało – obniż krzywą / maks. zasilanie", "low – lower the curve / max. flow"]));
    { const t1 = this.n("ot_t1"), k: Key = esp ? "ot_max_ch" : "ot_t1", v = esp ? this.n("ot_max_ch") : t1;
      out.push(this.setRow(k, esp ? "" : cMax[P], "ch", ["Maks. temperatura zasilania CO", "CH max. flow temperature"], "°C", 0, this.t("≤ 60 °C (kondensacja)", "≤ 60 °C (condensing)"),
        ["górny limit wody: niżej = więcej kondensacji, ale wolniejsze dogrzewanie", "the top water limit: lower = more condensing, but slower reheating"],
        cond < 50 && v > 60 ? 60 : v, cond < 50 && v > 60 ? [`kondensacja ${this.f(cond, 0)} % doby`, `condensing ${this.f(cond, 0)} % of the day`] : ["w porządku", "fine"], !esp)); }
    // --- pump: delta T and the pump setting of the menu family ---
    const dt = this.n("oa_delta_t"), lowDt = dt > 0 && dt < 10;
    const pumpAuto = (P === "superior" && this.s("ot_sup_pump_speed") === "auto") || (P === "hercules" && this.s("ot_her_pump") === "auto");
    out.push(this.infoRow("oa_delta_t", "pump", ["Delta T zasilanie − powrót", "Delta T flow − return"], "K", 1, "15–20 K",
      ["mała różnica = pompa tłoczy za dużo, powrót za ciepły na kondensację", "a small difference = the pump moves too much, the return is too warm for condensing"], (v) => v > 0 && v < 10,
      gt ? ["za mało – A5 w tryb ΔT (15–20) albo niższe A3", "too low – A5 to ΔT mode (15–20) or a lower A3"]
        : pumpAuto ? ["za mało mimo pompy w AUTO – sprawdź by-pass, zawory termostatyczne i przepływ instalacji", "too low with the pump in AUTO – check the bypass, the radiator valves and the system flow"]
        : P === "superior" ? ["za mało – prędkość pompy AUTO (ΔT)", "too low – pump speed AUTO (ΔT)"]
        : P === "hercules" ? ["za mało – sterowanie pompą AUTO", "too low – pump control AUTO"] : ["za mało – niższy bieg pompy", "too low – a lower pump speed"]));
    if (gt) { const a5 = this.n("ot_a5"); out.push(this.setRow("ot_a5", "A5", "pump", ["Tryb pompy (0 = proporcjonalny, 5-25 = ΔT)", "Pump mode (0 = proportional head, 5-25 = ΔT)"], "", 0, "15–20",
      ["tryb ΔT trzyma różnicę zasilanie − powrót", "the ΔT mode holds the flow − return difference"], lowDt && a5 === 0 ? 15 : a5, lowDt ? [`delta T ${f1(dt)} K`, `delta T ${f1(dt)} K`] : ["w porządku", "fine"], true)); }
    if (P === "superior" && this.eid("ot_sup_pump_speed")) { const v = this.s("ot_sup_pump_speed") ?? "", rec = lowDt ? "auto" : v;
      out.push({ k: "ot_sup_pump_speed", code: "M3", name: ["Prędkość pompy", "Pump speed"], unit: "", kind: this.canSet("ot_sup_pump_speed", "select") ? "select" : "info", group: "pump",
        model: "AUTO", why: ["AUTO trzyma ΔT kotła", "AUTO holds the boiler ΔT"], value: v, ok: rec === v, labels: { auto: "AUTO" }, rec: this.canSet("ot_sup_pump_speed", "select") ? rec : rec === v ? this.fine() : "→ AUTO",
        reason: lowDt && rec !== v ? [`delta T ${f1(dt)} K – zmień w menu M3 kotła`, `delta T ${f1(dt)} K – change it in the boiler menu M3`] : ["w porządku", "fine"] }); }
    if (P === "hercules" && this.eid("ot_her_pump")) { const v = this.s("ot_her_pump") ?? "", rec = lowDt ? "auto" : v;
      out.push({ k: "ot_her_pump", code: "M3", name: ["Sterowanie pompą", "Pump control"], unit: "", kind: this.canSet("ot_her_pump", "select") ? "select" : "info", group: "pump",
        model: "AUTO", why: ["AUTO = prędkość wg ΔT", "AUTO = speed by ΔT"], value: v, ok: rec === v, labels: { auto: "AUTO", fix: "FIX" }, rec: this.canSet("ot_her_pump", "select") ? rec : rec === v ? this.fine() : "→ AUTO",
        reason: lowDt && rec !== v ? [`delta T ${f1(dt)} K – zmień w menu M3 kotła`, `delta T ${f1(dt)} K – change it in the boiler menu M3`] : ["w porządku", "fine"] }); }
    // --- DHW ---
    out.push(this.dhwSetRow());
    out.push(this.infoRow("oa_dhw_cycles", "dhw", ["Cykle CWU dziś", "DHW cycles today"], "×", 0, "≤ 3", ["każdy cykl CWU przerywa grzanie domu", "every DHW cycle pauses the space heating"], (v) => v > 3,
      gt ? ["dużo – szersza histereza zasobnika (t2) albo krótszy program CWU", "many – a wider cylinder hysteresis (t2) or a shorter DHW program"] : P === "superior" ? ["dużo – start CWU niżej (5 / 10 °C poniżej nastawy)", "many – start the DHW lower (5 / 10 °C below the setpoint)"]
        : ["dużo – obniż nastawę albo skróć program CWU", "many – lower the setpoint or shorten the DHW program"]));
    if (P === "superior" || P === "hercules") { const v = this.s("ot_sup_dhw_restart") ?? "", many = this.n("oa_dhw_cycles") > 3, rec = many && v === "3" ? "5" : v;
      if (this.eid("ot_sup_dhw_restart")) out.push({ k: "ot_sup_dhw_restart", code: "M1", name: ["Start CWU poniżej nastawy", "DHW restart below the setpoint"], unit: "", kind: this.canSet("ot_sup_dhw_restart", "select") ? "select" : "info", group: "dhw",
        model: "5 °C", why: ["wcześniejszy restart = więcej krótkich cykli CWU", "an earlier restart = more short DHW cycles"], value: v, ok: rec === v, labels: { "3": "3 °C", "5": "5 °C", "10": "10 °C" },
        rec: this.canSet("ot_sup_dhw_restart", "select") ? rec : rec === v ? this.fine() : "→ 5 °C", reason: many ? ["dużo cykli CWU – zmień w menu kotła", "many DHW cycles – change it in the boiler menu"] : ["w porządku", "fine"] }); }
    // --- other: pressure, flame, link, outdoor probe, efficiency, the profile ---
    out.push(this.infoRow("oa_pressure_drop", "other", ["Spadek ciśnienia 24 h", "Pressure drop 24 h"], "bar", 2, "< 0,1 bar", ["szybki spadek = wyciek albo naczynie wzbiorcze", "a fast drop = a leak or the expansion vessel"], (v) => v >= 0.2,
      ["sprawdź wyciek i ciśnienie naczynia", "check for a leak and the vessel pressure"]));
    out.push(this.infoRow("oa_flame_i_avg", "other", ["Prąd płomienia (średnia)", "Flame current (average)"], "µA", 1, "≥ 4 µA", ["niski prąd = zabrudzona elektroda / zła mieszanka", "a low current = a dirty electrode / a wrong mixture"], (v) => v < 2,
      ["niski – serwis elektrody jonizacyjnej", "low – service the ionisation electrode"]));
    out.push(this.infoRow("oa_link_quality", "other", ["Jakość łącza OpenTherm", "OpenTherm link quality"], "%", 1, "≥ 99 %", ["błędy ramek = zakłócenia albo zły przewód", "frame errors = interference or a bad wire"], (v) => v < 95,
      ["słabe – sprawdź przewód i adapter", "poor – check the wire and the adapter"]));
    if (gt && this.eid("ot_p7")) { const p7 = this.n("ot_p7"); out.push({ k: "ot_p7", code: "P7", name: ["Korekta sondy zewnętrznej", "Outdoor probe correction"], unit: "K", d: 0, kind: "info", group: "other",
      model: "0 K", why: ["korekta przesuwa całą krzywą – lepiej dobrze umieścić sondę", "a correction shifts the whole curve – better place the probe well"], value: p7, ok: !(p7 !== 0),
      rec: p7 === 0 || isNaN(p7) ? this.t("✓ bez korekty", "✓ no correction") : this.t("sprawdź umiejscowienie sondy", "check the probe placement"), reason: ["", ""] }); }
    out.push(this.infoRow("oa_h_per_dd", "other", ["Godziny palnika na stopniodzień", "Burner hours per degree day"], "h/°C·d", 2, this.t("porównuj przed i po zmianie", "compare before and after a change"),
      ["mniej = dom potrzebuje mniej grzania", "less = the house needs less heating"], () => false, ["", ""]));
    out.push(this.profileRow(this.eid("ot_menu_profile") ? "ot_menu_profile" : undefined, names[P] ?? P,
      P === "generic" ? ["wybierz profil menu w Ustawieniach – dostaniesz kody parametrów kotła", "pick the menu profile in the Settings – you get the boiler parameter codes"]
        : esp ? ["hub OpenTherm: zapisy przez Data-ID, menu kotła ręcznie", "OpenTherm hub: writes over Data-IDs, the boiler menu by hand"]
        : ["parametry menu to kopie – zmieniasz je na kotle", "the menu parameters are copies – change them on the boiler"]));
    return out.filter((r): r is Row => !!r);
  }

  private gbRows(): Row[] {
    const m = this.s("gb_model") ?? "other", mtop = m === "mtop", pro = m === "pro", combi = m === "superior" || m === "extra", f1 = (v: number) => this.f(v, 1, 1);
    const names: Record<string, string> = { superior: "VICTRIX ZEUS Superior", extra: "VICTRIX EXTRA / EXTRA PLUS", pro: "VICTRIX PRO V2 EU", mtop: "MAGIS M TOP", iu23: "IMG-BUS + IU23", other: this.t("inny", "other") };
    const out: (Row | null)[] = [];
    if (!mtop) {
      const sh = this.n("ga_starts_hour"), sb = this.n("ga_short_burns"), mod = this.n("ga_mod_avg"), avg = this.n("ga_burn_avg");
      out.push(this.infoRow("ga_starts_hour", "cyc", ["Taktowanie: starty palnika na godzinę", "Cycling: burner starts per hour"], "/h", 0, "≤ 3 /h",
        ["mniej startów = mniej strat i zużycia", "fewer starts = fewer losses and less wear"], (v) => v > 3,
        pro ? ["za często – sprawdź kaskadę / sprzęgło i obniż nastawę CO", "too often – check the cascade / separator and lower the CH setpoint"] : ["za często – obniż nastawę / krzywą albo górny limit mocy", "too often – lower the setpoint / curve or the upper power limit"],
        [`dziś ${this.f(this.n("ga_starts_today"), 0)} startów, średnie palenie ${isNaN(avg) ? "–" : f1(avg)} min`, `${this.f(this.n("ga_starts_today"), 0)} starts today, average burn ${isNaN(avg) ? "–" : f1(avg)} min`]));
      out.push(this.infoRow("ga_burn_avg", "cyc", ["Średnie palenie", "Average burn"], "min", 1, "≥ 10 min", ["krótkie palenia = kocioł za duży na obciążenie", "short burns = the boiler is too big for the load"], (v) => v < 10,
        ["krótko – obniż górny limit mocy", "short – lower the upper power limit"]));
      out.push(this.infoRow("ga_short_burns", "cyc", ["Krótkie palenia dziś", "Short burns today"], "×", 0, "≤ 6", ["palenie < 5 min", "a burn < 5 min"], (v) => v > 6, ["dużo – patrz górny limit mocy", "many – see the upper power limit"]));
      const pw = this.n("gb_power");
      out.push(this.setRow("gb_power", "", "cyc", ["Górny limit mocy", "Upper power limit"], "%", 0, pro ? this.t("≈ obciążenie budynku", "≈ the building load") : "60–100 %",
        ["kocioł palący krótko na wysokiej mocy pali dłużej po obniżeniu limitu", "a boiler burning briefly at a high output burns longer with a lower limit"],
        sb > 6 && mod > 50 && pw > 40 ? pw - 10 : pw, sb > 6 && mod > 50 ? [`${this.f(sb, 0)} krótkich palień, średnia modulacja ${this.f(mod, 0)} %`, `${this.f(sb, 0)} short burns, average modulation ${this.f(mod, 0)} %`] : ["w porządku", "fine"]));
      // heating: condensing, setpoint, the hub weather curve
      const cond = this.n("ga_condensing_share"), cs = this.n("ot_ch_set"), curve = this.on("gb_curve");
      out.push(this.infoRow("ga_condensing_share", "ch", ["Praca kondensacyjna dziś", "Condensing today"], "%", 0, "≥ 70 %", ["powrót poniżej ~55 °C", "return below ~55 °C"], (v) => v < 50,
        ["mało – obniż nastawę CO / krzywą", "low – lower the CH setpoint / curve"]));
      out.push(this.swRow("gb_curve", "", "ch", ["Krzywa pogodowa w hubie", "Weather curve in the hub"], this.t("wł.", "on"),
        ["woda wg temperatury zewnętrznej = niższa przez większość sezonu", "water by the outdoor temperature = lower most of the season"], isNaN(this.n("outdoor")) ? null : true,
        isNaN(this.n("outdoor")) ? ["brak temperatury zewnętrznej", "no outdoor temperature"] : ["sonda zewnętrzna jest", "the outdoor probe is there"]));
      if (!curve) out.push(this.setRow("ot_ch_set", "", "ch", ["Nastawa zasilania CO", "CH flow setpoint"], "°C", 0, this.t("≤ 60 °C (kondensacja)", "≤ 60 °C (condensing)"),
        ["bez krzywej stała woda – niżej = więcej kondensacji", "without the curve the water is fixed – lower = more condensing"], cond < 50 && cs > 60 ? 60 : cs,
        cond < 50 && cs > 60 ? [`kondensacja ${this.f(cond, 0)} %`, `condensing ${this.f(cond, 0)} %`] : ["w porządku", "fine"]));
      out.push(this.infoRow("ga_setpoint_dev", "ch", ["Odchyłka od nastawy", "Setpoint deviation"], "K", 1, "±5 K", ["kocioł nie dochodzi albo przegrzewa", "the boiler does not reach or overshoots"], (v) => Math.abs(v) > 5,
        ["sprawdź moc / przepływ", "check the output / flow"]));
      // hydraulics: delta T, separator (PRO), pressure, ionisation
      out.push(this.infoRow("ga_delta_t", "pump", ["Delta T zasilanie − powrót", "Delta T flow − return"], "K", 1, "15–20 K", ["mała różnica = za ciepły powrót", "a small difference = a too warm return"], (v) => v > 0 && v < 10,
        ["za mało – niższy bieg / tryb ΔT pompy", "too low – a lower pump speed / ΔT mode"]));
      if (pro) out.push(this.infoRow("ga_sep_delta", "pump", ["Zasilanie − za sprzęgłem", "Flow − after the separator"], "K", 1, "≤ 3 K",
        ["duża różnica = pompa kotła tłoczy mniej niż instalacja (albo odwrotnie)", "a large difference = the boiler pump moves less than the system (or the other way)"], (v) => v > 5,
        ["zrównoważ pompę kotła z pompami obiegów", "balance the boiler pump with the circuit pumps"]));
      out.push(this.infoRow("ga_pressure_drop", "other", ["Spadek ciśnienia 24 h", "Pressure drop 24 h"], "bar", 2, "< 0,1 bar", ["szybki spadek = wyciek albo naczynie", "a fast drop = a leak or the vessel"], (v) => v >= 0.2,
        ["sprawdź wyciek i naczynie", "check for a leak and the vessel"]));
      out.push(this.infoRow("ga_ion_avg", "other", ["Jonizacja (średnia)", "Ionisation (average)"], "µA", 1, "≥ 4 µA", ["niska = elektroda / mieszanka", "low = the electrode / mixture"], (v) => v < 3,
        ["niska – serwis elektrody", "low – service the electrode"]));
    } else {
      // MAGIS M TOP: the heat pump side of the BMS
      out.push(this.infoRow("ga_hp_hours_today", "use", ["Pompa ciepła dziś", "Heat pump today"], "h", 2, this.t("większość grzania", "most of the heating"),
        ["MAGIS M TOP: kocioł tylko dogrzewa", "MAGIS M TOP: the boiler only tops up"], () => false, ["", ""]));
      const hh = this.n("ga_hp_hours_today");
      out.push(this.infoRow("ga_defrosts_today", "use", ["Odszraniania dziś", "Defrosts today"], "×", 0, this.t("≤ 1 na godzinę pracy", "≤ 1 per running hour"),
        ["częste odszranianie = wilgotny mróz albo zabrudzony parownik", "frequent defrosts = humid frost or a dirty evaporator"], (v) => !isNaN(hh) && v > Math.max(3, hh * 1.2),
        ["dużo – sprawdź parownik i jego otoczenie", "many – check the evaporator and its surroundings"]));
      const cmin = this.n("gb_cool_min"), cmax = this.n("gb_cool_max");
      out.push(this.setRow("gb_cool_min", "", "cool", ["Chłodzenie: min. zasilanie", "Cooling: min. flow"], "°C", 0, 18, ["podłoga: nie zimniej niż ~18 °C (rosa)", "floor: not colder than ~18 °C (dew)"],
        cmin < 18 ? 18 : cmin, [cmin < 18 ? "ryzyko wykroplenia" : "w porządku", cmin < 18 ? "condensation risk" : "fine"]));
      out.push(this.setRow("gb_cool_max", "", "cool", ["Chłodzenie: maks. zasilanie", "Cooling: max. flow"], "°C", 0, 22, ["min. 2 K nad min. zasilaniem", "at least 2 K above the min. flow"],
        cmax < Math.max(cmin, 18) + 2 ? Math.max(cmin, 18) + 4 : cmax, ["", ""]));
    }
    // DHW: the combi boilers (ZEUS Superior / EXTRA) - ECO = no preheating of the exchanger
    out.push(this.dhwSetRow());
    if (combi) { const dr = this.n("ga_draws_today"); out.push(this.swRow("gb_eco", "", "dhw", ["CWU ECO (bez podgrzewania wymiennika)", "DHW ECO (no exchanger preheating)"], this.t("wł. przy ≤ 5 poborach / dzień", "on with ≤ 5 draws / day"),
      ["podgrzewanie trzyma ciepły wymiennik całą dobę – przy rzadkich poborach to strata", "preheating keeps the exchanger warm all day – a loss with rare draws"],
      isNaN(dr) ? null : dr <= 5 ? true : dr > 15 ? false : null, [`dziś ${isNaN(dr) ? "–" : this.f(dr, 0)} poborów`, `${isNaN(dr) ? "–" : this.f(dr, 0)} draws today`])); }
    out.push(this.profileRow(this.eid("gb_model") ? "gb_model" : undefined, names[m] ?? m,
      m === "other" ? ["wybierz model w Ustawieniach – dostaniesz wiersze dla niego", "pick the model in the Settings – you get its rows"]
        : mtop ? ["wiersze pompy ciepła i chłodzenia zamiast palnika", "heat pump and cooling rows instead of the burner"]
        : pro ? ["kocioł systemowy: sprzęgło i kaskada", "system boiler: separator and cascade"] : combi ? ["kocioł dwufunkcyjny: CWU ECO", "combi boiler: DHW ECO"] : ["", ""]));
    return out.filter((r): r is Row => !!r);
  }

  private mtRows(): Row[] {
    const cap = this.n("mt_cap"), small = !isNaN(cap) && cap <= 6.5, big = !isNaN(cap) && cap >= 11.5, f1 = (v: number) => this.f(v, 1, 1);
    const cycMin = small ? 15 : big ? 20 : 18, startsMax = small ? 24 : big ? 16 : 20;
    const out: (Row | null)[] = [];
    // cycling: the smaller the unit, the shorter its minimum useful cycle
    out.push(this.infoRow("mt_cycle_avg", "cyc", ["Średni cykl sprężarki", "Average compressor cycle"], "min", 0, `≥ ${cycMin} min`,
      ["sprężarka rozgrzewa się i modulując pracuje wydajnie", "the compressor warms up and runs efficiently when modulating"], (v) => v < cycMin,
      ["krótko – obniż krzywą o 1 albo dodaj bufor / otwórz pętle", "short – lower the curve by 1 or add a buffer / open loops"]));
    out.push(this.infoRow("mt_short_cycles", "cyc", ["Krótkie cykle dziś", "Short cycles today"], "×", 0, "≤ 2", ["cykl < 10 min", "a cycle < 10 min"], (v) => v > 2,
      ["dużo – za mała pojemność wodna albo za wysoka krzywa", "many – too little water volume or a too high curve"]));
    out.push(this.infoRow("starts", "cyc", ["Starty sprężarki dziś", "Compressor starts today"], "×", 0, `≤ ${startsMax}`, ["łącznie CO i CWU od północy", "CH and DHW since midnight"], (v) => v > startsMax,
      ["za dużo – patrz cykl i krzywa", "too many – see the cycle and the curve"]));
    // heating: the weather curve number from the room deviation, water limits, the summer cut-off
    const room = this.n("zone1"), tgt = this.n("zone1_set"), dev = room - tgt, chh = this.n("mt_ch_hours"), enough = isNaN(chh) || chh >= 2;
    out.push(this.swRow("mt_curve_on", "", "ch", ["Krzywa pogodowa strefa 1", "Weather curve zone 1"], this.t("wł.", "on"),
      ["woda wg pogody = najniższa możliwa = najlepszy COP", "water by the weather = the lowest possible = the best COP"], true, ["", ""]));
    if (this.on("mt_curve_on")) { const n = this.n("mt_curve_n");
      out.push(this.setRow("mt_curve_n", "", "ch", ["Numer krzywej strefa 1", "Curve number zone 1"], "", 0, this.t("pokój ±0,5 K od zadanej", "room within ±0.5 K of the target"),
        ["wyższy numer = cieplejsza woda przy tej samej pogodzie", "a higher number = warmer water at the same weather"],
        !enough || isNaN(dev) ? n : dev > 0.5 ? n - 1 : dev < -0.5 ? n + 1 : n,
        isNaN(dev) ? ["brak temperatury pokoju", "no room temperature"] : [`pokój ${dev > 0 ? "+" : ""}${f1(dev)} K od zadanej${enough ? "" : " – za mało grzania, by ocenić"}`, `room ${dev > 0 ? "+" : ""}${f1(dev)} K from the target${enough ? "" : " – too little heating to judge"}`])); }
    out.push(this.infoRow("mt_curve_dev", "ch", ["Zasilanie − krzywa", "Flow − curve"], "K", 1, "±2 K", ["jednostka nie dochodzi do krzywej albo ją przegrzewa", "the unit does not reach the curve or overshoots"], (v) => Math.abs(v) > 3,
      ["sprawdź moc jednostki / przepływ", "check the unit output / flow"]));
    out.push(this.infoRow("mt_lhmax", "ch", ["Grzanie – maks. woda", "Heating water max."], "°C", 0, this.t("≤ 45 °C podłoga / ≤ 55 °C grzejniki", "≤ 45 °C floor / ≤ 55 °C radiators"),
      ["górny limit wody – wyżej COP szybko spada", "the top water limit – above it the COP drops fast"], (v) => v > 55, ["wysoko – obniż w menu jednostki", "high – lower it in the unit menu"]));
    out.push(this.infoRow("mt_t4hmax", "ch", ["Grzanie – maks. temp. zewn. (T4HMAX)", "Heating outdoor max. (T4HMAX)"], "°C", 0, "≈ 20 °C", ["powyżej tej temperatury zewnętrznej grzanie stoi", "above this outdoor temperature the heating stops"], (v) => v > 24,
      ["wysoko – grzanie w ciepłe dni, obniż w menu jednostki", "high – heating on warm days, lower it in the unit menu"]));
    out.push(this.infoRow("mt_cop_ch_today", "ch", ["COP grzania dziś", "Heating COP today"], "", 2, "≥ 3", ["niski COP = za ciepła woda albo dużo odszraniania", "a low COP = too warm water or a lot of defrosting"], (v) => v > 0 && v < 2.5,
      ["nisko – obniż krzywą o 1", "low – lower the curve by 1"]));
    // pump: delta T on the heat pump (~5 K)
    out.push(this.infoRow("mt_delta_t", "pump", ["Delta T pompy ciepła", "Heat pump delta T"], "K", 1, "4–6 K", ["pompa ciepła lubi małą, stałą różnicę", "a heat pump likes a small, steady difference"], (v) => v > 0 && (v < 3 || v > 8),
      ["poza zakresem – ustaw przepływ pompy obiegowej", "out of range – set the circulation pump flow"]));
    // DHW: setpoint, COP, disinfection, the tank heater
    out.push(this.dhwSetRow("dhw", true));
    out.push(this.infoRow("mt_cop_dhw_today", "dhw", ["COP CWU dziś", "DHW COP today"], "", 2, "≥ 2,5", ["CWU to wysoka woda – COP niższy niż przy grzaniu", "DHW is hot water – a lower COP than heating"], (v) => v > 0 && v < 2,
      ["nisko – obniż nastawę CWU", "low – lower the DHW setpoint"]));
    out.push(this.swRow("mt_dis", "", "dhw", ["Dezynfekcja (antylegionella)", "Disinfection (anti-legionella)"], this.t("wł. przy CWU < 55 °C", "on with DHW < 55 °C"),
      ["raz w tygodniu ~60 °C zabija Legionellę", "~60 °C once a week kills Legionella"], isNaN(this.n("dhw_set")) ? null : this.n("dhw_set") < 55,
      [`nastawa CWU ${this.f(this.n("dhw_set"), 0)} °C`, `DHW setpoint ${this.f(this.n("dhw_set"), 0)} °C`]));
    out.push(this.infoRow("mt_tbh_hours", "dhw", ["Grzałka zasobnika (TBH) dziś", "Tank heater (TBH) today"], "h", 2, "0 h", ["grzałka to COP 1", "the heater is COP 1"], (v) => v > 0.5,
      ["pracowała – sprawdź nastawę CWU i czasy TBH", "it ran – check the DHW setpoint and the TBH timings"]));
    // heaters / defrost
    const out_ = this.n("outdoor");
    out.push(this.infoRow("mt_ibh_hours", "use", ["Grzałka IBH dziś", "Backup heater IBH today"], "h", 2, this.t("0 h powyżej −5 °C", "0 h above −5 °C"), ["grzałka to COP 1", "the heater is COP 1"],
      (v) => v > 0.5 && !isNaN(out_) && out_ > -2, ["przy łagodnej pogodzie – sprawdź temperaturę włączenia grzałki (T4)", "in mild weather – check the heater start temperature (T4)"]));
    const hrs = (this.n("mt_ch_hours") || 0) + (this.n("mt_dhw_hours") || 0);
    out.push(this.infoRow("mt_defrosts_today", "use", ["Odszraniania dziś", "Defrosts today"], "×", 0, this.t("≤ 1 na godzinę pracy", "≤ 1 per running hour"),
      ["częste odszranianie = wilgotny mróz albo zabrudzony parownik", "frequent defrosts = humid frost or a dirty evaporator"], (v) => hrs > 0 && v > Math.max(3, hrs * 1.2),
      ["dużo – sprawdź parownik i jego otoczenie", "many – check the evaporator and its surroundings"]));
    out.push(this.profileRow(this.eid("mt_cap") ? "mt_cap" : undefined, isNaN(cap) ? "MAGIS M" : `MAGIS M · ${this.f(cap, 1, 0)} kW`,
      isNaN(cap) ? ["brak mocy jednostki – progi dla średniej (8–10 kW)", "no unit capacity – thresholds for a medium unit (8–10 kW)"]
        : small ? ["mała jednostka: krótsze cykle są normalne", "small unit: shorter cycles are normal"] : big ? ["duża jednostka: dłuższe cykle i mniej startów", "big unit: longer cycles and fewer starts"]
        : ["średnia jednostka", "medium unit"]));
    return out.filter((r): r is Row => !!r);
  }

  private cur(r: Row): number | string {
    if (r.kind === "info" || r.kind === "custom") return r.value ?? NaN;
    if (r.entity) return parseFloat(this.hass.states[r.entity]?.state);
    if (r.kind === "number") return this.n(r.k!);
    return this.s(r.k!) ?? "–";
  }
  private fmt(r: Row, v: number | string) {
    if (r.labels && typeof v === "string") return r.labels[v] ?? v;
    if (r.kind === "switch") return v === "on" ? this.t("wł.", "on") : v === "off" ? this.t("wył.", "off") : String(v);
    if (typeof v === "string") return v;
    return isNaN(v) ? "–" : this.f(v, r.d ?? 1, r.d ?? 0) + (r.unit ? " " + r.unit : "");
  }
  private apply(r: Row) {
    const v = r.rec;
    if (r.setFn) r.setFn(String(v));
    else if (r.entity) this.hass.callService("input_number", "set_value", { entity_id: r.entity, value: v });
    else if (r.kind === "select") this.call("select", "select_option", r.k!, { option: v });
    else if (r.kind === "switch") this.call("switch", v === "on" ? "turn_on" : "turn_off", r.k!);
    else this.call("number", "set_value", r.k!, { value: v });
  }

  protected body() {
    const mode = this.calMode, dom = mode === "dom", hub = mode === "hub";
    if (hub && (!this.hist || Date.now() - this.hist.at > 10 * 60e3)) this.load();
    if (hub && !this.effLoading && (!this.eff || Date.now() - this.eff.at > 30 * 60e3)) this.loadEff();
    if (dom && !this.effLoading && (!this.effDom || Date.now() - this.effDom.at > 30 * 60e3)) this.loadEffDom();
    if (hub && !this.lossLoading && (!this.loss || Date.now() - this.loss.at > 6 * H)) this.loadLoss();
    const gOf = (r: Row) => r.group ?? (r.kind === "info" && !r.code && !/harmonogram|schedule/i.test(r.name[0]) ? "cyc"
      : /^(źródło ciepła|harmonogram|nastawa co w pokojach)/i.test(r.name[0]) || ["U11", "FR", "P15"].includes(r.code) ? "use"
      : ["dhw_set", "t02"].includes(r.k as string) ? "dhw" : ["i10"].includes(r.k as string) ? "int" : r.k === "dew_corr" ? "cool" : "ch");
    const order = GROUPS.map((g) => g[0]);
    // Magis Pro has no gas boiler: no boiler integration (I..) and no heat pump vs gas choice
    const gas = this.hasGas, boilerRow = (r: Row) => gOf(r) === "int" || /^I\d\d$/.test(r.code ?? "") || /^(źródło ciepła)/i.test(r.name[0]);
    const rows = (dom ? this.domRows() : mode === "ot" ? this.otRows() : mode === "gb" ? this.gbRows() : mode === "mt" ? this.mtRows() : this.rows()).filter((r) => r.kind === "info" || r.kind === "custom" || r.entity || this.eid(r.k!)).filter((r) => gas || !boilerRow(r))
      .map((r, i) => ({ r: { ...r, group: gOf(r) }, i })).sort((a, b) => order.indexOf(a.r.group!) - order.indexOf(b.r.group!) || a.i - b.i).map((x) => x.r);
    const diff = (r: Row) => { if (r.kind === "info") return !r.ok; const a = this.cur(r), b = r.rec; return typeof a === "number" && typeof b === "number" ? !isNaN(b) && !isNaN(a) && Math.abs(a - b) > 0.01 : a !== b && b !== "" && b !== undefined; };
    const nDiff = rows.filter(diff).length, S = hub ? this.stats() : null;
    // the most important finding (first one to change, in group order) for the diagram card
    const top = rows.find(diff);
    hubNote.rec = top ? {
      text: this.t(top.name[0], top.name[1]) + ": " + (top.kind === "info" ? String(top.rec ?? "") : "→ " + this.fmt(top, top.rec as number | string)),
      reason: this.t(top.reason[0], top.reason[1]), ok: false, entity: top.entity ?? (top.k ? this.eid(top.k) : undefined), at: Date.now(),
    } : { text: this.t("Kalibracja: wszystko zgodnie z rekomendacją", "Calibration: all as recommended"), reason: "", ok: true, at: Date.now() };
    return html`
      ${this.head("mdi:tune-vertical-variant", this.t("Kalibracja", "Calibration"),
        nDiff ? this.t(`do zmiany: ${nDiff}`, `to change: ${nDiff}`) : this.t("wszystko zgodnie z rekomendacją", "all as recommended"))}
      <div class="tbl">
        <div class="th">${this.t("Parametr", "Parameter")}</div><div class="th c">${this.t("Model", "Model")}</div>
        <div class="th c">${this.t("Obecnie", "Now")}</div><div class="th c">${this.t("Rekomendacja", "Recommendation")}</div>
        ${rows.map((r, i) => {
          const gh = i === 0 || rows[i - 1].group !== r.group ? GROUPS.find((g) => g[0] === r.group) : undefined;
          const cur = this.cur(r), d = diff(r), tag = "cal_" + (r.k ?? r.entity), conf = this.isArmed(tag), col = d ? "peach" : "green";
          const atModel = r.kind === "info" ? !!r.ok : r.kind === "custom" ? cur === r.rec : typeof cur === "number" && typeof r.model === "number" ? Math.abs(cur - r.model) < 0.01 : cur === r.model;
          return html`${gh ? html`<div class="grp">${this.t(gh[1], gh[2])}</div>` : nothing}
            <div class="pn" @click=${() => r.entity ? this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: r.entity }, bubbles: true, composed: true })) : this.moreInfo(r.k!)}>
              ${r.code ? html`<span class="code">${r.code}</span>` : nothing}${this.t(r.name[0], r.name[1])}</div>
            <div class="cell"><div class="v">${this.fmt(r, r.model)}</div><div class="why">${this.t(r.why[0], r.why[1])}</div></div>
            <div class="cell"><div class="v" style="color:${c(atModel ? "green" : "yellow")}">${this.fmt(r, cur)}</div></div>
            <div class="cell rec" style="background:${ca(col, d ? 0.12 : 0.06)};border-color:${ca(col, d ? 0.45 : 0.18)}">
              ${r.kind === "info" ? html`<div class="txt" style="color:${c(col)}">${d ? "→ " : ""}${r.rec}</div>`
                : html`<div class="v" style="color:${c(col)}">${d ? "→ " : "✓ "}${this.fmt(r, r.rec)}</div>`}<div class="why">${this.t(r.reason[0], r.reason[1])}</div>
              ${d && (r.kind !== "info" || r.setFn) ? html`<div class="set" style="${conf ? `outline:2px solid ${c("peach")}` : ""}" @click=${() => this.confirm(tag, () => this.apply(r))}>
                <ha-icon icon="mdi:check-bold"></ha-icon>${conf ? this.t("Potwierdź", "Confirm") : this.t("Ustaw", "Set")}</div>` : nothing}</div>`;
        })}
        ${dom ? this.effDomView() : hub ? this.effView() : nothing}
      </div>
      ${!hub && !dom ? html`<div class="note">${mode === "ot" ? this.t("Rekomendacje z analizy dnia OpenTherm (ot_computed / ot_analytics albo Immergas Dominus 1.6.14) i profilu menu kotła.",
        "Recommendations from the OpenTherm Today analysis (ot_computed / ot_analytics or Immergas Dominus 1.6.14) and the boiler menu profile.")
        : mode === "gb" ? this.t("Rekomendacje z analizy dnia (gb_computed / gb_analytics) i modelu kotła.", "Recommendations from the Today analysis (gb_computed / gb_analytics) and the boiler model.")
        : this.t("Rekomendacje z analizy dnia (mt_computed / mt_analytics) i mocy jednostki.", "Recommendations from the Today analysis (mt_computed / mt_analytics) and the unit capacity.")}
        ${this.t("Zmieniaj po jednym parametrze i oceniaj po dobie.", "Change one parameter at a time and judge after a day.")}</div>`
      : dom || !S ? html`<div class="note">${this.t("Rekomendacje liczone ze statystyk integracji Immergas Dominus (ostatnia godzina i doba).",
        "Recommendations from the Immergas Dominus statistics (last hour and day).")}
        ${this.t("Zmieniaj po jednym parametrze i oceniaj po dobie.", "Change one parameter at a time and judge after a day.")}</div>` : html`<div class="note">${this.t("Rekomendacje liczone z ostatnich 24 h", "Recommendations from the last 24 h")}: ${this.f(S.coPerH, 1, 1)} ${this.t("startu CO/h", "CH starts/h")},
        ${this.t("cykl", "cycle")} ~${this.f(S.coRun, 1, 0)} min${this.rooms().length ? this.t(`, ${this.rooms().length} termostatów pokojowych`, `, ${this.rooms().length} room thermostats`) : ""}.
        ${this.t("Zmieniaj po jednym parametrze i oceniaj po dobie.", "Change one parameter at a time and judge after a day.")}</div>`}`;
  }

  static styles = [HubCard.styles, css`
    .tbl { display: grid; grid-template-columns: minmax(110px, 1.3fr) repeat(3, minmax(80px, 1fr)); gap: 6px 8px; align-items: stretch; }
    .th { font-size: 9.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; opacity: var(--ih-o5, .5); padding-bottom: 2px; }
    .th.c { text-align: center; }
    .pn { cursor: pointer; font-size: 12px; font-weight: 700; line-height: 1.25; align-self: center; }
    .code { display: inline-block; font-size: 9.5px; font-weight: 800; padding: 1px 5px; margin-right: 5px; border-radius: 5px; background: rgba(var(--ih-blue-rgb), .16); color: var(--ih-blue); }
    .cell { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 6px 6px; border-radius: 10px;
      background: rgba(var(--ih-overlay1-rgb), .06); border: 1px solid transparent; min-width: 0; }
    /* long values (e.g. calendar ranges) wrap inside the cell instead of spilling over the next column */
    .v { font-size: 13.5px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: normal; overflow-wrap: anywhere; max-width: 100%; }
    .effn { grid-column: 1 / -1; font-size: 10px; opacity: var(--ih-o6, .6); line-height: 1.4; margin-top: 2px; }
    .grp { grid-column: 1 / -1; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--ih-blue); margin-top: 8px;
      padding-bottom: 3px; border-bottom: 1px solid rgba(var(--ih-blue-rgb), .25); }
    .txt { font-size: 11.5px; font-weight: 800; line-height: 1.25; }
    .why { font-size: 9.5px; opacity: var(--ih-o6, .6); line-height: 1.25; margin-top: 2px; }
    .set { cursor: pointer; display: inline-flex; align-items: center; gap: 3px; margin-top: 5px; padding: 3px 9px; border-radius: 8px; font-size: 10.5px; font-weight: 800;
      background: rgba(var(--ih-peach-rgb), .22); color: var(--ih-peach); }
    .set ha-icon { --mdc-icon-size: 13px; }
    @media (max-width: 520px) { .why { display: none; } }
  `];
}

register("immergas-calibration-card", ImmergasCalibrationCard, "Immergas – Kalibracja / Calibration",
  "Kluczowe parametry: wartość modelowa, obecna i rekomendacja z danych na żywo (z przyciskiem Ustaw)");
