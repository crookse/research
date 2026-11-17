# API Keys for Tenants Within Tenants: One Key per Endpoint, Precise Permissions

*A white paper* · Nov 16, 2026 · @Eric

## Executive summary

This paper proposes how API keys should work in a multi-tenant web application, where teams (tenants) can have their own groups of teams beneath them (sub-tenants). A sub-tenant is a team too, with the same kind of account, and it can have teams beneath it as well.

The idea fits in one sentence: **every key belongs to one tenant, works on one part of the API, and can do only the specific things it was given, never more than its tenant, or any tenant above it, is allowed to do.**

Every time a key is used, the system checks it against four limits:

1. **What the key was given.** The permissions chosen when the key was created.
2. **What the endpoint allows.** Each main section of the API has a fixed list of things a key for it could ever do.
3. **What the tenant is allowed.** Usually set by the tenant's plan or contract.
4. **What every tenant above it is allowed.** A sub-tenant can never do more than its parent.

The key can do only what passes all four. Because the check happens every time, a change at any level takes effect straight away, without editing a single key.

This meets all four requirements:

- **A separate key for each top-level endpoint.** A key made for `/invoices` doesn't work on `/reports`, or anywhere else.
- **Tenants can have tenants.** Tenants are arranged like a family tree. A child can never have more access than its parent, and if a parent is suspended or downgraded, everyone below it is affected immediately.
- **Precise permissions.** Keys are given specific actions, like "read invoices" or "export reports," and can be limited further by expiry date, location or usage.
- **A management dashboard.** Each tenant gets a dashboard to create, replace and cancel its keys and, if allowed, the keys of every tenant below it.

The rest of the paper explains the problem, why it matters and how the design works, then gives the technical detail engineers will need and a plan for building it.

## Problem statement

A typical multi-tenant web application has many top-level endpoints: the main sections of the API, such as `/invoices` and `/reports`. And its teams aren't all the same shape. A reseller has its own groups; a large company has divisions.

A typical API key works like a master key to a building: whoever holds it can open every door the tenant can. That's a poor fit here. It can't say "this key may only read reports, and only for this one division."

Here's where the usual approaches fall short:

| What teams usually do | The problem |
| --- | --- |
| One all-access key per tenant | If it leaks, everything the tenant can reach is exposed |
| Broad key types like "read-only" or "admin" | Too blunt: a tool that only needs to read reports can also read everything else |
| Treating every tenant as a separate island | A reseller or parent company can't see or manage keys for the groups and divisions it's responsible for |
| Copying permissions down to sub-tenants | The copies fall out of date: downgrade a parent, and its sub-tenants keep access they should have lost |
| Letting each part of the API check keys its own way | Rules get applied unevenly, and one missed check lets a key into places it shouldn't go |
| Managing keys through support tickets | Slow for teams, and old keys pile up without anyone noticing |

**The problem in one sentence:** every tenant, at every level, needs a way to create keys that work on just one endpoint, can do only what's needed, can never go beyond what any tenant above allows, and can all be managed from one place.

## Why this matters

An API key is like a password that never asks who's using it. Anyone who has it can use it, from anywhere, until someone cancels it. That makes key design one of the most important security decisions in the product.

- **Less damage when a key leaks.** Keys end up in code, chat messages, support tickets and lost laptops. If each key works on only one endpoint and for only a few actions, a leak means "someone could read one division's reports for a while," not "someone has the whole account."
- **Resellers and large teams can trust the platform with their own groups.** They'll only set up sub-tenants if they know a sub-tenant can never get more access than they have, and that they can see and stop what happens below them.
- **Changes take effect everywhere, immediately.** When a team downgrades, is suspended or leaves, every key below them is affected at once. Nobody has to remember to clean up.
- **Teams can help themselves.** With a dashboard, teams create, replace and cancel keys on their own instead of waiting on support, and they can spot keys nobody uses anymore.
- **Easier security reviews and audits.** Large teams and auditors ask the same questions: does each key have only the access it needs, are keys replaced regularly, and can it be shown who did what? This design answers yes to all three as part of everyday use.
- **Room to grow.** New endpoints, new permissions and new levels of tenants fit in without reissuing existing keys.

Without this design, the risk grows with every endpoint and every level of tenant added. Each one makes a single key more powerful, and makes it harder to know which keys exist and what they can do.

## Requirements

