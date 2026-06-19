# UnityCloudCode

Production-quality proof-of-concept for Unity Cloud Code C# Module deployment with GitHub Actions CI/CD.

## Architecture

```
Unity Client
  └─► Cloud Code C# Module (BackpackAdventures)
        ├─► HealthCheck    — server connectivity
        ├─► PlayerEcho     — authenticated request roundtrip
        └─► ServerConfig   — server-side runtime config
```

Auto-deploy triggers on every push to `staging` via GitHub Actions.

## Repository Structure

```
CloudCodeModule/                  ← C# .NET 7.0 module (deployed to UGS)
  BackpackAdventures.ccmr         ← Cloud Code Module Reference (UGS CLI entry point)
  BackpackAdventuresModule.sln
  BackpackAdventuresModule/
    HealthCheckModule.cs
    PlayerEchoModule.cs
    ServerConfigModule.cs

UnityClient/                      ← Unity-side integration (copy into your Unity project)
  Runtime/
    BackpackCloudCodeService.cs   ← static service wrapper (HealthCheck, PlayerEcho, ServerConfig)
    CloudCodeModels.cs            ← response/request DTOs
    CloudCodeValidator.cs         ← per-field response validation
  Tests/
    CloudCodeIntegrationTest.cs   ← MonoBehaviour for Play Mode validation
  UnityClient.asmdef

.github/workflows/
  staging-deploy.yml              ← auto-deploys on push to staging

docs/
  DEPLOYMENT.md                   ← full setup and troubleshooting guide
```

## Quick Start

### 1. Configure GitHub Secrets

Configure these as GitHub repository secrets or GitHub Environment secrets for whichever environment runs the workflow:

| Secret | Where to find it |
|--------|-----------------|
| `UNITY_PROJECT_ID` | Unity Dashboard → your project → Settings → General → **Project ID** |
| `UNITY_ENVIRONMENT` | Unity Dashboard → your project → LiveOps → Environments → environment name |
| `UNITY_PROJECT_SERVICE_ACCOUNT_KEY` | Unity Dashboard > Organization > Settings > Service Accounts > project-scoped account > **Key ID** |
| `UNITY_PROJECT_SERVICE_ACCOUNT_SECRET` | Same page - **Secret Key** (shown only once at key creation, store immediately) |
`SendUserMail` smoke test uses the optional `workflow_dispatch` input `admin_test_player_id`; no extra secret is required.

**To create a service account:** Unity Dashboard > Organization > Settings > Service Accounts > Create service account > assign **Cloud Code Editor** only on this project > Add key.

### 2. Deploy

Push to `staging` — the pipeline runs automatically.

For manual local deploy:
```bash
npm install -g ugs
ugs login --service-key-id <UNITY_PROJECT_SERVICE_ACCOUNT_KEY> --secret-key-stdin <<< "<UNITY_PROJECT_SERVICE_ACCOUNT_SECRET>"
ugs config set project-id <UNITY_PROJECT_ID>
ugs config set environment-name <UNITY_ENVIRONMENT>
ugs deploy CloudCodeModule/BackpackAdventures.ccmr
```

### 3. Call from Unity

```csharp
// Requires Unity Services initialized + authenticated
await BackpackCloudCodeService.InitializeAsync();
var health = await BackpackCloudCodeService.CallHealthCheckAsync();
var echo   = await BackpackCloudCodeService.CallPlayerEchoAsync(playerId);
var config = await BackpackCloudCodeService.CallServerConfigAsync();
```

Add `CloudCodeIntegrationTest` MonoBehaviour to any GameObject to run all 3 APIs in Play Mode.

## API Contracts

All Cloud Code functions now return the same top-level envelope:

```json
{
  "StatusCode": 200,
  "Message": "OK",
  "Data": {}
}
```

