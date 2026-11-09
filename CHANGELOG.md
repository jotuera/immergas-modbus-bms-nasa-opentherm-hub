# Changelog

**English** · [Polski](CHANGELOG.pl.md)

The short history of the releases. Every release has its full notes on GitHub (linked) – what changed, what to update
in your device YAML, which package versions it brings.

| Release | Date | Highlights |
|---|---|---|
| [v1.11.1](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.11.1) | 2026-11-09 | OpenTherm boiler menu profiles checked against the manuals: EXA 28 / 32 moved to the S / P / t family, new VICTRIX HYBRID profile, OMNIA V2 named, TERA short-cycling hint fixed |
| [v1.11.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.11.0) | 2026-11-09 | card themes (Automatic, Light, Dark, built-in Mocha Neon), readable light look, every card text in 11 languages, OpenTherm: gas or electricity, last DHW cycle, target from the P66 curve |
| [v1.10.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.10.0) | 2026-11-08 | OpenTherm: CH supervision (does the boiler really take up the demand), the regulator falls back to the curve when Home Assistant is gone, optional integral room correction; cards 0.87.0 |
| [v1.9.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.9.0) | 2026-11-08 | every package in 11 languages (OpenTherm, gas boilers, MAGIS M, F1/F2, statistics), MAGIS M fault texts in 11 languages; cards 0.86.0 find the ESP hubs in every language; entity names without "/" (ESPHome 2027.7); connection status entities renamed (*… connection status*); Polish register maps, CHANGELOG, SECURITY |
| [v1.8.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.8.0) | 2026-11-08 | connection status on every bus (TT, GB, MT, FF); fault descriptions for OpenTherm, gas boilers over Modbus BMS and MAGIS M (53 Midea codes); F1/F2: defrost step, outdoor unit run command, indoor unit demand; *OpenTherm connection* switch in the gateway; wiring diagrams for TRIO HYDRO ELECTRIC, gas boilers and MAGIS M |
| [v1.7.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.7.0) | 2026-11-08 | OpenTherm installation docs and wiring diagrams (master on the ATOMIC ToUnit Base, gateway on the PortABC), `ot_3v3_supply`; TRIO HYDRO page and configurations; NASA defrost counters 0x824B / 0x824C; every example passes `esphome config` |
| [v1.6.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.6.0) | 2026-11-07 | the *Today · analysis*, *Calibration* and *Automations* cards; `hub_analytics`, `ot_computed` / `ot_analytics`, `gb_computed` / `gb_analytics`, `mt_costs` / `mt_computed` / `mt_analytics` |
| [v1.5.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.5.0) | 2026-11-06 | the cards run on the gas boiler (`gb_`) and MAGIS M (`mt_`) hubs; programs in the hub; bus map scanners |
| [v1.4.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.4.0) | 2026-11-06 | the OpenTherm hub does everything the Dominus does in OpenTherm mode (regulator, programs, boiler menu) |
| [v1.3.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.3.0) | 2026-11-06 | new name *IMMERGAS Modbus BMS NASA OpenTherm HUB*; new protocols: OpenTherm (master / gateway), gas boilers over Modbus BMS, MAGIS M (Midea M-Thermal) |
| [v1.2.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.2.0) | 2026-11-04 | the emulated zone panel takes schedule changes made through the Dominus; one AUTO / MANUAL rule for the hub and Dominus dashboards |
| [v1.1.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.1.0) – [v1.1.2](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.1.2) | 2026-11-02 | boiler parameters R02 / R03 / R10 / R11 / P07 in `hub_boiler_params`; settings split into online / offline; fixes |
| [v1.0.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.0.0) – [v1.0.6](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.0.6) | 2026-11-01 – 02 | first public release: one ESPHome device on D+/D-, T-/T+ and F1/F2 of the MAGIS PRO / COMBO V2, dashboard strategy and cards in 11 languages; fixes |
