# TRIO HYDRO (jednostka zewnętrzna Samsung + kocioł OpenTherm) – szukamy testerów

[English](trio-hydro.md) · **Polski**

Powrót do [przeglądu protokołów](../README.pl.md).

> **Planowany – szukamy testerów.** Gotowej konfiguracji dla TRIO HYDRO jeszcze nie ma. Ta strona zbiera to, co
> instrukcje Immergasa mówią o jego magistralach, i to, jak podłączyłby się hub. Jeśli masz TRIO HYDRO (ELECTRIC albo
> HYBRID 5 / 8 / 12) i chcesz pomóc, załóż zgłoszenie albo napisz do mnie – konfigurację przygotujemy razem przy
> pierwszej instalacji.

Immergas **TRIO HYDRO** to system z pompą ciepła monoblok: jednostka wewnętrzna (do zabudowy albo w szafce
technicznej, zasobnik 160 L) z jednostką zewnętrzną **UE HYDRO HP 5 / 8 / 12**. Wersja **HYBRID** dokłada kocioł
gazowy **VICTRIX TERA 24 PLUS**, którym jednostka wewnętrzna steruje po OpenTherm. To więc kolejny hub – te same
pakiety, inny zestaw magistral niż w MAGIS PRO / COMBO V2.

## Magistrale

Według instrukcji Immergasa *TRIO HYDRO 5-8-12*, *TRIO HYDRO sistema HYBRID 5-8-12* i *UE HYDRO HP 5-8-12*:

| Połączenie | Protokół | Co pokazują instrukcje | Hub |
|---|---|---|---|
| Jednostka zewnętrzna UE HYDRO HP ↔ płytka interfejsu jednostki zewnętrznej (A22) | **Samsung NASA, F1 / F2** | zaciski F1 / F2, przyciski K1–K4 z wyświetlaczem 7-segmentowym (Tx / Rx), błędy 101 / 201 / 202 / 203 – monoblok Samsung EHS | pakiety `f1f2_`, najpierw nasłuch (jak w MAGIS PRO / COMBO V2) |
| Jednostka wewnętrzna ↔ kocioł (tylko HYBRID) | **OpenTherm**, zaciski kotła 41 – 44 | „Comunicazione OT con caldaia” | pakiety `ot_` jako **bramka**: jednostka wewnętrzna zostaje masterem, hub siedzi pośrodku |
| Jednostka wewnętrzna ↔ urządzenia strefowe (panel strefy, czujnik T / H, Dominus) | **Modbus RTU, 9600 8E1**, jednostka wewnętrzna = master | adres panelu strefy **41** (strefa 1) / **42** (strefa 2), czujniki T / H 131 / 132 | hipoteza: ten sam protokół panelu strefy (0x29), który hub emuluje na D+ / D- w MAGIS (pakiety `dd_`) |
| Płytka interfejsu A22 ↔ płytka główna | Modbus RS485, wewnętrzny | błąd 111 „Errore di comunicazione MODBUS” | nieużywany |

Jednostka wewnętrzna ma też parametr *Definizione impianto → Supervisione impianto = NO / Domin / BMS*. Instrukcje nie
podają mapy rejestrów ani zacisków dla opcji BMS, więc ta droga zostaje otwarta.

## Sprzęt (planowany)

| Element | |
|---|---|
| [M5Stack AtomS3 Lite](https://docs.m5stack.com/en/core/AtomS3%20Lite) | ESP32-S3 – jedna płytka na wszystkie magistrale, ATOMIC PortABC niepotrzebny |
| 1× M5Stack Isolated RS485 Unit | F1 / F2, w gnieździe Grove AtomS3 Lite (RX GPIO1, TX GPIO2) |
| HYBRID: adapter OpenTherm master + slave | bramka – master na G6 / G5 do kotła, slave na G8 / G7 do jednostki wewnętrznej |
| opcjonalnie: drugi moduł RS485 | magistrala strefowa (Modbus 9600 8E1), dopiero po pierwszych logach |

## Co zrobiłby tester

1. **Najpierw część elektryczna, tylko odczyt.** Moduł RS485 na F1 / F2 równolegle (tylko słucha), jak w
   [MAGIS PRO / COMBO V2](magis-pro-combo-v2.pl.md#podłączenie). Sprężarka, obieg chłodniczy, odszranianie,
   temperatury zasilania i zewnętrzna, moc – i surowy log tego, co wysyła jednostka zewnętrzna Samsung.
2. **HYBRID: bramka OpenTherm** między jednostką wewnętrzną a VICTRIX TERA 24 PLUS (zobacz
   [Kotły OpenTherm](opentherm-hub.pl.md#dwa-tryby)): o co jednostka wewnętrzna prosi kocioł, płomień, modulacja, błędy.
3. **Magistrala strefowa, tylko nagrywanie.** Log ruchu Modbus między jednostką wewnętrzną a panelem strefy albo
   Dominusem, żeby sprawdzić, czy zgadza się z mapą panelu strefy MAGIS.

Co nagrać: [Zbieranie logów](collecting-logs.pl.md).

> ⚠️ Magistrale są wewnątrz urządzeń i łączą się z elektroniką zasilaną z sieci. Przed otwarciem odłącz zasilanie,
> a podłączenie zostaw osobie z uprawnieniami. Podłączenie sprzętu innej firmy może wpłynąć na gwarancję.
