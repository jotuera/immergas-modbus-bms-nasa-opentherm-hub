// "Krzywa pogodowa / Weather curve" for the Immergas Dominus integration in the OpenTherm mode (VICTRIX ZEUS, TERA …).
// The Dominus module is the OpenTherm master: with "Outdoor sensor" on it computes the CH flow from its own curve (OTC 1–9,
// like the CAR V2), the CH offset and the min. CH temperature, up to the CH setpoint (parameter 17), and sends it to the
// boiler every cycle. The boiler keeps that flow within its own CH min. / max. - the codes depend on the boiler menu
// family (Boiler menu profile): t0 / t1 (ZEUS 25, OMNIA, TERA), S5 / S6 (EXA), P66/A / P66/B (ZEUS Superior,
// HERCULES), Data-ID 49 (generic). ZEUS Superior / HERCULES also have their own climatic curve P66/A–D (used without a
// remote): drawn dashed with draggable points (the values are the declared menu copy, nothing is written to the boiler).
// The OTC shape is not published by Immergas: drawn as flow = room + offset + curve / 4 × (room − outdoor) – approximate.
import { svg, SVGTemplateResult } from "lit";
import { HubCard, html, css, nothing, c, ca, box, register } from "../base";
import { Key } from "../names";

const W = 340, H = 196, x0 = 30, x1 = 332, y0 = 10, y1 = 166;

class ImmergasOtCurveCard extends HubCard {
  private drag: { k: "c" | "w"; x: number; y: number } | null = null;
  private Y1 = 70;

  private px(x: number) { return x0 + (Math.min(30, Math.max(-25, x)) + 25) / 55 * (x1 - x0); }
  private py(y: number) { return y1 - (Math.min(this.Y1, Math.max(15, y)) - 15) / (this.Y1 - 15) * (y1 - y0); }
  private lim(k: Key, a: string, def: number) { const v = this.attr(k, a); return v === undefined || v === null || isNaN(+v) ? def : +v; }
  private writable(k: Key) { const id = this.eid(k) ?? ""; return /^(number|input_number)\./.test(id) && !this.otRO; }
  private setNum(k: Key, value: number) { if (this.writable(k)) this.call("number", "set_value", k, { value }); }

  private grid(): SVGTemplateResult[] {
    const g: SVGTemplateResult[] = [];
    for (let x = -25; x <= 30; x += 5) g.push(svg`<line x1=${this.px(x)} y1=${y0} x2=${this.px(x)} y2=${y1} stroke="currentColor" stroke-opacity=${x === 0 ? 0.18 : 0.07}/>
      <text x=${this.px(x)} y=${y1 + 13} font-size="9" text-anchor="middle" fill="currentColor" fill-opacity=".5">${x}°</text>`);
    for (let y = 15; y <= this.Y1; y += 10) g.push(svg`<line x1=${x0} y1=${this.py(y)} x2=${x1} y2=${this.py(y)} stroke="currentColor" stroke-opacity=".07"/>
      <text x=${x0 - 5} y=${this.py(y) + 3} font-size="9" text-anchor="end" fill="currentColor" fill-opacity=".5">${y}°</text>`);
    return g;
  }
  private hline(v: number, col: string, label: string, band: "above" | "below", right = true) {
    if (isNaN(v) || v < 15 || v > this.Y1) return nothing;
    const y = this.py(v);
    const b = band === "above" ? svg`<rect x=${x0} y=${y0} width=${x1 - x0} height=${Math.max(0, y - y0)} fill=${ca(col, 0.1)}/>`
      : svg`<rect x=${x0} y=${y} width=${x1 - x0} height=${Math.max(0, y1 - y)} fill=${ca(col, 0.08)}/>`;
    return svg`${b}<line x1=${x0} y1=${y} x2=${x1} y2=${y} stroke=${c(col)} stroke-width="1.4" stroke-dasharray="2 3"/>
      <text x=${right ? x1 - 2 : x0 + 4} y=${y - 4} font-size="9" font-weight="700" text-anchor=${right ? "end" : "start"} fill=${c(col)}>${label}</text>`;
  }

