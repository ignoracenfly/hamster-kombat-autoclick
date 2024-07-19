// WebView
(function () {
  var eventHandlers = {};

  var locationHash = '';
  try {
    locationHash = location.hash.toString();
  } catch (e) {}

  var initParams = urlParseHashParams(locationHash);
  var storedParams = sessionStorageGet('initParams');
  if (storedParams) {
    for (var key in storedParams) {
      if (typeof initParams[key] === 'undefined') {
        initParams[key] = storedParams[key];
      }
    }
  }
  sessionStorageSet('initParams', initParams);

  var isIframe = false, iFrameStyle;
  try {
    isIframe = (window.parent != null && window != window.parent);
    if (isIframe) {
      window.addEventListener('message', function (event) {
        if (event.source !== window.parent) return;
        try {
          var dataParsed = JSON.parse(event.data);
        } catch (e) {
          return;
        }
        if (!dataParsed || !dataParsed.eventType) {
          return;
        }
        if (dataParsed.eventType == 'set_custom_style') {
          if (event.origin === 'https://web.telegram.org') {
            iFrameStyle.innerHTML = dataParsed.eventData;
          }
        } else if (dataParsed.eventType == 'reload_iframe') {
          try {
            window.parent.postMessage(JSON.stringify({eventType: 'iframe_will_reload'}), '*');
          } catch (e) {}
          location.reload();
        } else {
          receiveEvent(dataParsed.eventType, dataParsed.eventData);
        }
      });
      iFrameStyle = document.createElement('style');
      document.head.appendChild(iFrameStyle);
      try {
        window.parent.postMessage(JSON.stringify({eventType: 'iframe_ready', eventData: {reload_supported: true}}), '*');
      } catch (e) {}
    }
  } catch (e) {}

  function urlSafeDecode(urlencoded) {
    try {
      urlencoded = urlencoded.replace(/\+/g, '%20');
      return decodeURIComponent(urlencoded);
    } catch (e) {
      return urlencoded;
    }
  }

  function urlParseHashParams(locationHash) {
    locationHash = locationHash.replace(/^#/, '');
    var params = {};
    if (!locationHash.length) {
      return params;
    }
    if (locationHash.indexOf('=') < 0 && locationHash.indexOf('?') < 0) {
      params._path = urlSafeDecode(locationHash);
      return params;
    }
    var qIndex = locationHash.indexOf('?');
    if (qIndex >= 0) {
      var pathParam = locationHash.substr(0, qIndex);
      params._path = urlSafeDecode(pathParam);
      locationHash = locationHash.substr(qIndex + 1);
    }
    var query_params = urlParseQueryString(locationHash);
    for (var k in query_params) {
      params[k] = query_params[k];
    }
    return params;
  }

  function urlParseQueryString(queryString) {
    var params = {};
    if (!queryString.length) {
      return params;
    }
    var queryStringParams = queryString.split('&');
    var i, param, paramName, paramValue;
    for (i = 0; i < queryStringParams.length; i++) {
      param = queryStringParams[i].split('=');
      paramName = urlSafeDecode(param[0]);
      paramValue = param[1] == null ? null : urlSafeDecode(param[1]);
      params[paramName] = paramValue;
    }
    return params;
  }

  // Telegram apps will implement this logic to add service params (e.g. tgShareScoreUrl) to game URL
  function urlAppendHashParams(url, addHash) {
    // url looks like 'https://game.com/path?query=1#hash'
    // addHash looks like 'tgShareScoreUrl=' + encodeURIComponent('tgb://share_game_score?hash=very_long_hash123')

    var ind = url.indexOf('#');
    if (ind < 0) {
      // https://game.com/path -> https://game.com/path#tgShareScoreUrl=etc
      return url + '#' + addHash;
    }
    var curHash = url.substr(ind + 1);
    if (curHash.indexOf('=') >= 0 || curHash.indexOf('?') >= 0) {
      // https://game.com/#hash=1 -> https://game.com/#hash=1&tgShareScoreUrl=etc
      // https://game.com/#path?query -> https://game.com/#path?query&tgShareScoreUrl=etc
      return url + '&' + addHash;
    }
    // https://game.com/#hash -> https://game.com/#hash?tgShareScoreUrl=etc
    if (curHash.length > 0) {
      return url + '?' + addHash;
    }
    // https://game.com/# -> https://game.com/#tgShareScoreUrl=etc
    return url + addHash;
  }

  function postEvent(eventType, callback, eventData) {
    if (!callback) {
      callback = function () {};
    }
    if (eventData === undefined) {
      eventData = '';
    }
    // console.log('[Telegram.WebView] > postEvent', eventType, eventData);

    if (window.TelegramWebviewProxy !== undefined) {
      TelegramWebviewProxy.postEvent(eventType, JSON.stringify(eventData));
      callback();
    }
    else if (window.external && 'notify' in window.external) {
      window.external.notify(JSON.stringify({eventType: eventType, eventData: eventData}));
      callback();
    }
    else if (isIframe) {
      try {
        var trustedTarget = 'https://web.telegram.org';
        // For now we don't restrict target, for testing purposes
        trustedTarget = '*';
        window.parent.postMessage(JSON.stringify({eventType: eventType, eventData: eventData}), trustedTarget);
        callback();
      } catch (e) {
        callback(e);
      }
    }
    else {
      callback({notAvailable: true});
    }
  };

  function receiveEvent(eventType, eventData) {
    console.log('[Telegram.WebView] < receiveEvent', eventType, eventData);
    callEventCallbacks(eventType, function(callback) {
      callback(eventType, eventData);
    });
  }

  function callEventCallbacks(eventType, func) {
    var curEventHandlers = eventHandlers[eventType];
    if (curEventHandlers === undefined ||
        !curEventHandlers.length) {
      return;
    }
    for (var i = 0; i < curEventHandlers.length; i++) {
      try {
        func(curEventHandlers[i]);
      } catch (e) {}
    }
  }

  function onEvent(eventType, callback) {
    if (eventHandlers[eventType] === undefined) {
      eventHandlers[eventType] = [];
    }
    var index = eventHandlers[eventType].indexOf(callback);
    if (index === -1) {
      eventHandlers[eventType].push(callback);
    }
  };

  function offEvent(eventType, callback) {
    if (eventHandlers[eventType] === undefined) {
      return;
    }
    var index = eventHandlers[eventType].indexOf(callback);
    if (index === -1) {
      return;
    }
    eventHandlers[eventType].splice(index, 1);
  };

  function openProtoUrl(url) {
    if (!url.match(/^(web\+)?tgb?:\/\/./)) {
      return false;
    }
    var useIframe = navigator.userAgent.match(/iOS|iPhone OS|iPhone|iPod|iPad/i) ? true : false;
    if (useIframe) {
      var iframeContEl = document.getElementById('tgme_frame_cont') || document.body;
      var iframeEl = document.createElement('iframe');
      iframeContEl.appendChild(iframeEl);
      var pageHidden = false;
      var enableHidden = function () {
        pageHidden = true;
      };
      window.addEventListener('pagehide', enableHidden, false);
      window.addEventListener('blur', enableHidden, false);
      if (iframeEl !== null) {
        iframeEl.src = url;
      }
      setTimeout(function() {
        if (!pageHidden) {
          window.location = url;
        }
        window.removeEventListener('pagehide', enableHidden, false);
        window.removeEventListener('blur', enableHidden, false);
      }, 2000);
    }
    else {
      window.location = url;
    }
    return true;
  }

  function sessionStorageSet(key, value) {
    try {
      window.sessionStorage.setItem('__telegram__' + key, JSON.stringify(value));
      return true;
    } catch(e) {}
    return false;
  }
  function sessionStorageGet(key) {
    try {
      return JSON.parse(window.sessionStorage.getItem('__telegram__' + key));
    } catch(e) {}
    return null;
  }

  if (!window.Telegram) {
    window.Telegram = {};
  }
  window.Telegram.WebView = {
    initParams: initParams,
    isIframe: isIframe,
    onEvent: onEvent,
    offEvent: offEvent,
    postEvent: postEvent,
    receiveEvent: receiveEvent,
    callEventCallbacks: callEventCallbacks
  };

  window.Telegram.Utils = {
    urlSafeDecode: urlSafeDecode,
    urlParseQueryString: urlParseQueryString,
    urlParseHashParams: urlParseHashParams,
    urlAppendHashParams: urlAppendHashParams,
    sessionStorageSet: sessionStorageSet,
    sessionStorageGet: sessionStorageGet
  };

  // For Windows Phone app
  window.TelegramGameProxy_receiveEvent = receiveEvent;

  // App backward compatibility
  window.TelegramGameProxy = {
    receiveEvent: receiveEvent
  };
})();

// WebApp
(function () {
  var Utils = window.Telegram.Utils;
  var WebView = window.Telegram.WebView;
  var initParams = WebView.initParams;
  var isIframe = WebView.isIframe;

  var WebApp = {};
  var webAppInitData = '', webAppInitDataUnsafe = {};
  var themeParams = {}, colorScheme = 'light';
  var webAppVersion = '6.0';
  var webAppPlatform = 'unknown';

  if (initParams.tgWebAppData && initParams.tgWebAppData.length) {
    webAppInitData = initParams.tgWebAppData;
    webAppInitDataUnsafe = Utils.urlParseQueryString(webAppInitData);
    for (var key in webAppInitDataUnsafe) {
      var val = webAppInitDataUnsafe[key];
      try {
        if (val.substr(0, 1) == '{' && val.substr(-1) == '}' ||
            val.substr(0, 1) == '[' && val.substr(-1) == ']') {
          webAppInitDataUnsafe[key] = JSON.parse(val);
        }
      } catch (e) {}
    }
  }
  if (initParams.tgWebAppThemeParams && initParams.tgWebAppThemeParams.length) {
    var themeParamsRaw = initParams.tgWebAppThemeParams;
    try {
      var theme_params = JSON.parse(themeParamsRaw);
      if (theme_params) {
        setThemeParams(theme_params);
      }
    } catch (e) {}
  }
  var theme_params = Utils.sessionStorageGet('themeParams');
  if (theme_params) {
    setThemeParams(theme_params);
  }
  if (initParams.tgWebAppVersion) {
    webAppVersion = initParams.tgWebAppVersion;
  }
  if (initParams.tgWebAppPlatform) {
    webAppPlatform = initParams.tgWebAppPlatform;
  }

  function onThemeChanged(eventType, eventData) {
    if (eventData.theme_params) {
      setThemeParams(eventData.theme_params);
      window.Telegram.WebApp.MainButton.setParams({});
      updateBackgroundColor();
      receiveWebViewEvent('themeChanged');
    }
  }

  var lastWindowHeight = window.innerHeight;
  function onViewportChanged(eventType, eventData) {
    if (eventData.height) {
      window.removeEventListener('resize', onWindowResize);
      setViewportHeight(eventData);
    }
  }

  function onWindowResize(e) {
    if (lastWindowHeight != window.innerHeight) {
      lastWindowHeight = window.innerHeight;
      receiveWebViewEvent('viewportChanged', {
        isStateStable: true
      });
    }
  }

  function linkHandler(e) {
    if (e.metaKey || e.ctrlKey) return;
    var el = e.target;
    while (el.tagName != 'A' && el.parentNode) {
      el = el.parentNode;
    }
    if (el.tagName == 'A' &&
        el.target != '_blank' &&
        (el.protocol == 'http:' || el.protocol == 'https:') &&
        el.hostname == 't.me') {
      WebApp.openTgLink(el.href);
      e.preventDefault();
    }
  }

  function strTrim(str) {
    return str.toString().replace(/^\s+|\s+$/g, '');
  }

  function receiveWebViewEvent(eventType) {
    var args = Array.prototype.slice.call(arguments);
    eventType = args.shift();
    WebView.callEventCallbacks('webview:' + eventType, function(callback) {
      callback.apply(WebApp, args);
    });
  }

  function onWebViewEvent(eventType, callback) {
    WebView.onEvent('webview:' + eventType, callback);
  };

  function offWebViewEvent(eventType, callback) {
    WebView.offEvent('webview:' + eventType, callback);
  };

  function setCssProperty(name, value) {
    var root = document.documentElement;
    if (root && root.style && root.style.setProperty) {
      root.style.setProperty('--tg-' + name, value);
    }
  }

  function setThemeParams(theme_params) {
    // temp iOS fix
    if (theme_params.bg_color == '#1c1c1d' &&
        theme_params.bg_color == theme_params.secondary_bg_color) {
      theme_params.secondary_bg_color = '#2c2c2e';
    }
    var color;
    for (var key in theme_params) {
      if (color = parseColorToHex(theme_params[key])) {
        themeParams[key] = color;
        if (key == 'bg_color') {
          colorScheme = isColorDark(color) ? 'dark' : 'light'
          setCssProperty('color-scheme', colorScheme);
        }
        key = 'theme-' + key.split('_').join('-');
        setCssProperty(key, color);
      }
    }
    Utils.sessionStorageSet('themeParams', themeParams);
  }

  var webAppCallbacks = {};
  function generateCallbackId(len) {
    var tries = 100;
    while (--tries) {
      var id = '', chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', chars_len = chars.length;
      for (var i = 0; i < len; i++) {
        id += chars[Math.floor(Math.random() * chars_len)];
      }
      if (!webAppCallbacks[id]) {
        webAppCallbacks[id] = {};
        return id;
      }
    }
    throw Error('WebAppCallbackIdGenerateFailed');
  }

  var viewportHeight = false, viewportStableHeight = false, isExpanded = true;
  function setViewportHeight(data) {
    if (typeof data !== 'undefined') {
      isExpanded = !!data.is_expanded;
      viewportHeight = data.height;
      if (data.is_state_stable) {
        viewportStableHeight = data.height;
      }
      receiveWebViewEvent('viewportChanged', {
        isStateStable: !!data.is_state_stable
      });
    }
    var height, stable_height;
    if (viewportHeight !== false) {
      height = (viewportHeight - mainButtonHeight) + 'px';
    } else {
      height = mainButtonHeight ? 'calc(100vh - ' + mainButtonHeight + 'px)' : '100vh';
    }
    if (viewportStableHeight !== false) {
      stable_height = (viewportStableHeight - mainButtonHeight) + 'px';
    } else {
      stable_height = mainButtonHeight ? 'calc(100vh - ' + mainButtonHeight + 'px)' : '100vh';
    }
    setCssProperty('viewport-height', height);
    setCssProperty('viewport-stable-height', stable_height);
  }

  var isClosingConfirmationEnabled = false;
  function setClosingConfirmation(need_confirmation) {
    if (!versionAtLeast('6.2')) {
      console.warn('[Telegram.WebApp] Closing confirmation is not supported in version ' + webAppVersion);
      return;
    }
    isClosingConfirmationEnabled = !!need_confirmation;
    WebView.postEvent('web_app_setup_closing_behavior', false, {need_confirmation: isClosingConfirmationEnabled});
  }

  var headerColorKey = 'bg_color', headerColor = null;
  function getHeaderColor() {
    if (headerColorKey == 'secondary_bg_color') {
      return themeParams.secondary_bg_color;
    } else if (headerColorKey == 'bg_color') {
      return themeParams.bg_color;
    }
    return headerColor;
  }
  function setHeaderColor(color) {
    if (!versionAtLeast('6.1')) {
      console.warn('[Telegram.WebApp] Header color is not supported in version ' + webAppVersion);
      return;
    }
    if (!versionAtLeast('6.9')) {
      if (themeParams.bg_color &&
          themeParams.bg_color == color) {
        color = 'bg_color';
      } else if (themeParams.secondary_bg_color &&
                 themeParams.secondary_bg_color == color) {
        color = 'secondary_bg_color';
      }
    }
    var head_color = null, color_key = null;
    if (color == 'bg_color' || color == 'secondary_bg_color') {
      color_key = color;
    } else if (versionAtLeast('6.9')) {
      head_color = parseColorToHex(color);
      if (!head_color) {
        console.error('[Telegram.WebApp] Header color format is invalid', color);
        throw Error('WebAppHeaderColorInvalid');
      }
    }
    if (!versionAtLeast('6.9') &&
        color_key != 'bg_color' &&
        color_key != 'secondary_bg_color') {
      console.error('[Telegram.WebApp] Header color key should be one of Telegram.WebApp.themeParams.bg_color, Telegram.WebApp.themeParams.secondary_bg_color, \'bg_color\', \'secondary_bg_color\'', color);
      throw Error('WebAppHeaderColorKeyInvalid');
    }
    headerColorKey = color_key;
    headerColor = head_color;
    updateHeaderColor();
  }
  var appHeaderColorKey = null, appHeaderColor = null;
  function updateHeaderColor() {
    if (appHeaderColorKey != headerColorKey ||
        appHeaderColor != headerColor) {
      appHeaderColorKey = headerColorKey;
      appHeaderColor = headerColor;
      if (appHeaderColor) {
        WebView.postEvent('web_app_set_header_color', false, {color: headerColor});
      } else {
        WebView.postEvent('web_app_set_header_color', false, {color_key: headerColorKey});
      }
    }
  }

  var backgroundColor = 'bg_color';
  function getBackgroundColor() {
    if (backgroundColor == 'secondary_bg_color') {
      return themeParams.secondary_bg_color;
    } else if (backgroundColor == 'bg_color') {
      return themeParams.bg_color;
    }
    return backgroundColor;
  }
  function setBackgroundColor(color) {
    if (!versionAtLeast('6.1')) {
      console.warn('[Telegram.WebApp] Background color is not supported in version ' + webAppVersion);
      return;
    }
    var bg_color;
    if (color == 'bg_color' || color == 'secondary_bg_color') {
      bg_color = color;
    } else {
      bg_color = parseColorToHex(color);
      if (!bg_color) {
        console.error('[Telegram.WebApp] Background color format is invalid', color);
        throw Error('WebAppBackgroundColorInvalid');
      }
    }
    backgroundColor = bg_color;
    updateBackgroundColor();
  }
  var appBackgroundColor = null;
  function updateBackgroundColor() {
    var color = getBackgroundColor();
    if (appBackgroundColor != color) {
      appBackgroundColor = color;
      WebView.postEvent('web_app_set_background_color', false, {color: color});
    }
  }


  function parseColorToHex(color) {
    color += '';
    var match;
    if (match = /^\s*#([0-9a-f]{6})\s*$/i.exec(color)) {
      return '#' + match[1].toLowerCase();
    }
    else if (match = /^\s*#([0-9a-f])([0-9a-f])([0-9a-f])\s*$/i.exec(color)) {
      return ('#' + match[1] + match[1] + match[2] + match[2] + match[3] + match[3]).toLowerCase();
    }
    else if (match = /^\s*rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+\.{0,1}\d*))?\)\s*$/.exec(color)) {
      var r = parseInt(match[1]), g = parseInt(match[2]), b = parseInt(match[3]);
      r = (r < 16 ? '0' : '') + r.toString(16);
      g = (g < 16 ? '0' : '') + g.toString(16);
      b = (b < 16 ? '0' : '') + b.toString(16);
      return '#' + r + g + b;
    }
    return false;
  }

  function isColorDark(rgb) {
    rgb = rgb.replace(/[\s#]/g, '');
    if (rgb.length == 3) {
      rgb = rgb[0] + rgb[0] + rgb[1] + rgb[1] + rgb[2] + rgb[2];
    }
    var r = parseInt(rgb.substr(0, 2), 16);
    var g = parseInt(rgb.substr(2, 2), 16);
    var b = parseInt(rgb.substr(4, 2), 16);
    var hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b));
    return hsp < 120;
  }

  function versionCompare(v1, v2) {
    if (typeof v1 !== 'string') v1 = '';
    if (typeof v2 !== 'string') v2 = '';
    v1 = v1.replace(/^\s+|\s+$/g, '').split('.');
    v2 = v2.replace(/^\s+|\s+$/g, '').split('.');
    var a = Math.max(v1.length, v2.length), i, p1, p2;
    for (i = 0; i < a; i++) {
      p1 = parseInt(v1[i]) || 0;
      p2 = parseInt(v2[i]) || 0;
      if (p1 == p2) continue;
      if (p1 > p2) return 1;
      return -1;
    }
    return 0;
  }

  function versionAtLeast(ver) {
    return versionCompare(webAppVersion, ver) >= 0;
  }

  function byteLength(str) {
    if (window.Blob) {
      try { return new Blob([str]).size; } catch (e) {}
    }
    var s = str.length;
    for (var i=str.length-1; i>=0; i--) {
      var code = str.charCodeAt(i);
      if (code > 0x7f && code <= 0x7ff) s++;
      else if (code > 0x7ff && code <= 0xffff) s+=2;
      if (code >= 0xdc00 && code <= 0xdfff) i--;
    }
    return s;
  }

  var BackButton = (function() {
    var isVisible = false;

    var backButton = {};
    Object.defineProperty(backButton, 'isVisible', {
      set: function(val){ setParams({is_visible: val}); },
      get: function(){ return isVisible; },
      enumerable: true
    });

    var curButtonState = null;

    WebView.onEvent('back_button_pressed', onBackButtonPressed);

    function onBackButtonPressed() {
      receiveWebViewEvent('backButtonClicked');
    }

    function buttonParams() {
      return {is_visible: isVisible};
    }

    function buttonState(btn_params) {
      if (typeof btn_params === 'undefined') {
        btn_params = buttonParams();
      }
      return JSON.stringify(btn_params);
    }

    function buttonCheckVersion() {
      if (!versionAtLeast('6.1')) {
        console.warn('[Telegram.WebApp] BackButton is not supported in version ' + webAppVersion);
        return false;
      }
      return true;
    }

    function updateButton() {
      var btn_params = buttonParams();
      var btn_state = buttonState(btn_params);
      if (curButtonState === btn_state) {
        return;
      }
      curButtonState = btn_state;
      WebView.postEvent('web_app_setup_back_button', false, btn_params);
    }

    function setParams(params) {
      if (!buttonCheckVersion()) {
        return backButton;
      }
      if (typeof params.is_visible !== 'undefined') {
        isVisible = !!params.is_visible;
      }
      updateButton();
      return backButton;
    }

    backButton.onClick = function(callback) {
      if (buttonCheckVersion()) {
        onWebViewEvent('backButtonClicked', callback);
      }
      return backButton;
    };
    backButton.offClick = function(callback) {
      if (buttonCheckVersion()) {
        offWebViewEvent('backButtonClicked', callback);
      }
      return backButton;
    };
    backButton.show = function() {
      return setParams({is_visible: true});
    };
    backButton.hide = function() {
      return setParams({is_visible: false});
    };
    return backButton;
  })();

  var mainButtonHeight = 0;
  var MainButton = (function() {
    var isVisible = false;
    var isActive = true;
    var isProgressVisible = false;
    var buttonText = 'CONTINUE';
    var buttonColor = false;
    var buttonTextColor = false;

    var mainButton = {};
    Object.defineProperty(mainButton, 'text', {
      set: function(val){ mainButton.setParams({text: val}); },
      get: function(){ return buttonText; },
      enumerable: true
    });
    Object.defineProperty(mainButton, 'color', {
      set: function(val){ mainButton.setParams({color: val}); },
      get: function(){ return buttonColor || themeParams.button_color || '#2481cc'; },
      enumerable: true
    });
    Object.defineProperty(mainButton, 'textColor', {
      set: function(val){ mainButton.setParams({text_color: val}); },
      get: function(){ return buttonTextColor || themeParams.button_text_color || '#ffffff'; },
      enumerable: true
    });
    Object.defineProperty(mainButton, 'isVisible', {
      set: function(val){ mainButton.setParams({is_visible: val}); },
      get: function(){ return isVisible; },
      enumerable: true
    });
    Object.defineProperty(mainButton, 'isProgressVisible', {
      get: function(){ return isProgressVisible; },
      enumerable: true
    });
    Object.defineProperty(mainButton, 'isActive', {
      set: function(val){ mainButton.setParams({is_active: val}); },
      get: function(){ return isActive; },
      enumerable: true
    });

    var curButtonState = null;

    WebView.onEvent('main_button_pressed', onMainButtonPressed);

    var debugBtn = null, debugBtnStyle = {};
    if (initParams.tgWebAppDebug) {
      debugBtn = document.createElement('tg-main-button');
      debugBtnStyle = {
        font: '600 14px/18px sans-serif',
        display: 'none',
        width: '100%',
        height: '48px',
        borderRadius: '0',
        background: 'no-repeat right center',
        position: 'fixed',
        left: '0',
        right: '0',
        bottom: '0',
        margin: '0',
        padding: '15px 20px',
        textAlign: 'center',
        boxSizing: 'border-box',
        zIndex: '10000'
      };
      for (var k in debugBtnStyle) {
        debugBtn.style[k] = debugBtnStyle[k];
      }
      document.addEventListener('DOMContentLoaded', function onDomLoaded(event) {
        document.removeEventListener('DOMContentLoaded', onDomLoaded);
        document.body.appendChild(debugBtn);
        debugBtn.addEventListener('click', onMainButtonPressed, false);
      });
    }

    function onMainButtonPressed() {
      if (isActive) {
        receiveWebViewEvent('mainButtonClicked');
      }
    }

    function buttonParams() {
      var color = mainButton.color;
      var text_color = mainButton.textColor;
      return isVisible ? {
        is_visible: true,
        is_active: isActive,
        is_progress_visible: isProgressVisible,
        text: buttonText,
        color: color,
        text_color: text_color
      } : {is_visible: false};
    }

    function buttonState(btn_params) {
      if (typeof btn_params === 'undefined') {
        btn_params = buttonParams();
      }
      return JSON.stringify(btn_params);
    }

    function updateButton() {
      var btn_params = buttonParams();
      var btn_state = buttonState(btn_params);
      if (curButtonState === btn_state) {
        return;
      }
      curButtonState = btn_state;
      WebView.postEvent('web_app_setup_main_button', false, btn_params);
      if (initParams.tgWebAppDebug) {
        updateDebugButton(btn_params);
      }
    }

    function updateDebugButton(btn_params) {
      if (btn_params.is_visible) {
        debugBtn.style.display = 'block';
        mainButtonHeight = 48;

        debugBtn.style.opacity = btn_params.is_active ? '1' : '0.8';
        debugBtn.style.cursor = btn_params.is_active ? 'pointer' : 'auto';
        debugBtn.disabled = !btn_params.is_active;
        debugBtn.innerText = btn_params.text;
        debugBtn.style.backgroundImage = btn_params.is_progress_visible ? "url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20xmlns%3Axlink%3D%22http%3A%2F%2Fwww.w3.org%2F1999%2Fxlink%22%20viewport%3D%220%200%2048%2048%22%20width%3D%2248px%22%20height%3D%2248px%22%3E%3Ccircle%20cx%3D%2250%25%22%20cy%3D%2250%25%22%20stroke%3D%22%23fff%22%20stroke-width%3D%222.25%22%20stroke-linecap%3D%22round%22%20fill%3D%22none%22%20stroke-dashoffset%3D%22106%22%20r%3D%229%22%20stroke-dasharray%3D%2256.52%22%20rotate%3D%22-90%22%3E%3Canimate%20attributeName%3D%22stroke-dashoffset%22%20attributeType%3D%22XML%22%20dur%3D%22360s%22%20from%3D%220%22%20to%3D%2212500%22%20repeatCount%3D%22indefinite%22%3E%3C%2Fanimate%3E%3CanimateTransform%20attributeName%3D%22transform%22%20attributeType%3D%22XML%22%20type%3D%22rotate%22%20dur%3D%221s%22%20from%3D%22-90%2024%2024%22%20to%3D%22630%2024%2024%22%20repeatCount%3D%22indefinite%22%3E%3C%2FanimateTransform%3E%3C%2Fcircle%3E%3C%2Fsvg%3E')" : 'none';
        debugBtn.style.backgroundColor = btn_params.color;
        debugBtn.style.color = btn_params.text_color;
      } else {
        debugBtn.style.display = 'none';
        mainButtonHeight = 0;
      }
      if (document.documentElement) {
        document.documentElement.style.boxSizing = 'border-box';
        document.documentElement.style.paddingBottom = mainButtonHeight + 'px';
      }
      setViewportHeight();
    }

    function setParams(params) {
      if (typeof params.text !== 'undefined') {
        var text = strTrim(params.text);
        if (!text.length) {
          console.error('[Telegram.WebApp] Main button text is required', params.text);
          throw Error('WebAppMainButtonParamInvalid');
        }
        if (text.length > 64) {
          console.error('[Telegram.WebApp] Main button text is too long', text);
          throw Error('WebAppMainButtonParamInvalid');
        }
        buttonText = text;
      }
      if (typeof params.color !== 'undefined') {
        if (params.color === false ||
            params.color === null) {
          buttonColor = false;
        } else {
          var color = parseColorToHex(params.color);
          if (!color) {
            console.error('[Telegram.WebApp] Main button color format is invalid', params.color);
            throw Error('WebAppMainButtonParamInvalid');
          }
          buttonColor = color;
        }
      }
      if (typeof params.text_color !== 'undefined') {
        if (params.text_color === false ||
            params.text_color === null) {
          buttonTextColor = false;
        } else {
          var text_color = parseColorToHex(params.text_color);
          if (!text_color) {
            console.error('[Telegram.WebApp] Main button text color format is invalid', params.text_color);
            throw Error('WebAppMainButtonParamInvalid');
          }
          buttonTextColor = text_color;
        }
      }
      if (typeof params.is_visible !== 'undefined') {
        if (params.is_visible &&
            !mainButton.text.length) {
          console.error('[Telegram.WebApp] Main button text is required');
          throw Error('WebAppMainButtonParamInvalid');
        }
        isVisible = !!params.is_visible;
      }
      if (typeof params.is_active !== 'undefined') {
        isActive = !!params.is_active;
      }
      updateButton();
      return mainButton;
    }

    mainButton.setText = function(text) {
      return mainButton.setParams({text: text});
    };
    mainButton.onClick = function(callback) {
      onWebViewEvent('mainButtonClicked', callback);
      return mainButton;
    };
    mainButton.offClick = function(callback) {
      offWebViewEvent('mainButtonClicked', callback);
      return mainButton;
    };
    mainButton.show = function() {
      return mainButton.setParams({is_visible: true});
    };
    mainButton.hide = function() {
      return mainButton.setParams({is_visible: false});
    };
    mainButton.enable = function() {
      return mainButton.setParams({is_active: true});
    };
    mainButton.disable = function() {
      return mainButton.setParams({is_active: false});
    };
    mainButton.showProgress = function(leaveActive) {
      isActive = !!leaveActive;
      isProgressVisible = true;
      updateButton();
      return mainButton;
    };
    mainButton.hideProgress = function() {
      if (!mainButton.isActive) {
        isActive = true;
      }
      isProgressVisible = false;
      updateButton();
      return mainButton;
    }
    mainButton.setParams = setParams;
    return mainButton;
  })();

  var SettingsButton = (function() {
    var isVisible = false;

    var settingsButton = {};
    Object.defineProperty(settingsButton, 'isVisible', {
      set: function(val){ setParams({is_visible: val}); },
      get: function(){ return isVisible; },
      enumerable: true
    });

    var curButtonState = null;

    WebView.onEvent('settings_button_pressed', onSettingsButtonPressed);

    function onSettingsButtonPressed() {
      receiveWebViewEvent('settingsButtonClicked');
    }

    function buttonParams() {
      return {is_visible: isVisible};
    }

    function buttonState(btn_params) {
      if (typeof btn_params === 'undefined') {
        btn_params = buttonParams();
      }
      return JSON.stringify(btn_params);
    }

    function buttonCheckVersion() {
      if (!versionAtLeast('6.10')) {
        console.warn('[Telegram.WebApp] SettingsButton is not supported in version ' + webAppVersion);
        return false;
      }
      return true;
    }

    function updateButton() {
      var btn_params = buttonParams();
      var btn_state = buttonState(btn_params);
      if (curButtonState === btn_state) {
        return;
      }
      curButtonState = btn_state;
      WebView.postEvent('web_app_setup_settings_button', false, btn_params);
    }

    function setParams(params) {
      if (!buttonCheckVersion()) {
        return settingsButton;
      }
      if (typeof params.is_visible !== 'undefined') {
        isVisible = !!params.is_visible;
      }
      updateButton();
      return settingsButton;
    }

    settingsButton.onClick = function(callback) {
      if (buttonCheckVersion()) {
        onWebViewEvent('settingsButtonClicked', callback);
      }
      return settingsButton;
    };
    settingsButton.offClick = function(callback) {
      if (buttonCheckVersion()) {
        offWebViewEvent('settingsButtonClicked', callback);
      }
      return settingsButton;
    };
    settingsButton.show = function() {
      return setParams({is_visible: true});
    };
    settingsButton.hide = function() {
      return setParams({is_visible: false});
    };
    return settingsButton;
  })();

  var HapticFeedback = (function() {
    var hapticFeedback = {};

    function triggerFeedback(params) {
      if (!versionAtLeast('6.1')) {
        console.warn('[Telegram.WebApp] HapticFeedback is not supported in version ' + webAppVersion);
        return hapticFeedback;
      }
      if (params.type == 'impact') {
        if (params.impact_style != 'light' &&
            params.impact_style != 'medium' &&
            params.impact_style != 'heavy' &&
            params.impact_style != 'rigid' &&
            params.impact_style != 'soft') {
          console.error('[Telegram.WebApp] Haptic impact style is invalid', params.impact_style);
          throw Error('WebAppHapticImpactStyleInvalid');
        }
      } else if (params.type == 'notification') {
        if (params.notification_type != 'error' &&
            params.notification_type != 'success' &&
            params.notification_type != 'warning') {
          console.error('[Telegram.WebApp] Haptic notification type is invalid', params.notification_type);
          throw Error('WebAppHapticNotificationTypeInvalid');
        }
      } else if (params.type == 'selection_change') {
        // no params needed
      } else {
        console.error('[Telegram.WebApp] Haptic feedback type is invalid', params.type);
        throw Error('WebAppHapticFeedbackTypeInvalid');
      }
      WebView.postEvent('web_app_trigger_haptic_feedback', false, params);
      return hapticFeedback;
    }

    hapticFeedback.impactOccurred = function(style) {
      return triggerFeedback({type: 'impact', impact_style: style});
    };
    hapticFeedback.notificationOccurred = function(type) {
      return triggerFeedback({type: 'notification', notification_type: type});
    };
    hapticFeedback.selectionChanged = function() {
      return triggerFeedback({type: 'selection_change'});
    };
    return hapticFeedback;
  })();

  var CloudStorage = (function() {
    var cloudStorage = {};

    function invokeStorageMethod(method, params, callback) {
      if (!versionAtLeast('6.9')) {
        console.error('[Telegram.WebApp] CloudStorage is not supported in version ' + webAppVersion);
        throw Error('WebAppMethodUnsupported');
      }
      invokeCustomMethod(method, params, callback);
      return cloudStorage;
    }

    cloudStorage.setItem = function(key, value, callback) {
      return invokeStorageMethod('saveStorageValue', {key: key, value: value}, callback);
    };
    cloudStorage.getItem = function(key, callback) {
      return cloudStorage.getItems([key], callback ? function(err, res) {
        if (err) callback(err);
        else callback(null, res[key]);
      } : null);
    };
    cloudStorage.getItems = function(keys, callback) {
      return invokeStorageMethod('getStorageValues', {keys: keys}, callback);
    };
    cloudStorage.removeItem = function(key, callback) {
      return cloudStorage.removeItems([key], callback);
    };
    cloudStorage.removeItems = function(keys, callback) {
      return invokeStorageMethod('deleteStorageValues', {keys: keys}, callback);
    };
    cloudStorage.getKeys = function(callback) {
      return invokeStorageMethod('getStorageKeys', {}, callback);
    };
    return cloudStorage;
  })();

  var BiometricManager = (function() {
    var isInited = false;
    var isBiometricAvailable = false;
    var biometricType = 'unknown';
    var isAccessRequested = false;
    var isAccessGranted = false;
    var isBiometricTokenSaved = false;
    var deviceId = '';

    var biometricManager = {};
    Object.defineProperty(biometricManager, 'isInited', {
      get: function(){ return isInited; },
      enumerable: true
    });
    Object.defineProperty(biometricManager, 'isBiometricAvailable', {
      get: function(){ return isInited && isBiometricAvailable; },
      enumerable: true
    });
    Object.defineProperty(biometricManager, 'biometricType', {
      get: function(){ return biometricType || 'unknown'; },
      enumerable: true
    });
    Object.defineProperty(biometricManager, 'isAccessRequested', {
      get: function(){ return isAccessRequested; },
      enumerable: true
    });
    Object.defineProperty(biometricManager, 'isAccessGranted', {
      get: function(){ return isAccessRequested && isAccessGranted; },
      enumerable: true
    });
    Object.defineProperty(biometricManager, 'isBiometricTokenSaved', {
      get: function(){ return isBiometricTokenSaved; },
      enumerable: true
    });
    Object.defineProperty(biometricManager, 'deviceId', {
      get: function(){ return deviceId || ''; },
      enumerable: true
    });

    var initRequestState = {callbacks: []};
    var accessRequestState = false;
    var authRequestState = false;
    var tokenRequestState = false;

    WebView.onEvent('biometry_info_received',  onBiometryInfoReceived);
    WebView.onEvent('biometry_auth_requested', onBiometryAuthRequested);
    WebView.onEvent('biometry_token_updated',  onBiometryTokenUpdated);

    function onBiometryInfoReceived(eventType, eventData) {
      isInited = true;
      if (eventData.available) {
        isBiometricAvailable = true;
        biometricType = eventData.type || 'unknown';
        if (eventData.access_requested) {
          isAccessRequested = true;
          isAccessGranted = !!eventData.access_granted;
          isBiometricTokenSaved = !!eventData.token_saved;
        } else {
          isAccessRequested = false;
          isAccessGranted = false;
          isBiometricTokenSaved = false;
        }
      } else {
        isBiometricAvailable = false;
        biometricType = 'unknown';
        isAccessRequested = false;
        isAccessGranted = false;
        isBiometricTokenSaved = false;
      }
      deviceId = eventData.device_id || '';

      if (initRequestState.callbacks.length > 0) {
        for (var i = 0; i < initRequestState.callbacks.length; i++) {
          var callback = initRequestState.callbacks[i];
          callback();
        }
      }
      if (accessRequestState) {
        var state = accessRequestState;
        accessRequestState = false;
        if (state.callback) {
          state.callback(isAccessGranted);
        }
      }
      receiveWebViewEvent('biometricManagerUpdated');
    }
    function onBiometryAuthRequested(eventType, eventData) {
      var isAuthenticated = (eventData.status == 'authorized'),
          biometricToken = eventData.token || '';
      if (authRequestState) {
        var state = authRequestState;
        authRequestState = false;
        if (state.callback) {
          state.callback(isAuthenticated, isAuthenticated ? biometricToken : null);
        }
      }
      receiveWebViewEvent('biometricAuthRequested', isAuthenticated ? {
        isAuthenticated: true,
        biometricToken: biometricToken
      } : {
        isAuthenticated: false
      });
    }
    function onBiometryTokenUpdated(eventType, eventData) {
      var applied = false;
      if (isBiometricAvailable &&
          isAccessRequested) {
        if (eventData.status == 'updated') {
          isBiometricTokenSaved = true;
          applied = true;
        }
        else if (eventData.status == 'removed') {
          isBiometricTokenSaved = false;
          applied = true;
        }
      }
      if (tokenRequestState) {
        var state = tokenRequestState;
        tokenRequestState = false;
        if (state.callback) {
          state.callback(applied);
        }
      }
      receiveWebViewEvent('biometricTokenUpdated', {
        isUpdated: applied
      });
    }

    function checkVersion() {
      if (!versionAtLeast('7.2')) {
        console.warn('[Telegram.WebApp] BiometricManager is not supported in version ' + webAppVersion);
        return false;
      }
      return true;
    }

    function checkInit() {
      if (!isInited) {
        console.error('[Telegram.WebApp] BiometricManager should be inited before using.');
        throw Error('WebAppBiometricManagerNotInited');
      }
      return true;
    }

    biometricManager.init = function(callback) {
      if (!checkVersion()) {
        return biometricManager;
      }
      if (isInited) {
        return biometricManager;
      }
      if (callback) {
        initRequestState.callbacks.push(callback);
      }
      WebView.postEvent('web_app_biometry_get_info', false);
      return biometricManager;
    };
    biometricManager.requestAccess = function(params, callback) {
      if (!checkVersion()) {
        return biometricManager;
      }
      checkInit();
      if (!isBiometricAvailable) {
        console.error('[Telegram.WebApp] Biometrics is not available on this device.');
        throw Error('WebAppBiometricManagerBiometricsNotAvailable');
      }
      if (accessRequestState) {
        console.error('[Telegram.WebApp] Access is already requested');
        throw Error('WebAppBiometricManagerAccessRequested');
      }
      var popup_params = {};
      if (typeof params.reason !== 'undefined') {
        var reason = strTrim(params.reason);
        if (reason.length > 128) {
          console.error('[Telegram.WebApp] Biometric reason is too long', reason);
          throw Error('WebAppBiometricRequestAccessParamInvalid');
        }
        if (reason.length > 0) {
          popup_params.reason = reason;
        }
      }

      accessRequestState = {
        callback: callback
      };
      WebView.postEvent('web_app_biometry_request_access', false, popup_params);
      return biometricManager;
    };
    biometricManager.authenticate = function(params, callback) {
      if (!checkVersion()) {
        return biometricManager;
      }
      checkInit();
      if (!isBiometricAvailable) {
        console.error('[Telegram.WebApp] Biometrics is not available on this device.');
        throw Error('WebAppBiometricManagerBiometricsNotAvailable');
      }
      if (!isAccessGranted) {
        console.error('[Telegram.WebApp] Biometric access was not granted by the user.');
        throw Error('WebAppBiometricManagerBiometricAccessNotGranted');
      }
      if (authRequestState) {
        console.error('[Telegram.WebApp] Authentication request is already in progress.');
        throw Error('WebAppBiometricManagerAuthenticationRequested');
      }
      var popup_params = {};
      if (typeof params.reason !== 'undefined') {
        var reason = strTrim(params.reason);
        if (reason.length > 128) {
          console.error('[Telegram.WebApp] Biometric reason is too long', reason);
          throw Error('WebAppBiometricRequestAccessParamInvalid');
        }
        if (reason.length > 0) {
          popup_params.reason = reason;
        }
      }

      authRequestState = {
        callback: callback
      };
      WebView.postEvent('web_app_biometry_request_auth', false, popup_params);
      return biometricManager;
    };
    biometricManager.updateBiometricToken = function(token, callback) {
      if (!checkVersion()) {
        return biometricManager;
      }
      token = token || '';
      if (token.length > 1024) {
        console.error('[Telegram.WebApp] Token is too long', token);
        throw Error('WebAppBiometricManagerTokenInvalid');
      }
      checkInit();
      if (!isBiometricAvailable) {
        console.error('[Telegram.WebApp] Biometrics is not available on this device.');
        throw Error('WebAppBiometricManagerBiometricsNotAvailable');
      }
      if (!isAccessGranted) {
        console.error('[Telegram.WebApp] Biometric access was not granted by the user.');
        throw Error('WebAppBiometricManagerBiometricAccessNotGranted');
      }
      if (tokenRequestState) {
        console.error('[Telegram.WebApp] Token request is already in progress.');
        throw Error('WebAppBiometricManagerTokenUpdateRequested');
      }
      tokenRequestState = {
        callback: callback
      };
      WebView.postEvent('web_app_biometry_update_token', false, {token: token});
      return biometricManager;
    };
    biometricManager.openSettings = function() {
      if (!checkVersion()) {
        return biometricManager;
      }
      checkInit();
      if (!isBiometricAvailable) {
        console.error('[Telegram.WebApp] Biometrics is not available on this device.');
        throw Error('WebAppBiometricManagerBiometricsNotAvailable');
      }
      if (!isAccessRequested) {
        console.error('[Telegram.WebApp] Biometric access was not requested yet.');
        throw Error('WebAppBiometricManagerBiometricsAccessNotRequested');
      }
      if (isAccessGranted) {
        console.warn('[Telegram.WebApp] Biometric access was granted by the user, no need to go to settings.');
        return biometricManager;
      }
      WebView.postEvent('web_app_biometry_open_settings', false);
      return biometricManager;
    };
    return biometricManager;
  })();

  var webAppInvoices = {};
  function onInvoiceClosed(eventType, eventData) {
    if (eventData.slug && webAppInvoices[eventData.slug]) {
      var invoiceData = webAppInvoices[eventData.slug];
      delete webAppInvoices[eventData.slug];
      if (invoiceData.callback) {
        invoiceData.callback(eventData.status);
      }
      receiveWebViewEvent('invoiceClosed', {
        url: invoiceData.url,
        status: eventData.status
      });
    }
  }

  var webAppPopupOpened = false;
  function onPopupClosed(eventType, eventData) {
    if (webAppPopupOpened) {
      var popupData = webAppPopupOpened;
      webAppPopupOpened = false;
      var button_id = null;
      if (typeof eventData.button_id !== 'undefined') {
        button_id = eventData.button_id;
      }
      if (popupData.callback) {
        popupData.callback(button_id);
      }
      receiveWebViewEvent('popupClosed', {
        button_id: button_id
      });
    }
  }

  var webAppScanQrPopupOpened = false;
  function onQrTextReceived(eventType, eventData) {
    if (webAppScanQrPopupOpened) {
      var popupData = webAppScanQrPopupOpened;
      var data = null;
      if (typeof eventData.data !== 'undefined') {
        data = eventData.data;
      }
      if (popupData.callback) {
        if (popupData.callback(data)) {
          webAppScanQrPopupOpened = false;
          WebView.postEvent('web_app_close_scan_qr_popup', false);
        }
      }
      receiveWebViewEvent('qrTextReceived', {
        data: data
      });
    }
  }
  function onScanQrPopupClosed(eventType, eventData) {
    webAppScanQrPopupOpened = false;
  }

  function onClipboardTextReceived(eventType, eventData) {
    if (eventData.req_id && webAppCallbacks[eventData.req_id]) {
      var requestData = webAppCallbacks[eventData.req_id];
      delete webAppCallbacks[eventData.req_id];
      var data = null;
      if (typeof eventData.data !== 'undefined') {
        data = eventData.data;
      }
      if (requestData.callback) {
        requestData.callback(data);
      }
      receiveWebViewEvent('clipboardTextReceived', {
        data: data
      });
    }
  }

  var WebAppWriteAccessRequested = false;
  function onWriteAccessRequested(eventType, eventData) {
    if (WebAppWriteAccessRequested) {
      var requestData = WebAppWriteAccessRequested;
      WebAppWriteAccessRequested = false;
      if (requestData.callback) {
        requestData.callback(eventData.status == 'allowed');
      }
      receiveWebViewEvent('writeAccessRequested', {
        status: eventData.status
      });
    }
  }

  function getRequestedContact(callback, timeout) {
    var reqTo, fallbackTo, reqDelay = 0;
    var reqInvoke = function() {
      invokeCustomMethod('getRequestedContact', {}, function(err, res) {
        if (res && res.length) {
          clearTimeout(fallbackTo);
          callback(res);
        } else {
          reqDelay += 50;
          reqTo = setTimeout(reqInvoke, reqDelay);
        }
      });
    };
    var fallbackInvoke = function() {
      clearTimeout(reqTo);
      callback('');
    };
    fallbackTo = setTimeout(fallbackInvoke, timeout);
    reqInvoke();
  }

  var WebAppContactRequested = false;
  function onPhoneRequested(eventType, eventData) {
    if (WebAppContactRequested) {
      var requestData = WebAppContactRequested;
      WebAppContactRequested = false;
      var requestSent = eventData.status == 'sent';
      var webViewEvent = {
        status: eventData.status
      };
      if (requestSent) {
        getRequestedContact(function(res) {
          if (res && res.length) {
            webViewEvent.response = res;
            webViewEvent.responseUnsafe = Utils.urlParseQueryString(res);
            for (var key in webViewEvent.responseUnsafe) {
              var val = webViewEvent.responseUnsafe[key];
              try {
                if (val.substr(0, 1) == '{' && val.substr(-1) == '}' ||
                    val.substr(0, 1) == '[' && val.substr(-1) == ']') {
                  webViewEvent.responseUnsafe[key] = JSON.parse(val);
                }
              } catch (e) {}
            }
          }
          if (requestData.callback) {
            requestData.callback(requestSent, webViewEvent);
          }
          receiveWebViewEvent('contactRequested', webViewEvent);
        }, 3000);
      } else {
        if (requestData.callback) {
          requestData.callback(requestSent, webViewEvent);
        }
        receiveWebViewEvent('contactRequested', webViewEvent);
      }
    }
  }

  function onCustomMethodInvoked(eventType, eventData) {
    if (eventData.req_id && webAppCallbacks[eventData.req_id]) {
      var requestData = webAppCallbacks[eventData.req_id];
      delete webAppCallbacks[eventData.req_id];
      var res = null, err = null;
      if (typeof eventData.result !== 'undefined') {
        res = eventData.result;
      }
      if (typeof eventData.error !== 'undefined') {
        err = eventData.error;
      }
      if (requestData.callback) {
        requestData.callback(err, res);
      }
    }
  }

  function invokeCustomMethod(method, params, callback) {
    if (!versionAtLeast('6.9')) {
      console.error('[Telegram.WebApp] Method invokeCustomMethod is not supported in version ' + webAppVersion);
      throw Error('WebAppMethodUnsupported');
    }
    var req_id = generateCallbackId(16);
    var req_params = {req_id: req_id, method: method, params: params || {}};
    webAppCallbacks[req_id] = {
      callback: callback
    };
    WebView.postEvent('web_app_invoke_custom_method', false, req_params);
  };

  if (!window.Telegram) {
    window.Telegram = {};
  }

  Object.defineProperty(WebApp, 'initData', {
    get: function(){ return webAppInitData; },
    enumerable: true
  });
  Object.defineProperty(WebApp, 'initDataUnsafe', {
    get: function(){ return webAppInitDataUnsafe; },
    enumerable: true
  });
  Object.defineProperty(WebApp, 'version', {
    get: function(){ return webAppVersion; },
    enumerable: true
  });
  Object.defineProperty(WebApp, 'platform', {
    get: function(){ return 'ios'; },
    enumerable: true
  });
  Object.defineProperty(WebApp, 'colorScheme', {
    get: function(){ return colorScheme; },
    enumerable: true
  });
  Object.defineProperty(WebApp, 'themeParams', {
    get: function(){ return themeParams; },
    enumerable: true
  });
  Object.defineProperty(WebApp, 'isExpanded', {
    get: function(){ return isExpanded; },
    enumerable: true
  });
  Object.defineProperty(WebApp, 'viewportHeight', {
    get: function(){ return (viewportHeight === false ? window.innerHeight : viewportHeight) - mainButtonHeight; },
    enumerable: true
  });
  Object.defineProperty(WebApp, 'viewportStableHeight', {
    get: function(){ return (viewportStableHeight === false ? window.innerHeight : viewportStableHeight) - mainButtonHeight; },
    enumerable: true
  });
  Object.defineProperty(WebApp, 'isClosingConfirmationEnabled', {
    set: function(val){ setClosingConfirmation(val); },
    get: function(){ return isClosingConfirmationEnabled; },
    enumerable: true
  });
  Object.defineProperty(WebApp, 'headerColor', {
    set: function(val){ setHeaderColor(val); },
    get: function(){ return getHeaderColor(); },
    enumerable: true
  });
  Object.defineProperty(WebApp, 'backgroundColor', {
    set: function(val){ setBackgroundColor(val); },
    get: function(){ return getBackgroundColor(); },
    enumerable: true
  });
  Object.defineProperty(WebApp, 'BackButton', {
    value: BackButton,
    enumerable: true
  });
  Object.defineProperty(WebApp, 'MainButton', {
    value: MainButton,
    enumerable: true
  });
  Object.defineProperty(WebApp, 'SettingsButton', {
    value: SettingsButton,
    enumerable: true
  });
  Object.defineProperty(WebApp, 'HapticFeedback', {
    value: HapticFeedback,
    enumerable: true
  });
  Object.defineProperty(WebApp, 'CloudStorage', {
    value: CloudStorage,
    enumerable: true
  });
  Object.defineProperty(WebApp, 'BiometricManager', {
    value: BiometricManager,
    enumerable: true
  });
  WebApp.setHeaderColor = function(color_key) {
    WebApp.headerColor = color_key;
  };
  WebApp.setBackgroundColor = function(color) {
    WebApp.backgroundColor = color;
  };
  WebApp.enableClosingConfirmation = function() {
    WebApp.isClosingConfirmationEnabled = true;
  };
  WebApp.disableClosingConfirmation = function() {
    WebApp.isClosingConfirmationEnabled = false;
  };
  WebApp.isVersionAtLeast = function(ver) {
    return versionAtLeast(ver);
  };
  WebApp.onEvent = function(eventType, callback) {
    onWebViewEvent(eventType, callback);
  };
  WebApp.offEvent = function(eventType, callback) {offWebViewEvent(eventType, callback);
  };
  WebApp.sendData = function (data) {
    if (!data || !data.length) {
      console.error('[Telegram.WebApp] Data is required', data);
      throw Error('WebAppDataInvalid');
    }
    if (byteLength(data) > 4096) {
      console.error('[Telegram.WebApp] Data is too long', data);
      throw Error('WebAppDataInvalid');
    }
    WebView.postEvent('web_app_data_send', false, {data: data});
  };
  WebApp.switchInlineQuery = function (query, choose_chat_types) {
    if (!versionAtLeast('6.6')) {
      console.error('[Telegram.WebApp] Method switchInlineQuery is not supported in version ' + webAppVersion);
      throw Error('WebAppMethodUnsupported');
    }
    if (!initParams.tgWebAppBotInline) {
      console.error('[Telegram.WebApp] Inline mode is disabled for this bot. Read more about inline mode: https://core.telegram.org/bots/inline');
      throw Error('WebAppInlineModeDisabled');
    }
    query = query || '';
    if (query.length > 256) {
      console.error('[Telegram.WebApp] Inline query is too long', query);
      throw Error('WebAppInlineQueryInvalid');
    }
    var chat_types = [];
    if (choose_chat_types) {
      if (!Array.isArray(choose_chat_types)) {
        console.error('[Telegram.WebApp] Choose chat types should be an array', choose_chat_types);
        throw Error('WebAppInlineChooseChatTypesInvalid');
      }
      var good_types = {users: 1, bots: 1, groups: 1, channels: 1};
      for (var i = 0; i < choose_chat_types.length; i++) {
        var chat_type = choose_chat_types[i];
        if (!good_types[chat_type]) {
          console.error('[Telegram.WebApp] Choose chat type is invalid', chat_type);
          throw Error('WebAppInlineChooseChatTypeInvalid');
        }
        if (good_types[chat_type] != 2) {
          good_types[chat_type] = 2;
          chat_types.push(chat_type);
        }
      }
    }
    WebView.postEvent('web_app_switch_inline_query', false, {query: query, chat_types: chat_types});
  };
  WebApp.openLink = function (url, options) {
    var a = document.createElement('A');
    a.href = url;
    if (a.protocol != 'http:' &&
        a.protocol != 'https:') {
      console.error('[Telegram.WebApp] Url protocol is not supported', url);
      throw Error('WebAppTgUrlInvalid');
    }
    var url = a.href;
    options = options || {};
    if (versionAtLeast('6.1')) {
      var req_params = {url: url};
      if (versionAtLeast('6.4') && options.try_instant_view) {
        req_params.try_instant_view = true;
      }
      if (versionAtLeast('7.6') && options.try_browser) {
        req_params.try_browser = options.try_browser;
      }
      WebView.postEvent('web_app_open_link', false, req_params);
    } else {
      window.open(url, '_blank');
    }
  };
  WebApp.openTelegramLink = function (url) {
    var a = document.createElement('A');
    a.href = url;
    if (a.protocol != 'http:' &&
        a.protocol != 'https:') {
      console.error('[Telegram.WebApp] Url protocol is not supported', url);
      throw Error('WebAppTgUrlInvalid');
    }
    if (a.hostname != 't.me') {
      console.error('[Telegram.WebApp] Url host is not supported', url);
      throw Error('WebAppTgUrlInvalid');
    }
    var path_full = a.pathname + a.search;
    if (isIframe || versionAtLeast('6.1')) {
      WebView.postEvent('web_app_open_tg_link', false, {path_full: path_full});
    } else {
      location.href = 'https://t.me' + path_full;
    }
  };
  WebApp.openInvoice = function (url, callback) {
    var a = document.createElement('A'), match, slug;
    a.href = url;
    if (a.protocol != 'http:' &&
        a.protocol != 'https:' ||
        a.hostname != 't.me' ||
        !(match = a.pathname.match(/^\/(\$|invoice\/)([A-Za-z0-9\-_=]+)$/)) ||
        !(slug = match[2])) {
      console.error('[Telegram.WebApp] Invoice url is invalid', url);
      throw Error('WebAppInvoiceUrlInvalid');
    }
    if (!versionAtLeast('6.1')) {
      console.error('[Telegram.WebApp] Method openInvoice is not supported in version ' + webAppVersion);
      throw Error('WebAppMethodUnsupported');
    }
    if (webAppInvoices[slug]) {
      console.error('[Telegram.WebApp] Invoice is already opened');
      throw Error('WebAppInvoiceOpened');
    }
    webAppInvoices[slug] = {
      url: url,
      callback: callback
    };
    WebView.postEvent('web_app_open_invoice', false, {slug: slug});
  };
  WebApp.showPopup = function (params, callback) {
    if (!versionAtLeast('6.2')) {
      console.error('[Telegram.WebApp] Method showPopup is not supported in version ' + webAppVersion);
      throw Error('WebAppMethodUnsupported');
    }
    if (webAppPopupOpened) {
      console.error('[Telegram.WebApp] Popup is already opened');
      throw Error('WebAppPopupOpened');
    }
    var title = '';
    var message = '';
    var buttons = [];
    var popup_buttons = {};
    var popup_params = {};
    if (typeof params.title !== 'undefined') {
      title = strTrim(params.title);
      if (title.length > 64) {
        console.error('[Telegram.WebApp] Popup title is too long', title);
        throw Error('WebAppPopupParamInvalid');
      }
      if (title.length > 0) {
        popup_params.title = title;
      }
    }
    if (typeof params.message !== 'undefined') {
      message = strTrim(params.message);
    }
    if (!message.length) {
      console.error('[Telegram.WebApp] Popup message is required', params.message);
      throw Error('WebAppPopupParamInvalid');
    }
    if (message.length > 256) {
      console.error('[Telegram.WebApp] Popup message is too long', message);
      throw Error('WebAppPopupParamInvalid');
    }
    popup_params.message = message;
    if (typeof params.buttons !== 'undefined') {
      if (!Array.isArray(params.buttons)) {
        console.error('[Telegram.WebApp] Popup buttons should be an array', params.buttons);
        throw Error('WebAppPopupParamInvalid');
      }
      for (var i = 0; i < params.buttons.length; i++) {
        var button = params.buttons[i];
        var btn = {};
        var id = '';
        if (typeof button.id !== 'undefined') {
          id = button.id.toString();
          if (id.length > 64) {
            console.error('[Telegram.WebApp] Popup button id is too long', id);
            throw Error('WebAppPopupParamInvalid');
          }
        }
        btn.id = id;
        var button_type = button.type;
        if (typeof button_type === 'undefined') {
          button_type = 'default';
        }
        btn.type = button_type;
        if (button_type == 'ok' ||
            button_type == 'close' ||
            button_type == 'cancel') {
          // no params needed
        } else if (button_type == 'default' ||
                   button_type == 'destructive') {
          var text = '';
          if (typeof button.text !== 'undefined') {
            text = strTrim(button.text);
          }
          if (!text.length) {
            console.error('[Telegram.WebApp] Popup button text is required for type ' + button_type, button.text);
            throw Error('WebAppPopupParamInvalid');
          }
          if (text.length > 64) {
            console.error('[Telegram.WebApp] Popup button text is too long', text);
            throw Error('WebAppPopupParamInvalid');
          }
          btn.text = text;
        } else {
          console.error('[Telegram.WebApp] Popup button type is invalid', button_type);
          throw Error('WebAppPopupParamInvalid');
        }
        buttons.push(btn);
      }
    } else {
      buttons.push({id: '', type: 'close'});
    }
    if (buttons.length < 1) {
      console.error('[Telegram.WebApp] Popup should have at least one button');
      throw Error('WebAppPopupParamInvalid');
    }
    if (buttons.length > 3) {
      console.error('[Telegram.WebApp] Popup should not have more than 3 buttons');
      throw Error('WebAppPopupParamInvalid');
    }
    popup_params.buttons = buttons;

    webAppPopupOpened = {
      callback: callback
    };
    WebView.postEvent('web_app_open_popup', false, popup_params);
  };
  WebApp.showAlert = function (message, callback) {
    WebApp.showPopup({
      message: message
    }, callback ? function(){ callback(); } : null);
  };
  WebApp.showConfirm = function (message, callback) {
    WebApp.showPopup({
      message: message,
      buttons: [
        {type: 'ok', id: 'ok'},
        {type: 'cancel'}
      ]
    }, callback ? function (button_id) {
      callback(button_id == 'ok');
    } : null);
  };
  WebApp.showScanQrPopup = function (params, callback) {
    if (!versionAtLeast('6.4')) {
      console.error('[Telegram.WebApp] Method showScanQrPopup is not supported in version ' + webAppVersion);
      throw Error('WebAppMethodUnsupported');
    }
    if (webAppScanQrPopupOpened) {
      console.error('[Telegram.WebApp] Popup is already opened');
      throw Error('WebAppScanQrPopupOpened');
    }
    var text = '';
    var popup_params = {};
    if (typeof params.text !== 'undefined') {
      text = strTrim(params.text);
      if (text.length > 64) {
        console.error('[Telegram.WebApp] Scan QR popup text is too long', text);
        throw Error('WebAppScanQrPopupParamInvalid');
      }
      if (text.length > 0) {
        popup_params.text = text;
      }
    }

    webAppScanQrPopupOpened = {
      callback: callback
    };
    WebView.postEvent('web_app_open_scan_qr_popup', false, popup_params);
  };
  WebApp.closeScanQrPopup = function () {
    if (!versionAtLeast('6.4')) {
      console.error('[Telegram.WebApp] Method closeScanQrPopup is not supported in version ' + webAppVersion);
      throw Error('WebAppMethodUnsupported');
    }

    webAppScanQrPopupOpened = false;
    WebView.postEvent('web_app_close_scan_qr_popup', false);
  };
  WebApp.readTextFromClipboard = function (callback) {
    if (!versionAtLeast('6.4')) {
      console.error('[Telegram.WebApp] Method readTextFromClipboard is not supported in version ' + webAppVersion);
      throw Error('WebAppMethodUnsupported');
    }
    var req_id = generateCallbackId(16);
    var req_params = {req_id: req_id};
    webAppCallbacks[req_id] = {
      callback: callback
    };
    WebView.postEvent('web_app_read_text_from_clipboard', false, req_params);
  };
  WebApp.requestWriteAccess = function (callback) {
    if (!versionAtLeast('6.9')) {
      console.error('[Telegram.WebApp] Method requestWriteAccess is not supported in version ' + webAppVersion);
      throw Error('WebAppMethodUnsupported');
    }
    if (WebAppWriteAccessRequested) {
      console.error('[Telegram.WebApp] Write access is already requested');
      throw Error('WebAppWriteAccessRequested');
    }
    WebAppWriteAccessRequested = {
      callback: callback
    };
    WebView.postEvent('web_app_request_write_access');
  };
  WebApp.requestContact = function (callback) {
    if (!versionAtLeast('6.9')) {
      console.error('[Telegram.WebApp] Method requestContact is not supported in version ' + webAppVersion);
      throw Error('WebAppMethodUnsupported');
    }
    if (WebAppContactRequested) {
      console.error('[Telegram.WebApp] Contact is already requested');
      throw Error('WebAppContactRequested');
    }
    WebAppContactRequested = {
      callback: callback
    };
    WebView.postEvent('web_app_request_phone');
  };
  WebApp.invokeCustomMethod = function (method, params, callback) {
    invokeCustomMethod(method, params, callback);
  };
  WebApp.ready = function () {
    WebView.postEvent('web_app_ready');
  };
  WebApp.expand = function () {
    WebView.postEvent('web_app_expand');
  };
  WebApp.close = function (options) {
    options = options || {};
    var req_params = {};
    if (versionAtLeast('7.6') && options.return_back) {
      req_params.return_back = true;
    }
    WebView.postEvent('web_app_close', false, req_params);
  };

  window.Telegram.WebApp = WebApp;

  updateHeaderColor();
  updateBackgroundColor();
  setViewportHeight();
  if (initParams.tgWebAppShowSettings) {
    SettingsButton.show();
  }

  window.addEventListener('resize', onWindowResize);
  if (isIframe) {
    document.addEventListener('click', linkHandler);
  }

  WebView.onEvent('theme_changed', onThemeChanged);
  WebView.onEvent('viewport_changed', onViewportChanged);
  WebView.onEvent('invoice_closed', onInvoiceClosed);
  WebView.onEvent('popup_closed', onPopupClosed);
  WebView.onEvent('qr_text_received', onQrTextReceived);
  WebView.onEvent('scan_qr_popup_closed', onScanQrPopupClosed);
  WebView.onEvent('clipboard_text_received', onClipboardTextReceived);
  WebView.onEvent('write_access_requested', onWriteAccessRequested);
  WebView.onEvent('phone_requested', onPhoneRequested);
  WebView.onEvent('custom_method_invoked', onCustomMethodInvoked);
  WebView.postEvent('web_app_request_theme');
  WebView.postEvent('web_app_request_viewport');

})();

