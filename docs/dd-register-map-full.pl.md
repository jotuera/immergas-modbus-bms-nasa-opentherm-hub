# Mapa rejestrów — Immergas Magis Combo, magistrala D+/D-

[English](dd-register-map-full.md) · **Polski**

Powrót do [przeglądu protokołów](../README.pl.md).

**Urządzenie:** Immergas **Magis Combo 9 Plus V2** (firmware płyty głównej **6.0**). Magistrala RS-485 **D+/D-**, **9600 8E1**, **wymagana terminacja 120 Ω**.
**Role:** **kocioł jest masterem Modbus**, wszystkie pozostałe urządzenia są slave'ami. Kocioł cyklicznie czyta (func 03/04) i zapisuje (func 06/16).
**Źródła:** pasywny podsłuch (47 logów, 218 rejestrów), sniffer magistrali z v1.2.0, porównanie z magistralą **T-/T+ BMS** i magistralą **Samsung NASA F1/F2**, instrukcja Magis Combo (EN rev. 8.0 / PL rev. 5.0), instrukcja panelu zdalnego strefy **3.030863** oraz mapa ekranów aplikacji Dominus (`CFG-WFC01_IM_MBUS_MPROCOMBOV2.json`).

Pewność: **POTWIERDZONE** = sprawdzone na żywo (korelacja / druga magistrala / odczyt z panelu), **INSTRUKCJA** = dopasowane do opisu w instrukcji, **KAND.** = mocny kandydat, **?** = nieznane.
Kierunek: **R** = kocioł czyta z urządzenia (func 03), **I** = kocioł czyta rejestr wejściowy (func 04), **W** = kocioł zapisuje do urządzenia (func 06/16).
Kody z instrukcji: w instrukcjach PDF kolumna kodów jest **przesunięta względem opisów** (zawijanie wierszy), a numeracja różni się między wersjami firmware – kody są dopasowane **po opisie**; numery sprawdzone na żywo są oznaczone.

## Adresy
| Adres | Urządzenie | Uwagi |
|---|---|---|
| **0x1E** (30) | **Płytka interfejsu jednostki zewnętrznej** („A22” na schemacie elektrycznym; Samsung **MIM**, tryb OEM) | zawsze obecna; łączy płytkę Immergasa z magistralą Samsung NASA. Stan połączenia = kod z instrukcji **D62**. Nigdy do niej nie nadawaj. |
| **0x29** (41) | Panel zdalny strefy 1 | fizyczny albo emulowany; brak → **E121** |
| **0x2A / 0x2B** (42/43) | Panele stref 2 / 3 | tylko przy A13 > 1 |
| **0x33** (51) | **Dominus** (moduł Wi-Fi) | brak → **E142** |

## 0x1E — płytka interfejsu jednostki zewnętrznej (pompa ciepła)
Sprawdzone na **trzech magistralach** (D+/D-, T-/T+, NASA) w postoju i podczas wymuszonej pracy sprężarki. Temperatury ×0,1 °C.