`BackpackCloudCodeService` unwraps `Data` and keeps its existing method return
types for backward compatibility. Direct `CloudCodeService` callers can request
either `ApiResponse` for status-only handling or `ApiResponse<TData>` when they
need the typed data payload.

| Function | Input | Output |
|----------|-------|--------|
| `HealthCheck` | — | `ApiResponse<HealthCheckData>` |
| `PlayerEcho` | `playerId: string` | `ApiResponse<PlayerEchoData>` |
| `ServerConfig` | — | `ApiResponse<ServerConfigData>` |

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full documentation.

---

## Mailbox System

Cloud Save-backed in-game mail with global broadcast and targeted player delivery.

### Architecture

```
Unity Client
  └─► Cloud Code C# Module (BackpackAdventuresModule)
        ├─► SendGlobalMail  — admin broadcast or targeted mail via global_mail custom data
        ├─► SendUserMail    — backward-compatible admin targeted wrapper
        ├─► GetMailbox      — fetch merged mailbox with read/claim status [not yet deployed]
        ├─► MarkMailRead    — mark a mail as read [not yet deployed]
        └─► ClaimAttachment — claim attachment with idempotency guard [not yet deployed]

Cloud Save Keys:
  mails_all                (custom, project-wide) — all admin mail payloads as [{ Mail }]
  mail_meta_state          (player)               — per-player read/claim/delete metadata
  mailbox_user_items       (player)               — user-to-user GiftMail payloads
```

Admin mail payloads use `TargetUserIds = null` for broadcast. When `TargetUserIds`
contains player IDs, the same global payload is visible only to those players.
`EndTime = null` means the admin mail does not expire. In the Admin Mail editor,
choose `Null / no expiration` to send a null end time, or `Use UTC time` to send an
ISO 8601 expiration timestamp. Player data stores only `MailMetadata` for admin
mail state.
The player metadata JSON is written as `{ "MailMetadata": [...] }`; each item uses
`IsClaimed`, `IsRead`, and `IsDeleted`.

In **CloudCode > Admin Mail > Manage**, admin REST actions do not require Play Mode:
`Set EndTime` updates an existing global mail's end time, `Expire Global` sets it
to now, and `Delete Global` removes the matching `{ Mail }` object from `mails_all`.
New Cloud Save writes omit mailbox `"Version"` fields.

`ClaimAllAttachments` claims all visible, unexpired reward mails for the selected
scope (`all`, `global`, or `user`) and returns aggregate granted attachments plus
per-mail results. The Unity client exposes this through
`BackpackCloudCodeService.CallClaimAllAttachmentsAsync`.

### Mailbox API Quick Reference

| Function | Status | Input | Output |
|----------|--------|-------|--------|
| `SendGlobalMail` | Implemented | `{ targetUserIds?, subject, body, expiresAt?, attachments? }` | `{ globalMailId, sentAt }` |
| `SendUserMail` | Compatibility wrapper | `{ targetPlayerId/userId/targetUserIds, subject, body, expiresAt?, attachments? }` | `{ mailId, sentAt }` |
| `GetMailbox` | Implemented, not yet committed | — | `{ success, mails[] }` |
| `MarkMailRead` | Implemented, not yet committed | `{ mailIds[] }` | `{ success }` |
| `ClaimAttachment` | Implemented, not yet committed | `{ mailId }` or raw `"mailId"` in `request` | `ApiResponse<ClaimAttachmentData>` |
| `ClaimAllAttachments` | Implemented | `{ mailType?, requestId? }` | `ApiResponse<ClaimAllAttachmentsData>` |

### Quick Usage Example