The four requirements are treated as rules the system enforces on its own, not guidelines people are merely expected to follow.

| # | Requirement | How the system guarantees it |
| --- | --- | --- |
| R1 | Each top-level endpoint is scoped and needs its own key | A key works only on the one endpoint it was made for. Using it anywhere else is refused. |
| R2 | Tenants can have tenants | Tenants are arranged in a tree, and a sub-tenant can never be allowed more than its parent. |
| R3 | Keys can be granularly scoped | Each key lists exactly which actions it can take, plus optional extra limits. |
| R4 | Dashboard per tenant and per sub-tenant | Each admin sees and manages exactly the tenants they're responsible for, and nothing else. |

The design also sets these goals:

- **Start with nothing.** A new key has no permissions until someone picks them, and works only for its own tenant unless deliberately set to reach further.
- **Nobody can hand out more than they have.** No one can create a key more powerful than their own access, and no tenant can go beyond the tenants above it.
- **Cancelling is fast.** Cancelling a key or suspending a tenant takes effect everywhere within a minute.
- **Everything is traceable.** Every key created, changed, used or cancelled can be traced to a person, a tenant and a time.
- **Checks are quick.** Checking a key adds less than 5 milliseconds to a request.
- **Keys are never stored in readable form.** Only a scrambled fingerprint of each key is kept, and the full key is shown once, when it's created.

## Key terms

| Term | What it means |
| --- | --- |
| Tenant | A team's account, with its own data, users and keys. |
| Sub-tenant | A team that sits under another team, like a team in a reseller's group or a division of a company. It works exactly like any other team. |
| Parent, ancestors | The tenant directly above a sub-tenant, and every tenant above that. |
| Subtree | A tenant plus everything below it. |
| Top-level endpoint | A main section of the API, named by the first part of its web address, like `/api/v1/invoices` or `/api/v1/reports`. Everything under that address belongs to it. |
| Permission (scope) | One specific action, written as thing:action, like `invoices:read` or `reports:export`. |
| Allowed permissions (entitlements) | The permissions a tenant may use, usually set by its plan. Never more than its parent's. |
| Endpoint limit (ceiling) | The fixed list of permissions a key for a given endpoint could ever have. |
| API key | A secret code that lets software use one endpoint for one tenant, with chosen permissions. |
| Reach | Whether a key acts only for its own tenant (`self`), also for the tenants directly below (`children`), or for everything below (`subtree`). |
| Extra limits (constraints) | Additional conditions on a key, such as an expiry date, allowed IP addresses or a cap on requests per minute. |
| Gateway | The API's front door: the server every request passes through first, where keys are checked. |
| Effective permissions | What a key can actually do at the moment it's used, after every check. |

## Tenants within tenants

Tenants are arranged like a family tree: each tenant has exactly one parent (except the one at the top) and can have any number of children. One rule governs the whole tree: **a tenant can never be allowed more than its parent.** Access can only stay the same or shrink further down the tree.

&#91;embedded content: tenant tree with entitlements · one key's effective permissions\]

Each box shows what that tenant is allowed, and every child's list fits inside its parent's. The highlighted key asks for two permissions but gets only one, because its tenant isn't allowed the other.

**Shape.** A typical tree looks like Platform → Reseller → Team → Sub-team, but it can be as deep as needed. A cap of 6 levels is recommended to keep things fast and the dashboard easy to navigate.

**How it's stored (for engineers).** The tree is stored in two ways, each suited to a different job:

- A **closure table** (`ancestor_id, descendant_id, depth`) answers "is B inside A's subtree?" with one indexed lookup. This is the hot path for authorization.
- A **materialized path** (e.g. Postgres `ltree`: `root.r12.c840`) makes subtree listings, breadcrumbs and sorting cheap for the dashboard.

Both are updated together whenever a tenant is added. Moving a tenant to a new parent (say, a team switching resellers) is a special, logged action: the system updates both records and rechecks every key under that tenant against its new parent.

**The rules.**

1. **Never more than the parent.** A sub-tenant can't be given a permission its parent doesn't have. The system refuses.
2. **Nothing is copied down.** A sub-tenant's access is worked out from the tenants above it every time a key is used. Take a permission away from a parent, and every tenant below loses it at once.
3. **Suspensions flow down.** If any tenant above is suspended, every key below it stops working, without the keys themselves being touched. Lift the suspension and they work again.
4. **Keys reach only downward.** A key can act for its own tenant and, if set up to, for tenants below. It can never act for a parent or a sibling.
5. **Reaching down is opt-in.** By default a key works only for its own tenant. Letting it act for tenants below needs a special permission (`tenants:act_on_descendants`).

