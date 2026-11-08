# Security

**English** · [Polski](SECURITY.pl.md)

The hub controls a boiler and a heat pump. Please report a security problem **privately**, not in a public issue:
use GitHub's *Report a vulnerability* (the **Security** tab of this repository). You get an answer within a few days.

Supported: the latest release. Good practice for your device:
- keep the API encryption key, the OTA password and the web server login in `secrets.yaml` (never in the YAML you share);
- keep the web server login on (`web_server: auth:`) – the hub can switch the boiler and the heat pump;
- do not expose the device to the internet; Home Assistant talks to it on the local network.