```csharp
// Initialize once
await BackpackCloudCodeService.InitializeAsync();

// Send a global broadcast mail with an attachment
var response = await BackpackCloudCodeService.SendGlobalMailAsync(
    subject: "Maintenance Reward",
    body: "Thanks for your patience!",
    expiresAt: null, // no expiration; pass an ISO 8601 UTC string to expire it
    attachments: new List<MailAttachment>
    {
        new MailAttachment { type = "currency", id = "gem", amount = 50 }
    }
);
Debug.Log($"Mail broadcast: {response.mailId}");

// Send a targeted mail to a player
await BackpackCloudCodeService.SendUserMailAsync(
    userId: "player-uuid",
    subject: "Expedition Complete",
    body: "Your team returned safely.",
    expiresAt: null,
    attachments: null
);
```

See [docs/MAILBOX_API_USAGE.md](docs/MAILBOX_API_USAGE.md) for full API documentation, parameter details, and integration patterns.

See [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) for current limitations, unimplemented features, and known risks.

See [CHANGELOG.md](CHANGELOG.md) for detailed change history including design decisions and risk notes.

---

## Admin Web

Browser-based admin dashboard mirroring the Unity Editor **CloudCode > Admin Mail** window.
Operators can send global/targeted mail and manage (list / edit / expire / delete) global mails
without opening the Unity Editor.

### Live URL

```
Use the URL returned by the `deploy-adminweb.yml` Cloudflare Pages deploy step.
```

### One-time Cloudflare setup

1. Create the Pages project (dashboard **Workers & Pages**, or it is created
   on first deploy).
2. Ensure `CLOUDFLARE_API_TOKEN` has **Pages:Edit** permission.
3. Set the required GitHub repo secrets. The workflow syncs UGS secrets into
   Cloudflare Pages (production **and** preview) before each deploy.
4. Set the required GitHub repo **variables** (these are validated; the deploy
   fails early if missing or unexpected, and never auto-selects another project):

   | Variable | Value |
   |---|---|
   | `CLOUDFLARE_PAGES_PROJECT` | `adminweb-fza` |
   | `CLOUDFLARE_PAGES_CUSTOM_DOMAIN` | `global-mails.buzzle.dev` |
   | `CLOUDFLARE_PAGES_PRODUCTION_BRANCH` *(optional)* | defaults to `staging` |

The production branch no longer needs manual dashboard setup: the workflow
reconciles it via the Cloudflare API on every run, so the custom domain always
serves the newest build.

### Production promotion model

The custom domain (`global-mails.buzzle.dev`) only serves the Pages **production**
deployment — the latest deployment whose Wrangler `--branch` equals the project's
production branch. The workflow therefore **always** deploys with
`--branch=<production branch>` (default `staging`) instead of the raw source
branch, so both `staging` and `release/**` pushes promote to the custom domain.
The real source branch and commit SHA are preserved in the deployment metadata
and job summary.

### Deploy trigger

| Event | Condition |
|---|---|
| `push` to `staging` or `release/**` | Every push (no path filter) |
| `workflow_dispatch` | Manual trigger from the Actions tab |

All deploys serialize through one global production concurrency group so
`staging` and `release/**` runs cannot race.

Workflow file: `.github/workflows/deploy-adminweb.yml`

### Build contract

| Item | Value |
|---|---|
| Working directory | `AdminWeb/` |
| Install | `npm ci` |
| Build | `VITE_BASE=/ npm run build` |
| Output | `AdminWeb/dist/` |
| Vite base default | `./` (relative, for local dev) |
| Vite base (Pages) | `/` — injected via `VITE_BASE` env var at CI build time |
| API proxy | `/api/*` same-origin Cloudflare Pages Function |

### Runtime credentials — security model

The web app prompts the operator for the **Admin Proxy Token** on first use. The UGS service-account
Key ID and Secret live only as Cloudflare Pages secrets and are never written into the SPA bundle.
The operator token is stored in `sessionStorage` only and cleared when the browser tab is closed.

This is an internal operator tool with the same trust model as the Unity Editor AdminMailWindow.
The operator is responsible for keeping the proxy token secure.

**`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are required** by the AdminWeb workflow.
UGS Key/Secret are never in the SPA bundle — they live in the Pages Function only.