  /** P66 points: c = (C, B) the coldest outdoor / max. flow, w = (D, A) the warmest outdoor / min. flow */
  private keys(k: "c" | "w"): [Key, Key] { return k === "c" ? ["ot_sup_out_min", "ot_t1"] : ["ot_sup_out_max", "ot_t0"]; }
  private onMove(e: PointerEvent) {
    if (!this.drag) return;
    const r = (e.currentTarget as SVGElement).closest("svg")!.getBoundingClientRect();
    const xx = (e.clientX - r.left) / r.width * W, yy = (e.clientY - r.top) / r.height * H;
    const [kx, ky] = this.keys(this.drag.k);
    const ox = Math.round(-25 + (xx - x0) / (x1 - x0) * 55), fy = Math.round(15 + (y1 - yy) / (y1 - y0) * (this.Y1 - 15));
    this.drag.x = Math.max(this.lim(kx, "min", -25), Math.min(this.lim(kx, "max", 30), ox));
    this.drag.y = Math.max(this.lim(ky, "min", 15), Math.min(this.lim(ky, "max", 90), fy));
    this.requestUpdate();
  }
  private handle(k: "c" | "w", x: number, y: number, lbl: string, col: string) {
    const d = this.drag?.k === k ? this.drag : null, cx = d ? d.x : x, cy = d ? d.y : y;
    const [kx, ky] = this.keys(k);
    if (!this.writable(kx) && !this.writable(ky))
      return svg`<circle cx=${this.px(cx)} cy=${this.py(cy)} r="5" fill=${c(col)} stroke="var(--ha-card-background, #1e1e2e)" stroke-width="2"/>`;
    return svg`<circle cx=${this.px(cx)} cy=${this.py(cy)} r="6.5" fill=${c(col)} stroke="var(--ha-card-background, #1e1e2e)" stroke-width="2.5"/>
      <circle cx=${this.px(cx)} cy=${this.py(cy)} r="18" fill="transparent" style="cursor:move;touch-action:none"
        @pointerdown=${(e: PointerEvent) => { e.preventDefault(); (e.target as Element).setPointerCapture(e.pointerId); this.drag = { k, x, y }; }}
        @pointermove=${(e: PointerEvent) => this.onMove(e)}
        @pointerup=${() => { const dd = this.drag; this.drag = null;
          if (dd) { if (dd.x !== x) this.setNum(kx, dd.x); if (dd.y !== y) this.setNum(ky, dd.y); } this.requestUpdate(); }}
        @pointercancel=${() => { this.drag = null; this.requestUpdate(); }}/>
      <text x=${this.px(cx)} y=${this.py(cy) + 20} font-size="9.5" font-weight="800" text-anchor="middle" fill=${c(col)}>${lbl}</text>
      ${d ? svg`<text x=${this.px(cx)} y=${y1 - 4} font-size="9" font-weight="800" text-anchor="middle" fill=${c(col)}>${cx}° → ${cy}°</text>` : nothing}`;
  }
  private ctl(k: Key, name: string, sub: string, col: string, dec = 0) {
    if (!this.eid(k)) return nothing;
    const v = this.n(k), mn = this.lim(k, "min", -100), mx = this.lim(k, "max", 100), step = this.lim(k, "step", 1);
    const u = String(this.attr(k, "unit_of_measurement") ?? ""), val = isNaN(v) ? "–" : this.f(v, dec, dec) + (u === "°C" || u === "K" ? "°" : "");
    if (!this.writable(k)) return html`<div class="ctl" style="background:${ca(col, 0.05)};border:1px dashed ${ca(col, 0.25)}">
      <div class="cx" @click=${() => this.moreInfo(k)}><div class="cn">${name}</div><div class="cs">${sub} · ${this.t("tylko odczyt", "read only")}</div></div>
      <div class="cvv" style="color:${c(col)}">${val}</div></div>`;
    const st = (d: number, icon: string) => {
      const nv = Math.round(Math.max(mn, Math.min(mx, v + d)) * 100) / 100, dis = isNaN(v) || nv === v;
      return html`<div class="btn ${dis ? "off" : ""}" @click=${() => !dis && this.setNum(k, nv)}><ha-icon icon=${icon}></ha-icon></div>`;
    };
    return html`<div class="ctl" style="background:${ca(col, 0.07)};border:1px solid ${ca(col, 0.25)}">
      <div class="cx" @click=${() => this.moreInfo(k)}><div class="cn">${name}</div><div class="cs">${sub}</div></div>
      ${st(-step, "mdi:minus")}<div class="cvv" style="color:${c(col)}">${val}</div>${st(step, "mdi:plus")}</div>`;
  }