| Rej | Kier. | Znaczenie | Kod | NASA / T-T+ | Skala | Pewność |
|---|---|---|---|---|---|---|
| 0 | W | **Żądanie pracy pompy ciepła** (0/1) | — | NASA Capacity Request | bit | POTWIERDZONE |
| 1 | R/W | **Zadana temperatura wody dla PC.** R1 = stała zadana (= D04 przy żądaniu, **5,0 °C w postoju**). W1 zachowuje się nietypowo: w każdym cyklu kocioł wysyła FC06 rej 1 = **0**, a MIM odpowiada nie echem, tylko wartością **50** (`1E 06 00 01 00 00` → `1E 06 00 01 00 32`), więc sniffer widzi „0 / 50”; prawdziwa zadana jest zapisywana tylko przy zmianie → używaj R1/I10. **CWU pompą ciepła**: W1 = **650** (65,0 °C) razem z 2001 bit 0 i W0 = 1; I17 (zadana tłoczenia) rośnie do 80 °C | — | NASA Water Outlet Target | ×0,1 °C | POTWIERDZONE (R1) |
| 2–6 | R | R2/R3/R5/R6 = 0, R4 = 1 (stałe) | — | — | — | ? |
| 15–18 | R | stałe 5 / 30 / 10 / 30 | T21–T24 (suszenie jastrychu)? | — | — | KAND. |
| 3 | I | **Temperatura tłoczenia sprężarki** | **D73** | NASA 820A, T-T+ 4554 | ×0,1 °C | POTWIERDZONE |
| 4 | I | **Temperatura parownika** (wymiennik jednostki zewnętrznej) | **D74** (na żywo) | NASA 8218, T-T+ D74 | ×0,1 °C | POTWIERDZONE |
| 5 | I | **Temperatura sondy jednostki zewnętrznej — SUROWA** (bez korekty P07); kocioł przekazuje ją ~2 s później jako 3002 **po uwzględnieniu P07** | **D79** | NASA 420C | ×0,1 °C | POTWIERDZONE |
| 6 | I | **Temperatura sprężarki** (korpus/góra) | **D72** | NASA 8280, T-T+ 4585 | ×0,1 °C | POTWIERDZONE |
| 10 | I | **Zadana temperatura wody** — potwierdzona przez PC | — | Water Outlet Target | ×0,1 °C | POTWIERDZONE |
| 11 | I | **Częstotliwość sprężarki** | **D71** (na żywo) | NASA Compressor Freq, T-T+ D71 | Hz | POTWIERDZONE |
| 12 | I | stałe 0 (postój i praca CO) | — | — | — | ? |
| 13 | I | **Prąd sprężarki** (szacunek falownika) | **D75** | NASA Outdoor Current | ×0,1 A | POTWIERDZONE |
| 14 | I | **Zadane obroty wentylatora** | **D76** (panel pewnie ÷10) | NASA Fan target, T-T+ 4587 | rpm | POTWIERDZONE |
| 15 | I | stałe 0 | — | — | — | ? |
| 16 | I | **Położenie EEV** (0–2000) | **D77** | NASA EEV, T-T+ D77 | kroki | POTWIERDZONE |
| 17 | I | **Zadana temperatura tłoczenia** (61–70 latem = CWU) | — | NASA Target Discharge | ×0,1 °C | POTWIERDZONE |
| 18 / 21 | I | stałe 1 | D78 (zawór 4-drogowy)? | — | — | KAND. |
| 19 | I | **Etap pracy**: 1 postój, 2 start, 3 praca | D80? | = NASA Start Stage 3 / 6 | enum | POTWIERDZONE (kod KAND.) |
| 20 | I | stałe 0 | — | — | — | ? |
| 22–29 | I | **Wersje firmware** (rejestr = 2 części jako pary dziesiętne): 22/23 płyta główna jednostki zewnętrznej (19.07.04.01), **24/25 falownik jednostki zewnętrznej (10.00.02.01)**, 26/27 pamięć falownika (19.04.10.01), **28/29 płytka interfejsu MIM (20.02.11.01)**. Kolejność rejestrów ≠ kolejność kodów w instrukcji. Przypisanie MIM/falownik: NASA 20.00.01 0x0608 (DB91-02164A) + naklejka na MCU MIM „D2164A 200211”; NASA 10.00.00 0x8601 (DB91-02338A) | D120–D135 (INSTRUKCJA) | NASA 0x0608 / 0x8601 | — | POTWIERDZONE (moduły) |
| 36 | I | **Flaga: sprężarka pracuje** | — | NASA Compressor Status (co do sekundy) | bit | POTWIERDZONE |
| 37 | I | stałe 0 | — | — | — | ? |
| 38 | I | **Flaga: wentylator pracuje** (gaśnie ~1 min po sprężarce) | — | — | bit | POTWIERDZONE |
| 40 | I | **Flaga: zlecenie przyjęte** (razem z W0) | — | — | bit | POTWIERDZONE |
| 2 | W (+ R 2, I 12 = echo MIM) | **Funkcja nocna (U11)** — ograniczenie sprężarki w oknie U12–U13: **30 = włączona, 0 = wyłączona**. Sprawdzone w obie strony (U11 ON → 30 w ~1 s na W2/I12/R2; U11 OFF → 0). **30 = limit mocy sprężarki w %** (30 % × 64 Hz ≈ 19 Hz). Skutek na magistrali Samsung NASA F1/F2: **0x8239 (górny limit Hz jednostki zewnętrznej) 64 → 19** około 6 min po starcie sprężarki, powrót do 64 ~40 s po W2 = 0; na D+/D- częstotliwość sprężarki (I11) spada do 18 Hz i odpowiednio wraca. **Wysyłane tylko w oknie U12–U13** (U11 ON z oknem 22–23: W2 = 0 do 22:00:11, potem 30; już pracująca sprężarka zeszła z 26 do 18 Hz w ciągu minuty), więc W2/I12 ≠ 0 znaczy „funkcja nocna aktywna teraz” | **U11** | % | wartość | POTWIERDZONE |
| 41 / 42 | I | stałe 0 / 1 | D78? | — | — | KAND. |
| 44–46 | I | stałe 0 | — | — | — | ? |
| 5 | W | stałe 0 (polecenie kotła) | — | — | — | ? |
| 20 | W | **Temperatura powrotu wody (TW1)** — kocioł przekazuje ją Samsungowi (jednostka zewnętrzna nie ma sond wody) | D08 (na żywo) | NASA Flow Temp Return | ×0,1 °C | POTWIERDZONE |
| 21 | W | **Temperatura zasilania wody (TW2)** | D20 (na żywo) | NASA 4204 TW2 | ×0,1 °C | POTWIERDZONE |
| 22 | W | **Temperatura czynnika w fazie ciekłej** | D24 (na żywo) | NASA EVA In | ×0,1 °C | POTWIERDZONE |

