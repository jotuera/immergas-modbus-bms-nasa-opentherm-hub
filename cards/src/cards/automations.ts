// "Automatyzacje / Automations": the heat-pump automations of Home Assistant in readable groups. Each row has the
// enable switch (an input_boolean the automation checks), a wrapping description, when it last fired (automation
// entity, last_triggered) and a live detail (vacation active, starts this hour, COP threshold −/+).
// Rows whose switch does not exist are skipped. With Immergas Dominus the card lists the integration's own automations
// (automatic summer / winter, vacation, DHW Comfort / Eco schedule, alert notifications) and its alerts (frost, module
// offline, boiler fault) shown as a live state instead of a switch. The ESP hubs (OpenTherm, gas boiler BMS, MAGIS M)
// list the automations built into their *_programs packages (automatic summer / winter, vacation, DHW program,
// anti-legionella, frost protection) and alerts from their own entities, by the device profile (OT menu family, boiler
// model, MAGIS M unit capacity). Option `items` replaces the default list:
//   items: [{ toggle, automation, name, icon, desc, group, param, param_label, live, live_label }]
//   group: control | alert | safety;  param: an input_number shown with −/+;  live: an entity whose state is shown.
import { HubCard, html, css, nothing, c, ca, register } from "../base";

type Item = { toggle: string; automation?: string; name: [string, string]; icon: string; desc: [string, string]; group: string;
  param?: string; paramLabel?: [string, string]; live?: string; liveLabel?: [string, string]; noLast?: boolean;
  /** more −/+ settings (Dominus) */ params?: [string, [string, string]][];
  /** an alert without its own switch: `toggle` is the alert entity, shown as ALARM / OK */ status?: boolean; liveText?: string;
  /** the alarm state when it is not simply the entity being on (link lost, a counter over its limit) */ alarm?: boolean };