  protected body() {
    if (!this.ot || this.esp) return html`${this.head("mdi:chart-bell-curve-cumulative", this.t("Krzywa pogodowa", "Weather curve"))}
      <div class="hint">${this.t("Ta karta jest dla integracji Immergas Dominus w trybie OpenTherm (ESP OpenTherm: karta Krzywa pogodowa w hubie).",
        "This card is for the Immergas Dominus integration in the OpenTherm mode (ESP OpenTherm: the Hub weather curve card).")}</div>`;
    const prof = this.otProfile, m = prof === "superior" || prof === "hercules", gen = prof === "generic";
    const codes: Record<string, [string, string]> = { zeus25: ["t0", "t1"], maior: ["t0", "t1"], tera: ["t0", "t1"], hybrid: ["t0", "t1"], classic: ["S5", "S6"], superior: ["P66/A", "P66/B"], hercules: ["P66/A", "P66/B"], generic: ["", ""] };
    const [cMin, cMax] = codes[prof];
    const wx = this.on("ot_out_sensor") || !this.eid("ot_out_sensor"), col = wx ? "peach" : "overlay2";
    const out = this.n("outdoor"), flow = this.n("ot_flow"), room = this.n("zone1");
    const tr = isNaN(this.n("ot_room_set")) ? 20 : this.n("ot_room_set"), crv = this.n("ot_curve"), off = isNaN(this.n("ot_offset")) ? 0 : this.n("ot_offset");
    const dMin = this.n("ot_ch_min"), dMax = this.n("ot_ch_set");
    // the boiler's limits: the declared menu values (t0 / t1 …), else what the boiler reports (Data-ID 49)
    const b49 = this.so("ot_ch_set")?.attributes ?? {};
    const bMin = !gen && !isNaN(this.n("ot_t0")) ? this.n("ot_t0") : +(b49.min ?? NaN), bMax = !gen && !isNaN(this.n("ot_t1")) ? this.n("ot_t1") : +(b49.max ?? NaN);
    const lo = Math.max(isNaN(dMin) ? -99 : dMin, isNaN(bMin) ? -99 : bMin), hi = Math.min(isNaN(dMax) ? 99 : dMax, isNaN(bMax) ? 99 : bMax);
    const otc = (x: number) => Math.max(lo, Math.min(hi, tr + off + crv / 4 * (tr - x)));
    const p66 = this.p66Target();
    const tgt = isNaN(out) ? NaN : wx ? (isNaN(crv) ? NaN : Math.round(otc(out) * 2) / 2) : !isNaN(p66) ? p66 : isNaN(dMax) ? NaN : Math.min(hi, dMax);
    // the boiler's own climatic curve (ZEUS Superior / HERCULES)
    const d = this.drag, oc = this.n("ot_sup_out_min"), ow = this.n("ot_sup_out_max");
    const pc = d?.k === "c" ? [d.x, d.y] : [oc, bMax], pw = d?.k === "w" ? [d.x, d.y] : [ow, bMin];
    const sup = m && !isNaN(pc[0]) && !isNaN(pw[0]) && !isNaN(pc[1]) && !isNaN(pw[1]);
    const top = Math.max(isNaN(crv) ? 0 : otc(-25), isNaN(flow) ? 0 : flow, sup ? pc[1] : 0, isNaN(tgt) ? 0 : tgt);
    this.Y1 = Math.min(90, Math.max(50, Math.ceil(Math.max(top + 5, hi <= top + 10 ? hi + 3 : 0) / 10) * 10));
    const g: unknown[] = [this.grid()];
    const lbl = (cd: string, txt: string, v: number) => `${cd ? cd + " " : ""}${txt} ${this.f(v)}°`;
    g.push(this.hline(hi, "red", hi === dMax ? lbl("", this.t("nastawa CO", "CH setpoint"), hi) : lbl(cMax || "ID 49", this.t("maks. kotła", "boiler max."), hi), "above"));
    g.push(this.hline(lo, "sky", lo === dMin ? lbl("", this.t("min. CO", "CH min."), lo) : lbl(cMin || "ID 49", this.t("min. kotła", "boiler min."), lo), "below"));
    if (sup) {
      const dd = `M ${this.px(-25)} ${this.py(pc[1])} L ${this.px(pc[0])} ${this.py(pc[1])} L ${this.px(pw[0])} ${this.py(pw[1])} L ${this.px(30)} ${this.py(pw[1])}`;
      g.push(svg`<path d=${dd} fill="none" stroke=${c("mauve")} stroke-width="1.8" stroke-dasharray="5 4" stroke-linejoin="round" stroke-opacity=".85"/>`);
      g.push(this.handle("c", oc, bMax, "P66 C/B", "mauve"), this.handle("w", ow, bMin, "P66 D/A", "mauve"));
    }
    if (!isNaN(crv)) {
      const pts: string[] = [];
      for (let x = -25; x <= 30; x += 0.5) pts.push(`${this.px(x).toFixed(1)},${this.py(otc(x)).toFixed(1)}`);
      g.push(svg`<polygon points="${this.px(-25)},${y1} ${pts.join(" ")} ${this.px(30)},${y1}" fill=${ca(col, wx ? 0.1 : 0.04)}/>
        <polyline points=${pts.join(" ")} fill="none" stroke=${c(col)} stroke-width="3" stroke-linejoin="round" stroke-opacity=${wx ? 1 : 0.5}
          style=${wx ? `filter:drop-shadow(0 0 4px ${ca(col, 0.7)})` : ""}/>`);
    }
    if (!wx && !isNaN(dMax)) g.push(svg`<line x1=${x0} y1=${this.py(Math.min(hi, dMax))} x2=${x1} y2=${this.py(Math.min(hi, dMax))} stroke=${c("yellow")} stroke-width="2.5"/>`);
    if (!isNaN(out) && out >= -25 && out <= 30) {
      const x = this.px(out);
      g.push(svg`<line x1=${x} y1=${y0} x2=${x} y2=${y1} stroke=${c("sky")} stroke-dasharray="3 3" stroke-opacity=".8"/>`);
      if (!isNaN(tgt)) g.push(svg`<circle cx=${x} cy=${this.py(tgt)} r="4.5" fill=${c("yellow")}/>`);
      if (!isNaN(flow)) g.push(svg`<circle cx=${x} cy=${this.py(flow)} r="5" fill="none" stroke=${c("red")} stroke-width="2"/>`);
    }
    const names: Record<string, string> = { zeus25: "ZEUS 25 / OMNIA", maior: "MAIOR TT", tera: "TERA", hybrid: "HYBRID", classic: "EXA / NIKE", superior: "ZEUS Superior", hercules: "HERCULES", generic: this.t("ogólny", "generic") };
    const chips = Array.from({ length: 9 }, (_, i) => i + 1);
    return html`
      <div class="top">
        <div class="tl"><ha-icon icon="mdi:chart-bell-curve-cumulative" style="color:${c(col)}"></ha-icon>
          <div><div class="ttl">${this.t("Krzywa pogodowa", "Weather curve")}</div>
            <div class="tsub">${this.t("Regulator modułu Dominus (OTC) · profil", "Dominus module regulator (OTC) · profile")}
              <b class="lnk" @click=${() => this.moreInfo("ot_menu_profile")}>${names[prof]}</b></div></div></div>
        ${this.eid("ot_out_sensor") ? html`<div class="state" style=${box(wx ? "peach" : "overlay1", wx)}
            @click=${() => !this.otRO && this.call("switch", wx ? "turn_off" : "turn_on", "ot_out_sensor")}>
          <ha-icon icon=${wx ? "mdi:thermometer" : "mdi:thermometer-off"}></ha-icon>${wx ? this.t("Pogodowa", "Weather") : this.t("Stała nastawa", "Fixed setpoint")}</div>` : nothing}</div>
      <div class="tr">
        <span @click=${() => this.moreInfo("outdoor")}>${this.t("na zewnątrz", "outdoor")} <b>${this.f(out)} °C</b></span>
        ${!isNaN(room) ? html`<span @click=${() => this.moreInfo("zone1")}>${this.t("pokój", "room")} <b>${this.f(room)}°</b>/${this.f(tr)}°</span>` : nothing}
        <span>${wx || !isNaN(p66) ? this.t("z krzywej", "from the curve") : this.t("nastawa", "setpoint")} <b style="color:${c("yellow")}">${this.f(tgt)} °C</b></span>
        ${wx && !isNaN(this.n("ot_max_ch")) ? html`<span @click=${() => this.moreInfo("ot_max_ch")}>${this.t("nastawa OTC modułu", "module OTC setpoint")} <b>${this.f(this.n("ot_max_ch"))} °C</b></span>` : nothing}
        <span @click=${() => this.moreInfo("ot_flow")}>${this.t("zasilanie", "flow")} <b style="color:${c("red")}">${this.f(flow)} °C</b></span></div>
      ${this.eid("ot_curve") ? html`<div class="nums">${chips.map((n) => html`<div class="numc" style=${Math.round(crv) === n ? box(col, true) : ""}
          @click=${() => n !== crv && this.setNum("ot_curve", n)}>${n}</div>`)}</div>` : nothing}
      <svg viewBox="0 0 ${W} ${H}">${g}</svg>
      <div class="row">
        ${this.ctl("ot_curve", this.t("Krzywa grzewcza", "Heating curve"), this.t("OTC 1–9, co 0,1", "OTC 1–9, step 0.1"), col, 1)}
        ${this.ctl("ot_offset", this.t("Offset CO", "CH offset"), this.t("przesuwa krzywą w górę / dół", "moves the curve up / down"), "yellow")}
        ${this.ctl("ot_ch_set", this.t("Nastawa CO", "CH setpoint"), this.t("maks. zasilanie z krzywej (parametr 17)", "max. flow of the curve (parameter 17)"), "red")}
        ${this.ctl("ot_ch_min", this.t("Min. temperatura CO", "Min. CH temperature"), this.t("najniższe zasilanie (parametr 16)", "lowest flow (parameter 16)"), "sky")}
        ${gen ? nothing : this.ctl("ot_t1", `${cMax} · ${this.t("maks. CO kotła", "boiler CH max.")}`, m ? this.t("zasilanie przy mrozie", "flow when cold") : this.t("z menu kotła", "from the boiler menu"), "red")}
        ${gen ? nothing : this.ctl("ot_t0", `${cMin} · ${this.t("min. CO kotła", "boiler CH min.")}`, m ? this.t("zasilanie przy cieple", "flow when warm") : this.t("z menu kotła", "from the boiler menu"), "sky")}
        ${m ? this.ctl("ot_sup_out_min", `P66/C · ${this.t("punkt mrozu", "cold point")}`, this.t("temp. zewn. maks. zasilania", "outdoor temp. of the max. flow"), "mauve") : nothing}
        ${m ? this.ctl("ot_sup_out_max", `P66/D · ${this.t("punkt ciepła", "warm point")}`, this.t("temp. zewn. min. zasilania", "outdoor temp. of the min. flow"), "mauve") : nothing}
      </div>
      <div class="legend"><span><i style="background:${c(col)}"></i>${this.t("krzywa Dominusa (orientacyjnie)", "Dominus curve (approximate)")}</span>
        ${sup ? html`<span><i style="border-top:2px dashed ${c("mauve")};height:0"></i>${this.t("krzywa kotła P66 (bez pilota)", "boiler curve P66 (without a remote)")}</span>` : nothing}
        <span>${this.t("● z krzywej · ○ faktyczne zasilanie", "● from the curve · ○ actual flow")}</span></div>
      ${this.otRO ? html`<div class="note" style="color:${c("yellow")}">${this.t("Tylko odczyt (steruje pilot) – zmiany są zablokowane.", "Read only (remote in charge) – changes are blocked.")}</div>` : nothing}
      <div class="note">${wx ? this.t("Moduł liczy zasilanie z temperatury zewnętrznej kotła (Data-ID 27) i wysyła je co cykl; kocioł trzyma je w swoich granicach. Kształt krzywej OTC jest orientacyjny (Immergas go nie publikuje) – porównaj kropkę z faktycznym zasilaniem.",
          "The module computes the flow from the boiler's outdoor temperature (Data-ID 27) and sends it every cycle; the boiler keeps it within its limits. The OTC shape is approximate (not published by Immergas) – compare the dot with the actual flow.")
        : this.t("Sonda zewnętrzna wyłączona: moduł nie używa krzywej – zasilanie = Nastawa CO (z modulacją wg pokoju).", "Outdoor sensor off: the module does not use the curve – flow = CH setpoint (with the room modulation).")}
        ${m ? this.t(" Krzywa P66 to kopia menu kotła (przeciągnij punkt albo −/+) – kocioł używa jej tylko bez pilota / bez Dominusa jako mastera.", " The P66 curve is a copy of the boiler menu (drag a point or −/+) – the boiler uses it only without a remote / without the Dominus as master.") : ""}</div>`;
  }