**Who can see what.** By default, a parent's admins can see the details of keys below them (name, endpoint, permissions, last used) but never the keys themselves. A sub-tenant can choose to keep its keys private, in which case the parent sees only how many keys exist, though it can still cancel them in an emergency. Whether keys should be private by default is one of the open questions at the end.

## One key per endpoint

Each key is made for exactly one top-level endpoint, and that can never be changed later. The server, not the calling software, decides which endpoint a request is for.

**The endpoint list.** The system keeps a list of every top-level endpoint (`invoices`, `reports`, `billing`, `users` and so on). For each one, it records the permissions a key for it could ever have. For example, a `/reports` key might be limited to reading, exporting and scheduling reports. Even if a tenant is allowed to edit invoices, its `/reports` key can't, because editing invoices isn't on the `/reports` list.

**Matching requests to endpoints.** The first part of the web address decides the endpoint: `/api/v1/invoices/123/lines` belongs to `/invoices`. When a request comes in, the system tidies up the address (so tricks like `..` don't work) and checks that it matches the key's endpoint. If it doesn't, the request is refused. The few addresses that don't follow this pattern are assigned by hand, and any address not assigned to an endpoint is refused. The system never trusts the caller to say which endpoint it's using.

**Why separate keys?** One key per endpoint means:

- **A leak stays contained.** A key leaked from a reporting tool can't touch `/billing`.
- **Keys can be replaced independently.** Replacing the `/billing` key doesn't break anything that uses `/reports`.
- **It's clear who did what.** Logs show which endpoint, and so which tool, made each request.
- **Keys are easy to check.** Each endpoint's list of possible permissions is short, so it's easy to see whether a key makes sense.

The trade-off is more keys: a tool that uses three endpoints needs three keys. The dashboard, and the approach for web pages below, are designed to keep that manageable.

**Keys and web browsers.** Anything sent to a web browser can be seen by the person using it, so a secret key must never go there. If the application's own web pages need to call an endpoint, one of two approaches is used:

1. **Go through the application's server (recommended).** The application's server holds the keys and makes the calls. The browser only talks to that server, using the person's normal login.
2. **Hand out short-lived passes.** The server swaps a key for a pass that expires in 5 to 15 minutes and has the same permissions or fewer. Only that pass reaches the browser.

**Test and live keys.** Each endpoint gets separate keys for testing and for real use. The key itself shows which kind it is, and test keys can never touch real data.

**Adding or moving an endpoint.** Adding an endpoint means giving it a name and its list of possible permissions. Existing keys aren't affected, and tenants create keys for the new endpoint from the dashboard. Moving part of the API from one endpoint to another breaks every key that used it, so treat it like any other breaking change to the API and release it as a new version.

## Precise permissions

A key can do something only if every level says yes. Each time a key is used, the system asks five questions:

1. Was the key given this permission?
2. Does the key's endpoint allow it?
3. Is the tenant being acted for allowed it?
4. Is every tenant above that one allowed it?
5. Is the key allowed to act for that tenant at all (its reach)?

If any answer is no, the request is refused. So no single mistake, like ticking the wrong box when creating a key, can give a key more than every level allows.

**How permissions are written.** Each permission names a thing and an action, like `invoices:read`. A few add a detail, like `users:read:self`.

| Permission | What it allows |
| --- | --- |
| `invoices:read` | See invoices |
| `invoices:write` | Create and change invoices |
| `reports:export` | Download report data as files |
| `users:read:self` | See only the user the key belongs to |
| `keys:manage` | Manage API keys for the holder's own tenant |
| `keys:manage:descendants` | Manage API keys for tenants below the holder's tenant |
| `tenants:act_on_descendants` | Create keys that can act for tenants below the holder's tenant |

**Shortcuts.** `invoices:*` means "every invoice action this endpoint allows." There is no shortcut for "everything."

**Permissions that include others.** A short, published list covers these; for example, being able to change invoices includes being able to see them. The list is kept short and visible so nobody is surprised.

**Extra limits.** Any key can be narrowed further:

| Limit | Example | Checked by |
| --- | --- | --- |
| Specific records only | Only projects 12 and 19 | The database, on every query |
| Allowed locations | Only from the office network (`203.0.113.0/24`) | The gateway |
| Usage cap | 600 requests a minute | The gateway |
| Expiry date | 90 days after creation | The key check |
| Look but don't change | Read requests (`GET`) only | The gateway |
| Extra approval for sensitive permissions | A reason, plus a second person's sign-off | The dashboard, when the key is created |

**No one can give what they don't have.** When someone creates a key, they can pick only permissions they hold themselves, for a tenant they manage, that the endpoint and the tenant allow. The dashboard shows only those options.

**Checked live, every time.** Because permissions are worked out each time a key is used, taking something away from a parent, an endpoint or a tenant takes effect immediately, without editing any keys. The permissions listed on a key are the most it could ever do, not a promise that it always can.

## What a key looks like and how it's looked after

A key is a long random code. It is shown once, when it's created, and only a scrambled fingerprint of it is stored, so even the application's operators can't read it back.

**What's in a key.**

```
mtk_live_inv_7K3QX9PDM2RA_4fJ8wZqL0vT2yN6sB1cH9kR3mX5pD7aE_c1a9f2
│   │    │   │            │                                └ check digits, to catch typos
|   |    |   |            |                                
│   │    │   │            └ the secret: 32 random bytes
|   |    |   |       
│   │    │   └ public ID: safe to show in logs and the dashboard
|   |    |   
│   │    └ endpoint code (inv = /invoices): a hint for humans only
|   |
│   └ live or test
|
└ application marker, so leaked keys can be spotted automatically
```

An application-specific, recognisable start (here `mtk_`) lets services like GitHub spot the application's keys if someone publishes one by accident, so they can be cancelled automatically. The endpoint code is just a hint for people; the system always checks the endpoint recorded when the key was created.

**How keys are stored (for engineers).** Store the public ID as is, and the secret only as `HMAC-SHA256(pepper, secret)`. The secret is 256 random bits, so a fast keyed hash is enough; a slow password hash like bcrypt adds delay without adding safety. Keep the pepper in a key management service, versioned so it can be replaced, and compare hashes in constant time.

**Creating a key.** Whoever creates a key picks the tenant, the endpoint, a name, the permissions, its reach, any extra limits and an expiry date. The system checks they're allowed to give those permissions, saves the key, logs who created it, and shows the full key exactly once.

**A key's life.**

| Status | What it means | What can happen next |
| --- | --- | --- |
| Active | Works normally | It can be replaced, cancelled or expire |
| Being replaced | A new key exists; old and new both work for a short overlap (24 hours by default, 7 days at most) so nothing breaks | The old key is cancelled automatically when the overlap ends |
| Expired | Past its expiry date; no longer works | Nothing; it's finished |
| Cancelled | Turned off by a person or automatically; no longer works | Nothing; it's finished |

Keys are never deleted, so the history stays complete for audits.

**Recommendations:**

- Keys expire after 90 days by default and never last more than a year. A tenant can set a shorter maximum for itself and everyone below it, but not a longer one.
- Keys unused for 30 days are flagged. After 90 days unused they're cancelled, unless the tenant turns this off.
- Replacing a key creates a new one with exactly the same settings, so replacing a key can never quietly give it more access.
- Cancelling a key tells every server straight away, rather than waiting for stored copies to time out.
- Suspending a tenant doesn't change its keys; they simply stop working. Lift the suspension and they work again as before.

## What happens when a key is used

Every request goes through the same ten checks, in order. The first one that fails stops the request and records why. The codes in brackets are the error each failure returns.

1. **Is it a real key?** It must arrive in the request's `Authorization` header, never in the web address, and have the right format (`401 malformed_key`).
2. **Is the key known?** Look it up by its public ID (`401 unknown_key`).
3. **Is the secret right?** Compare its fingerprint with the stored one (`401 invalid_key`).
4. **Is it still valid?** It must not be cancelled or expired (`401 key_revoked`, `401 key_expired`).
5. **Is its tenant in good standing?** The key's tenant and every tenant above it must be active (`403 tenant_suspended`).
6. **Is it the right endpoint?** The request must be for the key's endpoint (`403 endpoint_mismatch`).
7. **Is it acting for an allowed tenant?** If the request is for another tenant, that tenant must be below the key's tenant and within its reach (`403 tenant_out_of_reach`).
8. **Does it have the permission?** The action must be among the key's effective permissions for that tenant (`403 insufficient_scope`, naming what's missing).
9. **Does it meet its extra limits?** Allowed locations, allowed request types and usage cap (`403 ip_not_allowed`, `429 rate_limited`).
10. **Pass it on safely.** The request goes through with a signed note of which tenant it's for and what it may do. The database also filters every query by tenant (using Postgres row-level security), so even a bug in the application code can't show one tenant another's data.