0x1E **nie przenosi** rzeczywistych obrotów wentylatora, mocy ani napięcia szyny DC (są tylko na NASA F1/F2). **D78** (zawór 4-drogowy HT/CL) nie jest jeszcze zlokalizowany – kandydatami są stałe flagi 18/21/41/42 (powinny się przełączyć przy chłodzeniu/odszranianiu).

## 0x29 — panel strefy 1
### Kocioł → panel (W): ten blok to 1:1 menu „Informacje” panelu (instrukcja 3.030863)
| Rej | Znaczenie | Kod | Skala | Pewność |
|---|---|---|---|---|
| 2000 | Tryb pracy (0 standby, 1 lato CWU, 2 chłodzenie, 3 zima CO+CWU) | — | enum | POTWIERDZONE |
| 2001 | **Flagi stanu** (pole bitowe): **bit 3 = moduł pompy ciepła obecny** (gaśnie przy A11 = OFF; w normalnej pracy zawsze 1); **bit 0 (8→9) = żądanie CWU w oczekiwaniu** – ustawiany ~9 min przed każdym cyklem CWU, kasowany, gdy zawór 3-drogowy przełączy się na CWU (15/15 przypadków); **bit 2 (8→12) = aktywna anomalia kotła (2100 ≠ 0)** – zgadza się co do sekundy zarówno z E193 „Urządzenie w trybie testowym” (menu serwisowe M), jak i z E121 „Brak panelu strefy 1”. Dominus: `mb-water-request` | bit 0 = D09 (żądanie CWU) | pole bitowe | POTWIERDZONE |
| 2010 | Stan / faza strefy (bit 2 ręczny, bit 3 żądanie grzania, bit 6 komfort, bit 7 eko; **wartość 1 = bit 0 podczas odpowietrzania U50**, razem z anomalią 139 „odpowietrzanie w toku”, 2000 → 0 i 2101 = 2) | — | pole bitowe | POTWIERDZONE |
| 2015 / 2016 / 2017 | Nastawa / maks. / offset strefy | — | ×0,1 °C | POTWIERDZONE |
| **2090** | **Stan programu czasowego** (odpowiedź kotła na 2294, ~5 s później): **4 = ręczny (bit 2), 64 = auto / faza komfort (bit 6), 128 = auto / faza eko (bit 7)** (64 → 128 widziane 3 s po przestawieniu zegara kotła za koniec okna komfortu). Otwarte pozostaje, czy śledzi program CO strefy 1, czy program CWU | — | pole bitowe | POTWIERDZONE (powiązanie), KAND. (zakres) |
| 2100 | Kod błędu (0 = brak, np. 142 = brak Dominusa) | — | enum | POTWIERDZONE |
| 2218 / 2219 | Maks. / offset strefy (kopie) | — | ×0,1 °C | POTWIERDZONE |
| 2293 | Temperatura CWU (kopia) | — | ×0,1 °C | POTWIERDZONE |
| **2300** | **Zegar kotła**: [dzień tygodnia 3 b][godzina 5 b][minuta 8 b], 1 = pon … 7 = niedz. Ustawiany U21–U26 na kotle. Na fw 5.03 zegar uwzględnia czas letni (0 min odchyłki względem czasu lokalnego, zgłoszone w PR #1); wcześniejsza uwaga „CET, bez czasu letniego” wzięła się z zegara kotła, który był po prostu źle ustawiony | **D140/D141/D142** | — | POTWIERDZONE |
| **2302** | **Data**: bajt wysoki = dzień, bajt niski = miesiąc | **D143/D144** | — | POTWIERDZONE |
| **2303** | **Rok** | **D145** | — | POTWIERDZONE |
| **3002** | Temperatura zewnętrzna **po korekcie sondy P07** (P07 = +5 K → 3002 skoczyło z 10,5 na 15,5, a surowe 0x1E I5 zostało bez zmian) | D06 | ×0,1 °C | POTWIERDZONE |
| **3003** | **Wyliczona nastawa zasilania** (krzywa grzewcza + U03; 0 bez żądania) | **D04** (na żywo) | ×0,1 °C | POTWIERDZONE |
| 3009 / 3010 | Temperatura / wilgotność pokojowa (echo panelu) | — | ×0,1 °C / % | POTWIERDZONE |
| **3011** | **Zasilanie generatora głównego (pompa ciepła)** | **D20** (na żywo) | ×0,1 °C | POTWIERDZONE |
| **3012** | **Powrót generatora głównego** | **D08** (na żywo) | ×0,1 °C | POTWIERDZONE |
| **3013** | **Zasilanie generatora dodatkowego (kocioł gazowy)** („Temp. zasilania 2”; CWU gazem → 65,6 °C) | D01 (pierwsza pozycja w instrukcji, niesprawdzone) | ×0,1 °C | POTWIERDZONE (kod INSTRUKCJA) |
| **3014** | **Powrót generatora dodatkowego** („Temp. powrotu 2”) | brak kodu D | ×0,1 °C | POTWIERDZONE |
| **3015** | **Aktywna nastawa CWU** używana przez kocioł (60 w czasie anty-legionelli) | D05 | ×0,1 °C | POTWIERDZONE |
| 3016 | Temperatura zasobnika CWU | D03 | ×0,1 °C | POTWIERDZONE |
| 3031 | Wersja firmware płytki (600 = 6.00) | D91 | ×0,01 | POTWIERDZONE |
| **6102** | **A31 „Termostat pokojowy strefy 1”** przekazywany do panelu: **RPT = 0, RP = 2**; ustawienie RT zostawiło 6102 na 0, więc RT najpewniej = 0 jak RPT (2 tylko wtedy, gdy panel jest jedynym termostatem). Zmiana A31 RPT → RP przełączyła 6102 z 0 na 2, a powrót RP → RPT z 2 na 0 (sprawdzone w obie strony) | **A31** | enum | POTWIERDZONE (RT = KAND.) |
| **6150** | **Moduł pompy ciepła obecny** (A11 ≠ OFF): 1 = tak, 0 = brak. Przy A11 = OFF spada do 0, 2001 bit 3 gaśnie, 3002 przechodzi na 0 (temperatura zewnętrzna pochodzi z jednostki zewnętrznej), a kocioł przestaje odpytywać 0x1E | **A11** | flaga | POTWIERDZONE |

### Panel → kocioł (R)
| Rej | Znaczenie | Pewność |
|---|---|---|
| 0 / 1 | 233 / 60 — pewnie stara (legacy) kopia temperatury / wilgotności pokojowej | KAND. |
| 2000 | Tryb pracy | POTWIERDZONE |
| 2005 / 2006 | **Temperatura / wilgotność pokojowa** (jedyne wartości, które kocioł bierze z panelu do regulacji) | POTWIERDZONE |
| 2015–2017 | Nastawa / maks. / offset | POTWIERDZONE |
| 2095, 2290–2292 | Nastawa CWU 2095 (D05); 2290 = CWU Komfort, 2291 = CWU Eko, 2292 = kopia 2095 – 2290 / 2291 należą do panelu | POTWIERDZONE |
| 2103 | stałe 0 | ? |
| **2294** | **„Programy czasowe aktywne” w panelu**: −1 = nie ustawiono, **0 = wyłączone (ręczny), 1 = auto**. Sprawdzone w obie strony; po podłączeniu panelu kocioł zapisuje 0 | POTWIERDZONE |
| **6105** | **Ustawienie panelu „modulacja sondą pokojową”** (Serwis → Definicja strefy): −1 = nie ustawiono (świeży panel), **0 = NIE, 1 = TAK**. Po podłączeniu panelu kocioł zapisuje 0. Sprawdzone TAK → 1 i NIE → 0 | POTWIERDZONE |
| **6107** | **„Korekta nastawy wg punktu rosy” w panelu** (1 = włączona, 0 = wyłączona). Wyłączenie i ponowne włączenie na panelu przełączyło 6107 1 → 0 → 1 (sprawdzone w obie strony) | POTWIERDZONE |
| 2210 / 2211 | Komfort / Eko grzania | POTWIERDZONE |
| 2214 / 2215 / 2216 | Komfort / Eko chłodzenia, ustawienie wilgotności | POTWIERDZONE |
| 2218 / 2219 | Maks. / offset (kopie) | POTWIERDZONE |
| 2310–2347 | Kalendarze 1–4 (profile wł./wył., wspólne dla wszystkich stref) | POTWIERDZONE |
| 2410–2416 | Dzień → kalendarz — strefa 1 | POTWIERDZONE |
| 2490–2496 | Dzień → kalendarz — CWU | POTWIERDZONE |
| 2707 | Eko chłodzenia (kopia) | POTWIERDZONE |
| 2295, 2701–2706, 2708, 6106 | Tylko MAGIS HERCULES PRO: ustawienia panelu, które kocioł zapisuje i odczytuje z powrotem. **Okno nocne: 2701 = włączone (1) / wyłączone (0), 2702 / 2703 = godzina początku / końca (0–23)** – godziny zostają po wyłączeniu; hub: *Okno nocne włączone / start / koniec (piec)*. 2704 / 2705 / 2706 najpewniej drugie okno w tej samej postaci; 2708 (190), 2295 (−1), 6106 (50) nierozszyfrowane | 2701–2703 POTWIERDZONE, reszta KAND. |
| 3042 | Wersja firmware panelu (201 = 2.01) | POTWIERDZONE |

**Set-flow 2217 jest czytany tylko z Dominusa (0x33)** — z panelu kocioł czyta 2214–2216 i 2218–2219, celowo pomijając 2217, więc panel (fizyczny czy emulowany) nie może sterować set-flow.

### Krzywa grzewcza → D04 (3003) → zadana wody PC (0x1E W1/I10)
Zweryfikowane testem wymuszonym (zmiany U03):
`D04 = R05 + (R03 − T_out) / (R03 − R02) × (R04 − R05) + U03`, przycięte do [R05, R04]; T_out = **0x1E I5** (sonda jednostki zewnętrznej).
Przy R02 = −12, R03 = 20, R05 = 24, R04 = 35 i T_out 15,5 °C: U03 = 0 → **25,5** (zmierzone 255), U03 = +4 → **29,5** (295), T_out 15,3 → **29,6** (296, 1 s po zmianie I5), U03 = −2 → 23,5 → przycięte do **24,0** (R05). **U03 przesuwa krzywą 1:1.** U03 pojawia się na magistrali jako 0x33 2017 / 2218 (×0,1 °C).

## 0x33 — Dominus
| Rej | Kier. | Znaczenie | Pewność |
|---|---|---|---|
| 2000 | R/W | Tryb pracy | POTWIERDZONE |
| 2001–2002 | W | Sprawdzanie obecności Dominusa [12, 0] / flagi stanu | POTWIERDZONE |
| 2010 / 2011 | W | Stan strefy / temperatura pokojowa (32767 = brak) | POTWIERDZONE |
| 2012 | W | stałe 0 (bez zmian po odłączeniu Dominusa i przy A30 = OFF) | ? |
| (zachowanie) | — | **Dominus odłączony**: anomalia **142** po ~3 min (2001 bit 2, 2100 = 142, 2101 = 2). **Ponownie podłączony**: Dominus najpierw odpowiada 2015–2017 = 0, a kocioł od razu **zapisuje z powrotem swoją zapamiętaną konfigurację** (2095, 2210–2211, harmonogram 2310–2347, 2410–2416). **A30 = OFF** (włączenie Dominusa): kocioł przestaje odpytywać 0x33 bez żadnej anomalii | POTWIERDZONE |
| 2015–2017 | R/W | Nastawa / maks. / offset strefy 1 (2017 = U03) | POTWIERDZONE |
| 2020–2025 / 2030–2035 / 2040–2045 | R | Stan, temperatura i nastawa stref 2 / 3 / 4 (mapa Dominusa) | POTWIERDZONE |
| 2095 | R/W | Nastawa CWU | POTWIERDZONE |
| 2100 / 2101 | W | Kod błędu / reset | POTWIERDZONE |
| 2210–2218 | R/W | Komfort/Eko grzania i chłodzenia, wilgotność, **set-flow 2217**, offset 2218 | POTWIERDZONE |
| 2220–2228 / 2230–2238 / 2240–2248 | R/W | To samo dla stref 2 / 3 / 4 | POTWIERDZONE |
| 2310–2347 | R/W | Kalendarze 1–4 | POTWIERDZONE |
| 2410–2416 / 2420–2426 / 2430–2436 / 2440–2446 | R/W | Dzień → kalendarz, strefy 1 / 2 / 3 / 4 | POTWIERDZONE |
| 2490–2496 | R/W | Dzień → kalendarz, CWU | POTWIERDZONE |
| 3002 / 3016 | W | Temperatura zewnętrzna / temperatura CWU | POTWIERDZONE |
| 3031 | W | Wersja firmware (60 = 6.0) | POTWIERDZONE |
| **4199** | W | **Liczba stref** (Dominus `mb-number-zones`) | **A13** — POTWIERDZONE |

## 0x2A / 0x2B — panele stref 2 / 3
Ten sam zestaw rejestrów co 0x29 (2005/2006, 2015–2017, 2210–2216, …), z wartościami danej strefy. Aktywne tylko przy A13 > 1.

## Błędy związane z magistralą
- **E121** — brak urządzenia strefy 1 (panel 0x29): kocioł blokuje sterowanie strefą 1; zmiany zrobione w Dominusie się nie utrzymują.
- **E142** — brak Dominusa (0x33).

## Anty-legionella (P15)
Parametr **P15** (włączenie anty-legionelli; P13 czas trwania, P16 godzina, P17 dzień) **nie jest przesyłany po D+/D-** – porównanie bazowych zapisów sniffera przy P15 = ON i P15 = OFF nie pokazało żadnej trwałej zmiany rejestrów poza nastawą CWU. Widać tylko **skutek**: aktywna nastawa CWU kotła w **3015** rośnie na czas cyklu. Do v1.1.0 emulator przejmował 3015 jako nastawę użytkownika i odsyłał ją jako panel, przez co nastawa zostawała zablokowana na 60 °C – naprawione w v1.2.0.

## Wciąż nieznane — pomoc mile widziana
- 0x1E: I15, I20, I37, I44–46, W5 (zawsze 0), R2–6, R15–18; flagi I18/21/41/42 – kandydaci na **D78** (potrzebne dane z chłodzenia albo odszraniania).
- **Rejestry, które kocioł CZYTA z panelu 0x29**: 2000, 2005–2006, 2015–2017, 2095, 2103, 2210–2211, 2214–2216, 2218–2219, 2290–2292, 2294, 2310–2347, 2410–2416, 2490–2496, 2707, 3042, 6105, 6107. Tylko nimi może sterować emulowany panel; **6102 (A31) nigdy nie jest czytany**, więc A31 nie da się ustawić z magistrali.
- 0x29: 2103 (2001: zdekodowane bity 0, 2 i 3; 6102 = A31, 6150 = moduł pompy ciepła obecny).
- 0x33: 2012.

Przełącznik **sniffer magistrali** w firmware loguje każdą zmianę rejestru (tag logu `sniff`) – zapis z chłodzenia, odszraniania albo CWU pompą ciepła pomógłby zamknąć pozostałe luki.

## Parametry integracji / serwisowe a D+/D-
Zmiana parametrów integracji gaz/pompa ciepła (I01–I10), A05, A12, A18, P07–P24, T02–T23, U11 albo wejście w menu serwisowe M na panelu kotła **nie zmienia** żadnego rejestru D+/D-, z wyjątkiem: **2001 bit 2 + błąd 2100 = E193** w trybie testowym (menu M) oraz **3002** po zmianie korekty sondy zewnętrznej **P07**. Parametry integracji są na magistrali T-/T+ BMS (zob. projekt siostrzany `immergas-magis-combo-tt-bms`).
