import { LANGS, translate } from "./i18n";
import { define, storedTheme } from "./base";
/** option `theme` of the strategy goes to every card; the Mocha Neon look also sets the page background of the view */
const themeOpt = (config: any) => (config.theme ? { theme: config.theme } : {});
const neonBg = (config: any) => ((storedTheme() !== "auto" ? storedTheme() : config.theme) === "neon" ? { background: "#181825" } : {});
// Dashboard strategy: `strategy: { type: custom:immergas-hub }` builds a whole dashboard from the hub cards.
class ImmergasHubStrategy {
  static async generate(config: any, hass: any) {
    const l = String(hass?.locale?.language ?? hass?.language ?? "en").slice(0, 2), lang = LANGS.includes(l) ? l : "en";
    const t = (a: string, b: string) => translate(lang, a, b);
    const card = (type: string, extra: Record<string, unknown> = {}) => ({ type: "custom:" + type, ...themeOpt(config), ...extra });
    // the Automations card only when the HA automation switches exist (or an own list is given in `automations.items`)
    const autos = !!config.automations?.items || Object.keys(hass?.states ?? {}).some((e) => e.startsWith("input_boolean.auto_pompa_"));
    return {
      title: config.title ?? t("Pompa ciepła", "Heat pump"),
      views: [
        {
          title: t("Pompa ciepła", "Heat pump"), path: "pompa", icon: "mdi:heat-pump", type: "sections", max_columns: 3, ...neonBg(config),
          sections: [
            { type: "grid", column_span: 2, cards: [card("immergas-diagram-card", { grid_options: { columns: "full" }, stats: false, ...(config.diagram ?? {}) }), card("immergas-charts-card", { grid_options: { columns: "full" } }),
              card("immergas-states-card", { grid_options: { columns: "full" } }),
              card("immergas-links-card", { grid_options: { columns: "full" } })] },
            { type: "grid", cards: [card("immergas-now-card", { grid_options: { columns: "full" }, ...(config.now ?? {}) }), card("immergas-setpoints-card", { grid_options: { columns: "full" }, ...(config.setpoints ?? {}) })] },
            { type: "grid", cards: [card("immergas-mode-card", { grid_options: { columns: "full" }, ...(config.mode ?? {}) }),
              card("immergas-busmap-card", { grid_options: { columns: "full" } })] },
            { type: "grid", cards: [card("immergas-curve-card", { grid_options: { columns: "full" }, ...(config.curve ?? {}) }),
              card("immergas-gas-card", { grid_options: { columns: "full" } })] },
            { type: "grid", cards: [card("immergas-schedule-card", { grid_options: { columns: "full" }, ...(config.schedule ?? {}) }), card("immergas-dhw-card", { grid_options: { columns: "full" } })] },
            { type: "grid", column_span: 2, cards: [card("immergas-water-card", { grid_options: { columns: "full" } })] },
            { type: "grid", column_span: 2, cards: [card("immergas-refrigerant-card", { grid_options: { columns: "full" }, flags: false })] },
            { type: "grid", column_span: 3, cards: [card("immergas-day-card", { grid_options: { columns: "full" }, ...(config.day ?? {}) })] },
            { type: "grid", column_span: 3, cards: [card("immergas-calibration-card", { grid_options: { columns: "full" }, ...(config.curve?.max_floor_entity ? { max_floor_entity: config.curve.max_floor_entity } : {}), ...(config.calibration ?? {}) })] },
            ...(autos ? [{ type: "grid", column_span: 3, cards: [card("immergas-automations-card", { grid_options: { columns: "full" }, ...(config.automations ?? {}) })] }] : []),
            { type: "grid", column_span: 3, cards: [
              card("immergas-settings-card", { grid_options: { columns: 18 }, part: "online", ...(config.settings ?? {}) }),
              card("immergas-settings-card", { grid_options: { columns: 18 }, part: "offline", ...(config.settings ?? {}) })] },
          ],
        },
      ],
    };
  }
}

