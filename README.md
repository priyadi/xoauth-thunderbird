# XOAuth Thunderbird

Thunderbird's built-in OAuth2 support is usually hardcoded to major providers (Google, Microsoft, etc.). This extension lets you use OAuth2 with any mail server that provides its own configuration via the standard Autoconfig XML format.

### What it does
*   **Automatic Discovery**: Hooks into Thunderbird's account setup process. When you enter your email, the extension checks for an `<oAuth2>` block in the Autoconfig XML (from `autoconfig.yourdomain.com` or the domain's well-known paths).
*   **Dynamic Registration**: If an OAuth2 config is found, the extension registers it on the fly so Thunderbird can actually handle the login prompt.
*   **Background Maintenance**: Monitors your existing accounts. If you have an account that needs an OAuth2 provider that hasn't been registered yet, it will try to fetch and register it in the background.
*   **Caching**: Caches discovered configurations in preferences to avoid redundant network requests and speed up subsequent account setups.

### Why?
Many private or enterprise mail servers support OAuth2/OIDC, but since they aren't "famous," Thunderbird doesn't know which URLs to use for the login popup. This extension bridges that gap by reading the `<oAuth2>` tags directly from the server's own autoconfig file.

### Installation / Usage
1.  Download the `.xpi` from the Releases page.
2.  In Thunderbird, go to **Add-ons and Themes** -> Gear Icon -> **Install Add-on From File**.
3.  Add your email account as usual. If your server provides the correct XML config, the "OAuth2" authentication method will now work instead of failing.

### Server-Side Configuration

For this extension to pick up your settings, your mail server's `config-v1.1.xml` (hosted at `https://autoconfig.yourdomain.com/mail/config-v1.1.xml`) needs to include an `<oAuth2>` block.

Here is a minimal example of a compatible configuration:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="example.com">
    <domain>example.com</domain>

    <incomingServer type="imap">
      <hostname>imap.example.com</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <authentication>OAuth2</authentication>
      <username>%EMAILADDRESS%</username>
    </incomingServer>

    <!-- Optional: CalDAV / CardDAV. The extension reads the <serverURL>
         hostnames here and registers them for OAuth2 too, so Thunderbird
         offers OAuth2 when you add a calendar or address book. -->
    <calendar type="caldav">
      <serverURL>https://dav.example.com/dav/calendars</serverURL>
      <username>%EMAILADDRESS%</username>
      <authentication>OAuth2</authentication>
    </calendar>
    <addressBook type="carddav">
      <serverURL>https://dav.example.com/dav/addressbooks</serverURL>
      <username>%EMAILADDRESS%</username>
      <authentication>OAuth2</authentication>
    </addressBook>

    <!-- This block is what the extension looks for -->
    <oAuth2>
      <issuer>https://auth.domain.com/application/o/mail/</issuer>
      <scope>openid email offline_access</scope>
      <authURL>https://auth.domain.com/application/o/authorize/</authURL>
      <tokenURL>https://auth.domain.com/application/o/token/</tokenURL>
      <clientId>your-client-id-here</clientId>
      <!-- Optional: <clientSecret>...</clientSecret> -->
    </oAuth2>
  </emailProvider>
