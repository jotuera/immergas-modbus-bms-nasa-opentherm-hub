// "Obieg wodny / Water circuit" and "Obieg chłodniczy / Refrigerant circuit": tile grids; "Stan urządzeń / Device states":
// the on/off flags of the outdoor unit (also under the refrigerant tiles unless `flags: false`).
import { HubCard, html, css, nothing, c, ca, register } from "../base";
import { Key } from "../names";

type Row = [Key, string, string, string, number?]; // key, icon, PL label, EN label, decimals

abstract class GridCard extends HubCard {
  protected abstract rows(): Row[];
  protected flags(): [Key, string, string][] { return []; }
  /** computed tiles after the entity ones: icon, PL / EN label, value, colour */
  protected extra(): [string, string, string, string, string][] { return []; }
  protected abstract heading(): [string, string, string];
  /** wider tiles: 12 water / 24 refrigerant tiles fill even rows (6 across two dashboard columns, 3 in one) */
  protected wide = false;

  protected val(k: Key, d = 1) {
    const so = this.so(k);
    if (!so || ["unavailable", "unknown"].includes(so.state)) return "–";
    const v = parseFloat(so.state), u = so.attributes?.unit_of_measurement ?? "";
    return isNaN(v) ? so.state : this.f(v, d) + (u ? " " + u : "");
  }
  protected colOf(k: Key): string {
    const v = this.n(k), u = this.attr(k, "unit_of_measurement");
    if (isNaN(v)) return "overlay2";
    if (u === "°C") return v < 10 ? "sky" : v < 25 ? "teal" : v < 40 ? "yellow" : v < 60 ? "peach" : "red";
    return "blue";
  }

  protected body() {
    const [icon, pl, en] = this.heading();
    const fl = this.config.flags === false ? [] : this.flags(), rows = this.rows();
    return html`
      ${this.head(icon, this.t(pl, en))}
      ${rows.length ? html`<div class="grid ${this.wide ? "wide" : ""}">${this.rows().filter(([k]) => this.eid(k)).map(([k, ic, lp, le, d]) => {
        const col = this.colOf(k);
        return html`<div class="tile" style="background:${ca(col, 0.08)};border:1px solid ${ca(col, 0.18)}" @click=${() => this.moreInfo(k)}>
          <ha-icon icon=${ic} style="color:${c(col)}"></ha-icon>
          <div class="cx"><div class="lbl">${this.t(lp, le)}</div><div class="tv">${this.val(k, d ?? 1)}</div></div></div>`;
      })}${this.extra().map(([ic, lp, le, v, col]) => html`<div class="tile" style="background:${ca(col, 0.08)};border:1px solid ${ca(col, 0.18)}">
          <ha-icon icon=${ic} style="color:${c(col)}"></ha-icon>
          <div class="cx"><div class="lbl">${this.t(lp, le)}</div><div class="tv">${v}</div></div></div>`)}</div>` : nothing}
      ${fl.length ? html`<div class="flags ${rows.length ? "" : "cols"}">${fl.filter(([k]) => this.eid(k)).map(([k, lp, le]) => {
        const on = this.on(k), col = on ? "green" : "overlay2";
        return html`<div class="flag" style="background:${ca(col, on ? 0.2 : 0.06)};border:1px solid ${ca(col, on ? 0.5 : 0.15)};color:${on ? c(col) : "inherit"}"
          @click=${() => this.moreInfo(k)}><span class="dot" style="background:${c(col)};${on ? `box-shadow:0 0 6px ${c(col)}` : ""}"></span>${this.t(lp, le)}</div>`;
      })}</div>` : nothing}`;
  }

  static styles = [HubCard.styles, css`
    .grid.wide { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
    .flags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    /* own card (Device states): two even rows of five, two columns on a phone */
    .flags.cols { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); }
    .flags.cols .flag { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    @media (max-width: 600px) { .flags.cols { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .flag { cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 10px; font-size: 11px; font-weight: 700; }
    .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  `];
}