const DEFAULT_ITEMS: Item[] = [
  { toggle: "input_boolean.auto_pompa_lato_zima", automation: "automation.automatyka_lato_zima_automatycznie_t_t", group: "control", icon: "mdi:sun-snowflake-variant",
    name: ["Lato / Zima automatycznie", "Summer / winter automatically"],
    desc: ["codziennie 12:00: prognoza na 3 dni > 17 °C → Lato (CWU), < 13 °C → Zima (CO + CWU)", "daily 12:00: 3-day forecast > 17 °C → summer (DHW), < 13 °C → winter (CH + DHW)"] },
  { toggle: "input_boolean.auto_pompa_urlop", automation: "automation.automatyka_tryb_urlopowy_d_d", group: "control", icon: "mdi:bag-suitcase",
    live: "input_boolean.auto_pompa_urlop_aktywny", liveLabel: ["urlop aktywny", "vacation active"],
    name: ["Tryb urlopowy", "Vacation mode"],
    desc: ["nikogo w domu > 24 h → CO strefy 1 −2 °C i CWU 40 °C; po powrocie przywraca nastawy", "nobody home > 24 h → zone 1 CH −2 °C and DHW 40 °C; restores the setpoints on return"] },
  { toggle: "input_boolean.auto_pompa_taktowanie", automation: "automation.automatyka_taktowanie_sprezarki_f1f2", group: "alert", icon: "mdi:sine-wave",
    // its hourly counter reset also counts as "triggered", so last_triggered says nothing here - the counter does
    live: "counter.auto_pompa_starty", liveLabel: ["starty w tej godzinie", "starts this hour"], noLast: true,
    name: ["Taktowanie sprężarki", "Compressor short cycling"],
    desc: ["więcej niż 3 starty sprężarki w godzinie → ostrzeżenie", "more than 3 compressor starts in an hour → warning"] },
  { toggle: "input_boolean.auto_pompa_awaria", automation: "automation.automatyka_blad_brak_komunikacji", group: "alert", icon: "mdi:alert-octagon",
    name: ["Błąd lub brak komunikacji", "Fault or no communication"],
    desc: ["kod błędu albo Atom offline > 10 min → powiadomienie", "fault code or Atom offline > 10 min → notification"] },
  { toggle: "input_boolean.auto_pompa_niski_cop", automation: "automation.automatyka_niski_cop_rozwaz_gaz", group: "alert", icon: "mdi:fire-alert",
    param: "input_number.auto_pompa_prog_cop", paramLabel: ["próg COP", "COP threshold"],
    name: ["Niski COP → rozważ gaz", "Low COP → consider gas"],
    desc: ["COP poniżej progu przez 30 min pracy → powiadomienie (najwyżej raz na 6 h)", "COP below the threshold for 30 min of running → notification (at most every 6 h)"] },
  { toggle: "input_boolean.auto_pompa_punkt_rosy", automation: "automation.automatyka_chlodzenie_blisko_punktu_rosy", group: "alert", icon: "mdi:water-alert",
    name: ["Chłodzenie blisko punktu rosy", "Cooling near the dew point"],
    desc: ["zasilanie < punkt rosy + 2 °C przez 5 min → ostrzeżenie (najwyżej raz na 2 h)", "flow < dew point + 2 °C for 5 min → warning (at most every 2 h)"] },
  { toggle: "input_boolean.auto_pompa_max_podloga", automation: "automation.automatyka_za_gorace_zasilanie_podlogowki", group: "alert", icon: "mdi:thermometer-alert",
    param: "input_number.pompa_max_zasilanie_podlogi", paramLabel: ["limit podłogi", "floor limit"],
    name: ["Za gorące zasilanie podłogi", "Floor flow too hot"],
    desc: ["zasilanie CO > limit podłogi przez 10 min → ostrzeżenie (najwyżej raz na 3 h)", "CH flow > floor limit for 10 min → warning (at most every 3 h)"] },
  { toggle: "input_boolean.auto_pompa_kociol_zamiast_pc", automation: "automation.automatyka_kociol_grzeje_choc_pompa_tansza", group: "alert", icon: "mdi:fire-alert",
    live: "binary_sensor.immergas_dft_hub_immergas_tt_kociol_gazowy_pracuje", liveLabel: ["kocioł teraz", "boiler now"],
    name: ["Kocioł grzeje, choć pompa tańsza", "Boiler heats although the heat pump is cheaper"],
    desc: ["kocioł gazowy pracuje 15 min, pompa tańsza, a na zewnątrz > I10 + 2 °C → powiadomienie (najwyżej raz na 6 h)",
      "gas boiler runs 15 min while the heat pump is cheaper and outdoor > I10 + 2 °C → notification (at most every 6 h)"] },
];

const GROUPS: [string, string, string, string][] = [
  ["control", "mdi:cog-play-outline", "Sterowanie", "Control"],
  ["alert", "mdi:bell-alert-outline", "Ostrzeżenia", "Warnings"],
  ["safety", "mdi:shield-lock-outline", "Zabezpieczenia", "Safety"],
];

class ImmergasAutomationsCard extends HubCard {
  getCardSize() { return 6; }

