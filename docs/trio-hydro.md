# TRIO HYDRO (Samsung outdoor unit + OpenTherm boiler) – testers wanted

**English** · [Polski](trio-hydro.pl.md)

Back to the [protocol overview](../README.md).

> **Planned – looking for testers.** The configuration is ready but not tested on a unit yet. This page collects what
> the Immergas manuals say about its buses and how the hub would connect. If you have a TRIO HYDRO (ELECTRIC or
> HYBRID 5 / 8 / 12) and would like to help, open an issue or write to me – we check and adjust the configuration
> together at the first installation.

The Immergas **TRIO HYDRO** is a monoblock heat pump system: the indoor unit (built-in or in a technical cabinet, 160 L
cylinder) with the **UE HYDRO HP 5 / 8 / 12** outdoor unit. The **HYBRID** version adds a **VICTRIX TERA 24 PLUS**
gas boiler that the indoor unit drives over OpenTherm. So it is another hub – the same packages, a different set of
buses than the MAGIS PRO / COMBO V2.

## Buses

From the Immergas manuals *TRIO HYDRO 5-8-12*, *TRIO HYDRO sistema HYBRID 5-8-12* and *UE HYDRO HP 5-8-12*:

| Link | Protocol | What the manuals show | Hub |
|---|---|---|---|
| Outdoor unit UE HYDRO HP ↔ outdoor-unit interface board (A22) | **Samsung NASA, F1 / F2** | terminals F1 / F2, keys K1–K4 with a 7-segment display (Tx / Rx), errors 101 / 201 / 202 / 203 – a Samsung EHS monoblock | `f1f2_` packages, listen first (as on the MAGIS PRO / COMBO V2) |
| Indoor unit ↔ boiler (HYBRID only) | **OpenTherm**, boiler terminals 41 – 44 | "Comunicazione OT con caldaia" | `ot_` packages as a **gateway**: the indoor unit stays the master, the hub sits in between |
| Indoor unit ↔ zone devices (zone panel, T / H sensor, Dominus) | **Modbus RTU, 9600 8E1**, indoor unit = master | zone panel address **41** (zone 1) / **42** (zone 2), T / H sensors 131 / 132 | hypothesis: the same zone panel protocol (0x29) the hub emulates on the MAGIS D+ / D- (`dd_` packages) |
| Interface board A22 ↔ main board | Modbus RS485, internal | error 111 "Errore di comunicazione MODBUS" | not used |

The indoor unit also has the parameter *Definizione impianto → Supervisione impianto = NO / Domin / BMS*. The manuals
give no register map or terminals for the BMS option, so it stays open.

## Hardware (planned)

**HYBRID** – one AtomS3 Lite with an ATOMIC PortABC: the OpenTherm gateway between the indoor unit and the boiler and
**two RS485 buses** – Samsung F1/F2 and the zone bus. That takes all 8 free GPIOs (2 OpenTherm shields × 2 signals +
2 RS485 × 2), so the 3.3 V for the shields comes from a small regulator, not from a GPIO.

