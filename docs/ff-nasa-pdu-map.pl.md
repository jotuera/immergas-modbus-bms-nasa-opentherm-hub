# Mapa PDU Samsung NASA - magistrala F1/F2 w Immergas Magis Pro / Combo

[English](ff-nasa-pdu-map.md) · **Polski**

Powrót do [przeglądu protokołów](../README.pl.md).

Wartości odczytane na **Magis Combo 9 Plus V2 + Audax Pro 9 V2** (split Samsung EHS, płytka interfejsu MIM-B19N, przełącznik obrotowy = 1).
Uczestnicy magistrali: `10.00.00` = jednostka zewnętrzna, `20.00.01` = jednostka wewnętrzna (płytka MIM w Magisie), `80.FF.00` = to ESP (tylko przy `transmit: true`).

Kolumny: **klucz** = `key:` w konfiguracji, **dek.** = dekodowanie (`temp` = int16 ze znakiem x0.1, 65535/65036 = unknown).
Status: rozszyfrowane, chyba że oznaczone jako *kandydat* / *nieznany*. **Pomoc przy nieznanych jest mile widziana** - otwórz zgłoszenie z logiem sniffera (włącz przełącznik `NASA Sniffer`, logi z tagiem `sniff`).

## Czujniki

| PDU | źródło | klucz | nazwa (EN) | dek. | jednostka | uwagi |
|---|---|---|---|---|---|---|
| `0x4238` | wewn. | `flow_temp_out` | Flow Temp Out | temp | °C |  |
| `0x4236` | wewn. | `flow_temp_return` | Flow Temp Return | temp | °C |  |
| `0x4247` | wewn. | `water_outlet_target` | Water Outlet Target (active) | temp nan=50 | °C | Aktywna zadana temperatura zasilania (LWT). Na Magisie liczy ją sterownik **Immergasa** (krzywa termoregulacji R02-R05 + przesunięcie U03), a nie krzywa grzewcza FSV Samsunga. Zastępcze 50 w spoczynku -> unknown. |
| `0x4237` | wewn. | `dhw_temperature` | DHW Temperature | temp | °C | 0 na Magisie Combo - czujnik zasobnika CWU jest po stronie Immergasa (patrz D03 na D+/D- lub T-/T+). |
| `0x4235` | wewn. | `dhw_target` | DHW Target Temperature | temp | °C |  |
| `0x4203` | wewn. | `zone1_room_temp` | Zone 1 Indoor Temp | temp | °C | Na Magisie to **nie** jest temperatura pomieszczenia (pomieszczeniami zajmuje się Immergas): ~18 °C przy 22 °C w pokojach, idzie za stroną wodną i spadła do 14 °C podczas odszraniania. Od 1.2.1 nazwa "MIM temperature 0x4203". |
| `0x4201` | wewn. | `zone1_target` | Zone 1 Target Temp | temp | °C |  |
| `0x42D4` | wewn. | `zone2_room_temp` | Zone 2 Indoor Temp | temp | °C |  |
| `0x42D6` | wewn. | `zone2_target` | Zone 2 Target Temp | temp | °C |  |
| `0x4205` | wewn. | `eva_in_temp` | Indoor EVA In Temperature | temp | °C | Strona cieczowa czynnika chłodniczego - równa D24 Immergasa. |
| `0x4204` | wewn. | `water_out_tw2` | Indoor Water Out TW2 (4204) | temp | °C |  |
| `0x420C` | wewn. | `outdoor_temp_copy` | NASA Indoor PDU 420C Outdoor Temp Copy | temp | °C | Ta sama wartość co 0x8204, odświeżana co ~40 s. Równa D06/D79 Immergasa. |
| `0x4239` | wewn. | `heater_out_temp` | Heater Out Temperature | temp | °C | 0 na Magisie Combo (czujnik niezamontowany). |
| `0x428C` | wewn. | `mixing_valve_temp` | Mixing Valve Temperature | temp | °C | 0 na Magisie Combo (czujnik niezamontowany). |
| `0x42E9` | wewn. | `flow_rate` | Flow Rate Sensor | raw x0.1 | L/min |  |
| `0x4211` | wewn. | `capacity_request` | Indoor Capacity Request | raw /8.6 | kW | raw / 8.6 = kW (77 -> 8.95 kW przy jednostce 9 kW). |
| `0x4212` | wewn. | `capacity_absolute` | Indoor Capacity Absolute | raw /8.6 | kW | raw / 8.6 = kW. |
| `0x4426` | wewn. | `power_produced` | Power Produced Last Minute | raw signed nan=4294967295 | W |  |
| `0x4427` | wewn. | `energy_produced_total` | Total Produced Energy | raw x0.001 nan=4294967295 | kWh |  |
| `0x4217` | wewn. | `indoor_eev` | Indoor EEV Value 1 | raw |  | 0 na Magisie Combo. |
| `0x408A` | wewn. | `two_way_valve` | 2-Way Valve | raw |  |  |
| `0x4067` | wewn. | `three_way_valve` | 3-Way Valve | raw |  |  |
| `0x4001` | wewn. | `operation_mode` | Indoor Operation Mode (4=Heat) | raw |  | 0 Auto, 1 Chłodzenie, 2 Osuszanie, 3 Wentylator, 4 Grzanie, 21 Chłodzenie zasobnika, 24 Ciepła woda. |
| `0x406F` | wewn. | `control_reference` | EHS Control Reference (1=Water Out) | raw |  | 0 = pomieszczenie, 1 = woda na wyjściu (wtedy aktywna nastawa to 0x4247). |
| `0x440E` | wewn. | `status_bits_440e` | Indoor Status Bits (440E) | raw |  | 0x400 w spoczynku, 0x403, gdy pompa ciepła ma zapotrzebowanie na ciepło (samo zapotrzebowanie strefy go nie ustawia): **bit 0** na początku zapotrzebowania (`indoor_demand`), **bit 1** 2 s później, oba kasowane, gdy się kończy (6–7.11.2026). |
| `0x0402` | wewn. | `raw_0402` | NASA Indoor PDU 0402 LONG RAW | raw |  | *nieznany* LVAR_AD_ADDRESS_RMC (informacja o adresie). |
| `0x0411` | wewn. | `raw_0411` | NASA Indoor PDU 0411 LONG RAW | raw |  | *nieznany* Górne 16 bitów x0.1 = limit instalacyjny (chłodzenie, górny, 30.0). |
| `0x0412` | wewn. | `raw_0412` | NASA Indoor PDU 0412 LONG RAW | raw |  | *nieznany* Górne 16 bitów x0.1 (chłodzenie, dolny, 5.0). |
| `0x0413` | wewn. | `raw_0413` | NASA Indoor PDU 0413 LONG RAW | raw |  | *nieznany* Górne 16 bitów x0.1 (grzanie, górny, 55.0). |
| `0x0414` | wewn. | `raw_0414` | NASA Indoor PDU 0414 LONG RAW | raw |  | *nieznany* Górne 16 bitów x0.1 (grzanie, dolny, 15.0). To nie R04/R05 Immergasa. |
| `0x0415` | wewn. | `raw_0415` | NASA Indoor PDU 0415 LONG RAW | raw |  | *nieznany* LVAR_AD_INSTALL_LEVEL_CONTACT_CONTROL. |
| `0x4006` | wewn. | `raw_4006` | NASA Indoor PDU 4006 RAW | raw |  | *nieznany* Tryb wentylatora jednostki wewnętrznej - bez znaczenia w EHS. |
| `0x440A` | wewn. | `raw_440a` | NASA Indoor PDU 440A LONG RAW | raw |  | *nieznany* Stan urządzenia pompa ciepła / kocioł - stale 1, także gdy pracuje kocioł gazowy. |
| `0x428D` | wewn. | `raw_428d` | NASA Indoor PDU 428D RAW | raw |  | *kandydat* 0 -> 286, gdy wystartowała funkcja nocna Immergasa (22:00:59, 48 s po tym, jak kocioł zapisał do MIM limit 30 %); nie wrócił do 0 na końcu okna. Lista kodów Samsunga wymienia go przy "EHS Mono HT Quiet". |
| `0x8204` | zewn. | `outdoor_temperature` | Outdoor Temperature | temp | °C |  |
| `0x8238` | zewn. | `compressor_frequency` | Compressor Current Frequency | raw | Hz |  |
| `0x8236` | zewn. | `order_frequency` | Compressor 1 Order Frequency | raw | Hz |  |
| `0x8237` | zewn. | `target_frequency` | Compressor 1 Target Frequency | raw | Hz |  |
| `0x8239` | zewn. | `frequency_limit` | Compressor Frequency Limit | raw | Hz | Górny limit częstotliwości sprężarki: 95 w postoju / przy starcie, ~64 w trybie Normal, **19 podczas funkcji nocnej Immergasa** (U11 - kocioł zapisuje do MIM limit mocy 30 %; 30 % x 64 Hz = 19). Nakładany ~6 min po starcie sprężarki, zwalniany ~40 s po końcu okna nocnego. |
| `0x823D` | zewn. | `fan_speed_target` | Outdoor Fan Speed (target) | raw | RPM | 0x823D = zadane, 0x82D9 = rzeczywiste. |
| `0x82D9` | zewn. | `fan_speed_actual` | Outdoor Fan Speed (actual) | raw | RPM |  |
| `0x8413` | zewn. | `power_consumed` | Power Consumed last Minute | raw nan=4294967295 | W |  |
| `0x8411` | zewn. | `outdoor_power` | Outdoor Power (1 unit) | raw nan=4294967295 | W |  |
| `0x8414` | zewn. | `energy_consumed_total` | Total Consumed Energy | raw x0.001 nan=4294967295 | kWh |  |
| `0x8217` | zewn. | `outdoor_current` | Outdoor Current | raw x0.1 | A |  |
| `0x24FC` | zewn. | `heat_pump_voltage` | Heat Pump Voltage | raw nan=4294967295 | V |  |
| `0x82ED` | zewn. | `mains_voltage` | Mains AC Voltage | raw | V | Napięcie sieci AC na jednostce zewnętrznej. |
| `0x823B` | zewn. | `dc_link_voltage` | Outdoor DC-Link Voltage | raw x2 | V | Wartość surowa w jednostkach 2 V. |
| `0x82E3` | zewn. | `unit_capacity` | Outdoor Unit Capacity | raw x0.1 | kW | Klasa mocy jednostki zewnętrznej (9 = 9 kW). |
| `0x820A` | zewn. | `discharge_temp` | Outdoor Discharge 1 Temp (820A) | temp | °C |  |
| `0x8223` | zewn. | `target_discharge_temp` | Outdoor Target Discharge Temp | temp | °C | Równa 'HP target discharge temperature' Immergasa na D+/D-. |
| `0x8280` | zewn. | `comp_top_temp` | Outdoor Comp Top Temp (8280) | temp | °C |  |
| `0x8218` | zewn. | `cond_out_temp` | Outdoor Cond-Out Temp (8218) | temp | °C |  |
| `0x8254` | zewn. | `ipm_temp` | Outdoor IPM1 Temperature (8254) | temp | °C |  |
| `0x8229` | zewn. | `main_eev` | Outdoor Main EEV Position | raw | step | 0..2000 kroków (D77 Immergasa). |
| `0x8248` | zewn. | `start_sequence` | Compressor Start Sequence Stage | raw |  | 3 -> 0 -> 1 -> 2 -> 6 podczas startu sprężarki. |
| `0x8249` | zewn. | `restart_inhibit` | Compressor Restart Inhibit | raw |  | 5 = gotowa; 2 -> 3 -> 5 przez ~2 min 53 s po zatrzymaniu. |
| `0x8235` | zewn. | `error_code` | Error Code | raw |  | Kod błędu Samsunga (numer E), 0 = brak. |
| `0x0207` | zewn. | `linked_indoor_units` | Linked Indoor Units | raw |  | Liczba jednostek wewnętrznych połączonych z jednostką zewnętrzną. |
| `0x041B` | zewn. | `raw_041b` | NASA Outdoor PDU 041B LONG RAW | raw |  | *nieznany*  |
| `0x8201` | zewn. | `raw_8201` | NASA Outdoor PDU 8201 RAW | raw |  | *nieznany* Stała 181. |
| `0x8239` | zewn. | `raw_8239` | NASA Outdoor PDU 8239 RAW | raw |  | *przestarzały* - ta sama wartość co `frequency_limit`, zostawiony, żeby istniejące konfiguracje dalej działały. |
| `0x823F` | zewn. | `raw_823f` | NASA Outdoor PDU 823F RAW | raw |  | *nieznany* Stała 200. |
| `0x8243` | zewn. | `raw_8243` | NASA Outdoor PDU 8243 RAW | raw |  | *nieznany*  |
| `0x824B` | zewn. | `defrost_since` | Time since last defrost | raw, s |  | Sekundy od końca ostatniego odszraniania; zatrzymuje się na **2100 (35 min = minimalny odstęp)**, 0 od startu odszraniania (obserwacja 6–7.11.2026, 10 odszronień). |
| `0x824C` | zewn. | `defrost_frost_time` | Evaporator frosting time | raw, s |  | Sekundy pracy sprężarki z parownikiem poniżej ok. **−6 °C** (liczy tylko, dopóki tak jest); odszranianie startuje, gdy licznik dojdzie do **~8–10 min**, a 0x824B stoi na 2100; 0 od startu odszraniania (obserwacja). |
| `0x8247` | zewn. | `defrost_step` | Defrost Step | raw |  | NASA wiki *NASA_OUTDOOR_DEFROST_STEP*. Każde odszranianie z 6–7.11.2026 (9×): **1–2** przygotowanie, **5–6** zawór 4-drogowy przełączony i sprężarka pracuje, **7–10** zakończenie, **0** powrót do grzania. Trzyma ostatni krok (np. 7), gdy praca kończy się zaraz po odszranianiu. |
| `0x82E1` | zewn. | `raw_82e1` | NASA Outdoor PDU 82E1 RAW | raw |  | *nieznany* Stała 0x5A5A. |
| `0x80B1` | zewn. | `raw_80b1` | NASA Outdoor PDU 80B1 RAW | raw |  | *kandydat* 0 -> 1 razem z nocnym limitem częstotliwości (0x8239 -> 19 Hz) przy pracującej sprężarce; z powrotem 0, gdy sprężarka stanęła na końcu okna. Kandydat: "limit mocy aktywny". |
| `0x840F` | zewn. | `raw_840f` | NASA Outdoor PDU 840F LONG RAW | raw |  | *nieznany*  |
| `0x8417` | zewn. | `raw_8417` | NASA Outdoor PDU 8417 LONG RAW | raw |  | *nieznany*  |