  /** Immergas Dominus: the integration's own automations and alerts (entities found by the card index) */
  private domItems(): Item[] {
    const id = (k: Parameters<HubCard["eid"]>[0]) => this.eid(k) ?? "";
    const season = this.so("dom_auto_season")?.attributes ?? {}, mean = parseFloat(season.outdoor_mean_24h);
    const until = this.so("dom_vac_until"), u = until && !["unknown", "unavailable", ""].includes(until.state)
      ? new Date(until.state).toLocaleString(this.loc, { dateStyle: "medium", timeStyle: "short" }) : "";
    const code = this.s("err_code");
    return [
      { toggle: id("dom_auto_season"), group: "control", icon: "mdi:sun-snowflake-variant", name: ["Lato / Zima automatycznie", "Summer / winter automatically"],
        desc: ["średnia zewnętrzna z 24 h poniżej progu → Zima (CO + CWU), powyżej → Lato (CWU); nie rusza Czuwania ani Chłodzenia",
          "24 h outdoor mean below the threshold → winter (CH + DHW), above → summer (DHW); never touches standby or cooling"],
        params: [[id("dom_win_below"), ["Zima poniżej", "Winter below"]], [id("dom_sum_above"), ["Lato powyżej", "Summer above"]]],
        liveText: isNaN(mean) ? "" : this.t(`średnia 24 h ${this.f(mean, 1, 1)} °C`, `24 h mean ${this.f(mean, 1, 1)} °C`) },
      { toggle: id("dom_vacation"), group: "control", icon: "mdi:bag-suitcase", name: ["Tryb wyjazdowy", "Vacation mode"],
        desc: ["obniża zadaną Strefy 1 do temperatury wyjazdowej; po „Wyjazd do” albo wyłączeniu przywraca poprzednią",
          "lowers the zone 1 target to the vacation temperature; restores it at “Away until” or when switched off"],
        params: [[id("dom_vac_temp"), ["temperatura", "temperature"]]], liveText: u ? this.t("do ", "until ") + u : "" },
      { toggle: id("dhw_sched"), group: "control", icon: "mdi:calendar-clock", name: ["CWU Komfort / Eko wg harmonogramu", "DHW Comfort / Eco by schedule"],
        desc: ["w godzinach harmonogramu CWU nastawa Komfort, poza nimi Eko", "Comfort setpoint inside the DHW schedule hours, Eco outside"] },
      { toggle: id("dom_notify"), group: "alert", icon: "mdi:bell-ring-outline", name: ["Powiadomienia o alarmach", "Alert notifications"],
        desc: ["ryzyko zamarznięcia, moduł offline albo błąd kotła → powiadomienie w Home Assistant; znika, gdy alarm minie",
          "frost risk, module offline or a boiler fault → a Home Assistant notification; cleared when the alert ends"] },
      { toggle: id("dom_frost"), status: true, group: "alert", icon: "mdi:snowflake-alert", name: ["Ryzyko zamarznięcia", "Frost risk"],
        desc: ["temperatura Strefy 1 poniżej progu", "zone 1 temperature below the threshold"], params: [[id("dom_frost_thr"), ["próg", "threshold"]]] },
      { toggle: id("dom_offline"), status: true, group: "alert", icon: "mdi:lan-disconnect", name: ["Moduł Dominus offline", "Dominus module offline"],
        desc: ["moduł nie odpowiada dłużej niż ustawiony czas", "the module has not answered for longer than the set time"], params: [[id("dom_off_min"), ["po", "after"]]] },
      { toggle: id("err_active"), status: true, group: "alert", icon: "mdi:alert-octagon", name: ["Błąd kotła", "Boiler fault"],
        desc: ["kod błędu zgłoszony przez kocioł", "a fault code reported by the boiler"], liveText: code && code !== "0" ? code : "" },
    ];
  }

