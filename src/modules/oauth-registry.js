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

    const details = {
      name: issuer,
      clientId,
      clientSecret: clientSecret || undefined,
      issuerIdentifier: issuer,
      authorizationEndpoint: authURL,
      tokenEndpoint: tokenURL,
      redirectionEndpoint: redirectUri,
      usePKCE: usePKCE !== false,
      useExternalBrowser: true, // required for passkey authentication
    };

    OAuth2Providers.registerProvider(details, hostnames, scope);

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
