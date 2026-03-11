// popup.js — Main logic for the FOLIO Inn-Reach Paging Slips browser extension
// Uses FolioSession library for session detection, per-tenant config, and API calls.

/* global FolioSession, chrome */

(function () {
  "use strict";

  FolioSession.setLogPrefix("[PagingSlips]");

  // ======================== DOM REFS ========================
  const els = {
    mainUI: document.getElementById("main-ui"),
    detectStatus: document.getElementById("detect-status"),
    detectMsg: document.getElementById("detect-msg"),
    btnGrantAccess: document.getElementById("btn-grant-access"),
    tenantBar: document.getElementById("tenant-bar"),
    tenantSelect: document.getElementById("tenant-select"),
    tenantName: document.getElementById("tenant-name"),
    allSPs: document.getElementById("all-sps"),
    prefix: document.getElementById("prefix"),

    btnGenerate: document.getElementById("btn-generate"),
    status: document.getElementById("status"),
    progress: document.getElementById("progress"),
    log: document.getElementById("log"),
    toggleSettings: document.getElementById("toggle-settings"),
    settingsPanel: document.getElementById("settings-panel"),
    okapiUrlInput: document.getElementById("okapi-url"),
    okapiTenantInput: document.getElementById("okapi-tenant"),
    centralServerId: document.getElementById("central-server-id"),
    agencyMap: document.getElementById("agency-map"),
    singleLookup: document.getElementById("single-lookup"),
    btnSingle: document.getElementById("btn-single"),
  };

  // ======================== PER-TENANT SETTINGS ========================

  function gatherCurrentProfile() {
    return {
      okapiUrl: els.okapiUrlInput.value.trim(),
      centralServerId: els.centralServerId.value,
      agencyMap: els.agencyMap.value,
      prefix: els.prefix.value,
      allSPs: els.allSPs.checked,
    };
  }

  function applyProfile(profile) {
    if (!profile) return;
    if (profile.okapiUrl) els.okapiUrlInput.value = profile.okapiUrl;
    if (profile.centralServerId != null) {
      els.centralServerId.dataset.savedValue = profile.centralServerId;
    }
    if (profile.agencyMap) els.agencyMap.value = profile.agencyMap;
    if (profile.prefix) els.prefix.value = profile.prefix;
    if (profile.allSPs != null) els.allSPs.checked = profile.allSPs;
  }

  function saveCurrentSettings() {
    var tenantId = FolioSession.getCurrentTenantId();
    if (!tenantId) return;
    FolioSession.saveTenantProfile(tenantId, gatherCurrentProfile());
  }

  // ======================== SETTINGS TOGGLE ========================
  els.toggleSettings.addEventListener("click", function () {
    els.settingsPanel.classList.toggle("visible");
    var expanded = els.settingsPanel.classList.contains("visible");
    els.toggleSettings.setAttribute("aria-expanded", String(expanded));
    els.toggleSettings.textContent = expanded
      ? "⚙ Hide Settings"
      : "⚙ Settings";
  });

  // ======================== HELPERS ========================

  function setStatus(msg, type) {
    els.status.textContent = msg;
    els.status.className = type || "info";
  }

  function addLog(msg) {
    els.log.classList.add("visible");
    const d = document.createElement("div");
    d.textContent = msg;
    els.log.appendChild(d);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function showProgress(val, max) {
    els.progress.classList.add("visible");
    els.progress.value = val;
    els.progress.max = max;
  }

  function showSettings() {
    els.settingsPanel.classList.add("visible");
    els.toggleSettings.textContent = "⚙ Hide Settings";
    els.toggleSettings.setAttribute("aria-expanded", "true");
  }

  function hideSettings() {
    els.settingsPanel.classList.remove("visible");
    els.toggleSettings.textContent = "⚙ Settings";
    els.toggleSettings.setAttribute("aria-expanded", "false");
  }

  /**
   * Sync the URL/tenant from the settings inputs back into FolioSession,
   * in case the user edited them manually.
   */
  function syncFromInputs() {
    var url = els.okapiUrlInput.value.trim();
    var tenant = els.okapiTenantInput.value.trim();
    if (url) FolioSession.setUrl(url);
    if (tenant) FolioSession.setTenant(tenant);
  }

  // ======================== MUSTACHE RENDERER ========================

  function resolveKey(ctx, key) {
    if (key === ".") return ctx["."] != null ? ctx["."] : ctx;
    const parts = key.split(".");
    let val = ctx;
    for (const p of parts) {
      if (val == null || typeof val !== "object") return undefined;
      val = val[p];
    }
    return val;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderMustache(tpl, ctx) {
    tpl = tpl.replace(
      /\{\{#([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
      function (_m, key, body) {
        const val = resolveKey(ctx, key);
        if (!val || (Array.isArray(val) && val.length === 0)) return "";
        if (Array.isArray(val)) {
          return val
            .map(function (item) {
              return renderMustache(
                body,
                typeof item === "object"
                  ? Object.assign({}, ctx, item, { ".": item })
                  : Object.assign({}, ctx, { ".": item })
              );
            })
            .join("");
        }
        return renderMustache(body, ctx);
      }
    );
    tpl = tpl.replace(
      /\{\{\^([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
      function (_m, key, body) {
        const val = resolveKey(ctx, key);
        return !val || (Array.isArray(val) && val.length === 0)
          ? renderMustache(body, ctx)
          : "";
      }
    );
    tpl = tpl.replace(/\{\{\{([\w.]+)\}\}\}/g, function (_m, key) {
      const val = resolveKey(ctx, key);
      return val != null ? String(val) : "";
    });
    tpl = tpl.replace(/\{\{([\w.]+)\}\}/g, function (_m, key) {
      const val = resolveKey(ctx, key);
      return val != null ? escapeHtml(val) : "";
    });
    return tpl;
  }

  // ======================== GENERATION LOGIC ========================

  async function generate() {
    syncFromInputs();

    if (!FolioSession.getUrl() || !FolioSession.getTenant()) {
      setStatus(
        "FOLIO URL and Tenant are required. Open Settings to enter them manually.",
        "error"
      );
      showSettings();
      return;
    }

    const BATCH_SIZE = 10;
    const centralServerId = els.centralServerId.value.trim();
    let agencyCodeMap;
    try {
      agencyCodeMap = JSON.parse(els.agencyMap.value);
    } catch (_) {
      setStatus("Invalid JSON in agency code mappings. Open Settings to fix.", "error");
      showSettings();
      return;
    }
    if (!agencyCodeMap || Object.keys(agencyCodeMap).length === 0) {
      setStatus(
        "Agency code mappings are not configured. Open Settings to add them before generating.",
        "error"
      );
      showSettings();
      return;
    }

    saveCurrentSettings();
    hideSettings();
    els.btnGenerate.disabled = true;
    els.log.innerHTML = "";

    try {
      setStatus("Fetching service points…", "info");
      const servicePoints = await FolioSession.folioGetAll("/service-points", "servicepoints");
      const allSpCodes = servicePoints.map((sp) => sp.code);

      let selectedCodes;
      if (els.allSPs.checked) {
        selectedCodes = allSpCodes;
      } else {
        const pfx = (els.prefix.value || "").toLowerCase();
        selectedCodes = allSpCodes.filter((c) => c.toLowerCase().startsWith(pfx));
      }

      if (selectedCodes.length === 0) {
        setStatus("No service points matched the selected prefix.", "error");
        els.btnGenerate.disabled = false;
        return;
      }
      addLog("Selected " + selectedCodes.length + " service point code(s).");

      setStatus("Building location map…", "info");
      const spIdCodeMap = {};
      servicePoints.forEach(function (sp) { spIdCodeMap[sp.id] = sp.code; });

      const locations = await FolioSession.folioGetAll("/locations", "locations");
      const spLocations = {};
      for (const loc of locations) {
        for (const spId of loc.servicePointIds || []) {
          const code = spIdCodeMap[spId];
          if (code) {
            if (!spLocations[code]) spLocations[code] = [];
            spLocations[code].push(loc.id);
          }
        }
      }

      setStatus("Fetching Inn-Reach transactions…", "info");
      const transactions = await FolioSession.folioGetAll(
        "/inn-reach/transactions",
        "transactions",
        { type: "ITEM", state: ["ITEM_HOLD", "TRANSFER"] }
      );
      addLog("Fetched " + transactions.length + " transactions.");

      setStatus("Fetching paging slip template…", "info");
      const templateData = await FolioSession.folioGet(
        "/inn-reach/central-servers/" + centralServerId + "/paging-slip-template"
      );
      const template = templateData.template;

      const itemIds = transactions
        .map(function (t) { return t.hold && t.hold.folioItemId; })
        .filter(Boolean);

      setStatus("Fetching item & request data…", "info");
      const itemsMap = {};
      const requestsMap = {};

      for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
        const batch = itemIds.slice(i, i + BATCH_SIZE);
        showProgress(i, itemIds.length);
        setStatus(
          "Fetching items " + (i + 1) + "–" +
          Math.min(i + BATCH_SIZE, itemIds.length) + " of " + itemIds.length + "…",
          "info"
        );

        const itemQuery = "id==(" + batch.join(" or ") + ")";
        const batchItems = await FolioSession.folioGetCQL("/inventory/items", "items", itemQuery);
        batchItems.forEach(function (it) { itemsMap[it.id] = it; });

        const reqQuery = batch
          .map(function (id) { return 'itemId==' + id + ' and status=="Open - *"'; })
          .join(" or ");
        const batchReqs = await FolioSession.folioGetCQL(
          "/request-storage/requests", "requests", reqQuery
        );
        batchReqs.forEach(function (r) { requestsMap[r.itemId] = r; });
      }
      showProgress(itemIds.length, itemIds.length);

      setStatus("Assembling paging slips…", "info");
      const contextObjs = [];

      for (const txn of transactions) {
        if (!txn.hold || !txn.hold.folioItemId) continue;
        const item = itemsMap[txn.hold.folioItemId];
        if (!item) continue;

        const contextObj = buildSlipContext(txn, item, agencyCodeMap);
        const request = requestsMap[item.id];
        if (request) {
          if (!(request.status || "").startsWith("Open - Not yet filled")) {
            addLog(
              "Txn " + (txn.trackingId || "") + ": request status is " +
              (request.status || "Unknown") + " — " + (item.title || "No title")
            );
          }
          const itemLocId = item.effectiveLocation && item.effectiveLocation.id;
          const matchesSP = selectedCodes.some(function (sp) {
            return (spLocations[sp] || []).indexOf(itemLocId) !== -1;
          });
          const itemStatus = (item.status && item.status.name) || "";
          if (matchesSP && itemStatus !== "Checked out") {
            contextObjs.push(contextObj);
          }
        } else {
          addLog(
            "No request for txn " + (txn.trackingId || "") + ": " +
            ((item.status && item.status.name) || "Unknown") + " — " +
            (item.title || "No title")
          );
        }
      }

      contextObjs.sort(function (a, b) {
        const loc = a.item.effectiveLocationFolioName.localeCompare(
          b.item.effectiveLocationFolioName
        );
        return loc !== 0
          ? loc
          : a.item.effectiveCallNumber.localeCompare(b.item.effectiveCallNumber);
      });

      setStatus("Rendering " + contextObjs.length + " slips…", "info");
      const slips = contextObjs.map(function (ctx) {
        return (
          '<div style="page-break-after: always;">' +
          renderMustache(template, ctx) +
          "</div>"
        );
      });

      const fullHTML =
        "<!DOCTYPE html><html lang=\"en\"><head><title>Inn-Reach Paging Slips (" +
        slips.length + ")</title></head><body>" +
        (slips.length > 0 ? slips.join("\n") : "<p>No paging slips to print.</p>") +
        "</body></html>";

      const blob = new Blob([fullHTML], { type: "text/html" });
      const blobUrl = URL.createObjectURL(blob);
      chrome.tabs.create({ url: blobUrl });

      setStatus("Done — generated " + slips.length + " slips.", "success");
      addLog("Opened slips in a new tab.");
    } catch (err) {
      console.error("[PagingSlips]", err);
      setStatus(err.message, "error");
    } finally {
      els.btnGenerate.disabled = false;
    }
  }

  // ======================== SINGLE SLIP LOOKUP ========================

  function buildSlipContext(txn, item, agencyCodeMap) {
    const ecnc = item.effectiveCallNumberComponents || {};
    const volumeEnum =
      (item.displaySummary || "").trim() ||
      (
        ((item.volume || "").trim() || (item.enumeration || "").trim() || "") +
        " " +
        (item.chronology || "")
      ).trim();
    const callParts = [ecnc.prefix, ecnc.callNumber, ecnc.suffix, volumeEnum]
      .map(function (v) { return v == null ? "" : String(v); })
      .filter(Boolean);

    const itemObj = {
      title: item.title || "",
      author:
        item.contributorNames && item.contributorNames.length
          ? item.contributorNames[0].name || ""
          : "",
      barcode: item.barcode || "",
      effectiveCallNumber: callParts.join(" ").trim(),
      effectiveLocationFolioName:
        (item.effectiveLocation && item.effectiveLocation.name) || "",
    };

    const pickupParts = (txn.hold.pickupLocation || "").split(":");
    const transactionObj = {
      pickupLocationPrintName: pickupParts.length > 2 ? pickupParts[2] : "",
      patronAgencyCode: txn.hold.patronAgencyCode || "",
      itemAgencyDescription: agencyCodeMap[txn.hold.itemAgencyCode] || "",
      itemAgencyCode: txn.hold.itemAgencyCode || "",
      patronName: txn.hold.patronName || "",
    };

    return { item: itemObj, innReachTransaction: transactionObj };
  }

  async function generateSingle() {
    const lookup = (els.singleLookup.value || "").trim();
    if (!lookup) {
      setStatus("Enter an item barcode or tracking ID.", "error");
      return;
    }

    syncFromInputs();

    if (!FolioSession.getUrl() || !FolioSession.getTenant()) {
      setStatus("FOLIO URL and Tenant are required. Open Settings.", "error");
      showSettings();
      return;
    }

    const centralServerId = els.centralServerId.value.trim();
    let agencyCodeMap;
    try {
      agencyCodeMap = JSON.parse(els.agencyMap.value);
    } catch (_) {
      setStatus("Invalid JSON in agency code mappings.", "error");
      return;
    }

    saveCurrentSettings();
    hideSettings();
    els.btnSingle.disabled = true;
    els.log.innerHTML = "";

    try {
      setStatus("Searching for transaction…", "info");

      const transactions = await FolioSession.folioGetAll(
        "/inn-reach/transactions", "transactions", { type: "ITEM" }
      );

      let match = transactions.find(function (t) { return t.trackingId === lookup; });
      if (!match) {
        match = transactions.find(function (t) {
          return t.hold && t.hold.folioItemBarcode === lookup;
        });
      }

      if (!match) {
        setStatus('No ITEM transaction found for "' + lookup + '".', "error");
        return;
      }

      addLog("Found transaction: " + match.trackingId + " (" + match.state + ")");

      var terminalStates = ["FINAL_CHECKIN", "CANCEL_REQUEST", "BORROWING_SITE_CANCEL"];
      if (terminalStates.indexOf(match.state) !== -1) {
        setStatus(
          "Transaction " + match.trackingId + " is in " + match.state +
          " state — slips cannot be printed for terminal transactions.",
          "error"
        );
        return;
      }

      if (!match.hold || !match.hold.folioItemId) {
        setStatus("Transaction has no linked FOLIO item.", "error");
        return;
      }

      setStatus("Fetching item details…", "info");
      const items = await FolioSession.folioGetCQL(
        "/inventory/items", "items", "id==" + match.hold.folioItemId
      );
      if (items.length === 0) {
        setStatus("Item not found in inventory.", "error");
        return;
      }
      const item = items[0];

      setStatus("Fetching paging slip template…", "info");
      const templateData = await FolioSession.folioGet(
        "/inn-reach/central-servers/" + centralServerId + "/paging-slip-template"
      );
      const template = templateData.template;

      const contextObj = buildSlipContext(match, item, agencyCodeMap);
      const rendered =
        '<div style="page-break-after: always;">' +
        renderMustache(template, contextObj) +
        "</div>";

      const fullHTML =
        "<!DOCTYPE html><html lang=\"en\"><head><title>Inn-Reach Paging Slip \u2014 " +
        escapeHtml(item.barcode || match.trackingId) +
        "</title></head><body>" + rendered + "</body></html>";

      const blob = new Blob([fullHTML], { type: "text/html" });
      const blobUrl = URL.createObjectURL(blob);
      chrome.tabs.create({ url: blobUrl });

      setStatus("Done — printed slip for " + (item.barcode || match.trackingId) + ".", "success");
    } catch (err) {
      console.error("[PagingSlips]", err);
      setStatus(err.message, "error");
    } finally {
      els.btnSingle.disabled = false;
    }
  }

  // ======================== INN-REACH CONFIG ========================

  async function fetchCentralServerConfig() {
    try {
      els.detectMsg.textContent = "Fetching INN-Reach configuration…";
      els.detectStatus.style.display = "block";
      const csData = await FolioSession.folioGet("/inn-reach/central-servers", { limit: "100" });
      const centralServers = csData.centralServers || [];
      console.log("[PagingSlips] Found " + centralServers.length + " central server(s).");

      if (centralServers.length > 0) {
        els.centralServerId.innerHTML = "";
        centralServers.forEach(function (cs) {
          var opt = document.createElement("option");
          opt.value = cs.id;
          opt.textContent = cs.name || cs.id;
          els.centralServerId.appendChild(opt);
        });

        var savedVal = els.centralServerId.dataset.savedValue;
        if (savedVal) {
          for (var i = 0; i < els.centralServerId.options.length; i++) {
            if (els.centralServerId.options[i].value === savedVal) {
              els.centralServerId.value = savedVal;
              break;
            }
          }
        }

        var agencyCodes = [];
        centralServers.forEach(function (cs) {
          (cs.localAgencies || []).forEach(function (agency) {
            if (agency.code && agencyCodes.indexOf(agency.code) === -1) {
              agencyCodes.push(agency.code);
            }
          });
        });

        var needsSetup = false;
        try {
          var mapVal = JSON.parse(els.agencyMap.value);
          needsSetup = !mapVal || Object.keys(mapVal).length === 0;
        } catch (_) {
          needsSetup = true;
        }

        if (needsSetup && agencyCodes.length > 0) {
          var codeMap = {};
          agencyCodes.sort().forEach(function (code) { codeMap[code] = ""; });
          els.agencyMap.value = JSON.stringify(codeMap, null, 2);
        }
      }
    } catch (e) {
      console.warn("[PagingSlips] Could not fetch central server config:", e.message);
    }
  }

  // ======================== TENANT SWITCHING ========================

  async function switchToTenant(tenantId, apiUrl) {
    FolioSession.switchTenant(tenantId, apiUrl);
    els.okapiTenantInput.value = tenantId;
    if (apiUrl) els.okapiUrlInput.value = apiUrl;

    var profile = await FolioSession.loadTenantProfile(tenantId);
    if (profile) {
      applyProfile(profile);
      if (profile.okapiUrl) {
        FolioSession.setUrl(profile.okapiUrl);
        els.okapiUrlInput.value = profile.okapiUrl;
      }
    }

    await fetchCentralServerConfig();
  }

  function updateTenantBar() {
    var tenantId = FolioSession.getCurrentTenantId();
    if (!tenantId) {
      els.tenantBar.style.display = "none";
      return;
    }
    els.tenantBar.style.display = "flex";

    var allSessions = FolioSession.getAllSessions().filter(function (s) { return !!s.tenant; });
    if (allSessions.length > 1) {
      els.tenantSelect.style.display = "";
      els.tenantName.style.display = "none";
      els.tenantSelect.innerHTML = "";
      allSessions.forEach(function (s) {
        var opt = document.createElement("option");
        opt.value = s.tenant || "";
        opt.textContent = s.tenant ? (s.tenant + " — " + (s.url || "")) : (s.url || "unknown");
        opt.dataset.url = s.url || "";
        els.tenantSelect.appendChild(opt);
      });
      FolioSession.getKnownTenants().then(function (known) {
        var sessionTenants = allSessions.map(function (s) { return s.tenant; });
        var remaining = known.filter(function (t) {
          return t && sessionTenants.indexOf(t) === -1;
        });
        Promise.all(remaining.map(function (t) {
          return FolioSession.loadTenantProfile(t).then(function (profile) {
            return { tenant: t, url: (profile && profile.okapiUrl) || "" };
          });
        })).then(function (entries) {
          entries.forEach(function (e) {
            var opt = document.createElement("option");
            opt.value = e.tenant;
            opt.textContent = e.tenant + (e.url ? " — " + e.url : " (saved)");
            opt.dataset.url = e.url;
            els.tenantSelect.appendChild(opt);
          });
        });
      });
      els.tenantSelect.value = tenantId;
    } else {
      els.tenantSelect.style.display = "none";
      els.tenantName.style.display = "";
      els.tenantName.textContent = tenantId + (FolioSession.getUrl() ? " — " + FolioSession.getUrl() : "");
    }
  }

  // ======================== INIT ========================

  async function init() {
    // Migrate old flat settings to per-tenant format
    await FolioSession.migrateOldSettings(
      ["okapiUrl", "okapiTenant", "centralServerId", "agencyMap", "prefix", "allSPs"],
      "okapiTenant"
    );

    els.detectStatus.style.display = "block";
    els.detectMsg.textContent = "Detecting FOLIO session…";

    // Check if we already have host permission for the active tab
    var tabOrigin = await FolioSession.getActiveTabOrigin();
    var tabUrl = await FolioSession.getActiveTabUrl();
    var wildcardPattern = FolioSession.getWildcardPattern(tabUrl);
    var hasPermission = wildcardPattern
      ? await new Promise(function (r) {
          chrome.permissions.contains({ origins: [wildcardPattern] }, r);
        })
      : false;

    // Also fall back to checking exact origin (in case user granted it previously)
    if (!hasPermission && tabOrigin) {
      hasPermission = await FolioSession.hasHostPermission(tabOrigin);
    }

    if (tabOrigin && !hasPermission) {
      var displayDomain = wildcardPattern
        ? wildcardPattern.replace("https://", "").replace("/*", "")
        : tabOrigin;
      els.detectMsg.textContent =
        "This extension needs access to " + displayDomain + " to detect your FOLIO session.";
      els.btnGrantAccess.style.display = "";
      els.btnGrantAccess.onclick = async function () {
        els.btnGrantAccess.disabled = true;
        els.btnGrantAccess.textContent = "Requesting…";
        var patterns = [wildcardPattern || (tabOrigin + "/*")];
        var granted = await new Promise(function (r) {
          chrome.permissions.request({ origins: patterns }, r);
        });
        if (granted) {
          els.btnGrantAccess.style.display = "none";
          els.detectMsg.textContent = "Access granted. Detecting FOLIO session…";
          await continueInit();
        } else {
          els.btnGrantAccess.disabled = false;
          els.btnGrantAccess.textContent = "Grant Site Access";
          els.detectMsg.textContent =
            "Permission denied. Click \"Grant Site Access\" to try again, or open Settings to enter connection details manually.";
          showSettings();
        }
      };
      return;
    }

    await continueInit();
  }

  async function continueInit() {
    els.detectStatus.style.display = "block";
    els.detectMsg.textContent = "Detecting FOLIO session…";

    // Detect session (page + cookies + merge)
    var result = await FolioSession.detect();

    // Check for tenant switch
    var lastTenant = await FolioSession.getLastActiveTenant();
    var currentTenant = FolioSession.getCurrentTenantId();
    var tenantSwitched = currentTenant && lastTenant && currentTenant !== lastTenant;

    if (currentTenant) {
      FolioSession.setLastActiveTenant(currentTenant);
    }

    // Load saved profile for this tenant
    if (currentTenant) {
      var profile = await FolioSession.loadTenantProfile(currentTenant);
      if (profile) {
        applyProfile(profile);
      }
    }

    // Populate settings fields (prefer saved over detected)
    if (FolioSession.getUrl() && !els.okapiUrlInput.value) {
      els.okapiUrlInput.value = FolioSession.getUrl();
    } else if (els.okapiUrlInput.value) {
      FolioSession.setUrl(els.okapiUrlInput.value.trim());
    }
    if (FolioSession.getTenant() && !els.okapiTenantInput.value) {
      els.okapiTenantInput.value = FolioSession.getTenant();
    } else if (els.okapiTenantInput.value) {
      FolioSession.setTenant(els.okapiTenantInput.value.trim());
    }

    updateTenantBar();

    if (!FolioSession.getTenant() || !FolioSession.getUrl()) {
      els.detectStatus.style.display = "block";
      els.detectMsg.textContent =
        "Could not auto-detect FOLIO connection. Open Settings below to enter the Okapi URL and Tenant.";
      showSettings();
      return;
    }

    if (tenantSwitched) {
      console.log("[PagingSlips] Tenant switched: " + lastTenant + " → " + currentTenant);
    }
    console.log(
      "[PagingSlips] Session:",
      FolioSession.getUrl(),
      FolioSession.getTenant(),
      FolioSession.getToken() ? "(token present)" : "(no token, using cookies)"
    );

    // Auto-populate INN-Reach config
    await fetchCentralServerConfig();

    // Save this tenant
    FolioSession.saveTenantProfile(currentTenant, gatherCurrentProfile());

    // Check if agency map needs user input
    var needsSetup = false;
    try {
      var mapVal = JSON.parse(els.agencyMap.value);
      if (!mapVal || Object.keys(mapVal).length === 0) {
        needsSetup = true;
      } else {
        needsSetup = Object.values(mapVal).every(function (v) { return !v; });
      }
    } catch (_) {
      needsSetup = true;
    }

    if (needsSetup) {
      els.detectStatus.style.display = "block";
      els.detectMsg.textContent = tenantSwitched
        ? "Switched to " + currentTenant + ". Fill in agency code names in Settings before generating."
        : "Agency codes detected. Please fill in the library names in Settings below before generating slips.";
      showSettings();
    } else {
      if (tenantSwitched) {
        els.detectStatus.style.display = "block";
        els.detectMsg.textContent = "Switched to " + currentTenant + " — settings loaded.";
        setTimeout(function () { els.detectStatus.style.display = "none"; }, 3000);
      } else {
        els.detectStatus.style.display = "none";
      }

      // Verify API connectivity
      try {
        await FolioSession.folioGetAll("/service-points", "servicepoints");
      } catch (e) {
        console.warn("[PagingSlips] Could not fetch service points:", e.message);
        els.detectStatus.style.display = "block";
        els.detectMsg.textContent =
          "Connected to " + FolioSession.getUrl() + " but API call failed (" +
          e.message.split("\n")[0] +
          "). Check Settings and make sure you are logged into FOLIO.";
        showSettings();
      }
    }
  }

  init();

  // ======================== LISTENERS ========================
  els.btnGenerate.addEventListener("click", generate);
  els.btnSingle.addEventListener("click", generateSingle);

  els.singleLookup.addEventListener("keydown", function (e) {
    if (e.key === "Enter") generateSingle();
  });

  els.allSPs.addEventListener("change", function () {
    els.prefix.disabled = els.allSPs.checked;
  });

  // Tenant switcher
  els.tenantSelect.addEventListener("change", async function () {
    var selected = els.tenantSelect.options[els.tenantSelect.selectedIndex];
    if (!selected) return;
    var newTenant = selected.value;
    var newUrl = selected.dataset.url || "";
    if (newTenant === FolioSession.getCurrentTenantId()) return;

    saveCurrentSettings();

    els.log.innerHTML = "";
    els.log.classList.remove("visible");
    els.status.className = "";
    els.progress.classList.remove("visible");
    els.centralServerId.innerHTML = '<option value="">Loading…</option>';

    await switchToTenant(newTenant, newUrl || null);
    updateTenantBar();

    var needsSetup = false;
    try {
      var mapVal = JSON.parse(els.agencyMap.value);
      if (!mapVal || Object.keys(mapVal).length === 0) {
        needsSetup = true;
      } else {
        needsSetup = Object.values(mapVal).every(function (v) { return !v; });
      }
    } catch (_) {
      needsSetup = true;
    }

    if (needsSetup) {
      els.detectStatus.style.display = "block";
      els.detectMsg.textContent =
        "Switched to " + newTenant + ". Fill in agency code names in Settings before generating.";
      showSettings();
    } else {
      els.detectStatus.style.display = "none";
    }
  });
})();
