# TRIO HYDRO (Samsung outdoor unit + OpenTherm boiler) – testers wanted

**English** · [Polski](trio-hydro.pl.md)

Back to the [protocol overview](../README.md).

> **Planned – looking for testers.** There is no ready configuration for the TRIO HYDRO yet. This page collects what
> the Immergas manuals say about its buses and how the hub would connect. If you have a TRIO HYDRO (ELECTRIC or
> HYBRID 5 / 8 / 12) and would like to help, open an issue or write to me – the configuration is prepared together
> with the first installation.

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

| Part | |
|---|---|
| [M5Stack AtomS3 Lite](https://docs.m5stack.com/en/core/AtomS3%20Lite) | ESP32-S3 – one board for all buses, no ATOMIC PortABC needed |
| 1× M5Stack Isolated RS485 Unit | F1 / F2, in the AtomS3 Lite Grove port (RX GPIO1, TX GPIO2) |
| HYBRID: OpenTherm master + slave adapter | gateway – master on G6 / G5 to the boiler, slave on G8 / G7 to the indoor unit |
| optional: a second RS485 unit | the zone bus (Modbus 9600 8E1), only after the first logs |

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