class ImmergasWaterCard extends GridCard {
  protected extra(): [string, string, string, string, string][] {
    if (!this.mtx || this.eid("mt_delta_t")) return [];
    const d = this.n("tw2") - this.n("tw1");
    return [["mdi:delta", "Delta T (TW_O − TW_I)", "Delta T (TW_O − TW_I)", isNaN(d) ? "–" : this.f(d, 1, 1) + " K", isNaN(d) ? "overlay2" : d < 0 ? "sky" : d > 8 ? "peach" : "green"]];
  }
  protected heading(): [string, string, string] { return ["mdi:water-sync", "Obieg wodny", "Water circuit"]; }
  protected wide = true;
  protected rows(): Row[] {
    // MAGIS M (Midea): the unit's water sensors - TW_O / TW_I, T1 / T1B, buffer, flow, curve targets, the DHW tank
    if (this.mtx) return [
      ["tw2", "mdi:thermometer-chevron-up", "Woda wylot (TW_O)", "Water outlet (TW_O)"],
      ["tw1", "mdi:thermometer-chevron-down", "Woda wlot (TW_I)", "Water inlet (TW_I)"],
      ["mt_t1", "mdi:thermometer-lines", "Woda całkowita (T1)", "Total water (T1)"],
      ["mt_t1b", "mdi:thermometer-water", "Woda strefy 2 (T1B)", "Zone 2 water (T1B)"],
      ["mt_buf_top", "mdi:storage-tank", "Bufor – góra", "Buffer – top"],
      ["mt_buf_bot", "mdi:storage-tank-outline", "Bufor – dół", "Buffer – bottom"],
      ["mt_flow", "mdi:pump", "Przepływ wody", "Water flow", 1],
      ["heat_power", "mdi:radiator", "Moc cieplna", "Heat output", 2],
      ["d04", "mdi:target", "Z krzywej strefa 1", "Curve target zone 1"],
      ["mt_ct2", "mdi:target-variant", "Z krzywej strefa 2", "Curve target zone 2"],
      ["mt_wset", "mdi:thermometer-water", "Nastawa wody strefa 1", "Water setpoint zone 1"],
      ["tank", "mdi:water-boiler", "Zasobnik CWU (T5)", "DHW tank (T5)"],
      ["mt_delta_t", "mdi:delta", "Delta T wody", "Water delta T"],
      ["mt_lift", "mdi:arrow-expand-vertical", "Lift termiczny", "Thermal lift"],
      ["mt_mean_loop", "mdi:approximately-equal", "Średnia obiegu", "Mean loop"],
      ["mt_heat_flow_calc", "mdi:calculator-variant-outline", "Moc z przepływu", "Heat from the flow", 2],
      ["mt_curve_dev", "mdi:chart-bell-curve-cumulative", "Odchyłka od krzywej", "Curve deviation"],
      ["mt_buffer_strat", "mdi:storage-tank", "Rozwarstwienie bufora", "Buffer stratification"],
    ];
    return [
      ["tw2", "mdi:thermometer-chevron-up", "Zasilanie PC (TW2)", "HP flow (TW2)"],
      ["tw1", "mdi:thermometer-chevron-down", "Powrót PC (TW1)", "HP return (TW1)"],
      ["hp_delta", "mdi:delta", "Delta T pompy", "HP Delta T"],
      ["flow_d20", "mdi:thermometer-lines", "Zasilanie (D20)", "Flow (D20)"],
      ["d01", "mdi:fire", "Zasilanie kotła (D01)", "Boiler flow (D01)"],
      ["boiler_ret", "mdi:fire-off", "Powrót kotła", "Boiler return"],
      ["avg_circ", "mdi:approximately-equal", "Średnia obiegu", "Circuit average"],
      ["d14", "mdi:pump", "Przepływ (D14)", "Flow rate (D14)", 0],
      ["lift", "mdi:arrow-expand-vertical", "Lift termiczny", "Thermal lift"],
      ["d22", "mdi:valve", "Zawór 3-dr. (1=CWU)", "3-way valve (1=DHW)", 0],
      ["heat_power", "mdi:radiator", "Moc cieplna", "Heat output", 0],
      ["d04", "mdi:target", "Zadane D04", "Setpoint D04"],
    ];
  }
}