  static styles = [HubCard.styles, css`
    .top { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
    .tl { display: flex; align-items: center; gap: 8px; }
    .tl ha-icon { --mdc-icon-size: 22px; }
    .ttl { font-size: 10.5px; font-weight: 800; opacity: var(--ih-o55, .55); letter-spacing: .08em; text-transform: uppercase; }
    .tsub { font-size: 10.5px; opacity: var(--ih-o7, .7); }
    .lnk { cursor: pointer; text-decoration: underline dotted; }
    .state { cursor: pointer; display: flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: 10px; font-size: 11px; font-weight: 800; }
    .state ha-icon { --mdc-icon-size: 15px; }
    .tr { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11.5px; margin-top: 8px; }
    .tr span { cursor: pointer; }
    .nums { display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
    .numc { cursor: pointer; min-width: 26px; text-align: center; padding: 4px 6px; border-radius: 8px; font-size: 12px; font-weight: 800;
      background: rgba(var(--ih-ov-rgb), .04); border: 1px solid rgba(var(--ih-ov-rgb), .08); }
    svg { width: 100%; height: auto; display: block; margin-top: 6px; touch-action: pan-y; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .ctl { flex: 1 1 210px; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 14px; }
    .cx { flex: 1; min-width: 0; cursor: pointer; }
    .cn { font-size: 12px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cs { font-size: 10px; opacity: var(--ih-o55, .55); }
    .cvv { width: 44px; text-align: center; font-size: 16px; font-weight: 800; }
    .legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 10.5px; opacity: var(--ih-o65, .65); margin-top: 8px; }
    .legend i { display: inline-block; width: 14px; height: 3px; vertical-align: middle; margin-right: 4px; }
    .note, .hint { font-size: 10.5px; opacity: var(--ih-o6, .6); margin-top: 6px; line-height: 1.35; }
  `];
}

register("immergas-ot-curve-card", ImmergasOtCurveCard, "Immergas – Krzywa pogodowa OpenTherm / OpenTherm weather curve",
  "Dominus OpenTherm: krzywa OTC modułu, offset, min. / nastawa CO, granice kotła wg profilu menu (t0/t1, S5/S6, P66) i krzywa P66 Superiora");
