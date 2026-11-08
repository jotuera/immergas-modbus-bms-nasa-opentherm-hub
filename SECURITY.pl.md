# Bezpieczeństwo

[English](SECURITY.md) · **Polski**

Hub steruje kotłem i pompą ciepła. Problem z bezpieczeństwem zgłoś **prywatnie**, nie w publicznym zgłoszeniu:
przez *Report a vulnerability* na GitHubie (zakładka **Security** tego repozytorium). Odpowiedź w ciągu kilku dni.

Wspierane: najnowsze wydanie. Dobre praktyki dla urządzenia:
- klucz szyfrowania API, hasło OTA i login serwera WWW trzymaj w `secrets.yaml` (nigdy w YAML-u, który udostępniasz);
- zostaw włączone logowanie serwera WWW (`web_server: auth:`) – hub może przełączać kocioł i pompę ciepła;
- nie wystawiaj urządzenia do internetu; Home Assistant rozmawia z nim w sieci lokalnej.