class ImmergasRefrigerantCard extends GridCard {
  protected heading(): [string, string, string] { return ["mdi:snowflake-thermometer", "Obieg chłodniczy", "Refrigerant circuit"]; }
  protected wide = true;
  protected rows(): Row[] {
    // MAGIS M (Midea): compressor, refrigerant temperatures (Tp / Th / T3 / T4 / T2 / T2B), pressures, EEV, fan, inverter
    if (this.mtx) return [
      ["hz", "mdi:sine-wave", "Częstotliwość sprężarki", "Compressor frequency", 0],
      ["ff_hz_target", "mdi:target", "Częstotl. docelowa", "Target frequency", 0],
      ["d73", "mdi:thermometer-high", "Tłoczenie (Tp)", "Discharge (Tp)"],
      ["mt_suction", "mdi:thermometer-low", "Ssanie (Th)", "Suction (Th)"],
      ["d74", "mdi:coolant-temperature", "Wymiennik zewn. (T3)", "Outdoor coil (T3)"],
      ["outdoor", "mdi:thermometer", "Zewnętrzna (T4)", "Outdoor (T4)"],
      ["d24", "mdi:water-thermometer", "Czynnik – ciecz (T2)", "Refrigerant liquid (T2)"],
      ["mt_t2b", "mdi:weather-windy", "Czynnik – gaz (T2B)", "Refrigerant gas (T2B)"],
      ["mt_ph", "mdi:gauge-full", "Ciśnienie wysokie", "High pressure", 0],
      ["mt_pl", "mdi:gauge-low", "Ciśnienie niskie", "Low pressure", 0],
      ["d77", "mdi:valve-open", "Zawór rozprężny (EEV)", "Expansion valve (EEV)", 0],
      ["fan_real", "mdi:fan", "Wentylator", "Fan", 0],
      ["mt_cur", "mdi:current-ac", "Prąd jedn. zewn.", "ODU current", 0],
      ["mt_volt", "mdi:power-plug", "Napięcie jedn. zewn.", "ODU voltage", 0],
      ["mt_inv", "mdi:chip", "Moduł inwertera", "Inverter module"],
      ["mt_cap", "mdi:flash", "Moc jednostki", "Unit capacity", 1],
      ["elec_power", "mdi:flash-outline", "Pobór mocy", "Electric power", 2],
      ["mt_hours", "mdi:timer-outline", "Godziny sprężarki", "Compressor hours", 0],
      ["mt_t_cond", "mdi:thermometer-high", "Skraplanie (z ciśnienia)", "Condensing (from pressure)"],
      ["mt_t_evap", "mdi:thermometer-low", "Parowanie (z ciśnienia)", "Evaporating (from pressure)"],
      ["mt_superheat", "mdi:thermometer-plus", "Przegrzanie ssania", "Suction superheat"],
      ["mt_subcool", "mdi:thermometer-minus", "Dochłodzenie", "Subcooling"],
      ["mt_dsh", "mdi:fire-circle", "Przegrzanie tłoczenia", "Discharge superheat"],
      ["mt_comp_ratio", "mdi:arrow-collapse-vertical", "Stopień sprężania", "Compression ratio", 2],
      ["mt_odu_power_ui", "mdi:flash-outline", "Moc z U × I", "Power from U × I", 2],
    ];
    return [
      ["hz", "mdi:sine-wave", "Częstotliwość (D71)", "Frequency (D71)", 0],
      ["ff_hz_target", "mdi:target", "Częstotl. docelowa", "Target frequency", 0],
      ["ff_hz_order", "mdi:clipboard-arrow-right-outline", "Częstotl. zlecona", "Ordered frequency", 0],
      ["d73", "mdi:thermometer-high", "Tłoczenie (D73)", "Discharge (D73)"],
      ["d73_set", "mdi:target-variant", "Tłoczenie zadane", "Target discharge"],
      ["d72", "mdi:engine", "Korpus sprężarki (D72)", "Compressor shell (D72)"],
      ["d74", "mdi:coolant-temperature", "Wymiennik zewn. (D74)", "Outdoor coil (D74)"],
      ["d24", "mdi:water-thermometer", "Faza ciekła (D24)", "Liquid line (D24)"],
      ["d79", "mdi:thermometer", "Sonda jedn. zewn. (D79)", "ODU probe (D79)"],
      ["d75", "mdi:current-ac", "Prąd sprężarki (D75)", "Compressor current (D75)"],
      ["d77", "mdi:valve-open", "Zawór EEV (D77)", "EEV (D77)", 0],
      ["fan", "mdi:fan", "Wentylator zadany", "Fan target", 0],
      ["fan_real", "mdi:fan-chevron-up", "Wentylator faktyczny", "Fan actual", 0],
      ["odu_power", "mdi:flash", "Moc jedn. zewn.", "ODU power", 0],
      ["power_demand", "mdi:flash-outline", "Zapotrzeb. mocy", "Power demand"],
      ["ipm", "mdi:chip", "Moduł IPM", "IPM module"],
      ["dc_link", "mdi:current-dc", "DC-Link", "DC link", 0],
      ["mains", "mdi:power-plug", "Napięcie sieci", "Mains voltage", 0],
      ["odu_state", "mdi:state-machine", "Stan jedn. zewn.", "ODU state"],
      ["odu_mode", "mdi:cog-outline", "Tryb jedn. zewn.", "ODU mode"],
      ["start_stage", "mdi:stairs-up", "Etap rozruchu", "Start stage"],
      ["pc_stage", "mdi:progress-check", "Etap pracy", "Run stage"],
      ["restart_lock", "mdi:timer-lock-outline", "Blokada restartu", "Restart lock"],
      ["f_lim", "mdi:speedometer-medium", "Limit częstotliwości", "Frequency limit", 0],
    ];
  }
  protected colOf(k: Key): string {
    if (k === "hz" || k === "ff_hz_target" || k === "ff_hz_order") return this.n(k) > 0 ? "peach" : "overlay2";
    const v = this.n(k);
    // typical ranges: suction superheat 2-10 K, subcooling 2-8 K, discharge superheat 15-40 K
    if (k === "mt_superheat") return isNaN(v) ? "overlay2" : v < 1 || v > 15 ? "red" : v < 2 || v > 10 ? "yellow" : "green";
    if (k === "mt_subcool") return isNaN(v) ? "overlay2" : v < 1 || v > 12 ? "red" : v < 2 || v > 8 ? "yellow" : "green";
    if (k === "mt_dsh") return isNaN(v) ? "overlay2" : v < 10 || v > 50 ? "red" : v < 15 || v > 40 ? "yellow" : "green";
    if (k === "mt_comp_ratio") return isNaN(v) ? "overlay2" : v > 8 ? "red" : v > 6 ? "yellow" : "teal";
    return super.colOf(k);
  }
  protected flags() { return this.mtx ? MT_FLAGS : FLAGS; }
}