Afterwards, in the background, the system records when the key was last used and updates its usage counts.

**Speed.** Most of these checks use information kept in memory for 30–60 seconds, and cancelled keys are cleared from memory immediately. That makes the whole check a few lookups and one calculation, well under the 5-millisecond target.

**Careful error messages.** The caller is told why a request failed, but the key is never repeated back, and an unknown caller is never told whether a key ID exists.

## Data model (for engineers)

Ten database tables hold everything. The example below is written for Postgres but works in other databases with small changes.

```sql
CREATE TABLE tenants (
  id            uuid PRIMARY KEY,
  parent_id     uuid REFERENCES tenants(id),      -- NULL for roots
  name          text NOT NULL,
  path          ltree NOT NULL,                    -- materialized path
  depth         smallint NOT NULL CHECK (depth <= 6),
  status        text NOT NULL CHECK (status IN ('active','suspended','closed')),
  private_keys  boolean NOT NULL DEFAULT false,
  max_key_ttl   interval NOT NULL DEFAULT '365 days',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_closure (
  ancestor_id   uuid REFERENCES tenants(id),
  descendant_id uuid REFERENCES tenants(id),
  depth         smallint NOT NULL,                 -- 0 = self
  PRIMARY KEY (ancestor_id, descendant_id)
);

CREATE TABLE scopes (
  name          text PRIMARY KEY,                  -- 'invoices:read'
  resource      text NOT NULL,
  action        text NOT NULL,
  description   text NOT NULL,
  sensitive     boolean NOT NULL DEFAULT false     -- needs step-up approval
);

CREATE TABLE scope_implications (
  scope         text REFERENCES scopes(name),
  implies       text REFERENCES scopes(name),
  PRIMARY KEY (scope, implies)
);

CREATE TABLE endpoints (                           -- top-level endpoints
  id            uuid PRIMARY KEY,
  slug          text UNIQUE NOT NULL,              -- 'invoices' = /api/v1/invoices/**
  code          char(3) UNIQUE NOT NULL,           -- 'inv', used in key prefix
  name          text NOT NULL,
  status        text NOT NULL
);

CREATE TABLE endpoint_route_overrides (           -- routes outside the /<slug>/** pattern
  route_pattern text PRIMARY KEY,                  -- e.g. '/api/v1/exports/reports/**'
  endpoint_id   uuid NOT NULL REFERENCES endpoints(id)
);

CREATE TABLE endpoint_scope_ceiling (
  endpoint_id   uuid REFERENCES endpoints(id),
  scope         text REFERENCES scopes(name),
  PRIMARY KEY (endpoint_id, scope)
);

CREATE TABLE tenant_entitlements (
  tenant_id     uuid REFERENCES tenants(id),
  scope         text REFERENCES scopes(name),
  PRIMARY KEY (tenant_id, scope)
  -- trigger: reject if parent lacks the scope
);

CREATE TABLE api_keys (
  id              uuid PRIMARY KEY,
  public_id       char(12) UNIQUE NOT NULL,
  secret_hash     bytea NOT NULL,
  pepper_version  smallint NOT NULL,
  environment     text NOT NULL CHECK (environment IN ('live','test')),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  endpoint_id     uuid NOT NULL REFERENCES endpoints(id),  -- immutable
  name            text NOT NULL,
  reach           text NOT NULL DEFAULT 'self' CHECK (reach IN ('self','children','subtree')),
  constraints     jsonb NOT NULL DEFAULT '{}',         -- ip_cidrs, methods, rate_limit, resource_filter
  status          text NOT NULL CHECK (status IN ('active','rotating','revoked','expired')),
  expires_at      timestamptz NOT NULL,
  rotated_from_id uuid REFERENCES api_keys(id),
  created_by      uuid NOT NULL,                       -- user id
  created_by_tenant uuid NOT NULL REFERENCES tenants(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  revoked_reason  text
);

CREATE TABLE api_key_scopes (
  key_id        uuid REFERENCES api_keys(id),
  scope         text REFERENCES scopes(name),
  PRIMARY KEY (key_id, scope)
  -- trigger: reject if scope not in the key's endpoint ceiling
);
```