## Czujniki binarne

| PDU | źródło | klucz | nazwa (EN) |
|---|---|---|---|
| `0x4089` | wewn. | `water_pump` | Primary Water Pump |
| `0x406C` | wewn. | `backup_heater` | Backup Heater |
| `0x4087` | wewn. | `booster_heater` | EHS Booster Heater |
| `0x402E` | wewn. | `defrost` | Defrost Mode |
| `0x4065` | wewn. | `dhw_power` | DHW Power |
| `0x4000` | wewn. | `zone1_power` | Zone 1 Power |
| `0x411E` | wewn. | `zone2_power` | Zone 2 Power |
| `0x4123` | wewn. | `pv_control` | PV Control |
| `0x4124` | wewn. | `smart_grid` | Smart Grid |
| `0x8010` | zewn. | `compressor` | Compressor Status |
| `0x801A` | zewn. | `four_way_valve` | 4-Way Valve |
| `0x8017` | zewn. | `hot_gas_valve` | Hot Gas Valve |
| `0x80AF` | zewn. | `base_heater` | Base Heater |
| `0x8002` | zewn. | `odu_run_command` | Outdoor Unit Run Command (*kandydat*: włącza się ~20 s przed startem sprężarki, wyłącza, gdy kończy się zapotrzebowanie na ciepło) |
| `0x440E` bit 0 | wewn. | `indoor_demand` | Indoor Unit Demand (`mask: 0x1`) |

