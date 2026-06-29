/**
 * OAuth Registry Module
 * Handles registration of OAuth2 providers
 */

const { OAuth2Providers } = ChromeUtils.importESModule(
  "resource:///modules/OAuth2Providers.sys.mjs",
);

var OAuthRegistry = {
  /**
   * Register an OAuth2 provider
   * @param {object} config - Provider configuration
   */
  register(config) {
    const {
      issuer,
      clientId,
      clientSecret,
      authURL,
      tokenURL,
      redirectUri,
      usePKCE,
      hostnames,
      scope,
    } = config;

    // Check if already registered
    const existing = OAuth2Providers.getIssuerDetails(issuer);
    if (existing) {
      console.log(`[XOAuthTB] Provider exists: ${issuer}. Re-registering...`);
      OAuth2Providers.unregisterProvider(issuer);
    }

    console.log(
      `[XOAuthTB] Registering: ${issuer} for ${hostnames.join(", ")}`,
    );

    // OAuth2Providers.registerProvider has two incompatible upstream
    // signatures. Newer comm-central takes a single details object
    // (registerProvider(details, hostnames, scopes), arity 3); older releases
    // such as Thunderbird 140 take positional arguments
    // (registerProvider(issuer, clientId, ..., hostnames, scopes), arity 9).
    // Discriminate on the function's arity.
    //
    // External browser use (required for passkey authentication) is requested
    // via the per-provider useExternalBrowser field on the object signature,
    // and via the global mailnews.oauth.useExternalBrowser pref (set in
    // main.js) on the positional signature. Both require a loopback HTTP
    // redirect URI.
    if (OAuth2Providers.registerProvider.length <= 3) {
      OAuth2Providers.registerProvider(
        {
          name: issuer,
          clientId,
          clientSecret: clientSecret || undefined,
          issuerIdentifier: issuer,
          authorizationEndpoint: authURL,
          tokenEndpoint: tokenURL,
          redirectionEndpoint: redirectUri,
          usePKCE: usePKCE !== false,
          useExternalBrowser: true,
        },
        hostnames,
        scope,
      );
    } else {
      OAuth2Providers.registerProvider(
        issuer,
        clientId,
        clientSecret || null,
        authURL,
        tokenURL,
        redirectUri,
        usePKCE !== false,
        hostnames,
        scope,
      );
    }

    console.log(`[XOAuthTB] Successfully registered: ${issuer}`);
  },

  /**
   * Check if a provider is registered
   * @param {string} issuer - Provider issuer
   * @returns {boolean}
   */
  isRegistered(issuer) {
    return !!OAuth2Providers.getIssuerDetails(issuer);
  },

  /**
   * Unregister a provider
   * @param {string} issuer - Provider issuer
   */
  unregister(issuer) {
    if (this.isRegistered(issuer)) {
      console.log(`[XOAuthTB] Unregistering: ${issuer}`);
      OAuth2Providers.unregisterProvider(issuer);
    }
  },
};
