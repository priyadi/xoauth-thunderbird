/**
 * Config Fetcher Module
 * Handles fetching and parsing OAuth configuration
 */

const { NetUtil } = ChromeUtils.importESModule(
  "resource://gre/modules/NetUtil.sys.mjs",
);

var ConfigFetcher = {
  /**
   * Fetch and register OAuth config for a domain
   * Uses cache first, then fetches latest if needed
   * @param {string} domain
   * @param {boolean} forceRefresh - Skip cache and fetch fresh
   * @returns {boolean}
   */
  fetchAndRegister(domain, forceRefresh = false) {
    if (!domain) {
      console.warn("[XOAuthTB] No domain provided");
      return false;
    }

    console.log(`[XOAuthTB] Processing config for: ${domain}`);

    if (!forceRefresh) {
      const cached = ConfigCache.load(domain);
      if (cached) {
        console.log(`[XOAuthTB] Using cached config for: ${domain}`);

        // Register from cache immediately
        if (this.registerConfig(cached)) {
          // Check if cache is stale, fetch in background
          if (ConfigCache.isStale(cached)) {
            console.log(`[XOAuthTB] Cache stale for ${domain}, refreshing...`);
            this.fetchAndRegisterFromNetwork(domain);
          }
          return true;
        }
      }
    }

    // No cache or force refresh - fetch from network
    return this.fetchAndRegisterFromNetwork(domain);
  },

  /**
   * Fetch from network and register
   * @param {string} domain
   * @returns {boolean}
   */
  fetchAndRegisterFromNetwork(domain) {
    console.log(`[XOAuthTB] Fetching from network: ${domain}`);

    const urls = this.buildConfigUrls(domain);

    for (const url of urls) {
      try {
        const xmlText = this.fetchSync(url);
        if (xmlText && this.parseAndRegister(xmlText, domain)) {
          console.log(`[XOAuthTB] Successfully registered: ${domain}`);
          return true;
        }
      } catch (error) {
        console.error(`[XOAuthTB] Error fetching ${url}:`, error);
      }
    }

    console.warn(`[XOAuthTB] No OAuth config found for: ${domain}`);
    return false;
  },

  /**
   * Build autoconfig URLs
   * @param {string} domain
   * @returns {string[]}
   */
  buildConfigUrls(domain) {
    return [
      `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=user@${domain}`,
      `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
      `https://autoconfig.thunderbird.net/v1.1/${domain}`,
    ];
  },

  /**
   * Synchronously fetch URL
   * @param {string} url
   * @returns {string|null}
   */
  fetchSync(url) {
    try {
      const uri = Services.io.newURI(url);
      const channel = NetUtil.newChannel({
        uri,
        loadUsingSystemPrincipal: true,
      });

      if (channel instanceof Components.interfaces.nsIHttpChannel) {
        channel.QueryInterface(Components.interfaces.nsIHttpChannelInternal);
        channel.loadFlags |= Components.interfaces.nsIRequest.LOAD_BYPASS_CACHE;
      }

      const inputStream = channel.open();
      if (!inputStream) return null;

      return NetUtil.readInputStreamToString(
        inputStream,
        inputStream.available(),
        { charset: "UTF-8" },
      );
    } catch (error) {
      console.warn(`[XOAuthTB] fetchSync failed: ${url}`, error.message);
      return null;
    }
  },

  /**
   * Parse XML and register OAuth provider
   * @param {string} xmlText
   * @param {string} domain
   * @returns {boolean}
   */
  parseAndRegister(xmlText, domain) {
    if (!xmlText || !xmlText.includes("<oAuth2>")) {
      return false;
    }

    try {
      const oauthMatch = xmlText.match(/<oAuth2[^>]*>([\s\S]*?)<\/oAuth2>/i);
      if (!oauthMatch) return false;

      const oauthBlock = oauthMatch[1];
      const getTag = (tag) => {
        const regex = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, "i");
        const match = oauthBlock.match(regex);
        return match ? match[1].trim() : "";
      };

      // Extract hostnames. <hostname> tags cover IMAP/SMTP (incomingServer,
      // outgoingServer). CalDAV/CardDAV servers instead appear as full URLs in
      // <serverURL> tags inside <calendar>/<addressBook> blocks; registering
      // their hostnames lets Thunderbird offer OAuth2 for DAV using the same
      // issuer and token as mail (TB looks up OAuth config by hostname only).
      const hostnameSet = new Set();

      for (const m of xmlText.matchAll(/<hostname[^>]*>([^<]+)<\/hostname>/gi)) {
        hostnameSet.add(m[1].trim());
      }

      for (const m of xmlText.matchAll(
        /<serverURL[^>]*>([^<]+)<\/serverURL>/gi,
      )) {
        const host = this.extractHostname(m[1].trim());
        if (host) {
          hostnameSet.add(host);
        }
      }

      // Thunderbird's Account Hub "add address book / calendar to an existing
      // account" flow derives the DAV host from the email domain
      // (username.split("@")[1]) rather than the actual DAV server hostname,
      // and gates OAuth on getHostnameDetails(<emailDomain>, "carddav"|"caldav").
      // Register the bare email domain so OAuth2 is offered for that flow too;
      // RFC 6764 (.well-known/carddav, SRV) then redirects to the real server.
      if (domain) {
        hostnameSet.add(domain.toLowerCase().trim());
      }

      const hostnames = [...hostnameSet];

      const config = {
        domain,
        issuer: getTag("issuer"),
        clientId: getTag("clientId"),
        clientSecret: getTag("clientSecret") || null,
        authURL: getTag("authURL") || getTag("authUrl"),
        tokenURL: getTag("tokenURL") || getTag("tokenUrl"),
        redirectUri: getTag("redirectUri") || "http://127.0.0.1",
        usePKCE: (getTag("usePKCE") || "true").toLowerCase() === "true",
        scope: getTag("scope"),
        hostnames,
      };

      // Validate
      if (!config.issuer || !config.authURL || !config.tokenURL) {
        console.warn(`[XOAuthTB] Invalid config for: ${domain}`);
        return false;
      }

      // Register and cache
      if (this.registerConfig(config)) {
        ConfigCache.save(domain, config);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`[XOAuthTB] Parse error:`, error);
      return false;
    }
  },

  /**
   * Extract a hostname from a (possibly templated) serverURL value.
   * CalDAV/CardDAV serverURL values may contain placeholders such as
   * %EMAILADDRESS% or %EMAILDOMAIN%, so fall back to a regex if URI parsing
   * fails.
   * @param {string} url
   * @returns {string|null}
   */
  extractHostname(url) {
    if (!url) return null;
    try {
      return Services.io.newURI(url).host || null;
    } catch (error) {
      const match = url.match(/^https?:\/\/([^/:?#]+)/i);
      return match ? match[1] : null;
    }
  },

  /**
   * Register a config object with OAuthRegistry
   * @param {object} config
   * @returns {boolean}
   */
  registerConfig(config) {
    try {
      OAuthRegistry.register(config);
      return true;
    } catch (error) {
      console.error(`[XOAuthTB] Registration failed:`, error);
      return false;
    }
  },
};