  /** ESP hubs: the automations of the *_programs packages and alerts from the hub entities, by the device profile */
  private espItems(): Item[] {
    const id = (k: Parameters<HubCard["eid"]>[0]) => this.eid(k) ?? "";
    const fam = this.gbx ? "gb" : this.mtx ? "mt" : "ot", gbm = this.s("gb_model") ?? "", mtop = fam === "gb" && gbm === "mtop";
    const hp = fam === "mt" || mtop, prof = fam === "ot" ? this.otProfile : "";
    const mean = this.n("ot_out_mean");
    const until = this.so("dom_vac_until"), u = until && !["unknown", "unavailable", ""].includes(until.state)
      ? new Date(until.state).toLocaleString(this.loc, { dateStyle: "medium", timeStyle: "short" }) : "";
    const act = this.s("ot_vac_action"), actTxt = act === "summer" ? this.t("Lato (tylko CWU)", "summer (DHW only)") : act === "standby" ? this.t("Czuwanie", "standby") : "";
    const leg = this.s("ot_leg"), legTxt: Record<string, [string, string]> = { off: ["wyłączona", "off"], weekly: ["co tydzień", "weekly"], daily: ["codziennie", "daily"] };
    const items: Item[] = [
      { toggle: id("dom_auto_season"), group: "control", icon: "mdi:sun-snowflake-variant", name: ["Lato / Zima automatycznie", "Summer / winter automatically"],
        desc: hp ? ["średnia zewnętrzna z 24 h poniżej progu → grzanie, powyżej → tylko CWU; liczy hub, działa też bez Home Assistanta",
          "24 h outdoor mean below the threshold → heating, above → DHW only; the hub decides, also without Home Assistant"]
          : ["średnia zewnętrzna z 24 h poniżej progu → Zima (CO + CWU), powyżej → Lato (CWU); liczy hub, działa też bez Home Assistanta",
            "24 h outdoor mean below the threshold → winter (CH + DHW), above → summer (DHW); the hub decides, also without Home Assistant"],
        params: [[id("dom_win_below"), ["Zima poniżej", "Winter below"]], [id("dom_sum_above"), ["Lato powyżej", "Summer above"]]],
        liveText: isNaN(mean) ? "" : this.t(`średnia 24 h ${this.f(mean, 1, 1)} °C`, `24 h mean ${this.f(mean, 1, 1)} °C`) },
      { toggle: id("dom_vacation"), group: "control", icon: "mdi:bag-suitcase", name: ["Tryb wyjazdowy", "Vacation mode"],
        desc: [`na czas wyjazdu ${this.esp || this.gbx || this.mtx ? "hub" : "Dominus"} przełącza tryb (Czuwanie albo Lato) i wraca do poprzedniego po „Wyjazd do” albo wyłączeniu`,
          `for the vacation ${this.esp || this.gbx || this.mtx ? "the hub" : "Dominus"} switches the mode (standby or summer) and goes back at “Away until” or when switched off`],
        liveText: [u ? this.t("do ", "until ") + u : "", actTxt].filter(Boolean).join(" · ") },
      { toggle: id("dhw_sched"), group: "control", icon: "mdi:calendar-clock", name: ["CWU Komfort / Eko wg programu", "DHW Comfort / Eco by program"],
        desc: hp ? ["w oknach programu CWU nastawa Komfort, poza nimi Eko – pompa grzeje wodę w wybranych godzinach (np. tania taryfa)",
          "Comfort setpoint inside the DHW program windows, Eco outside – the heat pump heats the water at chosen hours (e.g. the cheap tariff)"]
          : ["w oknach programu CWU nastawa Komfort, poza nimi Eko", "Comfort setpoint inside the DHW program windows, Eco outside"],
        liveText: leg && legTxt[leg] ? this.t("anty-legionella: " + legTxt[leg][0], "anti-legionella: " + legTxt[leg][1]) : "" },
      // OpenTherm: the hub keeps the boiler from freezing (heats below the threshold even in standby)
      { toggle: id("ot_frost"), group: "safety", icon: "mdi:snowflake-alert", name: ["Ochrona przed zamarzaniem", "Frost protection"],
        desc: ["pokój albo zasilanie poniżej progu → hub włącza grzanie nawet w Czuwaniu", "room or flow below the threshold → the hub heats even in standby"],
        params: [[id("ot_frost_t"), ["próg", "threshold"]]] },
    ];
    // --- alerts (ALARM / OK) ---
    const code = this.s("err_code") ?? "", num = parseFloat(code);
    const fault = !!code && !(isFinite(num) && num === 0) && !["", "unknown", "unavailable", "brak", "none", "–"].includes(code.toLowerCase());
    const errK = this.eid("err_active") ? "err_active" : "err_code";
    items.push({ toggle: id(errK), status: true, alarm: errK === "err_active" ? this.on("err_active") : fault, group: "alert", icon: "mdi:alert-octagon",
      name: [hp ? "Błąd urządzenia" : "Błąd kotła", hp ? "Device fault" : "Boiler fault"],
      desc: hp ? ["kod błędu zgłoszony przez jednostkę", "a fault code reported by the unit"] : ["kod błędu zgłoszony przez kocioł", "a fault code reported by the boiler"],
      liveText: fault ? code + (this.s("err_desc") ? " · " + this.s("err_desc") : "") : "" });
    const linkK = fam === "ot" ? "ot_link" : fam === "gb" ? "gb_conn" : "mt_conn";
    items.push({ toggle: id(linkK), status: true, alarm: !this.on(linkK), group: "alert", icon: "mdi:lan-disconnect",
      name: ["Brak łączności z urządzeniem", "No link to the device"],
      desc: fam === "ot" ? ["kocioł nie odpowiada na OpenTherm", "the boiler does not answer OpenTherm"] : ["urządzenie nie odpowiada na Modbus", "the device does not answer Modbus"] });
    // short cycling, by the profile: a condensing boiler ≤ 3 starts/h; MAGIS M - the short cycle limit of its size
    if (!hp) {
      const k = fam === "ot" ? "ot_burn_h" : "ga_starts_hour", v = this.n(k);
      items.push({ toggle: id(k), status: true, alarm: v > 3, group: "alert", icon: "mdi:sine-wave", name: ["Taktowanie palnika", "Burner short cycling"],
        desc: ["więcej niż 3 starty palnika w ostatniej godzinie", "more than 3 burner starts in the last hour"],
        liveText: isNaN(v) ? "" : this.t(`starty w ostatniej godzinie: ${this.f(v, 0)}`, `starts in the last hour: ${this.f(v, 0)}`) });
    } else {
      const k = fam === "mt" ? "mt_short_cycles" : "ga_defrosts_today", v = this.n(k), cap = this.n("mt_cap"), lim = fam === "mt" ? (cap <= 6.5 ? 3 : 2) : 12;
      items.push({ toggle: id(k), status: true, alarm: v > lim, group: "alert", icon: fam === "mt" ? "mdi:sine-wave" : "mdi:snowflake-melt",
        name: fam === "mt" ? ["Taktowanie sprężarki", "Compressor short cycling"] : ["Częste odszranianie", "Frequent defrosting"],
        desc: fam === "mt" ? [`więcej niż ${lim} cykle < 10 min dziś (próg dla jednostki ${isNaN(cap) ? "–" : this.f(cap, 0)} kW)`, `more than ${lim} cycles < 10 min today (limit for a ${isNaN(cap) ? "–" : this.f(cap, 0)} kW unit)`]
          : [`więcej niż ${lim} odszraniań dziś`, `more than ${lim} defrosts today`],
        liveText: isNaN(v) ? "" : this.t(`dziś: ${this.f(v, 0)}`, `today: ${this.f(v, 0)}`) });
    }
    // burner health: leak (pressure drop), flame current (OT) / ionisation (gas BMS with a burner)
    if (!hp) {
      const lk = fam === "ot" ? "oa_leak_warning" : "ga_leak_warning";
      items.push({ toggle: id(lk), status: true, group: "alert", icon: "mdi:water-alert", name: ["Możliwy wyciek", "Possible leak"],
        desc: ["ciśnienie instalacji spada szybciej niż zwykle", "the system pressure drops faster than usual"] });
      const fk = fam === "ot" ? "oa_flame_low" : "ga_ion_low";
      items.push({ toggle: id(fk), status: true, group: "alert", icon: "mdi:fire-alert",
        name: fam === "ot" ? ["Niski prąd płomienia", "Low flame current"] : ["Niska jonizacja", "Low ionisation"],
        desc: ["elektroda albo mieszanka do sprawdzenia przy przeglądzie", "the electrode or the mixture to check at the service"] });
    }
    // heat pumps: antifreeze running and the unit alarm
    if (hp) {
      const ak = fam === "mt" ? "mt_antifreeze" : "gb_antifreeze";
      items.push({ toggle: id(ak), status: true, group: "safety", icon: "mdi:snowflake-thermometer", name: ["Ochrona przed zamarzaniem aktywna", "Antifreeze active"],
        desc: ["jednostka grzeje wodę, żeby obieg nie zamarzł", "the unit heats the water so the circuit does not freeze"] });
      if (fam === "mt") items.push({ toggle: id("mt_alarm"), status: true, group: "alert", icon: "mdi:alarm-light-outline", name: ["Alarm jednostki", "Unit alarm"],
        desc: ["wyjście alarmowe sterownika MAGIS M", "the alarm output of the MAGIS M controller"] });
    }
    // service reminder: interval set in the boiler parameters
    const last = this.s("ot_last_srv");
    items.push({ toggle: id("ot_maint_due"), status: true, group: "alert", icon: "mdi:wrench-clock", name: ["Przegląd serwisowy", "Service due"],
      desc: prof === "superior" || prof === "hercules" ? ["termin przeglądu wg interwału z parametrów (kocioł ma też własne przypomnienie w menu M1)", "the service date by the interval from the parameters (the boiler has its own reminder in menu M1 too)"]
        : ["termin przeglądu wg interwału ustawionego w parametrach", "the service date by the interval set in the parameters"],
      liveText: last && !["unknown", "unavailable"].includes(last) ? this.t("ostatni: ", "last: ") + last.slice(0, 10) : "" });
    return items;
  }

