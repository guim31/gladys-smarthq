# SmartHQ fixtures

One file per appliance: the entry of the appliance list (`applianceId`, `nickname`, `online`) and the
answer to the full ERD read (`GET /v1/appliance/<mac>/erd`), as `{ code: hex value }`.

**Where the values come from.** Neither gehomesdk (simbaja/gehome, MIT) nor the Home Assistant
integration `ge_home` (simbaja/ha_gehome, MIT) publishes complete dumps of real appliances: their tests
cover a few converters only. These values were therefore **built by hand to the byte layouts of
gehomesdk's converters** (`gehomesdk/erd/converters/`), with the codes of `erd_codes.py` and the
appliance types of `ErdApplianceType`. They exercise every decoder of the integration, they are not
captures. `scripts/probe.mjs --dump` prints the same shape from a real account (MAC addresses and serial
numbers masked) to replace them with real answers.

All identifiers are invented: the MAC addresses (`D828C9000A01`…), the model and serial numbers belong
to no real appliance.

| File                   | Type (ERD 0x0008)           | What it shows                                               |
| ---------------------- | --------------------------- | ----------------------------------------------------------- |
| `washer.json`          | `02` washer                 | running, "Normal or mixed load", 45 min left, door closed   |
| `dryer.json`           | `01` dryer                  | cycle finished, blocked vent alert                          |
| `washer_dryer.json`    | `17` washer-dryer           | idle, no nickname, door open                                |
| `dishwasher.json`      | `06` dishwasher             | main wash, 52 min left, rinse aid low, remote control on    |
| `wall_oven.json`       | `07` double wall oven       | upper baking at 350 °F (340 °F reached), lower off, a timer |
| `range.json`           | `08` electric range         | single cavity, preheating to 400 °F                         |
| `fridge.json`          | `03` refrigerator           | 37 °F / 0 °F, limits, water filter to order (15 %)          |
| `beverage_center.json` | `19` beverage center        | no freezer (0x80 and invalid limits)                        |
| `window_ac.json`       | `0A` window air conditioner | cooling to 72 °F, medium fan, filter to clean               |
| `portable_ac.json`     | `16` portable AC            | off, heat mode available, 64-86 °F range                    |
| `water_heater.json`    | `00` GeoSpring water heater | hybrid mode, 114 °F, setpoint 120 °F                        |
| `ice_maker.json`       | `1B` Opal ice maker         | making ice                                                  |
| `toaster_oven.json`    | `22` toaster oven           | not supported: must not be published                        |
