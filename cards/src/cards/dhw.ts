// "Ostatni cykl CWU / Last DHW cycle": source, duration, electricity, heat (cylinder / flow), COP and the cycle cost
// against the same heat from the gas boiler (Combo) or from the electric heater (Pro, no gas). The view follows the
// system model (TT D61) or the option variant: combo | pro, and can be switched in the card.
import { HubCard, html, css, nothing, c, ca, box, register } from "../base";
import { isDhw, srcKind } from "./timers";

const copCol = (v: number) => isNaN(v) || v <= 0 ? "overlay1" : v < 2 ? "red" : v < 2.7 ? "peach" : v < 3.5 ? "yellow" : "green";

class ImmergasDhwCard extends HubCard {
  private variant = "";

  private get combo() {
    if (this.mtx) return false; // MAGIS M: no gas boiler
    const v = this.variant || this.config.variant;
    if (v) return v === "combo";
    const m = (this.s("d61") ?? "").toLowerCase();
    return m ? /combo|\(mc/.test(m) : true;
  }

  /** OpenTherm boiler: the last cylinder cycle, or the draws of today on a boiler without a cylinder */
  private otBody() {
    const pg = this.n("oa_gas_price"), pe = this.n("ot_elec_price"), vol = this.n("ot_tank_vol"), running = this.on("dom_dhw_request");
    const cyl = vol > 0, tank = this.n("tank"), rise = this.n("oa_dhw_cycle_rise"), mins = this.n("oa_dhw_cycle_last");
    const heat = cyl ? (rise > 0 ? vol * rise * 1.163 / 1000 : NaN) : this.n("oa_dhw_heat");
    const gas = cyl ? this.n("ot_cyc_gas") : this.n("oa_gas_dhw_today");
    const cost = gas >= 0 && pg > 0 ? gas * pg : NaN, alt = heat > 0 && pe > 0 ? heat * pe : NaN;
    const cheaper = isNaN(cost) || isNaN(alt) || Math.abs(cost - alt) < 0.005 ? null : cost < alt;
    return html`
      ${this.head("mdi:water-boiler", cyl ? this.t("Ostatni cykl CWU", "Last DHW cycle") : this.t("Ciepła woda dziś", "Hot water today"),
        running ? html`<span style="color:${c("yellow")};font-weight:800">${this.t("● trwa grzanie", "● heating now")}</span>` : undefined)}
      <div class="top" style=${box("peach", true)}>
        <ha-icon icon="mdi:fire" style="color:${c("peach")}"></ha-icon>
        <div class="cx"><div class="st" style="color:${c("peach")}">${this.t("Kocioł gazowy", "Gas boiler")}</div>
          <div class="ss">${cyl ? html`${isNaN(mins) ? this.t("Brak cyklu", "No cycle yet") : this.f(mins, 0) + " min"} · ${this.t("zasobnik teraz", "cylinder now")} ${this.f(tank, 1, 1)} °C`
            : html`${this.f(this.n("oa_dhw_litres"), 0)} L · ${this.f(this.n("oa_draws_today"), 0)} × ${this.t("pobór", "draw")}`}</div></div></div>
      <div class="row">
        ${cyl ? this.chip("oa_dhw_cycle_rise", "mdi:thermometer-chevron-up", "sky", this.t("Przyrost temperatury", "Temperature rise"), this.f(rise, 1, 1) + " K") : nothing}
        ${this.chip(cyl ? "oa_dhw_cycle_rise" : "oa_dhw_heat", "mdi:water-thermometer", "blue", this.t("Ciepło", "Heat"), this.f(heat, 2, 2) + " kWh")}
        ${this.chip(cyl ? "ot_cyc_gas" : "oa_gas_dhw_today", "mdi:meter-gas", "peach", this.t("Gaz", "Gas"), this.f(gas, 2, 2) + " m³")}
      </div>
      <div class="cost" style=${box(cheaper === null ? "overlay1" : cheaper ? "green" : "peach", false)}>
        <div class="cx"><div class="lbl">${cyl ? this.t("Koszt cyklu", "Cycle cost") : this.t("Koszt gazu CWU", "DHW gas cost")}</div><div class="val">${this.f(cost, 2, 2)} ${this.currency}</div></div>
        <div class="cx"><div class="lbl">${this.t("To samo z grzałki", "Same heat from the heater")}</div><div class="val">${this.f(alt, 2, 2)} ${this.currency}</div></div>
        ${cheaper === null ? nothing : html`<div class="vd" style="color:${c(cheaper ? "green" : "peach")}">${cheaper ? this.t("gaz taniej", "gas cheaper") : this.t("grzałka taniej", "heater cheaper")}</div>`}
      </div>
      ${this.numRow("ot_tank_vol", "mdi:water-boiler", this.t("Pojemność zasobnika CWU", "DHW cylinder capacity"), 0)}
      <div class="note">${cyl ? this.t("Gaz szacowany z mocy palnika, ciepło z pojemności zasobnika i przyrostu temperatury.", "Gas is estimated from the burner power, heat from the cylinder capacity and the temperature rise.")
        : this.t("Bez zasobnika: gaz CWU z całego dnia, ciepło z przepływu CWU. Jeśli masz zasobnik, podaj jego pojemność.", "No cylinder: the DHW gas of the whole day, heat from the DHW flow. If you have a cylinder, enter its capacity.")}</div>`;
  }

  protected body() {
    if (this.ot) return this.otBody();
    const combo = this.combo;
    const src = this.s("dhw_src") ?? "";
    // MAGIS M (mt_costs): "Heat pump" / "Heat pump + TBH heater" / "TBH heater"
    const sk = this.mtx ? (/\+/.test(src) ? "hpb" : /tbh/i.test(src) ? "heater" : src ? "hp" : "") : srcKind(src).replace("hph", "hpb");
    const sc = this.bad("dhw_src") ? "overlay1" : sk === "hpb" ? "yellow" : sk === "boiler" ? "peach" : sk === "hp" ? "teal" : sk === "heater" ? "red" : "overlay2";
    const si = sk === "hpb" ? "mdi:heat-pump-outline" : sk === "boiler" ? "mdi:fire" : sk === "heater" ? "mdi:heating-coil" : "mdi:heat-pump";
    const ct = this.n("dhw_cop_tank"), cf = this.n("dhw_cop_flow"), cost = this.n("dhw_cost");
    // the same heat from the alternative: gas boiler (Combo) or the electric heater, 1 kWh of heat per kWh (Pro)
    const heatTank = this.n("dhw_heat_tank"), pe = this.n("price_elec");
    const cg = combo ? this.n("dhw_cost_gas") : heatTank > 0 && pe > 0 ? heatTank * pe : NaN;
    const running = this.mtx ? /^(cwu|dhw)$/i.test(this.s("state") ?? "") || this.on("dhw_heater") : isDhw(this.s("state"));
    const tank = this.n("tank"), set = this.n("dhw_active_set");
    // no comparison for a cycle heated by the gas boiler, or when the two costs are the same
    const cheaper = !isNaN(cost) && !isNaN(cg) && sk !== "boiler" && Math.abs(cost - cg) >= 0.005 ? cost < cg : null;
    const tab = (id: string, lbl: string) => html`<div class="tab" style=${(id === "combo") === combo ? `background:${ca("teal", 0.24)};border-color:${ca("teal", 0.6)}` : ""}
      @click=${(e: Event) => { e.stopPropagation(); this.variant = id; this.requestUpdate(); }}>${lbl}</div>`;
    const big = (k: any, lbl: string, v: number, col: string) => html`<div class="big" style=${box(col, false)} @click=${() => this.moreInfo(k)}>
      <div class="lbl">${lbl}</div><div class="bv" style="color:${c(col)};text-shadow:0 0 10px ${ca(col, 0.4)}">${this.f(v, 2, 2)}</div></div>`;
    return html`
      ${this.head("mdi:water-boiler", this.t("Ostatni cykl CWU", "Last DHW cycle"),
        html`<span class="tabs">${running ? html`<span style="color:${c("yellow")};font-weight:800">${this.t("● trwa grzanie", "● heating now")}</span>` : nothing}
          ${this.mtx ? nothing : html`${tab("combo", "Combo")}${tab("pro", "Pro")}`}</span>`)}
      <div class="top" style=${box(sc, true)} @click=${() => this.moreInfo("dhw_src")}>
        <ha-icon icon=${si} style="color:${c(sc)}"></ha-icon>
        <div class="cx"><div class="st" style="color:${c(sc)}">${this.bad("dhw_src") ? this.t("Brak cyklu", "No cycle yet") : src}</div>
          <div class="ss">${this.f(this.n("dhw_min"), 0)} min · ${this.f(this.n("dhw_elec"), 2, 2)} kWh ${this.t("prądu", "electricity")} ·
            ${this.t("zasobnik teraz", "cylinder now")} ${this.f(tank, 1, 1)} / ${this.f(set, 0)} °C</div></div></div>
      <div class="row">
        ${big("dhw_cop_tank", this.t("COP (zasobnik)", "COP (cylinder)"), ct, copCol(ct))}
        ${big("dhw_cop_flow", this.t("COP (przepływ)", "COP (flow)"), cf, copCol(cf))}
      </div>
      <div class="row">
        ${this.chip("dhw_heat_tank", "mdi:water-thermometer", "sky", this.t("Ciepło (zasobnik)", "Heat (cylinder)"), this.f(this.n("dhw_heat_tank"), 2, 2) + " kWh")}
        ${this.chip("dhw_heat_flow", "mdi:waves-arrow-right", "blue", this.t("Ciepło (przepływ)", "Heat (flow)"), this.f(this.n("dhw_heat_flow"), 2, 2) + " kWh")}
      </div>
      <div class="cost" style=${box(cheaper === null ? "overlay1" : cheaper ? "green" : "peach", false)} @click=${() => this.moreInfo("dhw_cost")}>
        <div class="cx"><div class="lbl">${this.t("Koszt cyklu", "Cycle cost")}</div><div class="val">${this.f(cost, 2, 2)} ${this.currency}</div></div>
        <div class="cx" @click=${(e: Event) => { e.stopPropagation(); this.moreInfo(combo ? "dhw_cost_gas" : "price_elec"); }}>
          <div class="lbl">${combo ? this.t("To samo z gazu", "Same heat from gas") : this.t("To samo z grzałki", "Same heat from the heater")}</div>
          <div class="val">${this.f(cg, 2, 2)} ${this.currency}</div></div>
        ${cheaper === null ? nothing : html`<div class="vd" style="color:${c(cheaper ? "green" : "peach")}">${cheaper ? this.t("pompa taniej", "heat pump cheaper") : (combo ? this.t("gaz taniej", "gas cheaper") : this.t("grzałka taniej", "heater cheaper"))}</div>`}
      </div>
      <div class="note">${this.mtx ? html`${this.t("Zasobnik: pojemność", "Cylinder: volume")} <b class="lnk" @click=${() => this.moreInfo("mt_tank_vol")}>${this.f(this.n("mt_tank_vol"), 0)} L</b>
          ${this.t("× przyrost temperatury (nie widzi poboru wody w trakcie). Przepływ: moc cieplna jednostki w czasie cyklu. Prąd: pobór jednostki – grzałka TBH nie jest w nim liczona.",
          "× temperature rise (misses hot water drawn during the cycle). Flow: the unit's heat output over the cycle. Electricity: the unit's input – the TBH heater is not metered in it.")}`
        : this.t("Zasobnik: pojemność × przyrost temperatury (nie widzi poboru wody w trakcie). Przepływ: D14 × ΔT pompy. Prawda zwykle pomiędzy.",
        "Cylinder: capacity × temperature rise (misses hot water drawn during the cycle). Flow: D14 × heat-pump ΔT. The truth is usually in between.")}
        ${combo ? nothing : this.t(" Grzałka: ciepło z zasobnika × cena prądu (1 kWh prądu = 1 kWh ciepła).", " Heater: cylinder heat × electricity price (1 kWh of electricity = 1 kWh of heat).")}</div>`;
  }

  static styles = [HubCard.styles, css`
    .top { cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; }
    .top ha-icon { --mdc-icon-size: 26px; flex: none; }
    .st { font-size: 14px; font-weight: 800; }
    .ss { font-size: 10.5px; opacity: var(--ih-o65, .65); }
    .big { cursor: pointer; flex: 1 1 120px; padding: 8px 10px; border-radius: 12px; text-align: center; }
    .bv { font-size: 24px; font-weight: 800; line-height: 1.15; }
    .cost { cursor: pointer; display: flex; align-items: center; gap: 12px; margin-top: 8px; padding: 8px 12px; border-radius: 12px; }
    .vd { font-size: 12px; font-weight: 800; white-space: nowrap; }
    .tabs { display: inline-flex; gap: 4px; align-items: center; }
    .lnk { cursor: pointer; text-decoration: underline dotted; }
    .tab { cursor: pointer; padding: 3px 9px; border-radius: 9px; font-size: 10.5px; font-weight: 800; border: 1px solid rgba(var(--ih-ov-rgb), .08); background: rgba(var(--ih-ov-rgb), .04); }
  `];
}

register("immergas-dhw-card", ImmergasDhwCard, "Immergas – Ostatni cykl CWU / Last DHW cycle",
  "Źródło, czas, prąd, ciepło (zasobnik i przepływ), COP i koszt ostatniego cyklu CWU w porównaniu z gazem (Combo) albo grzałką (Pro)");