## Czujniki tekstowe

| PDU | źródło | klucz | nazwa (EN) | tryb |
|---|---|---|---|---|
| `0x8001` | zewn. | `outdoor_driving_mode` | Outdoor Driving Mode | map (driving_mode) |
| `0x8003` | zewn. | `outdoor_operation_state` | Outdoor Operation State | map (heat_cool) |
| `0x800D` | zewn. | `outdoor_fan_state` | Outdoor Fan Operation State | map (fan_state) |
| `0x8061` | zewn. | `defrost_stage` | Defrost Stage (1 ~10 s, 2 ~20 s, 3 ~4–5 min główny, 4 ~10 s zakończenie, 6 ~30 s powrót do grzania, 7 koniec) | map (defrost_stage) |
| `0x8235` | zewn. | `system_error` | System Error Status | error |
| `0x4066` | wewn. | `dhw_mode` | Hot Water Mode | map (dhw_mode) |
| `0x4001` | wewn. | `operation_mode_text` | Indoor Operation Mode | map (operation_mode) |
| `0x4067` | wewn. | `three_way_valve_text` | 3-Way Valve Position | map (three_way_valve) |
| `0x0608` | zewn. | `firmware_outdoor` | Outdoor Unit Firmware | firmware |
| `0x060C` | zewn. | `firmware_outdoor_eeprom` | Outdoor Unit EEPROM | firmware |
| `0x8601` | zewn. | `firmware_inverter` | Inverter Firmware | firmware |
| `0x0608` | wewn. | `firmware_indoor` | Indoor Unit (MIM) Firmware | firmware |
| `0x4604` | wewn. | `raw_4604` | NASA Indoor PDU 4604 RAW | hex |