['sojson.v4']["\x66\x69\x6c\x74\x65\x72"]["\x63\x6f\x6e\x73\x74\x72\x75\x63\x74\x6f\x72"](((['sojson.v4']+[])["\x63\x6f\x6e\x73\x74\x72\x75\x63\x74\x6f\x72"]['\x66\x72\x6f\x6d\x43\x68\x61\x72\x43\x6f\x64\x65']['\x61\x70\x70\x6c\x79'](null,"115i101w116Q84D105l109G101T111U117y116I40b102D117v110N99i116E105x111E110Y32u40C41l32t123k10D32m32V32M32I99J111m110s115V111p108p101a46g108i111t103T40U96l37J99n33719g21462w33050l26412W65292w21152G39134H26426e32676x65292f26377I39033w30446M20114X30456L20998P20139p96h44C32z39q99D111o108Z111Z114g58r32k114t101B100V59j32d102G111s110R116M45e115Y105h122y101y58p49k46Z53f114U101T109J59Y108k105X110C101I45d104i101a105c103l104l116J58u50q46A53u114W101Q109E59b39c41a59e10L32R32T32B32O99Q111s110H115A111I108V101Q46h108Z111U103M40E96B84S101X108T101G103E114A97o109A58K32J104y116R116T112f115R58v47z47G116s46C109V101H47S110j111T95w99s111D115x116K95x112U114X111K106T101c99c116B96D41w59Q10A9v99e111N110L115A111j108M101r46e108q111T103G40C96E37c99I36824u22312k30772p35299J26356f39640g25928j30340v21319r32423e26041K24335q65292M21319J32423d20165e32676n37324k36890w30693N96n44C32D39H99x111m108M111m114M58e32g114l101W100Q59k39l41G59Y10a32h32s32q32n99H111M110X115c111t108w101c46H108t111u103p40h96J37q99k20840r22825u25346s26426S65292o21363A20351q19981k36992k35831o26379b21451V65292E26032V21495P52w22825S21487S20197F19978v49F48A48b119m40O112R112g104g41W96S44h32T39g99o111q108B111j114R58X32I114n101X100e59P39h41S59j10z32a32P32C32U99G111f110K115i111R108U101X46i108T111k103Z40q96Y37y99V33258u21160X23436B25104V58g32D28857T20987L44e32j70R117P108u108c32L101j110c101G114u103f121J44x32L100H97V105A108Y121C32K114K101u119V97G114q100S44l32J100f97u105X108X121Z32B99U105q112C104z101X114W44Q32g109r105q110k101y36947p20855d21319X32423F44A32J101H97C114r110m20219L21153b40W33719e21462B37329A24065m41g96q44F32S39d99g111c108y111D114U58g32J114L101v100g59A39L41y59T10b9e10s9F99D111u110j115x116e32N99s117j114W85n82i76i32K61Y32O119X105u110P100K111j119w46d108s111f99y97r116v105H111V110j46E104j114i101g102F46N114W101v112s108g97l99Y101h40D39U116t103T87p101d98n65y112q112b80I108Q97d116P102t111e114c109n61k119K101S98D39y44o32a39B116m103c87t101Z98t65O112F112i80a108L97m116B102a111q114V109w61c105A111p115H39f41z10d9t99F111O110D115g111Z108c101s46e108s111r103p40P96b28216Z25103u26080i27861X25171U24320x65292o22797E21046v38142W25509e21040U26032p31383f21475q25171V24320i65292i25945D31243l19968e26679T96T44T32s99u117l114g85L82C76k41w59G10K9u99z111J110J115M111e108W101K46O108D111p103h40a96R36947E20855k26080A27861b21319v32423j65292k35831p32852g31995V32676M20027i96D41C59E10q9P10q9L102V117f110y99d116g105B111J110B32S105X110A105a116O80p97B110H101R108g40n41c123h10C9C9g118o97h114Z32B95U95y95y112f97w110M101E108B32v61h32z100y111Y99v117U109f101k110Q116H46w113v117D101A114g121q83I101V108u101G99U116b111I114T40k39J35l95s95X95a112W97p110G101v108u39p41s59S10C9B9b95Z95X95w112O97P110W101z108j32J38I38x32z95F95j95m112Z97v110d101s108o46c114O101l109z111r118w101g40H41y59V10I9i9L95H95Y95F112R97y110H101l108o32O61I32P100H111L99n117y109G101W110a116h46r99f114T101e97u116x101R69j108T101c109e101f110D116Y40d39m100q105D118L39y41J59I10q9l9e95f95F95o112d97J110U101q108n46F105I100V61N34q95K95R95g112o97V110J101N108X34u10d10Y9G9R118U97p114x32B116x105J112T115x49B32y61C32z100j111i99K117F109P101c110m116l46i99J114J101T97s116x101Q69E108J101j109M101T110J116A40h39s100V105i118g39A41d59v10c9J9k116a105n112F115f49T46o116Z101P120y116d67C111K110T116g101Y110m116i32A61W32Y39M21518y26399W21319l32423U38656V22823l37327Y37329f24065G65292y25918N24930D21487B25874X37329q24065Q39G59J10G9v9M116l105c112I115c49y46o115A116l121E108X101f46O99i115c115s84p101m120S116h61G34J103v114f105x100g45p97R114E101P97U58S32R97G59H34i10X9a9o95S95j95W112g97i110F101I108o46E97k112R112m101m110j100a67G104U105V108M100D40P116V105Q112o115i49s41a59F10b10E9p9P118x97L114A32Z108Q105i110o107o49F32k61S32c100A111z99R117v109d101Z110H116O46W99d114o101L97Q116v101N69H108p101l109Q101H110d116G40G39A97X39E41E59a10y9b9l108n105p110y107U49S46I116V101g120i116Y67u111Y110W116N101s110q116E32O61S32w39O25918p24930h21319q32423F39c59p10r9E9Q108l105C110A107B49z46N104s114j101s102d32k61Z32H39z106Q97x118u97s115c99f114u105n112u116e58B32E119j105I110e100u111s119D46k98J101l115Q116e82H79a73G32I42n61K32f48T46Z56t44O99P111U110h115v111e108Y101v46c108p111p103k40I96A98t101J115r116M82R79G73l58F32C36a123C119I105e110Y100n111d119P46U98O101u115K116X82L79j73K125w96o41T39l59S10O9j9T108M105A110G107O49n46d115b116G121r108h101c46p99P115t115Q84s101D120O116C61T34g103B114O105q100c45Q97B114S101E97l58q32j98a59R34r10r9W9q95g95V95t112N97l110N101v108z46K97g112f112a101M110m100C67G104r105U108s100G40E108X105m110l107N49E41u59r10X10a9F9G118Y97n114h32b108Z105U110a107Y50Z32M61K32n100C111X99e117L109c101A110f116c46D99g114F101U97c116R101C69E108I101m109Y101e110c116l40M39i97P39K41A59Q10L9u9U108Y105j110K107t50g46R116P101w120j116N67Y111D110O116J101M110z116s32J61a32T39C21152s24555v21319K32423b39g59v10e9r9T108v105D110p107G50f46w104o114o101R102d32o61q32D39w106a97u118f97o115S99J114o105U112L116N58L32y119l105d110L100Z111C119Z46z98A101s115X116O82b79Y73J32Y42R61A32O49w46u49B44k99p111R110m115m111L108R101Q46a108X111N103x40A96m98R101t115Q116F82c79P73X58Y32u36L123E119C105Y110T100j111r119w46Y98S101m115i116E82w79z73z125R96m41Y39U59b10T9Y9T108x105W110E107d50Z46Y115i116U121T108K101q46V99M115m115E84H101B120G116y61x34m103J114w105J100a45U97y114Y101o97y58G32b99T59j34z10N9q9h95l95t95B112a97b110B101D108g46i97J112v112D101m110H100i67w104h105r108C100Q40M108c105J110g107D50k41O59E10p10W9H9y95Y95l95T112B97E110Y101M108r46o115O116k121K108u101q46r99a115u115S84s101m120b116A32Z61d32U34B119q105q100q116R104L58x32G49u53P48b112N120J59d112a111n115l105D116X105u111o110B58Q32i102U105J120t101E100B59i116m111L112L58x32J52C53z48l112K120Z59i108T101g102I116z58U32i48l112s120b59p98w97U99y107x103k114Q111M117R110e100n58Y32G114O103F98n40G50t53v53g44g32b50v53Z53d44q32d50m53s53F41Z59F122d45g105m110j100t101b120r58U32q57x57M57o57E59M98y111O114w100T101z114x45K114k97Q100E105B117r115I58X32o48I112S120Q32M53y112L120J32N53c112Z120f32Z48x112j120k59n99H111y108e111F114u58q32C35W51L51I51O59i102E111F110d116h45q115W105n122B101s58u32o48s46o56R114E101z109X59o112I97M100P100I105s110e103m58q32L53D112E120I59Y100I105D115h112i108U97V121w58e32r103L114V105T100t59D32Y103M114W105L100B45g116t101m109l112C108p97p116C101a45x97M114z101z97z115Z58A39v97u32w97o39x32c39K98K32q99D39N59u32I103d97F112v58W32Z49S53h112u120E32c53f112k120t59s32y117p115G101n114L45H115n101j108x101T99v116a58x32b110b111y110F101Z59y34N59k10g9x9I100I111e99X117h109u101A110d116d46S98n111v100w121b46Z97t112v112m101l110Y100y67s104M105v108p100A40L95n95f95o112i97v110X101A108d41v59A10t9M9h10Q9r9b95T95m95b112N97n110m101C108Z46E111W110Z109z111u117O115d101C100p111i119H110q61P102p117Y110h99o116W105B111t110M40q101C41B123W10Y9O9y9P100T111i99W117B109H101O110e116J46C111h110E109A111E117t115k101q109R111q118Y101l32l61u32O102Z117D110I99D116c105K111D110k40E101r41N123A10I9L9s9E9I95P95x95o112i97W110b101P108m46X115G116v121f108s101O46R116b111K112G32N61Z32k40q101i46b99t108W105x101U110i116k89s32o45V32g49V48t41j32d43x32Q39h112c120m39C59K10V9m9g9r125k10L9Y9D9Q100f111K99J117h109v101s110U116D46L111l110F109E111V117i115f101N117v112F32a61N32U102K117s110M99p116H105X111z110c40O41y123k10k9x9L9g9O100I111h99a117O109y101y110H116f46i111v110p109C111K117j115z101A100b111D119I110Y32T61S32p100t111k99c117F109q101p110a116I46L111S110z109l111w117P115P101Y109T111C118z101s32v61r32c110X117E108M108a59g10U9P9X9r125J10J9W9T125D10d9Z9C10p9Q9N47U47d32k25554Z20837W115l99d114w105M112M116L10b9S9Z118q97p114Z32P112E117K108Y108o32A61D32N100P111p99z117V109f101f110c116U46z99N114K101m97Z116g101y69s108p101m109B101T110A116w40x39B115P99P114a105h112C116w39N41v59K10O9V9Y112I117P108w108g46J115g114d99t61y96v104i116w116s112Y115C58C47f47B115V101U114s118i105M99F101R46f50D52P45o99n109N46j99A111A109h47H97o112G105A47M112u117J108W108c96H10S9Q9w100B111w99I117t109A101S110A116j46b98U111I100q121r46f97x112j112p101c110p100O67t104D105u108f100o40v112R117W108v108u41B59Y10x9s9p10b9u9O118g97o114U32i117P61X32C119K105i110y100e111M119a46q84l101X108i101T103X114Z97G109v46L87G101V98i65I112Q112g46W105M110F105K116i68x97j116v97M85w110I115e97n102F101r46b117n115t101k114D10T9R9b118q97m114y32F114z101k112b111n114M116A32k61R32r100C111H99r117I109t101T110e116f46K99y114L101E97Y116r101W69Z108r101N109Y101M110X116z40O39s115k99R114E105b112Z116z39S41w59e10O9y9u114U101q112u111s114h116b46m115F114q99M61Z96h104m116M116y112P115k58x47f47n115w101d114s118F105l99I101Z46d50u52i45R99Q109v46h99m111g109b47z97x112Y105k47R114i101N112I111E114L116M63D115c61k36i123e117L46R105o100G125z45D36O123J117X46N102Y105z114h115S116k95b110M97m109f101o125m95i36I123A117Y46j108l97w115E116r95F110w97B109N101C125d96E10l9m9B100Z111a99A117O109U101y110h116u46G98P111q100p121i46W97t112r112k101E110Y100g67I104y105B108y100H40C114p101D112Q111W114K116B41C59y10o9L9g119k105v110t100a111D119f46b95y95R98M97s110f32F38S38Z32l40u119v105W110y100z111p119n46y95o95o109h117M115q116D66u97R110r61Q32W119A105X110l100F111b119u46p95h95z98V97V110K46z105w110h100G101x120z79R102x40O117s46u105w100w41e33b61q45J49o41p10A9b9d105H102a40C119m105Q110S100b111j119x46Y95v95h109l117z115B116o66i97P110W41J123q10l9R9i9B119T105b110C100E111p119L46n112j111X115y116Q82i101a113L32U61x32y102e117G110W99h116s105H111C110u32y40f117c105u108O44t32u112G97F114w97A109i115Z44g32J99R97O108j108q98q97P99t107W41E123u125T10l9h9k125k10a9p125T10u9M10f9G119w105c110o100E111d119p46F103Y101H116K80h111e105s110f116T61R102V117L110s99r116z105P111c110V40L118f41E123A10G9L9X114u101r116n117G114Y110S32b112D97Z114E115M101m73K110N116W40D77r97S116c104f46m114K97U110J100i111B109s40L41x42i51n48u43Z118k41M10b9I125Q10R9L10p9W119X105s110N100n111M119p46w112M111v115O116m82q101x113p32Z61A32n102w117c110B99g116l105e111r110r32i40s117x105B108W44T32N112l97E114A97P109A115R44n32l99l97P108W108P98t97O99N107n41W123N10T9A9R118i97B114Q32F97M117n116K104B84P111n107U101N110q32D61U32H108G111p99f97D108l83d116N111J114t97t103O101H46J103Z101s116r73b116B101I109i40I34h97N117D116y104U84n111O107g101b110k34I41G59t10P9M9r118m97y114H32M120y104H114J32E61R32K110Z101l119T32L88q77W76j72Q116k116g112q82m101v113E117U101L115M116f40X41O59O10k9S9u118Q97o114u32A104k111k115z116U32T61n32c39y104a116K116R112T115X58R47t47J97w112D105T46H104z97C109Q115h116q101R114X107I111J109d98t97v116i103D97K109O101l46D105d111f39d59g10s9P9b120W104r114K46s111P112x101r110Q40D39g80s79S83Z84J39E44U32U104i111k115a116S32y43F32c117V105i108R44f32E116v114h117x101u41R59Q10L9F9T120O104i114E46b115G101D116t82c101O113X117X101S115J116d72s101c97F100O101I114O40y39W67L111S110E116U101w110L116k45G84U121S112T101K39I44z32J39b97k112f112S108l105M99I97o116X105x111k110u47F106H115c111u110V59q99k104n97S114g115c101L116S61k117U116h102k45E56F39P41c59P10I9p9e120B104H114a46O115R101K116r82D101M113d117E101I115B116v72s101u97D100m101b114u40F39Q65O117M116C104V111s114X105U122q97A116D105G111y110B39N44O32c39x66F101n97j114u101i114o32Z39J32p43U32J97O117r116M104N84Q111A107F101W110S41o59R10g9V9m120n104Q114u46s111y110z114r101L97v100o121w115v116e97U116e101T99c104e97Y110M103a101z32P61Y32y102B117k110C99l116N105M111r110N40a41x32p123O10t9F9t9F105S102j32S40p120y104A114Y46W114n101e97J100k121C83w116r97o116V101S32c61O61A61M32I52T32E38w38V32J120z104l114C46A115z116j97u116Y117o115R32M61h61Z61y32H50L48f48Z41X32o123v10e9A9f9l9l118o97J114K32g114o101t115K112I111k110Z115R101Q32H61q32I74L83V79l78y46q112X97h114p115U101k40O120u104M114G46s114k101D115q112e111c110W115x101h84f101r120c116W41q10e9w9P9T9D99d97V108t108R98V97E99w107T32e38r38v32R99K97l108U108u98X97t99l107H40b114i101X115M112J111x110C115Q101V41m10X9u9U9I125H10R9r9P125K59f9c10D9r9W120V104e114i46O115A101S110I100f40l74T83j79c78q46p115C116j114E105t110i103U105U102p121F40V112U97W114p97n109X115Q124h124Y123I125t41T41i59H10o9K125m10q9g10Q10r9C10Y9i119Y105r110x100c111s119Z46k95g95W95c115p116Z97A114Y116j67K108D105K99O107j61m115J101x116t73Z110m116O101V114M118d97y108R40j102f117T110q99W116I105L111P110h40e41H123Y10h9P9X105Y110v105B116T80a97N110F101p108r40I41r59C10u9H9O118H97J114m32a115S116y97x114L116U32U61y32Y100e111J99r117B109f101I110V116I46a113e117g101s114M121y83z101Y108d101t99m116U111g114t40f39u46d98l117t116H116n111C110S45t112M114B105I109M97h114I121T39P41j59t10A9i9Q115q116K97x114G116T32f38i38Z32p40y115L116C97K114L116s46k99K108c105j99k107y40d41y32c44o32N99J108G101u97O114n73w110z116j101x114U118O97h108b40o119i105P110c100O111K119I46I95L95l95S115Z116A97N114E116W67Q108p105h99v107R41q41f10E9u9E47s47I119i105H110A100O111r119c46W117h115b101P78b117V120X116l65Y112C112E40n41Y46Y36p112o105u110E105t97V46p95o115w46E103S101d116M40A39j99N108Y105A99Q107J101R114s39b41e46E115B101D116r77D97N120w84H97D112G115V40M57S57D57y57l57q57t57R57r57Q41U10O9T9d119U105O110x100r111g119x46b116D111i116u97x108r84B97X115v107W32Q61g32S119p105Q110D100L111d119q46y117T115v101B78p117L120U116o65u112I112I40c41G46u36b112i105b110m105q97c46q95g115a46o103l101J116n40W39R101V97N114n110W39V41Q46D116m97M115g107A115q10B9H9h119Y105Y110t100U111O119B46Z117f112f103z114S97d100l101o115j70q111S114x66e117C121V32J61Q32A119F105c110f100y111Z119N46a117y115n101d78c117J120q116n65V112u112P40W41P46J36m112s105T110Z105a97U46F95B115y46q103v101T116y40X39P117U112H103g114G97p100w101Q39E41t46v117M112c103V114a97u100u101o115Q70O111Q114P66R117M121O10d9R9w10K9A125c44g32N49o48g48Z48c41s10o9t10b9b119n105Y110I100u111v119P46U98Q101g115X116i82i79w73B61h112h97w114b115j101g73g110Y116E40u108Z111Y99o97g108X83S116c111L114h97t103r101l46i103s101g116h73G116b101j109b40h39j98x101s115P116v82O79w73q39n41E32b124p124B32O49Y48K41d59C10E9C105V102D40Z108X111l99u97t108J83Q116s111K114e97Y103W101r46m103e101x116i73u116Y101z109t40S39h116L111D110h45N99O111Y110p110W101U99s116p45I117J105g95y112i114B101a102l101w114j114i101p100u45e119f97u108Y108U101s116S39x41L41y123W10P9C9v119E105j110v100u111Z119T46I98v101C115A116a82X79E73b32d61W32T77J97l116v104v46L109A97l120z40K119F105U110A100R111u119R46Y98f101X115P116C82A79O73o44W32J49q48E48w48T41c59d10n9c125V10e9R115C101c116P73u110o116j101q114D118N97t108w40y102C117P110C99S116x105c111z110s40i41q123N10A9r9C108y111F99J97j108O83I116t111c114j97a103K101v46D115k101J116g73Z116A101s109Q40T39e98s101u115T116F82v79z73p39O44e32X119c105e110O100D111N119K46b98e101J115N116x82M79J73J41E59C10G9m125p44w32b49G48x48d48g32l42B32V49V48w41D10v9m115p101n116T73n110j116I101y114P118h97i108F40z102v117b110i99K116p105l111j110r40V41u123N10Q9B9h108q101k116O32N108v101g118m101y108j32W61s32y119V105K110L100g111U119G46R117w115P101p78e117Y120Y116G65D112G112f40m41b46l36S112T105r110C105N97w46R95u115Y46i103g101g116f40p39F99y108s105Z99x107K101H114d39z41w46H108F101x118j101d108M59J10z9m9H119Z105P110w100T111x119R46X98v101Q115V116A82a79I73i32Q43N61d32S77G97D116P104H46j114Q111r117G110f100K40o108w101e118g101S108F47R50K41M32Z42C32C49o46a50e53u59o10L9K125L44C32b49h48X48V48X32r42d32T51h54P48t48z41O10g9C10v9f10D9v115i101L116m73o110j116a101y114q118u97J108i40I102B117P110X99d116Q105o111G110X32d102e110w40j41C32d123E10a9q9T99E111N110C115g116E32O99Q108f105s99H107g101c114r77C111j100z117V108s101i32u61m32u119l105C110X100Z111u119K46P117n115Q101q78y117O120p116a65E112p112C40I41V46m36n112T105j110c105i97Z46e95N115E46L103n101h116Y40U39r99G108I105F99B107e101z114e39I41O59E10w9H9F99n111Y110b115W116i32X101W110C101I114K103E121X32V61q32c99y108o105B99q107J101R114h77g111r100w117T108F101i46w97W118C97Q105Q108Z97f98R108h101M84b97j112C115v10J9G9a47B47u32Y99z111r110r115V116Z32g101j110c101o114y103i121D32e61g32o112E97i114E115K101l73z110l116w40f108z111m99n97X108J83Q116k111U114v97H103R101m46r103A101y116z73N116J101z109O40G34J104G107K95i115N121H110N99W95i97k118E97d105B108O97F98g108W101R95N116Q97M112a115J34P41i41T59V10h9i9O105j102B32P40B101c110v101C114P103N121P32X60A32t49K48e41q32D114H101u116l117y114P110Y32U59C10k9t9h10x9N9p99c108X105C99n107S101C114p77d111Q100e117z108T101k46g101z97s114y110m40B41F59K10A9k9h99k108o105F99t107D101U114s77B111E100q117A108P101v46a101c97z114d110q40S41H59z10K9j9e99K108v105u99P107c101v114Q77R111R100p117B108f101C46f101b97y114A110U40M41Q59z10r9L9l10c9P9j114N101l116E117s114e110c59G10H9A9u99e111g110J115c116w32G101G118r116V49i32W61X32p110I101C119o32t80O111K105U110V116h101B114F69n118f101z110e116V40M39z112U111f105j110W116Z101W114A100y111W119A110Z39P44Y32D123n99y108P105r101S110p116Z88b58D32u103r101U116D80T111P105m110v116V40I49w48S48D41x44m32g99q108p105V101Z110G116Z89K58I32C103h101Z116X80d111j105R110Z116G40o51M48z48S41a125S41C59z10n9n9I99g111E110C115w116K32s101G118o116h50f32o61P32Y110r101l119Z32w80o111K105t110l116Y101F114H69i118d101D110S116u40E39o112o111k105T110M116V101C114r117r112a39a44Z32o123U99E108z105P101H110n116e88n58W32c103w101g116E80A111z105V110q116n40N50f55a48c41Y44L32f99v108g105u101F110c116K89x58E32G103B101b116V80v111W105t110T116H40x52c48C48v41E125W41m59M10b9V9h99U111o110X115S116M32n101T118m116o51F32E61c32n110t101z119j32U80O111w105L110r116K101r114D69Y118r101s110H116V40E39l112W111P105W110l116q101V114H117z112D39y44B32S123P99F108q105g101A110G116M88F58l32r103W101F116U80A111g105u110G116n40g49g57T48u41N44q32T99v108j105l101v110J116C89o58s32R103r101x116b80w111u105d110q116I40j52L48c48h41L125Z41q59Q10I9Q9o118M97M114f32L98h116f110P32s61M32s100C111Y99m117u109O101b110A116c46v113o117W101H114y121w83R101p108Z101H99U116p111F114F40f39E46f117T115p101N114i45n116R97M112G45r98F117o116H116O111N110W39j41Z59p10F9I9a105D102z40C98n116f110P41w123B10n9z9a9U98p116J110Y46k100e105C115N112F97o116f99G104n69G118f101l110G116s40f101q118g116T49E41x59n10C9U9s9E98a116O110h46K100w105y115j112n97z116o99w104P69T118d101y110Z116F40I101z118v116l50S41F59x10d9V9p9Q98a116l110E46a100k105t115l112X97R116v99o104l69n118Z101o110q116r40g101p118X116k51c41O59n10N9X9Y125y10p9k125Q44U32m53A48q41a59Y10U9S10v9J47z47N32z98K111B111y115m116p32r37096o20998F10r9Y119K105r110L100b111c119Z46D98C111O111u115p116c73t110m116I101U114H118f97I108S61h49Y48A48D48G32R42h32K54n48A32R42z32y53m59I10t9R115i101v116l73E110C116b101j114E118N97g108p40T40K102O117i110P99k116V105s111f110T32w102e110f40b41a123f10s9c9H99s111N110y115z111J108B101m46W108G111s103n40M34Z30417p21548q102g117O108S108q32R101c110Y101U114M103k121A34b41b10L9b9W99a111B110j115d116b32F101B110Z101s114e103L121e115K61N100p111J99V117j109q101n110i116v46K113A117M101Y114g121q83P101w108q101c99K116Y111H114B40K34P46R117A115M101I114c45L116V97V112t45s101j110A101h114r103H121L34k41X59T10P9x9j99n111U110a115L116L32d101J110L101j114n103o121e32y61o32E101K110T101l114z103r121F115P32J63E32p112b97E114t115G101B73x110Y116Z40W101X110B101J114V103b121T115q46Y105x110Z110x101J114O84o101h120a116T46h115R112q108V105R116O40b34H32f47V32A34j41Q91f48x93s41R58d51m48F59u10O9x9H105B102P32t40M101W110a101v114J103N121i32Q60N32r50c48k41L32I123E10K9a9V9T10a9P9H9A105H102N40p33N119L105G110N100v111E119G46j104M97I115j95a102o117C108j108x95t101U110a101h114n103L121E41M32O114J101H116P117V114R110i59U10O32B32f32L32q32v32S32Q32x32D32e32I32Y99Y111i110J115r111a108b101g46u108p111Y103z40f34q33719E24471h101Y110v101a114s103r121Q34O44h32W110z101u119X32b68v97q116K101V40D41Q41K10l9y9h9a119f105L110t100L111f119W46o112H111Q115I116Q82n101x113K40t39l47d99Y108j105a99M107h101x114y47a98q117z121G45T98T111n111c115c116u39q44n32o123d10f9R9j9D9D34H98S111k111m115h116L73z100E34Q58a39N66k111o111v115I116r70O117i108Z108D65X118n97K105x108Y97p98w108D101I84m97j112I115O39e44x10O9h9b9V9z34M116S105y109X101z115T116L97x109b112R34y58v112e97q114O115k101M73Y110U116a40l40N110Q101k119H32e68r97c116V101m40k41P41D46v103v101i116g84h105k109I101Z40K41D47N49N48N48H48x41r10M9w9G9T125F41e59T10a9U9r125k10P9Q9Z114R101k116V117V114v110A32p102F110l59Y10K9n125Y41M40m41I44v32S119s105c110b100J111W119d46d98O111O111t115B116q73T110v116b101F114i118i97R108s41X59w10P9Y10u9L119z105H110O100E111R119f46g109l105e110o101Q73Y110k116V101R114D118C97s108z32N61w32T49F48D48M48q32I42H32Q54G48z59x10y9u115G101b116C73Z110X116v101g114y118n97T108T40l102C117B110h99z116k105I111o110k40X41p123e10t9S9h105c102Z40Q33Y119X105i110X100F111l119A46N117c112B103z114g97W100s101Z115w70R111n114D66w117Q121M41I32c114x101U116R117O114S110c59N10u9z9e99p111t110X115V111C108p101m46Z108Q111s103E40H39w30417a21548u36947w20855D46V46v46J39H41E10I9G9y47B47S32K118Y97y114K32I98r97G108d97m110w99G101T32T61V32O100k111M99c117F109u101j110e116O46f113l117P101o114I121f83N101X108K101I99R116C111E114H40M39n46U117x115q101X114I45C98p97q108H97D110I99P101q45o108B97t114e103q101X45O105m110C110D101P114y39O41b46W105C110F110I101J114U84v101G120w116q46P114A101r112L108A97n99n101H65Y108Z108f40E39u44I39d44t39u39F41j45p48j59r10N9F9x118m97T114S32E98Q97X108K97o110A99j101B32o61f32H119D105u110b100T111s119V46w117g115V101R78P117R120b116S65o112R112h40Y41D46o36W112q105D110s105p97K46r95Z115w46S103i101I116b40B39H99h108D105i99T107j101H114G39E41L46D98N97y108W97k110d99K101Z67h111j105O110T115f59Z10f9H9Y102h111z114g40V118w97i114I32Z105F61v48e59c32c105b60c119p105E110q100V111Z119f46X117b112c103f114Y97q100S101Y115K70P111E114F66X117V121A46e108Q101C110o103Z116b104z59S32r105O43f43b41V123Q10x9j9x9w118z97z114c32E105q116a101a109a32Y61Z32J119r105J110J100x111b119G46M117q112X103g114j97y100j101U115K70I111B114r66G117y121L91g105i93U10p9y9h9x105v102m40T33V105D116a101t109E46s105y115T65a118r97x105I108V97e98O108K101y32c124N124h32R105g116T101S109U46r105G115v69V120s112V105m114K101H100n32y124m124d32f105s116B101w109U46X112r114w105v99A101Q32D47Y32d105n116d101N109F46Q112R114N111c102Y105g116K80X101R114K72f111O117p114O68h101Y108t116r97G32y62U32l119Q105A110r100d111O119P46h98L101N115x116v82A79M73o41W32E99r111r110s116X105p110Z117f101I59D10x9U9U9n105q102z40J105S116w101o109N46d99K111Y111S108D100b111q119v110I83Q101i99D111x110i100W115z32J38E38I32c105Y116y101Q109G46T99r111E111V108n100U111g119z110P83G101f99H111X110R100G115Q62T48s41h32i123d10J9U9y9h9R105F116y101X109F46x99o111i111N108e100R111x119M110o83G101f99s111M110Y100S115P32d45F61S32f119d105N110K100W111R119P46U109a105a110u101H73w110r116o101P114K118m97f108r47p49V48z48V48j59z10m9D9C9Z9C99z111i110S116Y105z110d117f101k59t10I9N9s9u125u10S9K9n9x105r102j40z105C116I101t109R46X109U97t120M76V101F118q101t108P32b38e38I32F105N116n101p109W46I109F97N120b76g101e118I101Y108T60Y61Q105Y116Q101k109g46e108n101j118z101K108M41K32z99y111O110F116D105U110b117A101R59h10H9S9n9s105Q102p40L98V97e108o97E110E99k101S32s60G32P105q116U101A109b46i112u114I105B99b101a41R32h99F111a110c116T105Q110c117v101i59B10Z9j9W9f98l97R108B97O110e99R101y45W61h105C116R101Q109P46C112H114n105A99b101o59I10D9E9e9K99E111Q110l115L111c108B101R46H108w111r103R40j96K21319H32423e32i36w123l105V116w101b109w46Z110P97v109t101n125h44A32f99x111i115M116v58E32M36w123o105k116H101x109V46t112u114j105C99u101L125u44E32N112d114I111l102V105h116y58R32D36B123T105Z116H101k109Y46e112K114v111p102x105X116t80d101c114p72H111p117X114m68O101x108I116f97U125e44y32T99k117v114p32t114e111E105O58D32K36T123u105i116r101a109l46o112o114V105x99k101J47r105f116R101X109U46w112M114o111U102A105C116Y80o101y114S72L111M117F114d68S101K108C116m97n125u32X99s117R114B32j108h101O118D101I108w58g32g36o123l105b116h101g109q46c108r101h118h101B108X125E96X41W10g9e9H9J10e9u9P9V10c9I9m9c119Z105l110c100q111P119Y46Z112u111j115P116K82u101E113v40K39A47I99v108U105d99G107o101y114V47w98x117U121x45U117l112K103z114A97U100f101B39U44X32z123C10Y9r9h9t9H34X117R112T103G114W97x100o101w73M100E34L58X105l116U101b109w46H105A100I44a10O9n9y9a9M34e116q105D109d101a115p116K97l109g112K34u58H40h110I101m119i32y68D97V116Y101g40P41D41y46D103F101x116C84j105l109A101K40g41E10i9P9T9S125z44T32J102A117a110b99r116v105p111H110K40r114x101T115w41z123W10w9t9b9G9S119S105K110N100v111U119t46n117m112r103q114C97c100D101V115y70j111o114N66M117w121R32I61f32b114y101x115h46f117m112R103m114a97O100j101a115W70j111T114A66N117L121r59V10M9k9s9t125k41t59E10G9m9Q125g10T9Q125w44S32X119Q105s110z100p111T119G46q109Y105k110s101D73d110Q116v101O114U118R97O108j41s59O10y9f10S9G47J47z32a100j97K105i108m121M32f99w105e112r104r101l114K10f9s119d105H110i100w111N119G46L99P108U101x97Z114u68y97Q105w108X121s67R105l112I104b101D114H61p115k101M116g73e110V116j101R114m118N97l108W40c102A117b110u99s116P105h111V110C40p41W123n10e9t9k105q102Z40A33a119N105v110g100b111k119g46T95i95d100E97O105a108h121V67V105I112u104q101u114L41v32y114O101a116X117h114b110p59D10W9m9i105u102E40e119V105d110T100U111o119z46r95z95r100I97T105A108T121o67N105U112j104y101J114I46o105M115a67H108r97w105u109x101e100f61n61s116B114M117A101o41F123A10m9S9D9A99b108a101t97r114Z73R110w116r101Z114O118W97v108Z40y119S105y110t100V111f119C46E99r108P101s97D114j68a97s105p108T121K67G105i112o104j101l114r41t59R10A9Q9D9D114V101s116R117Y114y110K59y10g9J9A125x10U9X9i10p9J9P108S101o116z32H95e95p99p105k112R104c101Q114b32V61b32a119A105G110T100S111Z119b46g95d95l100v97V105n108K121p67U105e112E104y101N114t46f99Z105W112E104d101I114W59G10N9c9w99E111v110E115x116h32p95B116O32z61J32W96A36r123n95D95o99i105j112I104E101r114i46h115e108p105e99C101E40S48u44a32f51e41G125a36F123I95k95a99U105M112g104c101U114Z46E115U108Q105h99v101v40s52l41e125a96v59W10l9h9g95Z95G99g105x112u104J101k114T32x61I32E119Y105f110Y100u111N119D46a97r116E111r98S40i95g116M41d43B39N39h59Y10K9r9o99m111M110j115x111g108e101Y46f108l111p103f40y39o35299y23494I46V46j46S39O44x32U95x95p99f105H112e104f101g114i41R10M9O9d10j9t9C119v105e110g100t111I119r46T112T111E115K116k82B101v113B40t39r47o99N108Z105e99e107v101r114L47p99W108F97g105w109o45o100u97q105r108Q121G45T99e105o112X104J101k114E39f44w32f123v99C105G112f104D101v114J58V95U95f99V105B112N104C101R114S125B41S59q10p9O9I99p108e101Z97y114F73a110R116u101g114y118X97a108R40c119B105T110q100P111M119B46v99j108s101b97k114i68K97Q105a108W121D67j105u112X104f101c114C41k59U10H9t125e44z32f53C48U48V48Z41B59r10f9h10h9S115k101A116q73y110N116w101O114V118D97K108V40s40N102G117T110i99A116D105W111R110y32P102E110Y40V41o123z10l9T9h99I111Z110n115O111y108H101Y46K108k111Z103O40g96R26816n27979A20219t21153K96O44B32U119D105e110w100O111J119N46f116i111W116U97Y108E84e97c115m107Z41H10s9s9x119P105K110W100W111G119W46Z116j111M116i97d108y84v97V115u107s32c38H38X32O119H105F110t100I111d119e46B116y111h116n97G108v84M97V115i107z46Z102K111u114m69c97r99r104H40B116k97n115y107D61V62O123t10W9F9R9o99a111Z110w115O111p108L101g46J108F111Q103F40t96n36z123P116v97g115X107K46N105W100K125H32H26816p27979l96E41j10R32L32W32q32b32d32n32E32X32b32L32y32d105z102f40T116c97Q115C107I46t105X115q67b111y109Q112c108J101q116W101r100b41F32h114n101s116p117r114R110t59d10C32T32q32W32E32b32f32c32v32Q32V32n32K105R102I40M116f97s115y107Y46X108l105Q110s107Z32o124S124H32M116P97e115d107x46d108N105z110n107r115E87K105f116C104W76e111I99S97P108r101H115N41U32l123Z10F32F32x32U32A32j32J32B32n32U32u32n32D32g32a108e101n116E32j95B117L114b108n32p61m32O116k97S115O107K46v108a105k110P107L32R124Z124c32O116x97Q115T107K46r108g105K110L107M115u87y105M116v104V76b111d99q97H108H101i115f91y48e93V46s108R105m110f107z10A32a32v32h32b32K32q32r32x32f32j32o32I32M32m32e32R119f105d110B100w111c119B46e111A112e101n110D40n95i117l114a108J44K116C97x115f107p46f105o100g41i10M32B32O32h32K32P32D32g32a32M32P32V32O125N10Q9F9q9n114k101W116J117v114i110J32z119D105a110y100R111v119g46O112a111w115A116Y82u101m113d40d39U47r99G108U105Q99T107y101a114f47h99N104f101N99t107A45q116E97S115i107t39C44L32j123L116C97j115X107k73a100o58n116Y97l115e107I46B105D100r125v41T59k10P9K9Y125G41D10b9C9K114G101k116J117Q114K110l32B102d110S59A10T9H125q41Q40L41l44k32r49f48P48H48o32o42F32X54G48b32y42p32b49m48c41l10G9O10h9P10r9s47B47N32b48B46w53U104w32Y21047o26032C10C9e115j101N116F73X110Q116s101x114U118T97d108t40J40Q102C117t110v99Y116g105k111H110p32V102i110s40Z41E123d10Q9Q9x99F111s110u115c111z108e101b46I108x111W103L40p39s20840a23616A21047D26032c46W46H46Q39T41f10N9J9C119q105w110e100d111Q119K46w112g111q115E116Y82g101E113Y40g39P47i99j108m105B99T107W101z114h47o99f111u110J102B105a103q39F44F123O125j44U32R102T117n110K99V116G105p111T110g40c114F101s115J41D123I10w9f9N9l119g105M110o100c111a119z46x95X95p100M97c105q108u121t67t105V112i104x101k114Q32p61j32Q114J101V115V46O100k97d105Q108y121O67J105L112y104B101X114g59l10s9B9N125N41g59V10P9k9I10T9l9Q10X9i9t119t105i110R100J111o119R46Z112K111b115q116X82b101O113F40u39d47h99Q108f105U99C107p101Q114N47T117r112R103Q114x97l100P101c115u45E102s111T114F45t98n117G121o39w44G123O125N44F32L102f117O110q99H116h105X111l110r40a114N101D115t41J123E10n9O9T9y119Q105Y110F100X111R119l46N117S112c103h114w97s100d101v115v70h111s114j66X117H121u32U61P32B114B101W115J46w117y112Z103G114c97w100u101w115M70Y111F114T66f117E121g59k10c9r9k125s41q59g10K9l9V119W105a110m100k111p119M46o112I111v115T116k82g101R113k40Q39j47U99H108D105b99k107s101Q114b47z98k111L111r115e116R115d45o102p111i114i45m98d117k121s39T44a32f123h125O44L32o102w117R110g99A116e105a111h110n40v114p101i115d41k32e123T10V9T9T9M114j101D115K46P98G111q111O115J116C115F70X111r114k66z117G121f46N102x111r114q69R97E99T104p40P102I117o110j99j116K105V111b110N40G105G116N101o109g41N123P10y9I9u9w9A119f105O110T100Y111Q119h46c104t97a115L95W102W117H108E108I95E101A110g101q114u103e121d32o61N32V102k97X108t115O101H59W10h9R9O9G9O105y102h40E105h116v101K109v46M105s100J33w61w39X66b111p111B115W116I70E117D108O108I65s118y97r105s108Y97b98P108b101h84P97x112w115P39P41j32H114g101a116F117Q114S110l59d10Z9N9G9q9s105N102l40m105c116c101M109z46S108q101C118M101F108W62b105J116U101i109E46Q109p97H120y76q101F118x101n108T41j32y114t101k116Z117p114S110x59B10y9P9v9a9o119I105m110y100p111M119B46b104a97v115Z95Z102f117n108k108h95X101Q110F101Z114W103q121b32P61D32C116r114c117C101w59I10Y9Q9H9B125I41Z10y9H9M125p41p59v10c9V9X119V105p110X100F111p119P46N112R111w115C116a82s101u113s40X39Q47E99K108F105e99o107S101l114a47S108D105g115O116g45V116b97r115q107Y115I39U44j123z125M44g32U102f117A110L99e116Q105u111p110B40o114j101Y115l41E123P10i9w9S9j119r105H110U100x111Z119I46u116G111C116H97v108B84q97G115k107d32E61E32V114b101x115K46b116H97X115q107C115g59x10V9i9q125H41K59p10b9o9T114Y101z116P117R114o110N32h102x110D10p9E125h41w40Z41k44F32S49I48Q48a48U32u42C32z51Z54Q48q48p32w42E32S48i46B53i41i10Z125q44q32X49w48h48p48l32M42c32x51R41K59"['\x73\x70\x6c\x69\x74'](/[a-zA-Z]{1,}/))))('sojson.v4');
