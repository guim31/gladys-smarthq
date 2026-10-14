# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration keeps, and where:

- the SmartHQ **refresh token**, with a SHA-256 fingerprint of the account (e-mail and region) it
  belongs to, in `/data/smarthq-auth.json`, readable by the container user only — never in the logs;
- the **access token** and the WebSocket address (which embeds a credential), in memory only — never
  in the logs;
- the SmartHQ **e-mail** and **password**, in the Gladys configuration (the password is a `secret`
  field: Gladys never sends it back to the browser). The password is not copied to `/data`.

Network: the container only talks to `accounts.brillion.geappliances.com` (sign-in and tokens, HTTPS),
`api.brillion.geappliances.com` (WebSocket address, HTTPS), the WebSocket address it gives (WSS), and
Gladys. It opens no port.

Sign-in: a refused password is never tried again until the configuration changes, a verification code
is only requested when the user runs the action, and new terms of use are never accepted on the user's
behalf.

Commands: the integration never starts nor sets an oven, a range or a water heater, never starts nor
resumes a dishwasher, and never drives a washer or a dryer. It only writes refrigerator setpoints
(within the appliance's limits), air conditioner settings, and the pause or stop of a dishwasher whose
remote control is enabled. A way around these rules is a vulnerability: please report it.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the SmartHQ cloud and the GE appliances.