Struktury firmware dekodują się jako `DBxx-xxxxxx yy.mm.dd` (numer części Samsunga + data kompilacji); `0x8601` niesie też wersję, np. `DB91-02338A v10.00.02`.

## Ustawienia instalatora FSV (jednostka wewnętrzna, odczyt żądaniami READ)

Nigdy nie są rozgłaszane - komponent odczytuje je przy starcie (+30 s) i co `poll_interval`. Tylko do odczytu: na F1/F2 zapisy są ignorowane przez sterownik Immergasa.
65535 / 255 = nieobsługiwane przez tę jednostkę -> unknown.

| FSV | PDU | nazwa | dek. | jednostka | opcje |
|---|---|---|---|---|---|
| 1011 | `0x424A` | Maks. temp. wody wyj. (chłodzenie) | temp | °C |  |
| 1012 | `0x424B` | Min. temp. wody wyj. (chłodzenie) | temp | °C |  |
| 1021 | `0x424C` | Maks. temp. pomieszczenia (chłodzenie) | temp | °C |  |
| 1022 | `0x424D` | Min. temp. pomieszczenia (chłodzenie) | temp | °C |  |
| 1031 | `0x424E` | Maks. temp. wody wyj. (ogrzewanie) | temp | °C |  |
| 1032 | `0x424F` | Min. temp. wody wyj. (ogrzewanie) | temp | °C |  |
| 1041 | `0x4250` | Maks. temp. pomieszczenia (ogrzewanie) | temp | °C |  |
| 1042 | `0x4251` | Min. temp. pomieszczenia (ogrzewanie) | temp | °C |  |
| 1051 | `0x4252` | Maks. temp. zbiornika CWU | temp | °C |  |
| 1052 | `0x4253` | Min. temp. zbiornika CWU | temp | °C |  |
| 2011 | `0x4254` | Krzywa grzania - temp. zewn. pkt 1 | temp | °C |  |
| 2012 | `0x4255` | Krzywa grzania - temp. zewn. pkt 2 | temp | °C |  |
| 2021 | `0x4256` | Krzywa grzania WL1 - woda wyj. pkt 1 | temp | °C |  |
| 2022 | `0x4257` | Krzywa grzania WL1 - woda wyj. pkt 2 | temp | °C |  |
| 2031 | `0x4258` | Krzywa grzania WL2 - woda wyj. pkt 1 | temp | °C |  |
| 2032 | `0x4259` | Krzywa grzania WL2 - woda wyj. pkt 2 | temp | °C |  |
| 2041 | `0x4093` | Typ krzywej grzania | enum |  | 1 WL1 (podłoga), 2 WL2 (klimakonwektor) |
| 2051 | `0x425A` | Krzywa chłodzenia - temp. zewn. pkt 1 | temp | °C |  |
| 2052 | `0x425B` | Krzywa chłodzenia - temp. zewn. pkt 2 | temp | °C |  |
| 2061 | `0x425C` | Krzywa chłodzenia WL1 - woda wyj. pkt 1 | temp | °C |  |
| 2062 | `0x425D` | Krzywa chłodzenia WL1 - woda wyj. pkt 2 | temp | °C |  |
| 2071 | `0x425E` | Krzywa chłodzenia WL2 - woda wyj. pkt 1 | temp | °C |  |
| 2072 | `0x425F` | Krzywa chłodzenia WL2 - woda wyj. pkt 2 | temp | °C |  |
| 2081 | `0x4094` | Typ krzywej chłodzenia | enum |  | 1 WL1, 2 WL2 |
| 2091 | `0x4095` | Zewnętrzny termostat pokojowy (podłoga) | enum |  | 0 Nie, 1-4 tryby termostatu |
| 2092 | `0x4096` | Zewnętrzny termostat pokojowy (klimakonwektor) | enum |  | 0 Nie, 1-4 tryby termostatu |
| 2093 | `0x4127` | Sterowanie temp. pokoju z pilota | enum |  | 1-4 tryby sterowania temp. pokoju |
| 3011 | `0x4097` | Zbiornik CWU - zastosowanie | enum |  | 0 Bez CWU, 1 Tak (start przy temp. thermo-on), 2 Tak (start przy temp. thermo-off) |
| 3021 | `0x4260` | CWU - maks. temp. (pompa ciepła) | temp | °C |  |
| 3022 | `0x4261` | CWU - różnica wyłączenia pompy | temp | °C |  |
| 3023 | `0x4262` | CWU - różnica włączenia pompy | temp | °C |  |
| 3024 | `0x4263` | Min. czas ogrzewania przestrzeni | raw | min |  |
| 3025 | `0x4264` | Maks. czas dostarczania CWU | raw | min |  |
| 3026 | `0x4265` | Maks. czas ogrzewania przestrzeni | raw x0.0166667 | h |  |
| 3031 | `0x4098` | Grzałka dodatkowa - zastosowanie | enum |  | 0 Wył., 1 Wł. |
| 3032 | `0x4266` | Grzałka dodatkowa - opóźnienie | raw | min |  |
| 3033 | `0x4267` | Grzałka dodatkowa - przeregulowanie | temp | °C |  |
| 3041 | `0x4099` | Dezynfekcja | enum |  | 0 Wył., 1 Wł. |
| 3042 | `0x409A` | Dezynfekcja - dzień tygodnia | enum |  | 0 Niedziela ... 6 Sobota, 7 Codziennie |
| 3043 | `0x4269` | Dezynfekcja - godzina rozpoczęcia | raw | h |  |
| 3044 | `0x426A` | Dezynfekcja - temp. docelowa | temp | °C |  |
| 3045 | `0x426B` | Dezynfekcja - czas trwania | raw | min |  |
| 3046 | `0x42CE` | Dezynfekcja - maks. czas | raw | h |  |
| 3051 | `0x409B` | Timer wymuszonego CWU | enum |  | 0 Wył., 1 Wł. |
| 3052 | `0x426C` | Wymuszone CWU - czas trwania | raw x10 | min |  |
| 3061 | `0x409C` | Panel słoneczny / termostat CWU | enum |  | 0 Nie, 1 Panel słoneczny, 2 Termostat CWU |
| 3071 | `0x409D` | Kierunek zaworu 3-drogowego | enum |  | 0 Pomieszczenie, 1 Zbiornik |
| 3081 | `0x42ED` | Grzałka dodatkowa - moc stopień 1 | raw | kW |  |
| 3082 | `0x42EE` | Grzałka dodatkowa - moc stopień 2 | raw | kW |  |
| 3083 | `0x42EF` | Grzałka zbiornika (BSH) - moc | raw | kW |  |
| 4011 | `0x409E` | Priorytet ogrzewanie / CWU | enum |  | 0 CWU, 1 Ogrzewanie |
| 4012 | `0x426D` | Temp. zewn. dla priorytetu | temp | °C |  |
| 4013 | `0x426E` | Temp. zewn. wyłączenia ogrzewania | temp | °C |  |
| 4021 | `0x409F` | Grzałka zapasowa - zastosowanie | enum |  | 0 Nie, 1 2-stopniowa, 2 1-stopniowa |
| 4022 | `0x40A0` | Priorytet grzałki zapasowej/dodatkowej | enum |  | 0 Obie, 1 Grzałka zapasowa, 2 Grzałka dodatkowa |
| 4023 | `0x40A1` | Kompensacja niskiej temp. zewn. | enum |  | 0 Wył., 1 Wł. |
| 4024 | `0x4270` | Temp. progowa grzałki zapasowej | temp | °C |  |
| 4025 | `0x4271` | Temp. rezerwy przy odszranianiu | temp | °C |  |
| 4031 | `0x40A2` | Kocioł zapasowy - zastosowanie | enum |  | 0 Nie, 1 Tak |
| 4032 | `0x40A3` | Priorytet kotła zapasowego | enum |  | 0 Nie, 1 Tak |
| 4033 | `0x4272` | Temp. progowa kotła zapasowego | temp | °C |  |
| 4041 | `0x40C0` | Zawór mieszający - zastosowanie | enum |  | 0 Nie, 1 Delta T, 2 Krzywa grzewcza |
| 4042 | `0x4286` | Zawór miesz. - docelowa ΔT (ogrzewanie) | temp | °C |  |
| 4043 | `0x4287` | Zawór miesz. - docelowa ΔT (chłodzenie) | temp | °C |  |
| 4044 | `0x40C1` | Zawór miesz. - współczynnik kontroli | enum |  |  |
| 4045 | `0x4288` | Zawór miesz. - interwał kontroli | raw | min |  |
| 4046 | `0x4289` | Zawór miesz. - czas przejścia | raw x10 | s |  |
| 4051 | `0x40C2` | Pompa inwerterowa - zastosowanie | enum |  | 0 Nie, 1 100%, 2 70% |
| 4052 | `0x428A` | Pompa inwerterowa - docelowa ΔT | temp | °C |  |
| 4053 | `0x40C3` | Pompa inwerterowa - współczynnik kontroli | enum |  |  |
| 4061 | `0x411A` | Sterowanie strefami | enum |  | 0 Wył., 1 Wł. |
| 5011 | `0x4273` | Tryb wyjazdowy - woda wyj. chłodzenie | temp | °C |  |
| 5012 | `0x4274` | Tryb wyjazdowy - pokój chłodzenie | temp | °C |  |
| 5013 | `0x4275` | Tryb wyjazdowy - woda wyj. ogrzewanie | temp | °C |  |
| 5014 | `0x4276` | Tryb wyjazdowy - pokój ogrzewanie | temp | °C |  |
| 5015 | `0x4277` | Tryb wyjazdowy - auto chłodz. WL1 | temp | °C |  |
| 5016 | `0x4278` | Tryb wyjazdowy - auto chłodz. WL2 | temp | °C |  |
| 5017 | `0x4279` | Tryb wyjazdowy - auto grzanie WL1 | temp | °C |  |
| 5018 | `0x427A` | Tryb wyjazdowy - auto grzanie WL2 | temp | °C |  |
| 5019 | `0x427B` | Tryb wyjazdowy - cel zbiornika CWU | temp | °C |  |
| 5021 | `0x427C` | CWU oszczędzanie - różnica temp. | temp | °C |  |
| 5022 | `0x4128` | Tryb oszczędzania CWU | enum |  | 0 Wył., 1 Wł. |
| 5023 | `0x42F0` | CWU oszcz. - różnica thermo-off | raw |  |  |
| 5041 | `0x40A4` | Kontrola szczytu mocy - zastosowanie | enum |  | 0 Wył., 1 Wł. |
| 5042 | `0x40A5` | Szczyt mocy - wymuszone wyłączenia | enum |  | 0 Wszystko, 1-3 wybór |
| 5043 | `0x40A6` | Szczyt mocy - napięcie wejściowe | enum |  | 0 Niskie, 1 Wysokie |
| 5051 | `0x40A7` | Sterowanie współczynnikiem częstotliwości | enum |  | 0 Wył., 1 Wł. |
| 5081 | `0x411B` | Sterowanie PV | enum |  | 0 Wył., 1 Wł. |
| 5082 | `0x42DB` | PV - przesunięcie chłodzenia | raw |  |  |
| 5083 | `0x42DC` | PV - przesunięcie grzania | raw |  |  |
| 5091 | `0x411C` | Sterowanie Smart Grid | enum |  | 0 Wył., 1 Wł. |
| 5092 | `0x42DD` | Smart Grid - przesunięcie grzania | raw |  |  |
| 5093 | `0x42DE` | Smart Grid - przesunięcie CWU | raw |  |  |
| 5094 | `0x411D` | Smart Grid - tryb CWU | enum |  | 0 Limit pompy ciepła (FSV 3021), 1 Grzałka dodatkowa do 70 C |

## Nieobecne w Magisie Combo

Na tej instalacji zawsze 65535 albo nigdy niewysyłane (dlatego poza domyślną konfiguracją): ciśnienia `0x8206/0x8208`, ssanie `0x821A`, temperatury nasycenia `0x829F/0x82A0`, EVI / podwójna rura / DSH `0x821C/0x821E/0x8220/0x827A`, sprężarka 2 `0x8276`, czujniki wody ODU `0x82DE-0x82E0` (65036), `0x4206`, `0x423E`, FR control `0x42F1`.
`0x42D4`, `0x42D6`, `0x42E9`, `0x4426`, `0x4427` są w katalogu, ale Magis Combo ich nie rozgłasza, a READ zwraca "niedostępne" (65535 / 0xFFFFFFFF) - płytka MIM nie ma przepływomierza ani pomiaru ciepła (pompą i przepływem zajmuje się płytka Immergasa). Na innych instalacjach mogą działać. Na Magisie bierz przepływ z magistrali T-/T+ (BMS) (D14).