Activity records go into a separate store that can only be added to, never edited (see Keeping a record). Usage counts live in their own store too, so the main key table stays small and fast.

Two database rules back up the application, so the most important guarantees hold even if the application has a bug: a tenant can't be allowed more than its parent, and a key can't hold a permission its endpoint doesn't allow.

## The management dashboard

The dashboard is built around the tenant tree. Pick a tenant on the left, and everything on the right shows that tenant. Flip a switch to include every tenant below it too.

**Who can do what.** Dashboard roles follow the same rule as everything else: nobody can be given more than the person granting it has.

| Role | Can do | Permissions behind it |
| --- | --- | --- |
| Tenant owner | Everything for their tenant and those below it, including creating sub-tenants and choosing what they're allowed | `keys:manage`, `keys:manage:descendants`, `tenants:manage` |
| Key admin (whole tree) | Create, replace and cancel keys for their tenant and every tenant below | `keys:manage`, `keys:manage:descendants` |
| Key admin (own tenant) | Create, replace and cancel keys for their own tenant only | `keys:manage` |
| Developer | Create and replace their own keys, within rules an admin sets | `keys:create:own` |
| Auditor | See keys and the activity log for their tenant and those below, without changing anything | `keys:read`, `audit:read` |

Admins of a sub-tenant see their own tenant as the top of the tree. They never see the tenant above them, or their siblings.