  /** Immergas Dominus in the OpenTherm mode: its own automations + the OpenTherm alerts of ot_computed (burner cycling,
   *  leak, flame current) and the fault code; the vacation switches the mode (standby / summer) like the ESP hub */
  private domOtItems(): Item[] {
    const ids = ["ot_burn_h", "oa_leak_warning", "oa_flame_low", "ot_maint_due"].map((k) => this.eid(k as Parameters<HubCard["eid"]>[0]));
    const esp = this.espItems(), d = this.domItems().map((i) => i.toggle === this.eid("dom_vacation") && this.eid("ot_vac_action")
      ? { ...i, desc: esp.find((e) => e.toggle === i.toggle)?.desc ?? i.desc, liveText: esp.find((e) => e.toggle === i.toggle)?.liveText || i.liveText } : i);
    const extra = esp.filter((i) => i.status && (ids.includes(i.toggle) || (!this.eid("err_active") && i.toggle === this.eid("err_code"))));
    return [...d.filter((i) => !(i.status && i.toggle === this.eid("err_active") && !this.hass.states[i.toggle])), ...extra];
  }

  private items(): Item[] {
    const cfg = this.config.items as any[] | undefined;
    if (!cfg) return this.esp || this.gbx || this.mtx ? this.espItems() : this.dominus && this.ot ? this.domOtItems() : this.dominus ? this.domItems() : DEFAULT_ITEMS;
    return cfg.map((i) => ({ ...i, name: [i.name, i.name], desc: [i.desc ?? "", i.desc ?? ""], group: i.group ?? "alert", icon: i.icon ?? "mdi:robot",
      liveLabel: i.live_label ? [i.live_label, i.live_label] : undefined, noLast: !!i.hide_last, paramLabel: i.param_label ? [i.param_label, i.param_label] : undefined }));
  }