// `strategy: { type: custom:immergas-dominus }`: the reduced dashboard for the Immergas Dominus integration (no hub) -
// what the Dominus module reads over local TCP: now, setpoints, operating mode, schedules and the connection
class ImmergasDominusStrategy {
  static async generate(config: any, hass: any) {
    const l = String(hass?.locale?.language ?? hass?.language ?? "en").slice(0, 2), lang = LANGS.includes(l) ? l : "en";
    const t = (a: string, b: string) => translate(lang, a, b);
    const card = (type: string, extra: Record<string, unknown> = {}) => ({ type: "custom:" + type, grid_options: { columns: "full" }, source: "dominus", ...themeOpt(config), ...extra });
    // OpenTherm mode (VICTRIX ZEUS / AVIO, STAR …): the integration exposes only the OpenTherm Data-IDs - the same cards
    // without the ones that have nothing to show there (schedules, curve, statistics, settings)
    const ot = otEntities(hass);
    if (config.opentherm === true || (config.opentherm !== false && ot.ot_mode && !ot.fault_code)) return otDashboard(config, t);
    const online = () => card("immergas-settings-card", { part: "online", ...(config.settings ?? {}) });
    const offline = () => card("immergas-settings-card", { part: "offline", ...(config.settings ?? {}) });
    const wide = [{ condition: "screen", media_query: "(min-width: 768px)" }], narrow = [{ condition: "screen", media_query: "(max-width: 767px)" }];
    return {
      title: config.title ?? "Immergas Dominus",
      views: [
        {
          title: t("Kocioł", "Boiler"), path: "dominus", icon: "mdi:water-boiler", type: "sections", max_columns: 3, ...neonBg(config),
          sections: [
            // diagram + charts + connectivity (2 columns) | now + setpoints; then curve | mode | schedule
            { type: "grid", column_span: 2, cards: [card("immergas-diagram-card", { stats: false, ...(config.diagram ?? {}) }), card("immergas-charts-card", config.charts ?? {}),
              card("immergas-links-card", { four_in_row: true, ...(config.links ?? {}) })] },
            { type: "grid", cards: [card("immergas-now-card", config.now ?? {}), card("immergas-setpoints-card", config.setpoints ?? {})] },
            { type: "grid", cards: [card("immergas-curve-card", config.curve ?? {})] },
            { type: "grid", cards: [card("immergas-mode-card", config.mode ?? {})] },
            { type: "grid", cards: [card("immergas-schedule-card", config.schedule ?? {})] },
            // Dominus 1.6.14: today's analysis (room comfort, building, phases, DHW use, weather, link, zones)
            { type: "grid", column_span: 3, cards: [card("immergas-day-card", config.day ?? {})] },
            { type: "grid", column_span: 3, cards: [card("immergas-calibration-card", config.calibration ?? {})] },
            { type: "grid", column_span: 3, cards: [card("immergas-automations-card", config.automations ?? {})] },
            // online settings and boiler parameters: 50 % each, one under the other on a phone
            { type: "grid", column_span: 3, cards: [
              { type: "horizontal-stack", grid_options: { columns: "full" }, visibility: wide, cards: [online(), offline()] },
              { ...online(), visibility: narrow }, { ...offline(), visibility: narrow }] },
          ],
        },
      ],
    };
  }
}

/** entity ids of the Immergas Dominus integration by translation key (first config entry wins) */
function otEntities(hass: any): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [id, e] of Object.entries<any>(hass?.entities ?? {}))
    // 0.52.4: skip orphans (registry entries left by an earlier Modbus setup: no state, or a "restored" one) - they made
    // an OpenTherm installation look like Modbus (#2)
    if (e.platform === "immergas_dominus" && e.translation_key && !r[e.translation_key] && liveEntity(hass, id)) r[e.translation_key] = id;
  return r;
}