</clientConfig>
```

#### CalDAV / CardDAV

Thunderbird resolves OAuth2 for calendars and address books through the same
`OAuth2Providers` registry it uses for mail, looked up **by hostname**. If your
DAV server runs on a different hostname than IMAP/SMTP (e.g. `dav.example.com`),
add a `<calendar type="caldav">` and/or `<addressBook type="carddav">` block
with a `<serverURL>`; the extension extracts the hostname and registers it
against the same `<oAuth2>` issuer. When you then add a calendar/address book
pointing at that host, Thunderbird offers OAuth2 and reuses the mail token.

Notes:
*   Discovery is separate from auth — add the calendar/address book the normal
    way (manual URL, or DNS SRV / `.well-known` discovery). OAuth2 applies once
    the URL is on a registered hostname.
*   Thunderbird prefers a saved password login for a DAV origin over OAuth2 if
    one exists, so use OAuth2 on a fresh setup.
*   The IdP receives the same `<scope>` as mail. If your DAV resource server
    requires a dav-specific scope, include it in the shared `<scope>` value.

### How it works

This is a [MailExtension Experiment](https://developer.thunderbird.net/add-ons/mailextensions/experiments) that uses privileged APIs to extend Thunderbird's core functionality.

#### Architecture

The extension consists of several modular components loaded into isolated JavaScript sandboxes:

1.  **Config Cache** (`config-cache.js`): Manages persistent storage of OAuth2 configurations using Thunderbird's preference system (`extensions.xoauthtb.cache.*`). Cached configs include metadata like timestamps to enable stale-cache detection and background refreshes.

2.  **OAuth Registry** (`oauth-registry.js`): Interfaces with Thunderbird's `OAuth2Providers.sys.mjs` module to dynamically register OAuth2 providers at runtime. Handles re-registration when providers already exist and maintains the mapping between domain hostnames and OAuth2 issuers.

3.  **Config Fetcher** (`config-fetcher.js`): Implements the autodiscovery logic by fetching Autoconfig XML from multiple standard locations:
    *   `https://autoconfig.{domain}/mail/config-v1.1.xml`
    *   `https://{domain}/.well-known/autoconfig/mail/config-v1.1.xml`
    *   `https://autoconfig.thunderbird.net/v1.1/{domain}` (Mozilla's ISPDB)
    
    Parses XML using regex patterns to extract `<oAuth2>` configuration blocks, validates required fields (issuer, authURL, tokenURL), and orchestrates the registration and caching workflow.

4.  **Account Scanner** (`account-scanner.js`): Enumerates all configured accounts on startup, extracts domains from email addresses, and proactively registers OAuth2 providers for existing accounts that may have been set up before the extension was installed.

#### Runtime Behavior

**On Extension Startup:**
*   The experiment API (`oauthprovider.js`) creates isolated JavaScript sandboxes with system principal privileges using `Components.utils.Sandbox()`.
*   All module scripts are loaded into the sandbox via `Services.scriptloader.loadSubScript()` with cache-busting query parameters to ensure fresh code on each reload during development.
*   The extension hooks `FetchConfig.fromISP()` from Thunderbird's `accountcreation/FetchConfig.sys.mjs` module. This intercepts the account setup wizard's configuration fetch process.
*   Account Scanner runs immediately to handle pre-existing accounts.

**During Account Setup:**
*   When a user enters an email address, Thunderbird calls `FetchConfig.fromISP()` to retrieve server configuration.
*   The extension's hook extracts the domain and triggers `ConfigFetcher.fetchAndRegister()` in parallel with Thunderbird's normal process.
*   If an `<oAuth2>` block is found, the provider is registered via `OAuth2Providers.registerProvider()` before Thunderbird attempts authentication.
*   The configuration is cached in preferences for 24 hours by default.

**Cache Management:**
*   Cached configurations include timestamps and domain metadata.
*   On subsequent lookups, cached configs are used immediately for fast registration.
*   If cache is stale (>24 hours old), the extension uses the cache but refreshes in the background to pick up any provider changes.
*   Users can manually invalidate cache via the extension's API (exposed to WebExtension context).

**On Shutdown:**
*   The `FetchConfig.fromISP()` hook is removed and the original function is restored.
*   All sandboxes are explicitly destroyed using `Cu.nukeSandbox()` to prevent memory leaks.
*   Garbage collection and cycle collection are forced to clean up any remaining references.

#### Security Considerations

*   Scripts run with **system principal** privileges in isolated compartments (`freshCompartment: true`), preventing interference between extension reloads.
*   The extension does not store or transmit credentials—it only registers metadata (URLs, client IDs) with Thunderbird's built-in OAuth2 handler.
*   Configuration cache uses Thunderbird's preference system, which is stored locally in `prefs.js`.

---
*Note: This extension requires Thunderbird 140 or newer.*