  private info(e: string) { this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: e }, bubbles: true, composed: true })); }

  private when(iso?: string) {
    if (!iso) return this.t("jeszcze nie zadziałała", "has not fired yet");
    const d = new Date(iso), now = new Date(), day = 86400e3;
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const hm = d.toLocaleTimeString(this.loc, { hour: "2-digit", minute: "2-digit" });
    const txt = d.getTime() >= d0 ? this.t("dziś ", "today ") + hm : d.getTime() >= d0 - day ? this.t("wczoraj ", "yesterday ") + hm
      : d.toLocaleDateString(this.loc, { day: "numeric", month: "short" }) + " " + hm;
    return this.t("zadziałała ", "fired ") + txt;
  }

  private param(e: string, label?: [string, string]) {
    const st = this.hass.states[e];
    if (!st) return nothing;
    const a = st.attributes ?? {}, v = parseFloat(st.state), step = a.step ?? 0.1, d = String(step).split(".")[1]?.length ?? 0;
    const set = (dir: number) => !isNaN(v) && this.hass.callService(e.split(".")[0], "set_value",
      { entity_id: e, value: Math.round(Math.min(a.max ?? 1e9, Math.max(a.min ?? -1e9, v + dir * step)) * 1e4) / 1e4 });
    return html`<div class="prm" @click=${(ev: Event) => ev.stopPropagation()}>
      <span class="pl">${label ? this.t(label[0], label[1]) : this.t("próg", "threshold")}</span>
      <div class="btn xs" @click=${() => set(-1)}><ha-icon icon="mdi:minus"></ha-icon></div>
      <span class="pvv">${this.f(v, d, d)}${a.unit_of_measurement ? " " + a.unit_of_measurement : ""}</span>
      <div class="btn xs" @click=${() => set(1)}><ha-icon icon="mdi:plus"></ha-icon></div></div>`;
  }

  private row(i: Item, col: string) {
    const sw = this.hass.states[i.toggle], on = sw?.state === "on";
    const au = i.automation ? this.hass.states[i.automation] : undefined, auOff = !!au && au.state !== "on";
    // the F1/F2 disarm has nothing to do on hubs v23+, where the write gate is always armed and hidden
    const obsolete = i.toggle.endsWith("f1f2_rozbroj") && !this.eid("f_arm");
    const live = i.live ? this.hass.states[i.live] : undefined;
    const ll = i.liveLabel ? this.t(i.liveLabel[0], i.liveLabel[1]) : "";
    const liveTxt = i.liveText ?? (!live ? "" : live.state === "on" ? ll : live.state === "off" ? "" : `${ll}: ${live.state}`);
    const hot = i.status ? on : !!live && live.state === "on";
    if (i.status) return this.statusRow(i, i.alarm ?? on, liveTxt);
    const cc = on && !obsolete ? col : "overlay1";
    return html`<div class="ar ${on ? "" : "off"}" style="${on && !obsolete ? `border-color:${ca(col, 0.35)};background:${ca(col, hot ? 0.16 : 0.06)}` : ""}"
      @click=${() => this.info(i.automation && au ? i.automation : i.toggle)}>
      <ha-icon class="ai" icon=${i.icon} style="color:${c(cc)}"></ha-icon>
      <div class="cx">
        <div class="an">${this.t(i.name[0], i.name[1])}</div>
        <div class="ad">${this.t(i.desc[0], i.desc[1])}</div>
        <div class="as">
          ${obsolete ? html`<span class="tag" style="color:${c("overlay2")}">${this.t("zbędna od huba v23 – zapis jest stale uzbrojony", "not needed since hub v23 – writing is always armed")}</span>`
            : auOff ? html`<span class="tag" style="color:${c("red")}">${this.t("automatyzacja wyłączona w HA", "automation disabled in HA")}</span>`
            : au && !i.noLast ? html`<span class="tag"><ha-icon icon="mdi:history"></ha-icon>${this.when(au.attributes?.last_triggered)}</span>` : nothing}
          ${liveTxt ? html`<span class="tag" style="color:${c(hot ? col : "overlay2")}" @click=${(e: Event) => { e.stopPropagation(); this.info(i.live!); }}>● ${liveTxt}</span>` : nothing}
          ${i.param && on ? this.param(i.param, i.paramLabel) : nothing}
          ${on ? (i.params ?? []).map(([e, l]) => this.param(e, l)) : nothing}
        </div></div>
      <div class="tgl" style="flex:none;background:${on ? ca(col, 0.35) : "rgba(var(--ih-ov-rgb), .08)"};${on ? `box-shadow:0 0 6px ${ca(col, 0.5)}` : ""}"
        @click=${(e: Event) => { e.stopPropagation(); this.hass.callService(i.toggle.split(".")[0] === "input_boolean" ? "input_boolean" : "homeassistant", "toggle", { entity_id: i.toggle }); }}>
        <div class="kn" style="left:${on ? 23 : 3}px;background:${on ? c(col) : c("overlay1")}"></div></div></div>`;
  }

  /** an alert without a switch (Dominus): ALARM / OK instead of the toggle, its threshold always editable */
  private statusRow(i: Item, alarm: boolean, liveTxt: string) {
    const col = alarm ? "red" : "green";
    return html`<div class="ar" style="border-color:${ca(col, alarm ? 0.5 : 0.2)};background:${ca(col, alarm ? 0.14 : 0.04)}" @click=${() => this.info(i.toggle)}>
      <ha-icon class="ai" icon=${i.icon} style="color:${c(col)}"></ha-icon>
      <div class="cx">
        <div class="an">${this.t(i.name[0], i.name[1])}</div>
        <div class="ad">${this.t(i.desc[0], i.desc[1])}</div>
        <div class="as">
          ${liveTxt ? html`<span class="tag" style="color:${c(col)}">● ${liveTxt}</span>` : nothing}
          ${(i.params ?? []).map(([e, l]) => this.param(e, l))}
        </div></div>
      <span class="pill" style="color:${c(col)};border-color:${ca(col, 0.5)}">${alarm ? this.t("ALARM", "ALERT") : "OK"}</span></div>`;
  }

  protected body() {
    const its = this.items().filter((i) => i.toggle && this.hass.states[i.toggle]);
    const on = its.filter((i) => !i.status && this.hass.states[i.toggle].state === "on").length, sw = its.filter((i) => !i.status).length;
    const cols: Record<string, string> = { control: "blue", alert: "yellow", safety: "mauve" };
    return html`
      ${this.head("mdi:robot-outline", this.t("Automatyzacje", "Automations"), sw ? this.t(`włączone ${on} z ${sw}`, `${on} of ${sw} on`) : "")}
      ${!its.length ? html`<div class="note">${this.t("Brak przełączników automatyzacji (input_boolean.auto_pompa_*) – podaj własne w opcji items.",
        "No automation switches (input_boolean.auto_pompa_*) – list your own in the items option.")}</div>` : nothing}
      ${GROUPS.map(([g, icon, pl, en]) => {
        const rows = its.filter((i) => i.group === g);
        return rows.length ? html`<div class="gh"><ha-icon icon=${icon} style="color:${c(cols[g])}"></ha-icon>${this.t(pl, en)}</div>
          <div class="grid2">${rows.map((i) => this.row(i, cols[g]))}</div>` : nothing;
      })}`;
  }

  static styles = [HubCard.styles, css`
    .gh { display: flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; opacity: var(--ih-o7, .7); margin: 10px 0 6px; }
    .gh ha-icon { --mdc-icon-size: 15px; }
    .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 8px; }
    .ar { cursor: pointer; display: flex; align-items: flex-start; gap: 10px; padding: 9px 11px; border-radius: 13px; min-width: 0;
      background: rgba(var(--ih-ov-rgb), .03); border: 1px solid rgba(var(--ih-ov-rgb), .07); }
    .ar.off .an, .ar.off .ad { opacity: .55; }
    .ai { --mdc-icon-size: 20px; flex: none; margin-top: 1px; }
    .an { font-size: 12.5px; font-weight: 800; line-height: 1.25; }
    .ad { font-size: 10.5px; opacity: var(--ih-o7, .7); line-height: 1.35; margin-top: 2px; }
    .as { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 5px; }
    :host([ih-light]) .as { opacity: 1; }
    .tag { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; font-weight: 700; opacity: .85; }
    .tag ha-icon { --mdc-icon-size: 12px; opacity: .7; }
    .prm { display: inline-flex; align-items: center; gap: 5px; }
    .pl { font-size: 10px; font-weight: 700; opacity: var(--ih-o6, .6); }
    .pvv { font-size: 11px; font-weight: 800; min-width: 28px; text-align: center; font-variant-numeric: tabular-nums; }
    .ar .tgl { margin-top: 1px; }
    .pill { flex: none; font-size: 10px; font-weight: 800; letter-spacing: .05em; padding: 2px 8px; border-radius: 9px; border: 1px solid; margin-top: 1px; }
  `];
}

register("immergas-automations-card", ImmergasAutomationsCard, "Immergas – Automatyzacje / Automations",
  "Automatyzacje pompy ciepła w grupach: przełącznik, opis, kiedy zadziałała, stan na żywo i progi");