/** the entity is provided by the integration now (not just a leftover registry entry restored as unavailable) */
function liveEntity(hass: any, id: string): boolean {
  const s = hass?.states?.[id];
  return !!s && !s.attributes?.restored;
}

/** OpenTherm: the same Dominus cards in the same style; only what OpenTherm has no data for is left out (heating curve
 *  of the Magis, offline settings, automations); the calibration works from the Today analysis and the menu profile. The schedules are the programs
 *  the integration keeps in Home Assistant (Dominus 1.6). */
function otDashboard(config: any, t: (a: string, b: string) => string) {
  const card = (type: string, extra: Record<string, unknown> = {}) => ({ type: "custom:" + type, grid_options: { columns: "full" }, source: "dominus", ...themeOpt(config), ...extra });
  const online = () => card("immergas-settings-card", { part: "online", ...(config.settings ?? {}) });
  const offline = () => card("immergas-settings-card", { part: "offline", ...(config.settings_offline ?? {}) });
  const wide = [{ condition: "screen", media_query: "(min-width: 768px)" }], narrow = [{ condition: "screen", media_query: "(max-width: 767px)" }];
  return {
    title: config.title ?? "Immergas Dominus",
    views: [{
      title: t("Kocioł", "Boiler"), path: "dominus", icon: "mdi:water-boiler", type: "sections", max_columns: 3, ...neonBg(config),
      sections: [
        // diagram + charts + connectivity (2 columns) | now + setpoints; then weather curve + Data-ID map | operating mode | schedule + boiler
        { type: "grid", column_span: 2, cards: [card("immergas-diagram-card", { stats: false, ...(config.diagram ?? {}) }), card("immergas-charts-card", config.charts ?? {}),
          card("immergas-links-card", { four_in_row: true, ...(config.links ?? {}) })] },
        { type: "grid", cards: [card("immergas-now-card", config.now ?? {}), card("immergas-setpoints-card", config.setpoints ?? {})] },
        { type: "grid", cards: [card("immergas-ot-curve-card", config.ot_curve ?? {}), card("immergas-ot-map-card", config.ot_map ?? {})] },
        { type: "grid", cards: [card("immergas-mode-card", config.mode ?? {})] },
        { type: "grid", cards: [card("immergas-schedule-card", config.schedule ?? {}), card("immergas-ot-boiler-card", config.ot_boiler ?? {})] },
        // Dominus 1.6.14: today's analysis (gas, condensing, short cycling, DHW, room / degree days) - hidden tiles without data
        { type: "grid", column_span: 3, cards: [card("immergas-day-card", config.day ?? {})] },
        // calibration from the Today analysis and the boiler menu profile
        { type: "grid", column_span: 3, cards: [card("immergas-calibration-card", config.calibration ?? {})] },
        { type: "grid", column_span: 3, cards: [card("immergas-automations-card", config.automations ?? {})] },
        // gas or electricity and the last DHW cycle: 50 % each, one under the other on a phone
        { type: "grid", column_span: 3, cards: [
          { type: "horizontal-stack", grid_options: { columns: "full" }, visibility: wide, cards: [card("immergas-gas-card", config.gas ?? {}), card("immergas-dhw-card", config.dhw ?? {})] },
          { ...card("immergas-gas-card", config.gas ?? {}), visibility: narrow }, { ...card("immergas-dhw-card", config.dhw ?? {}), visibility: narrow }] },
        // online settings and boiler parameters: 50 % each, one under the other on a phone
        { type: "grid", column_span: 3, cards: [
          { type: "horizontal-stack", grid_options: { columns: "full" }, visibility: wide, cards: [online(), offline()] },
          { ...online(), visibility: narrow }, { ...offline(), visibility: narrow }] },
      ],
    }],
  };
}

define("ll-strategy-dashboard-immergas-dominus", class extends HTMLElement {
  static generate = ImmergasDominusStrategy.generate;
} as any);

define("ll-strategy-dashboard-immergas-hub", class extends HTMLElement {
  static generate = ImmergasHubStrategy.generate;
} as any);