const MT_FLAGS: [Key, string, string][] = [
  ["mt_run", "Praca", "Running"], ["defrost", "Odszranianie", "Defrost"], ["f_pump", "Pompa wewn.", "Internal pump"], ["mt_pump_o", "Pompa zewn.", "Outer pump"],
  ["mt_sv1", "Zawór SV1 (CWU)", "Valve SV1 (DHW)"], ["backup_heater", "Grzałka IBH1", "Heater IBH1"], ["mt_ibh2", "Grzałka IBH2", "Heater IBH2"],
  ["dhw_heater", "Grzałka TBH", "Heater TBH"], ["mt_antifreeze", "Ochrona przed zamarzaniem", "Antifreeze"], ["mt_oil", "Powrót oleju", "Oil return"],
  ["mt_th_heat", "Termostat: grzanie", "Thermostat: heat"], ["mt_th_cool", "Termostat: chłodzenie", "Thermostat: cool"], ["mt_alarm", "Alarm", "Alarm"],
];

const FLAGS: [Key, string, string][] = [
  ["f_comp", "Sprężarka", "Compressor"], ["f_fan", "Wentylator", "Fan"], ["f_order", "Zlecenie pracy", "Run request"],
  ["defrost", "Odszranianie", "Defrost"], ["f_4way", "Zawór 4-dr.", "4-way valve"], ["f_hotgas", "Gorący gaz", "Hot gas"],
  ["f_pump", "Pompa obieg.", "Circ. pump"], ["backup_heater", "Grzałka rez.", "Backup heater"], ["dhw_heater", "Grzałka CWU", "DHW heater"],
  ["f_tray", "Grzałka tacy", "Tray heater"],
];

class ImmergasStatesCard extends GridCard {
  protected heading(): [string, string, string] { return ["mdi:list-status", "Stan urządzeń", "Device states"]; }
  protected rows(): Row[] { return this.mtx && this.eid("mt_op_state") ? [["mt_op_state", "mdi:state-machine", "Stan pracy", "Operating state"]] : []; }
  protected colOf(k: Key): string { return k === "mt_op_state" ? (/błąd|fault|evu/i.test(this.s(k) ?? "") ? "red" : /odszr|defrost/i.test(this.s(k) ?? "") ? "sky" : "teal") : super.colOf(k); }
  protected flags() { return this.mtx ? MT_FLAGS : FLAGS; }
}

const copCol = (v: number) => isNaN(v) || v <= 0 ? "overlay2" : v < 2 ? "red" : v < 2.7 ? "peach" : v < 3.5 ? "yellow" : "green";