**Screens.**

1. **Overview.** For the selected tenant (and, optionally, everything below it): active keys by endpoint, keys expiring in the next 14 days, keys unused for 30 days or more, keys with sensitive permissions, and spikes in failed requests. Each item links to the matching keys.
2. **Tenant tree.** An expandable tree showing each tenant, its status and how many keys it has, with search. Picking a tenant here changes what every other screen shows.
3. **Coverage grid.** Tenants down the side, endpoints across the top. Each square shows how many active keys exist, and highlights gaps (a tenant that could use an endpoint but has no key) and extras (more keys than the rules allow).
4. **Key list.** Every key with its name, endpoint, test or live, permissions, reach, creator, created date, last used, expiry and status. Filter by any of these, including "unused for N days." Replace or cancel many keys at once, or export the list.
5. **Create a key.** A step-by-step guide:
   1. Choose the tenant (only tenants the creator manages are shown).
   2. Choose the endpoint (only endpoints the tenant can use are shown).
   3. Choose permissions, grouped by area. Only permissions the creator is able to give are shown. Sensitive ones are marked and need approval.
   4. Choose reach: own tenant only by default. Wider options appear only if the creator is allowed to grant them.
   5. Add limits: expiry (pre-filled with the tenant's default), allowed IP addresses, usage cap, specific records.
   6. Check a plain-English summary, for example: "This key can read and export reports for Acme EU on the /reports endpoint, from 203.0.113.0/24, until 14 Feb 2027."
   7. Copy the key. It's shown once and can't be shown again.
6. **Key details.** What the key can actually do right now for each tenant it can reach (including anything taken away by a tenant above), a usage chart, recent requests, its history, and buttons to replace it, cancel it, or change its name and limits. Permissions can be removed from a key, but adding one means creating a new key.
7. **Sub-tenants.** Create sub-tenants, choose what they're allowed (only from what the parent is allowed), set their rules (longest key life, automatic cancelling, private keys), and suspend or reinstate them.
8. **Activity log.** Filter by tenant, person, key, endpoint and type of event, and export it.
9. **Rules.** Default settings that flow down to every tenant below: longest key life, required IP limits for sensitive permissions, maximum keys per endpoint and replacement reminders. A sub-tenant can make these stricter, never looser.

**Alerts.** Email and webhook alerts go to the tenant (and to its parent, if set up) when a key is created, a sensitive permission is given, a key is about to expire, a key is cancelled, a key is found published online, or a key is used in an unusual way.

## Risks and mitigations

The two biggest risks are a key leaking and a sub-tenant somehow getting more access than its parent. The design limits the damage from the first with narrow keys and fast cancelling, and rules out the second entirely.

| Risk | Example | Mitigation |
| --- | --- | --- |
| A key leaks | Someone publishes a key in public code or pastes it into a support ticket | Narrow keys for one endpoint; a recognisable format so leaked keys are spotted and cancelled automatically; IP limits; expiry dates |
| A sub-tenant gets more than its parent | A sub-tenant's admin tries to give a key a permission the parent doesn't have | Blocked when the key is created, by the database, and again every time the key is used |
| A key reaches into another tenant | A key for one tenant asks for another tenant's data | Every request is checked against the tenant tree, and the database filters every query by tenant |
| A key is used on the wrong endpoint | A `/reports` key used on `/billing` | The server works out the endpoint from the address and ignores what the caller claims; unassigned addresses are refused |
| A key ends up in a web page | A secret key included in a page's code | Keys stay on the server, or only short-lived passes reach the browser; keys in web addresses are refused |
| The database is stolen | An attacker copies the key table | Only scrambled fingerprints are stored, and the secret needed to check them is kept separately |
| Guessing keys | An attacker tries random keys | Keys are far too long to guess; repeated failures from one place are slowed down; every failure looks the same |
| Forgotten keys | A key made by someone who has left still works | Keys expire by default, unused keys are cancelled, and owners are alerted when a key's creator leaves |
| A parent oversteps | A reseller's admin acts inside a team's account | Reaching into sub-tenants is off by default and always logged; sub-tenants can keep keys private and see the activity log |
| Cancelling is slow | A cancelled key keeps working for a while | Cancelling notifies every server immediately |

Day-to-day practices should also include replacing the secret used for fingerprints once a year, reviewing who has access every quarter using the dashboard's export, requiring two-step login for anyone who can create keys, and having outside testers specifically try to cross tenant boundaries.

## Keeping a record

Every change to a key or tenant is written to a permanent log, and every request is counted, so it's always possible to answer: who did what, with which key, for which tenant, and when?

**What's logged.** The log can only be added to, never edited, and is protected so any tampering would show. It records:

- **Key events:** created, replaced, cancelled, expired, limits changed, permissions removed.
- **Tenant events:** created, moved to a new parent, suspended, reinstated, allowed permissions changed.
- **Security events:** a sample of refused requests with the reason, and keys found published online.

Each entry says who did it, from which tenant, for which tenant, with which key and endpoint, what changed, from where and when. A tenant can see its own entries, and admins above it can see them too if they have permission to (`audit:read`).

**Usage.** For each key, the system tracks requests, errors and their reasons, response times, where requests come from and when it was last used. These power the dashboard's "unused," "unusual" and "expiring" views.

**Sending logs elsewhere.** Teams can stream their log to their own security tools, limited to their tenant and those below it.

**Compliance.** This design gives auditors what they typically look for: keys with only the access they need, regular key replacement, access reviews, complete activity records and strict separation between tenants. Keep logs as long as the strictest applicable requirement says; at least 1 year readily available and 7 years archived is recommended.

## Plan and open questions

Building this in four stages is recommended, so the security foundations are in place and tested before tenants can manage other tenants.

| Stage | What gets built | Done when |
| --- | --- | --- |
| 1. Foundations | The tenant tree, the endpoint list, permissions, creating keys, the ten checks and the activity log | Every part of the API belongs to an endpoint, and tests confirm keys can't cross endpoints, tenants or permissions |
| 2. Dashboard for one tenant | Key list, creating keys, key details, overview, activity log | Admins can manage their keys entirely from the dashboard |
| 3. Tenants within tenants | Managing sub-tenants, choosing what they're allowed, tree-wide views, the coverage grid, roles, rules that flow down | Outside security testers confirm parent and sub-tenant admins see exactly what they should, and nothing more |
| 4. Hardening | Automatic leak detection, unusual-use alerts, log export, short-lived passes for web pages, yearly secret replacement | In a practice run, a leaked key is cancelled within 5 minutes |

**Open questions.**

- [ ] Should parents see their sub-tenants' keys by default, or should keys be private by default?
- [ ] Can a sub-tenant buy extra permissions its parent doesn't have, or is "never more than the parent" absolute?
- [ ] Is a 6-level limit on the tree enough for the expected resellers and large teams?
- [ ] Should a tenant have exactly one test key and one live key per endpoint, or a few (say 3) to make replacing keys simpler?
- [ ] Which endpoints are called from the application's own web pages, and so need the server-side or short-lived-pass approach?
- [ ] Should people sign in to the dashboard with these keys, or only with their normal company login (SSO)?