| Part | Where |
|---|---|
| [M5Stack AtomS3 Lite](https://docs.m5stack.com/en/core/AtomS3%20Lite) + USB-C 5 V power supply | – |
| [M5Stack ATOMIC PortABC](https://botland.com.pl/seria-atom/23346-m5stack-atomic-portabc-extension-base-modul-rozszerzen-unit-do-modulow-deweloperskich-m5atom-m5stack-a130-6972934174567.html) | under the AtomS3 Lite |
| Grove cable + [Grove → 4-pin screw terminal](https://botland.com.pl/grove-konwertery-i-przetworniki/11348-grove-4-pinowe-zlacze-srubowe-5904422340063.html) | **port A** – the junction: GND and 5 V go both to the Master shield and to the regulator |
| [DIYLess Master OpenTherm Shield](https://diyless.com/product/master-opentherm-shield) | port A (G39 → D2, G38 → D1, GND) → boiler VICTRIX TERA, terminals 41 / 44 |
| 3.3 V regulator module: any AMS1117-3.3 module or the ready-made [Pololu D24V5F3, step-down 3.3 V 0.5 A](https://botland.com.pl/przetwornice-step-down/3109-d24v5f3-przetwornica-step-down-33v-05a-pololu-2842-5904422360115.html) (VIN / GND / VOUT) | IN ← 5 V of port A, GND common, **OUT → 3V3 of both shields** |
| [DIYLess Slave OpenTherm Shield](https://diyless.com/product/slave-opentherm-shield) | **port C** (G6 → D6, G5 → D7, GND, 5 V) → the indoor unit's OpenTherm output (the wires that went to the boiler) |
| [Grove → Dupont cables, 4-pin, female / male 2.54 mm](https://botland.com.pl/przewody-polaczeniowe-grove/21690-grove-zestaw-5-przewodow-4-pin-2mm-przewody-zenskiemeskie-254mm-20cm-6972934173751.html) | port C → Slave shield; the loose wires from the screw terminal to the Master shield and the regulator |
| [M5Stack Isolated RS485 Unit](https://botland.com.pl/moduly-unit-moduly-komunikacyjne/19118-izolowany-modul-nadawczo-odbiorczy-rs485-modul-rozszerzen-unit-do-modulow-deweloperskich-m5stack-5904422363673.html) no. 1 | **port B** (RX G8, TX G7) → F1 / F2, listening in parallel |
| [M5Stack Isolated RS485 Unit](https://botland.com.pl/moduly-unit-moduly-komunikacyjne/19118-izolowany-modul-nadawczo-odbiorczy-rs485-modul-rozszerzen-unit-do-modulow-deweloperskich-m5stack-5904422363673.html) no. 2 | **Grove AtomS3** socket next to USB-C (RX G1, TX G2) → zone bus (Modbus 9600 8E1), **120 Ω resistor across A-B** (as on the MAGIS D+/D- bus) |

![TRIO HYDRO HYBRID: OpenTherm gateway, F1/F2 and the zone bus on one AtomS3 Lite with the PortABC](images/en/trio-hydro-hybrid-wiring.png)

The TRIO HYDRO indoor unit is the OpenTherm master towards the boiler, the hub sits between them. The indoor unit has
its own mains supply, so the Slave shield does not have to power it. The `ot_3v3_supply` package is **not** used here –
G1 is taken by the zone bus and the regulator gives the 3.3 V. Shields and pins: [OpenTherm boilers](opentherm-hub.md#hardware).

**ELECTRIC** (no boiler) – no OpenTherm, so no shields and no regulator: the AtomS3 Lite with the PortABC and two
M5Stack Isolated RS485 Units on Grove cables, the ports as in the MAGIS PRO / COMBO V2 hub – **port A** zone bus
(RX G39, TX G38, 120 Ω across A-B), **port B** F1/F2 (RX G8, TX G7), port C free. F1/F2 alone needs only the Grove AtomS3 socket, no
PortABC.

<img src="images/en/trio-hydro-electric-wiring.svg" alt="TRIO HYDRO ELECTRIC: the hub on F1/F2 and the zone bus" width="100%">

**Without soldering, as two devices:** the ready-made [OT-thing](https://www.seegel-systeme.de/produkt/ot-thing/)
gateway (OpenTherm master + slave in a box, ESP32-C3) for the boiler side and an AtomS3 Lite with the RS485 units for
F1/F2 and the zone bus – a configuration for the OT-thing is not prepared yet.

## Configuration

| Version | Configuration file |
|---|---|
| **HYBRID** – OpenTherm gateway + F1/F2 + zone bus | [`examples/immergas-trio-hydro.yaml`](../examples/immergas-trio-hydro.yaml) ([open on GitHub](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/blob/main/examples/immergas-trio-hydro.yaml) · [download (raw)](https://raw.githubusercontent.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/main/examples/immergas-trio-hydro.yaml)) |
| **ELECTRIC** – F1/F2 + zone bus | [`examples/immergas-trio-hydro-electric.yaml`](../examples/immergas-trio-hydro-electric.yaml) ([open on GitHub](https://github.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/blob/main/examples/immergas-trio-hydro-electric.yaml) · [download (raw)](https://raw.githubusercontent.com/jotuera/immergas-modbus-bms-nasa-opentherm-hub/main/examples/immergas-trio-hydro-electric.yaml)) |

The pins match the diagrams above. Everything starts **passive** except the OpenTherm gateway (it relays the indoor
unit's frames to the boiler): F1/F2 with `f1f2_transmit: "false"` (listen only) and the zone bus emulation switches
off – the hub only listens. The `ot_3v3_supply` package is not used (the regulator gives the 3.3 V).

1. Copy the file into your ESPHome folder and add the secrets it uses to `secrets.yaml`: `wifi_ssid`, `wifi_password`,
   `immergas_trio_api_key`, `immergas_trio_ota_password`.
2. Flash (USB the first time) and add the device in Home Assistant.
3. Check the OpenTherm boiler and room unit connection (HYBRID) and the F1/F2 and zone bus sniffers in the
   diagnostics – then record the logs ([Collecting logs](collecting-logs.md)).

## What a tester would do

1. **Electric part first, read only.** The RS485 unit on F1 / F2 in parallel (it only listens), as on the
   [MAGIS PRO / COMBO V2](magis-pro-combo-v2.md#wiring). Compressor, refrigerant circuit, defrost, flow and outdoor
   temperatures, power – and a raw log of what the Samsung outdoor unit sends.
2. **HYBRID: the OpenTherm gateway** between the indoor unit and the VICTRIX TERA 24 PLUS (see
   [OpenTherm boilers](opentherm-hub.md#two-modes)): what the indoor unit asks the boiler for, flame, modulation, faults.
3. **The zone bus, recording only.** A log of the Modbus traffic between the indoor unit and the zone panel or Dominus,
   to check whether it matches the MAGIS zone panel map.

What to record: [Collecting logs](collecting-logs.md).

> ⚠️ The buses are inside the units and connect to mains-powered electronics. Disconnect the power before you open
> anything, and leave the wiring to someone qualified. Connecting third-party hardware may affect the warranty.