/** MAGIS M (mt_analytics): today's short cycling, defrosts, heating / DHW split with their COPs, heaters */
class ImmergasDayCard extends GridCard {
  protected heading(): [string, string, string] { return ["mdi:calendar-today", "Dziś · analiza pracy", "Today · operation analysis"]; }
  protected wide = true;
  protected rows(): Row[] {
    return [
      ["mt_cop_ch_today", "mdi:radiator", "COP grzanie dziś", "COP heating today", 2],
      ["mt_cop_dhw_today", "mdi:water-boiler", "COP CWU dziś", "COP DHW today", 2],
      ["mt_cop_system_today", "mdi:home-lightning-bolt-outline", "COP systemu (z grzałkami)", "System COP (with heaters)", 2],
      ["mt_cop_total", "mdi:gauge-full", "COP od początku", "COP since installation", 2],
      ["mt_ch_hours", "mdi:radiator", "Grzanie – sprężarka", "Heating – compressor", 1],
      ["mt_dhw_hours", "mdi:water-boiler", "CWU – sprężarka", "DHW – compressor", 1],
      ["mt_ch_elec", "mdi:flash", "Prąd grzanie", "Heating electricity", 2],
      ["mt_dhw_elec_today", "mdi:flash", "Prąd CWU", "DHW electricity", 2],
      ["mt_ch_heat", "mdi:fire", "Ciepło grzanie", "Heating heat", 2],
      ["mt_dhw_heat_today", "mdi:fire", "Ciepło CWU", "DHW heat", 2],
      ["mt_cycle_avg", "mdi:timer-sync-outline", "Średni cykl sprężarki", "Average compressor cycle", 0],
      ["mt_short_cycles", "mdi:timer-alert-outline", "Krótkie cykle", "Short cycles", 0],
      ["mt_cycle_last", "mdi:timer-outline", "Ostatni cykl", "Last cycle", 0],
      ["mt_defrosts_today", "mdi:snowflake-melt", "Odszraniania", "Defrosts", 0],
      ["mt_defrost_last", "mdi:timer-snowflake", "Ostatnie odszranianie", "Last defrost", 1],
      ["mt_since_defrost", "mdi:clock-outline", "Od odszraniania", "Since the defrost", 0],
      ["mt_ibh_hours", "mdi:heating-coil", "Grzałka IBH", "IBH heater", 2],
      ["mt_tbh_hours", "mdi:heating-coil", "Grzałka TBH", "TBH heater", 2],
      ["mt_heater_elec", "mdi:flash-alert", "Prąd grzałek (szac.)", "Heater electricity (est.)", 2],
    ];
  }
  protected colOf(k: Key): string {
    const v = this.n(k);
    if (/^mt_cop_/.test(k)) return copCol(v);
    if (k === "mt_short_cycles") return isNaN(v) ? "overlay2" : v > 6 ? "red" : v > 2 ? "yellow" : "green";
    if (k === "mt_cycle_avg") return isNaN(v) ? "overlay2" : v < 10 ? "red" : v < 20 ? "yellow" : "green";
    if (k === "mt_ibh_hours" || k === "mt_tbh_hours" || k === "mt_heater_elec") return v > 0 ? "peach" : "overlay2";
    if (/defrost/.test(k)) return "sky";
    if (/_heat/.test(k)) return "peach";
    if (/_elec/.test(k)) return "yellow";
    return "teal";
  }
}

register("immergas-day-card", ImmergasDayCard, "Immergas – Dziś · analiza pracy / Today · operation analysis",
  "MAGIS M: COP grzania / CWU / systemu dziś, czasy i energia grzania i CWU, taktowanie, odszraniania, grzałki");
register("immergas-water-card", ImmergasWaterCard, "Immergas – Obieg wodny / Water circuit",
  "Temperatury zasilania i powrotu pompy i kotła, przepływ, delta T, zawór 3-drożny");
register("immergas-states-card", ImmergasStatesCard, "Immergas – Stan urządzeń / Device states",
  "Włączone / wyłączone: sprężarka, wentylator, odszranianie, zawór 4-drożny, grzałki, pompa obiegowa");
register("immergas-refrigerant-card", ImmergasRefrigerantCard, "Immergas – Obieg chłodniczy / Refrigerant circuit",
  "Sprężarka, tłoczenie, parownik, EEV, wentylator, napięcia i flagi jednostki zewnętrznej");
