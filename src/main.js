const { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs",
);
const { FetchConfig } = ChromeUtils.importESModule(
  "resource:///modules/accountcreation/FetchConfig.sys.mjs",
);

this.xoauthtb = class extends ExtensionCommon.ExtensionAPI {
  onStartup() {
    console.log("[XOAuthTB] Extension starting...");

    Services.prefs.setBoolPref("mailnews.oauth.useExternalBrowser", true);

    const cacheBuster = Date.now();
    const sandbox = Components.utils.Sandbox(
      Services.scriptSecurityManager.getSystemPrincipal(),
      {
        sandboxName: `XOAuthTB-${cacheBuster}`,
        wantGlobalProperties: ["ChromeUtils"],
        freshCompartment: true,
      },
    );

    sandbox.Services = Services;
    sandbox.ChromeUtils = ChromeUtils;
    sandbox.console = console;

    const scripts = [
      "config-cache.js",
      "oauth-registry.js",
      "config-fetcher.js",
      "account-scanner.js",
    ];

    for (const script of scripts) {
      const scriptURI = this.extension.rootURI.resolve(
        `src/modules/${script}?${cacheBuster}`,
      );
      try {
        Services.scriptloader.loadSubScript(scriptURI, sandbox);
        console.log(`[XOAuthTB] Loaded: ${script}`);
      } catch (error) {
        console.error(`[XOAuthTB] Failed to load ${script}:`, error);
      }
    }

    this._ConfigFetcher = sandbox.ConfigFetcher;
    this._ConfigCache = sandbox.ConfigCache;
    this._AccountScanner = sandbox.AccountScanner;
    this._sandbox = sandbox;

    if (!FetchConfig._originalFromISP) {
      console.log("[XOAuthTB] Hooking FetchConfig.fromISP...");
      FetchConfig._originalFromISP = FetchConfig.fromISP;

      const ConfigFetcher = this._ConfigFetcher;
      FetchConfig.fromISP = function (...args) {
        const domain = args[0];
        console.log(`[XOAuthTB] FetchConfig called for: ${domain}`);
        ConfigFetcher.fetchAndRegister(domain);
        return FetchConfig._originalFromISP(...args);
      };
    }

    this._AccountScanner.scanAndRegisterAll();

    console.log("[XOAuthTB] Startup complete.");
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) return;

    console.log("[XOAuthTB] Shutting down...");

    if (FetchConfig._originalFromISP) {
      console.log("[XOAuthTB] Restoring FetchConfig.fromISP");
      FetchConfig.fromISP = FetchConfig._originalFromISP;
      delete FetchConfig._originalFromISP;
    }

    this._ConfigFetcher = null;
    this._ConfigCache = null;
    this._AccountScanner = null;

    if (this._sandbox) {
      Components.utils.nukeSandbox(this._sandbox);
      this._sandbox = null;
    }

    Components.utils.forceGC();
    Components.utils.forceCC();

    console.log("[XOAuthTB] Shutdown complete.");
  }

  getAPI(context) {
    const cacheBuster = Date.now();
    const sandbox = Components.utils.Sandbox(
      Services.scriptSecurityManager.getSystemPrincipal(),
      {
        sandboxName: `XOAuthTB-API-${cacheBuster}`,
        wantGlobalProperties: ["ChromeUtils"],
        freshCompartment: true,
      },
    );

    sandbox.Services = Services;
    sandbox.ChromeUtils = ChromeUtils;
    sandbox.console = console;

    // Load required modules with cache-busting
    const scripts = [
      "config-cache.js",
      "oauth-registry.js",
      "config-fetcher.js",
    ];

    for (const script of scripts) {
      const scriptURI = context.extension.rootURI.resolve(
        `src/modules/${script}?${cacheBuster}`,
      );
      Services.scriptloader.loadSubScript(scriptURI, sandbox);
    }

    const ConfigFetcher = sandbox.ConfigFetcher;
    const ConfigCache = sandbox.ConfigCache;

    return {
      xoauthtb: {
        async checkIfProviderExists(hostname) {
          const exists = ConfigFetcher.fetchAndRegister(hostname);
          return { exists };
        },

        async refreshProvider(hostname) {
          const exists = ConfigFetcher.fetchAndRegister(hostname, true);
          return { exists };
        },

        async clearCache(hostname) {
          if (hostname) {
            ConfigCache.remove(hostname);
          } else {
            ConfigCache.clearAll();
          }
          return { success: true };
        },

        async getCachedDomains() {
          const domains = ConfigCache.getAllDomains();
          return { domains };
        },

        async getProviderDetails(hostname) {
          const details = ConfigCache.getDetails(hostname);
          return details;
        },
      },
    };
  }
};
