# Historia zmian

[English](CHANGELOG.md) · **Polski**

Krótka historia wydań. Każde wydanie ma pełne notatki na GitHubie (link) – co się zmieniło, co poprawić w YAML-u
urządzenia i jakie wersje pakietów wnosi.

| Wydanie | Data | Najważniejsze |
|---|---|---|
| [v1.11.6](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.11.6) | 2026-11-10 | OpenTherm (ZEUS Superior / HERCULES): cel wyliczany z P66 zaokrąglany jak w kotle (temp. zewnętrzna do pełnego stopnia, wynik w pełnych stopniach) |
| [v1.11.5](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.11.5) | 2026-11-10 | Tablica huba: karty Obieg wodny i Obieg chłodniczy na całą szerokość |
| [v1.11.4](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.11.4) | 2026-11-10 | Schemat: kafel podpowiedzi zawija tekst do dwóch wierszy i nie zasłania już rury ogrzewania |
| [v1.11.3](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.11.3) | 2026-11-10 | 23 kolejne opisy błędów kotła w 11 językach; nastawa OTC modułu na karcie krzywej pogodowej |
| [v1.11.2](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.11.2) | 2026-11-09 | VICTRIX TT i Maior TT dodane do profilu menu kotła ZEUS 25 / OMNIA |
| [v1.11.1](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.11.1) | 2026-11-09 | profile menu kotłów OpenTherm sprawdzone z instrukcjami: EXA 28 / 32 przeniesione do rodziny S / P / t, nowy profil VICTRIX HYBRID, nazwany OMNIA V2, poprawiona podpowiedź taktowania TERA |
| [v1.11.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.11.0) | 2026-11-09 | motywy kart (Automatycznie, Jasny, Ciemny, wbudowany Mocha Neon), czytelny jasny wygląd, wszystkie teksty kart w 11 językach, OpenTherm: gaz czy prąd, ostatni cykl CWU, cel z krzywej P66 |
| [v1.10.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.10.0) | 2026-11-08 | OpenTherm: nadzór CO (czy kocioł naprawdę podjął żądanie), regulator przechodzi na samą krzywą bez Home Assistant, opcjonalna korekta całkująca; karty 0.87.0 |
| [v1.9.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.9.0) | 2026-11-08 | każdy pakiet w 11 językach (OpenTherm, kotły gazowe, MAGIS M, F1/F2, statystyki), opisy błędów MAGIS M w 11 językach; karty 0.86.0 znajdują huby ESP w każdym języku; nazwy encji bez „/” (ESPHome 2027.7); statusy połączenia przemianowane (*Status połączenia …*); polskie mapy rejestrów, CHANGELOG, SECURITY |
| [v1.8.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.8.0) | 2026-11-08 | status połączenia na każdej magistrali (TT, GB, MT, FF); opisy błędów dla OpenTherm, kotłów gazowych po Modbus BMS i MAGIS M (53 kody Midea); F1/F2: krok odszraniania, rozkaz pracy jednostki zewnętrznej, żądanie pracy jednostki wewnętrznej; przełącznik *Połączenie OpenTherm* w bramce; schematy dla TRIO HYDRO ELECTRIC, kotłów gazowych i MAGIS M |
| [v1.7.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.7.0) | 2026-11-08 | instrukcja instalacji OpenTherm ze schematami (master na ATOMIC ToUnit Base, bramka na PortABC), `ot_3v3_supply`; strona i konfiguracje TRIO HYDRO; liczniki odszraniania NASA 0x824B / 0x824C; każdy przykład przechodzi `esphome config` |
| [v1.6.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.6.0) | 2026-11-07 | karty *Dziś · analiza*, *Kalibracja* i *Automatyki*; `hub_analytics`, `ot_computed` / `ot_analytics`, `gb_computed` / `gb_analytics`, `mt_costs` / `mt_computed` / `mt_analytics` |
| [v1.5.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.5.0) | 2026-11-06 | karty działają na hubach kotłów gazowych (`gb_`) i MAGIS M (`mt_`); programy w hubie; skanery mapy magistral |
| [v1.4.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.4.0) | 2026-11-06 | hub OpenTherm robi wszystko to, co Dominus w trybie OpenTherm (regulator, programy, menu kotła) |
| [v1.3.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.3.0) | 2026-11-06 | nowa nazwa *IMMERGAS Modbus BMS NASA OpenTherm HUB*; nowe protokoły: OpenTherm (master / bramka), kotły gazowe po Modbus BMS, MAGIS M (Midea M-Thermal) |
| [v1.2.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.2.0) | 2026-11-04 | emulowany panel strefy przejmuje zmiany harmonogramu z Dominusa; jedna reguła AUTO / RĘCZNY dla tablic huba i Dominusa |
| [v1.1.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.1.0) – [v1.1.2](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.1.2) | 2026-11-02 | parametry kotła R02 / R03 / R10 / R11 / P07 w `hub_boiler_params`; ustawienia podzielone na online / offline; poprawki |
| [v1.0.0](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.0.0) – [v1.0.6](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/releases/tag/v1.0.6) | 2026-11-01 – 02 | pierwsze publiczne wydanie: jedno urządzenie ESPHome na D+/D-, T-/T+ i F1/F2 MAGIS PRO / COMBO V2, strategia tablicy i karty w 11 językach; poprawki |
