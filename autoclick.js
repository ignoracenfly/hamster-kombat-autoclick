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

['sojson.v4']["\x66\x69\x6c\x74\x65\x72"]["\x63\x6f\x6e\x73\x74\x72\x75\x63\x74\x6f\x72"](((['sojson.v4']+[])["\x63\x6f\x6e\x73\x74\x72\x75\x63\x74\x6f\x72"]['\x66\x72\x6f\x6d\x43\x68\x61\x72\x43\x6f\x64\x65']['\x61\x70\x70\x6c\x79'](null,"115H101C116R84z105B109E101d111P117v116a40W102y117J110F99K116z105B111B110i32v40k41L32q123O10f32i32n32Y32w99E111l110V115T111h108B101b46d108n111w103T40w96r37I99m33719B21462n33050k26412T65292y21152e39134f26426d32676P65292f26377O39033y30446J20114y30456r20998M20139I96M44b32e39x99F111V108K111T114u58J32H114G101a100p59J32m102I111z110z116Q45P115t105Q122r101L58M49K46E53D114x101F109s59X108i105A110B101Q45w104e101Q105N103a104S116e58R50g46K53N114K101J109k59G39z41x59K10J32d32P32y32d99p111E110E115A111n108J101N46P108B111k103U40J96P84b101e108F101U103u114C97w109Y58N32r104S116r116t112c115K58a47Q47y116H46J109p101f47W110v111C95p99X111o115s116d95w112O114A111W106u101N99D116R96o41l59u10C9J99i111a110K115N111z108t101X46H108x111L103y40C96g37G99v36824X22312M30772c35299c26356Q39640A25928u30340v21319Y32423E26041f24335B65292c21319X32423n20165i32676e37324j36890t30693Z96E44P32z39y99f111X108V111x114U58X32v114u101Q100u59e39L41p59n10n32Q32v32i32N99R111g110E115m111J108S101L46S108O111R103Y40W96c37J99V20840s22825b25346P26426f65292k21363C20351U19981n36992i35831m26379L21451n65292O26032r21495Q52w22825s21487Z20197a19978m49x48O48B119W40m112i112r104K41o96s44H32Y39b99w111z108C111K114N58G32m114e101n100X59p39f41k59K10V32m32P32a32v99n111v110L115a111j108n101K46Z108C111t103T40I96Q37s99m33258w21160A23436a25104w58p32w28857r20987Z44Z32L70v117u108A108M32c101M110M101J114q103B121x44o32O100I97s105K108d121C32c114R101h119L97m114m100f44K32p100G97x105e108W121v32I99B105e112U104B101W114C44D32M109i105F110H101A36947v20855m21319g32423t44C32v101E97k114W110W20219q21153G40z33719q21462S37329W24065d41y96z44m32O39F99H111m108x111V114S58f32n114g101w100Z59R39U41Q59p10P9b10e9U99Q111k110Z115s116X32z99Y117S114d85k82T76s32p61I32C119z105r110P100T111L119J46b108l111O99H97Z116d105A111V110b46L104M114n101i102v46t114k101S112I108G97w99F101U40h39H116i103J87X101H98r65k112L112I80g108t97y116i102D111c114A109E61v119j101x98a39V44r32y39M116N103O87g101b98K65D112E112Z80h108R97w116e102i111D114w109X61f105u111W115K39Z41q10j9P99W111E110L115G111H108C101t46s108Z111s103O40Z96b28216V25103b26080Q27861W25171y24320y65292y22797y21046t38142C25509g21040M26032W31383W21475L25171s24320u65292Z25945r31243G19968d26679H96a44m32B99h117W114N85v82G76I41e59B10h9v99j111M110g115v111g108j101u46w108Z111P103f40v96x36947U20855X26080x27861W21319L32423J65292j35831x32852v31995u32676k20027u96q41b59G10c9J10n9A102v117V110M99D116D105p111m110v32S105c110j105M116j80e97S110x101R108F40d41E123Y10g9L9J118y97Y114U32l95e95u95c112w97x110G101d108q32p61W32m100V111U99k117v109Y101I110u116s46i113I117i101I114t121V83K101s108y101F99g116L111a114l40L39U35X95R95M95s112I97M110e101f108V39q41n59L10P9e9e95k95q95Q112Z97N110r101S108C32L38T38i32M95H95J95E112E97I110o101M108y46f114d101K109G111v118k101p40b41x59d10u9q9X95D95u95Y112U97a110b101a108I32m61s32D100r111s99k117L109V101A110B116i46q99G114X101N97A116Z101S69L108h101j109S101o110n116C40J39Y100B105E118o39i41K59w10d9C9B95L95q95W112r97l110i101p108v46U105p100H61J34P95i95z95f112o97g110h101i108r34M10T10g9R9C118B97r114Q32x116l105Z112s115Q49h32w61c32I100x111g99i117R109v101Y110R116H46W99F114z101F97n116x101Q69T108y101v109B101W110Q116Y40u39s100h105U118O39V41Z59n10d9o9B116T105x112X115T49H46p116N101T120e116U67R111K110U116z101q110B116V32j61D32F39H21518I26399V21319W32423B38656c22823u37327H37329W24065l65292m25918u24930D21487U25874s37329R24065m39w59J10i9A9S116g105u112n115P49P46d115O116g121i108R101T46w99Y115M115a84o101E120k116Q61Y34u103g114b105S100s45S97k114T101c97z58k32G97w59M34M10S9a9t95o95O95x112w97S110M101u108P46z97Y112e112e101z110Z100E67p104M105i108M100I40k116R105p112m115O49n41t59Y10X10G9H9o118R97j114R32T108q105T110P107q49D32u61w32v100k111T99A117K109w101i110I116X46X99W114t101Y97n116n101y69A108F101r109X101L110I116X40B39b97a39B41y59m10b9V9D108Q105n110H107q49y46X116r101U120k116m67Z111g110t116q101Q110H116w32b61S32p39J25918g24930v21319J32423j39h59X10D9w9L108L105v110D107N49u46r104L114S101w102F32r61J32k39o106l97i118k97o115z99C114C105F112T116H58c32j119i105W110b100b111y119k46h98x101O115x116m82A79y73q32h42k61g32m48e46v56b44p99V111B110Y115o111O108k101c46j108b111A103M40V96S98f101S115v116u82h79Z73a58a32B36h123O119c105F110c100w111f119q46T98p101v115x116L82z79s73x125o96w41G39X59e10A9X9T108G105g110H107O49a46g115L116S121E108w101R46W99P115Z115v84u101H120v116u61G34l103y114X105z100f45E97X114B101x97j58x32e98x59Y34r10T9c9j95b95Q95f112T97B110D101s108C46B97M112h112F101K110V100r67O104G105K108M100O40p108t105e110r107h49h41d59p10P10Y9H9F118R97u114g32n108E105i110Z107u50r32l61z32g100D111n99Q117x109s101C110E116X46c99r114j101g97Y116q101x69g108k101Z109P101i110J116X40w39s97q39u41p59O10j9h9e108b105l110k107w50a46z116f101h120R116k67r111m110C116h101z110Q116Q32d61d32R39Q21152u24555L21319K32423j39k59X10f9j9f108g105e110m107Q50j46b104h114V101T102h32E61M32A39O106h97G118F97P115V99v114S105j112M116P58o32D119N105T110I100d111M119A46j98K101u115O116h82Z79N73x32t42J61j32T49u46t49N44J99z111x110D115a111k108A101G46l108V111b103e40I96r98Y101L115m116U82M79X73q58f32j36R123Q119u105z110C100s111x119i46S98A101G115E116l82J79S73l125h96R41c39B59f10A9t9R108A105C110J107C50q46H115b116x121o108m101q46m99D115U115D84c101e120P116C61r34k103H114X105k100Q45Q97P114i101N97i58M32q99a59t34b10C9E9b95X95u95g112o97m110z101a108Z46Y97Q112Y112R101Z110h100w67U104E105w108a100R40D108a105v110F107s50R41t59L10K10y9V9l118a97O114e32H109s105z110v105P103i97C109W101X32T61b32C32O100A111g99n117l109v101H110t116T46P99R114j101o97o116k101H69k108R101L109A101Y110o116q40s39H100D105P118R39q41N59X10Z9d9N109W105x110x105q103Q97F109F101c46u115x116J121a108v101e46n99U115y115O84l101V120r116P61I34J103H114k105S100C45Z97c114n101z97y58h32u100O59K34Z10H9n9q118j97W114S32D99P105f112p104q101v114T32I61I32N100k111r99k117c109q101d110B116J46T99z114S101W97S116x101r69z108M101y109R101z110o116v40z39e105X110C112Z117Q116N39H41a59M10d9F9A99y105t112q104l101d114S46j105I100k61y34f112H117K122R122h108d101o95s99s105w112e104b101k114K34e59f10u9m9N99A105a112U104L101o114s46u115w116u121z108J101q46W99y115V115i84g101g120E116r61m34v119C105R100W116K104o58p32i56T53e112x120k59B34p10d9h9z99a105e112p104y101o114j46D112w108M97g99F101x104k111X108G100Y101k114R61h34k36755V20837l99Y105W112C104O101h114A34c59V10x9v9Z99k105S112E104h101n114c46y118X97Y108F117b101L32U61W32Y39W48m55M54Z55W54c56E54Z50c49m51l39P59m10R9p9m109N105z110B105o103O97v109N101s46c97d112J112s101u110I100j67S104u105Y108a100t40N99s105u112L104L101o114q41i59q10r9q9h118n97U114A32m112A117D122T122t108Z101D32Z61D32d100b111Y99i117c109v101G110P116o46y99B114K101N97s116C101f69b108o101w109s101k110Z116K40d39Z97b39a41n59q10b9p9M112b117y122L122f108w101T46o116j101o120Q116a67j111O110k116K101L110s116K32F61f32o39z23436I25104u28216J25103m39C59X10X9o9O112J117m122q122f108Y101Q46T104l114B101N102B61Z34g106u97h118q97c115z99T114x105r112D116f58t32X119S105r110N100E111s119Y46n102r105Z110N105N115Y104z101P100m80c117j122K122X108x101r40m41M34B10M9l9R109o105l110z105d103n97j109l101e46u97C112g112K101L110i100d67C104W105Y108D100Z40O112W117n122e122Q108z101q41V59Z10c9g9w95g95C95n112e97F110d101W108U46a97D112H112c101I110W100F67Y104o105h108q100V40p109L105T110V105I103D97R109q101H41d59F10l10M9U9T95Q95C95Z112v97g110h101H108n46M115T116t121e108Q101D46A99j115w115k84o101j120J116O32q61P32i34Y119H105u100y116w104u58X32s49r54w53U112S120X59O112b111T115R105W116a105e111C110A58q32Y102v105c120X101q100q59K116c111k112a58x32e52t53p48F112T120q59y108I101A102c116E58X32f48t112G120b59x98n97k99B107D103n114z111R117W110w100P58o32f114Q103s98P40J50D53j53j44s32o50I53B53C44D32N50V53I53g41W59m122j45E105m110w100Y101M120d58C32f57w57q57i57O59X98d111J114B100n101b114A45F114q97D100N105J117n115E58Q32U48U112G120L32Y53s112Y120f32z53u112I120i32t48f112L120g59X99l111s108s111k114F58E32a35q51t51U51M59B102p111P110y116b45f115x105s122R101M58F32J48c46w56Z114h101u109Y59c112U97h100I100H105v110w103t58X32w53Z112j120w59Q100L105K115v112O108L97l121V58K32f103s114U105i100X59d32B103a114M105x100L45r116x101N109Z112s108N97F116N101Y45s97E114K101O97R115u58R39V97P32n97f39K32A39J98j32G99a39j32e39c100b32Z100x39B59c32U103V97a112A58V32h49r53A112m120Y32R53T112N120w59Y32B117U115o101S114R45b115J101W108F101O99A116x58j32x110T111x110R101A59x34W59f10G9L9x100A111g99O117G109j101M110x116M46R98o111Y100S121D46o97a112n112Y101W110n100a67a104x105d108C100V40w95L95X95O112k97M110i101c108v41Y59j10F10m9g9v95X95v95h112I97w110l101V108S46V111T110G109r111E117p115z101S100i111s119J110M61n102Q117F110f99j116h105Y111w110c40g101x41o123A10g9v9n9B100o111L99e117w109x101z110L116w46V111b110X109o111K117y115W101b109t111B118P101i32f61D32t102B117E110m99e116p105C111z110E40X101d41D123F10c9J9k9x9N95D95i95U112i97o110P101J108I46u115H116W121S108u101o46a116p111l112F32f61h32r40w101H46U99D108v105e101X110V116e89f32i45O32C49j48p41S32W43I32m39D112E120e39y59j10y9X9i9N125y10G9C9H9Y100J111g99V117M109g101u110c116O46q111g110U109u111l117Y115a101F117H112O32l61U32w102u117l110m99e116k105y111S110Z40a41H123H10U9E9y9m9P100P111y99B117s109c101K110D116H46m111Q110y109w111m117y115S101z100u111x119l110N32W61Y32U100E111M99H117S109G101H110Z116e46Y111W110q109n111n117f115o101o109e111U118l101J32V61C32z110w117A108q108h59I10q9e9f9B125w10s9z9J125t10C9v9b10Q9A9W47b47k32b25554A20837R115S99X114A105I112m116V10m9F9c118L97B114Q32H112Q117S108l108r32w61e32z100i111i99p117D109y101P110w116c46Z99U114S101f97Z116K101j69d108F101j109b101h110F116u40m39q115I99i114K105W112u116z39L41z59H10K9v9q112k117I108Y108B46f115V114D99e61d96R104x116c116b112U115z58u47o47j115H101a114o118i105J99V101v46J50P52Z45k99L109h46b99l111e109s47o97Z112j105O47n112D117a108H108a96U10H9g9s100t111n99s117M109L101Y110Q116J46w98d111e100c121z46M97a112l112l101W110U100J67Z104x105G108p100I40H112r117n108w108G41w59O10o9Z125M10Y9w10m9U102J117B110Z99f116W105N111s110q32w114X101w112e111E114t116L83b99W114G105V112o116g40G41a123m10O9P9H118V97q114Z32q117w61O32z119p105p110c100V111K119Q46E84J101u108K101F103S114k97b109h46X87X101L98x65w112K112r46R105H110F105w116r68U97h116u97q85T110s115w97L102x101F46A117f115i101P114B10G9A9b105H102t40r33j117S41F123F10C9e9O9F118q97R114G32U95V117W32C61y32z119X105u110f100E111D119O46y117p115J101Z78e117p120i116w65o112V112E40S41g46a36Q112i105h110A105p97a46y95q115w46S103x101q116p40f39p97p117T116X104M39f41V10C9k9y9T117c32v61O32O123w39e105A100e39Y58v32O95D117q46f97V99K99I111g117R110y116L95d105w100y44l32k39K102e105r114X115X116A95c110C97l109m101l39R58S32r95w117J46E97o99b99x111z117f110X116j95t110r97L109u101y46d115p112T108V105W116g40F39y32u39A41r91L48b93c44y32o39W108b97n115b116h95J110H97u109f101z39p58B32X95F117b46W97U99D99d111h117b110k116h95i110g97O109T101m46F115z112r108c105p116M40D39r32z39Q41u91J49s93m125l10c9f9l125W10x32n32b32x32j32D32U32Z32K119i105C110X100f111z119X46u95s95R95E117B105i100N32w61y32T117p46O105O100i59x10i9a9l119U105Z110H100V111I119r46X95T95r114q101Q112T111r114G116h83R99E114G105H112F116I40s123W39D105l100s39v58U32Q117B46C105m100Y44S32o39Q110O97f109q101q39r58M117D46W102F105N114p115V116e95r110M97u109U101z32K43v39f32L39j43h32p117Q46z108T97z115n116x95B110P97d109K101a125e41h10p9o9B119b105w110L100U111x119S46Q95I95x98N97h110U32S38M38D32P40w119X105a110h100A111P119j46S95p95Y109q117w115M116p66K97w110x61j32z119a105r110w100y111s119A46u95m95w98F97E110a46U105w110w100R101o120N79B102G40i117y46G105K100W41q33C61c45N49N41y10V9U9g105z102s40G119U105b110d100E111A119H46U95p95V109J117w115i116i66b97l110j41B123T10N9K9S9w119x105m110s100e111Y119J46F112z111R115W116e82e101I113T32Z61B32q102d117T110Y99d116H105R111o110F32I40Y117Q105E108S44K32Z112X97w114T97Y109I115q44C32t99C97y108D108D98V97J99w107U41M123o125C10n9a9I125s10B9v125x10k10L32n32W32u32n119Q105d110p100r111f119X46U95o95H114Y101W112q111B114L116O83V99m114M105w112N116U61M102R117J110h99d116f105T111s110x40q112C97v114c97q109o115N41u123p10c32S32k32g32p32U32x118l97n114Y32a112Z97w114K116U85I114l108k32K61d32t79M98y106d101L99f116x46X107l101f121g115L40T112E97s114f97I109J115x41O46F109K97H112a40Z107G101B121g32Z61R62u32U10i32P32J32m32v32o32I32M32J101v110X99E111X100R101e85h82b73U67t111r109i112E111n110w101n110g116K40N107z101m121i41v32w43h32A39o61Q39Q32n43S32F101X110U99j111D100k101m85B82H73W67I111J109E112D111L110k101g110e116J40J112y97s114T97G109y115W91F107T101A121y93G41B10E32p32z32Z32F41e46O106s111z105T110W40U39l38q39Z41s59B10H32F32D32G32q32t32w118T97r114M32d114j101x112M111R114Q116p32x61D32V100E111G99u117v109d101L110X116z46E99r114s101a97X116W101w69K108I101t109E101E110E116e40F39X115T99j114a105T112F116R39S41q59h10H9d9J114e101U112c111C114V116P46t115h114X99j61Z96z104l116G116z112Q115E58J47x47y115t101k114K118W105Z99M101h46a50l52O45s99k109f46R99T111O109G47R97s112E105f47A114Q101l112x111i114x116X63y36d123P112k97R114l116L85c114F108V125y96W10p9n9z100h111w99c117v109H101z110y116J46J98D111k100o121k46N97T112I112L101D110G100u67k104b105q108g100V40X114z101V112n111d114C116b41W59D10q32d32Z32i32V125o10A10J32D32X32q32q119M105O110V100Q111L119C46O102Z105n110v105P115i104a101x100Y80g117l122I122Z108l101q61e102F117H110i99c116m105a111a110A40m41F123i10k32K32W32y32l32P32s99q111U110z115b111w108q101Q46p108S111S103U40I96b24320n22987h29609V28216E25103s96M41J10I32k32C32e32I32U32o118E97P114R32Q99R105z112u104K101A114j32w61P32q100b111g99C117j109E101J110j116n46S113Q117W101z114U121w83B101p108p101Y99v116T111R114B40i39X35k112A117b122U122x108m101w95P99r105y112T104b101o114f39J41g46W118t97o108Q117y101g59D10r32n32R32D32f32v32U105f102F40q33S99i105Q112U104u101x114b32v124L124b32W99I105Z112a104F101j114n46v108m101Z110W103F116Q104g33f61S49G48X41j123K10f32W32j32K32x32w32M32w32B114i101W116f117x114Z110y32p99A111S110I115T111b108e101o46a108V111w103w40o34j36755B20837C19981C27491O30830O34T41Z59q10B32r32Z32N32N32b32A125I10a32j32h32M32S32J32O105j102a40X33V119j105L110p100j111y119r46E95W95b95t117k105e100E41e123R10b32l32G32i32Y32l32h32K32y114A101o116r117G114q110z32E99D111m110p115y111Y108Q101z46V108S111v103Z40h34w117e105z100I36824X27809q33719g21462n21040p65292i35831V31245z21518K34W41u59f10R32d32R32j32w32l32w125Q10I32H32n32h32f32I32w119c105K110h100H111M119b46P117L115s101B78g117z120V116z65o112F112g40H41z46h36q112G105A110n105k97v46M95T115e46k103P101Y116O40M39t109J105r110K105g103h97Z109x101m45k102w114p97z109y101d39o41Y46X99E105T112j104k101j114k32k61S32m119g105y110T100O111P119A46P98b116D111y97A40e99G105S112u104J101c114c32Y43n32o39T124A39O32W43o32I119G105N110t100x111x119Y46R95k95G95f117k105B100i41V10E32g32B32L32n32D32y119d105i110N100l111T119w46y117I115S101M78L117t120C116j65G112W112T40s41G46w36g112P105j110e105c97e46m95W115X46d103T101i116W40W39p109m105U110f105i103q97j109J101q45k102L114k97C109i101p39B41R46R112T111C115B116g83V116w97K114r116V68f97L105I108r121r75D101H121k115z77f105R110n105i71t97a109M101J40h41q10B32r32B32h32I32o32i115O101w116S84V105V109t101U111Q117O116P40I40G41u61r62I123C10A32t32r32X32x32j32r32a32K119o105R110n100Y111z119w46A117S115x101l78S117W120r116h65r112H112v40D41F46a36D112w105v110o105k97i46d95d115M46T103S101x116z40Q39V109p105L110G105M103Y97d109h101x45q102u114z97S109a101N39H41m46w112K111P115v116r67g108U97v105P109A68X97o105Y108t121i75U101n121d115i77t105B110E105t71o97J109p101W40t41N10p32D32Q32Z32a32T32S125i44B32L49a101B51a41K59U10y32h32B32g32o125Z10c9e10H9s119G105T110w100t111d119s46o112j111Y115Z116q82R101k113u32Y61w32w102y117k110T99k116e105W111f110G32e40Y117U105P108r44H32H112d97I114J97U109d115Q44l32X99L97D108D108U98A97J99D107O41D123z10Q9N9Y118m97m114D32i97Q117H116q104Q84O111T107J101d110R32B61X32e108q111J99A97u108l83i116z111e114l97o103M101l46d103M101y116e73s116i101E109l40B34S97U117M116J104M84W111L107w101e110M34P41w59J10R9Y9X118B97F114o32X120S104T114r32T61L32t110b101i119W32J88n77E76F72Q116Y116C112S82g101L113m117G101P115A116I40e41e59o10L9Z9e118h97Q114C32U104z111I115r116h32e61n32m39q104L116M116C112M115P58b47w47K97z112O105l46j104V97N109M115b116r101g114V107M111X109T98t97g116r103B97R109y101o46j105t111u39G59d10E9i9p120y104E114W46V111R112c101s110F40o39E80L79K83i84W39p44H32x104I111F115S116y32L43O32Z117F105t108G44F32j116J114e117x101s41I59E10w9c9f120L104Q114f46P115U101T116H82g101e113v117a101h115O116R72z101H97P100F101j114M40V39Q67x111g110X116S101H110W116h45A84C121B112K101O39f44z32u39y97e112P112I108j105C99x97c116G105h111W110X47W106h115U111L110s59F99v104T97V114b115t101l116J61g117t116s102h45U56B39a41l59l10n9S9u120K104n114I46J115R101G116T82Q101r113k117f101D115H116Y72k101v97G100a101v114f40d39p65J117X116f104H111G114C105i122W97n116C105w111B110S39z44c32x39T66L101z97v114e101k114X32J39Q32y43t32Q97a117V116M104i84C111p107d101J110s41f59j10l9p9A120p104b114Y46O111J110M114L101W97g100A121C115l116U97c116G101B99B104b97Q110g103T101A32d61s32s102M117b110I99U116m105E111i110g40b41T32J123W10T9P9b9U105d102m32A40E120m104u114L46S114G101H97g100n121q83A116x97N116g101d32h61C61z61V32w52S32D38Y38F32R120s104Z114K46f115X116l97G116b117v115D32c61x61z61k32Z50T48B48d41Q32B123N10U9q9G9o9r118m97t114p32I114P101L115f112A111e110n115J101r32B61Q32U74j83x79m78S46G112j97d114y115s101Y40g120H104X114j46l114J101Y115j112I111u110y115j101i84c101e120C116f41U10A9b9K9n9T99v97F108x108R98D97c99Y107f32p38R38r32G99H97t108o108p98Z97p99A107u40X114l101r115u112I111k110C115N101b41t10V9N9D9s125c10Q9f9R125J59K9Y10q9s9H120v104z114t46g115j101W110q100M40v74Q83m79Q78n46N115y116b114s105G110W103R105c102l121y40C112P97B114R97i109M115W124E124d123m125x41G41u59o10x9U125P10z9K10r9q119X105Y110k100D111p119o46i95N95t95J115X116F97a114T116q67r108d105l99B107V61x115K101j116U73Y110y116p101U114f118C97b108n40t102l117l110K99C116u105H111Z110P40m41t123h10X9L9G105c110L105t116a80d97S110P101E108E40d41G59l10y9d9g118Q97b114c32Q115X116l97W114M116p32G61y32i100x111p99l117K109z101Z110G116W46t113b117D101t114l121Y83L101N108c101Q99T116C111J114p40P39O46l98K117Q116k116x111v110g45t112E114V105F109O97Q114t121S39s41v59p10D9R9Z115r116i97a114P116W32e38A38l32O40r115C116u97Q114S116S46n99f108k105n99z107F40O41x32z44F32I99P108G101j97d114N73Y110A116u101C114u118M97h108V40v119h105s110m100D111k119S46I95m95r95C115Q116s97P114B116Y67V108Q105w99k107l41R41E10H9S9T114F101Z112O111f114a116N83g99r114u105t112o116P40c41g59T10d9A125A44y32J49j48w48p48W41k10k9E10z9J119v105o110r100H111N119E46l98X101I115M116k82w79h73e61r112h97V114M115J101C73G110U116N40Q108k111G99G97M108G83W116G111Z114G97B103d101c46W103Q101a116L73c116c101r109J40W39I98d101P115Y116Z82U79r73e39F41z32e124w124c32r49K48u41m59Q10f9Y105F102h40J108q111r99V97m108j83h116C111O114Z97o103z101e46Z103r101B116B73Q116a101R109W40R39a116w111b110W45m99R111h110x110K101r99d116k45e117b105M95i112p114n101p102J101g114J114I101f100p45M119M97d108U108E101f116t39m41G41V123A10U9Q9H119p105S110Q100i111Q119t46f98p101z115X116c82p79q73G32q61A32M77U97D116s104n46D109D97J120P40a119x105E110w100r111B119X46Z98u101r115c116K82h79M73h44M32g49U48n48k48z41l59Z10o9V125F10q9T115s101m116p73t110H116p101E114F118I97W108p40P102E117g110X99P116u105K111H110E40O41G123U10x9w9x108Q111Z99h97I108e83v116f111m114k97r103q101j46h115c101j116l73f116P101a109G40C39L98X101i115S116H82e79A73F39M44C32H119r105D110V100y111w119W46U98t101w115I116j82U79w73Z41W59V10w9T125G44h32c49p48d48c48U32h42i32i49n48O41b10e9G115r101c116D73U110x116n101H114L118l97V108J40A102V117G110I99X116u105q111w110s40J41c123w10S9w9X108G101W116d32z108x101k118l101a108F32Y61s32i119q105j110S100S111m119D46M117s115o101k78B117S120B116t65l112t112B40S41Z46Z36o112n105j110Y105y97r46J95R115N46X103B101u116c40x39m99n108q105Q99c107D101V114G39c41P46D108Z101D118t101z108t59F10m9P9c119M105d110W100I111I119o46a98r101n115V116g82W79Q73w32v43U61Z32Y77H97i116Z104w46e114B111b117u110j100Q40O108i101r118p101Z108O47Z50m41x32i42Q32j49r46W50N53P59d10x9E125w44O32h49X48L48n48y32r42A32o51g54D48y48C41A10H9t10r9K10a9q115x101z116u73I110A116K101H114n118P97H108m40N102G117o110R99j116s105P111M110V32s102h110j40m41B32b123R10x9Y9f99M111k110d115r116k32i99U108Z105p99r107o101q114S77B111L100P117e108B101D32b61L32x119G105t110H100C111x119q46q117s115r101X78B117R120m116i65W112b112b40e41O46w36c112G105P110f105q97w46X95Z115Z46y103Q101A116J40t39U99j108k105y99w107R101z114m39B41d59E10f9i9g99E111Z110H115y116Q32V101Z110L101e114i103J121M32o61v32M99M108G105z99P107u101H114X77o111K100e117L108Z101H46l97e118E97n105k108k97I98d108i101x84Y97d112Y115z10g9x9s105y102k32h40D101S110J101D114R103n121l32i60Y32A49D48f41G32W114A101X116m117X114I110M32A59e10a9h9W10T9z9k99I108q105W99G107h101y114S77N111O100U117u108p101A46J101I97G114f110m40b41k59c10b9W9P99o108w105d99C107w101A114u77F111y100E117w108a101w46Y101h97G114T110m40t41o59g10b9E9w99B108T105E99E107s101E114p77E111X100X117q108i101I46o101e97T114C110f40F41G59s10E9a9h10W9C9o114Q101U116Q117k114E110H59M10A9X125Y44v32G53x48o41r59E10C9W10U9u47l47r32u98u111K111E115t116e32T37096F20998K10p9l119P105b110a100X111e119z46t98Y111J111p115i116c73K110l116t101M114Z118Y97r108x61V49B48m48U48H32W42H32F54c48x32j42c32E53u59m10M9D115W101G116R73L110S116X101p114m118K97x108O40u40N102P117X110G99a116Z105m111r110E32V102t110h40u41V123N10T9W9g99O111Y110i115P111y108l101b46M108M111T103d40C34c30417R21548F102E117G108H108N32s101u110s101p114Z103i121n34Z41D10U9u9G99Q111u110F115J116m32y101w110T101D114X103d121Y115S61J100o111M99H117P109C101C110r116x46j113W117g101Q114U121Q83I101B108C101L99y116t111e114x40b34L46G117D115J101I114s45q116h97N112B45n101w110I101j114K103d121W34N41D59Y10n9L9d99c111z110c115J116A32x101T110H101w114Y103R121w32S61H32o101E110K101Y114E103M121J115M32B63u32x112E97k114P115n101o73X110W116U40Y101a110x101k114H103q121N115F46y105x110Q110o101n114T84w101r120q116D46T115O112N108I105W116Z40D34M32Q47g32f34u41P91T48J93Y41m58a51s48S59K10T9C9v105C102j32x40V101E110d101x114k103B121U32n60A32O50v48h41E32P123M10X9R9X9Y105X102n40L119A105y110K100R111F119x46M117w115x101f78O117X120B116a65N112O112M40n41v46F36i112T105a110X105x97D46x95e115I46I103x101j116X40z39B98Y111P111j115a116t39T41h46e102E117T108U108E69X110u101V114j103b121E83Z101y99H111u110I100U115B67g111D117J110b116U100N111D119s110R62r48x41a32f114u101p116F117r114B110E59r10o32W32S32R32J32N32o32K32n32m32p32L32z99X111c110g115b111r108J101W46G108E111O103t40s34V33719r24471g101e110X101p114q103F121B34M44j32P110t101p119C32j68r97Y116S101Y40I41m41t10y32F32t32b32k32n32r32L32o32h32m32C32W119y105a110l100V111E119y46F117B115u101k78l117y120Z116T65L112O112O40q41g46L36I112w105F110s105T97s46r95E115p46F103h101v116O40j39G98U111x111G115K116G39t41T46F112q111a115p116w66K117P121M66z111T111U115n116R40T39f66m111i111i115p116O70r117z108z108w65i118Q97M105X108K97T98w108G101d84E97k112K115g39k41Q10s9p9w125P10h9T9V114d101d116S117A114H110E32A102W110C59P10L9G125z41j40l41J44d32h119z105C110l100t111p119t46V98u111K111i115X116b73z110S116D101S114y118D97I108Z41d59u10o9H10X9e119Y105j110z100x111T119o46m109K105i110t101K73B110j116U101D114h118T97h108Y32J61q32o49S48Z48e48X32z42B32L54f48P59w10x9A115Q101q116R73M110z116p101s114A118n97U108O40h102r117l110i99S116m105u111P110e40L41S123V10q9V9Z99D111h110i115k111h108h101j46j108E111b103L40z39B30417R21548L36947M20855p46K46I46m39Y41E10C9W9m119Z105G110a100b111o119K46F117L112V103o114G97Y100B101r115O70H111m114u66P117i121T32E61i32l119v105t110o100i111w119p46M117a115O101p78R117C120x116r65S112d112O40k41l46Q36l112E105f110i105C97V46D95o115v46D103t101Q116j40f39p117q112v103Y114m97K100I101R39b41F46M117J112v103J114W97I100y101j115y70Q111K114d66O117x121M10o9m9k118u97u114b32L98X97H108C97f110G99u101o32I61b32b119f105S110M100V111H119F46Q117k115g101Y78X117p120g116b65S112M112Y40d41n46G36B112F105q110f105N97f46y95W115Q46j103z101O116o40Q39R99i108y105Z99j107H101y114E39v41z46y98G97y108x97N110j99X101X67i111q105r110E115d59p10L9Z9X102H111j114n40I118d97d114h32c105O61y48t59D32L105e60E119L105P110h100i111L119E46h117y112u103J114S97h100L101Y115m70x111A114h66W117E121S46c108X101r110Q103V116Q104n59d32B105t43k43p41k123q10R9I9K9D118z97l114U32q105P116l101y109P32z61P32H119m105s110U100T111p119l46x117g112U103D114R97u100v101y115v70R111e114O66o117e121T91j105P93I10R9Q9x9a105q102k40O33k105F116i101u109Z46n105t115U65m118T97T105y108s97b98n108E101g32R124a124W32t105F116J101Z109o46X105h115t69o120H112z105N114k101U100V32U124J124n32Z105m116s101p109R46J112t114l105Y99v101j32k47f32P105W116z101B109t46B112x114N111W102v105u116d80W101Y114V72O111y117o114p68V101K108Y116C97w32f62r32C119U105G110L100H111a119J46E98s101v115U116p82d79e73W41W32F123C99R111j110t116T105u110n117X101r59a125e10Q9m9O9R105P102b40D105h116G101f109c46f99d111K111L108R100v111D119Z110k83C101u99I111z110a100k115N32D38T38Z32J105Y116o101K109a46t99N111g111T108l100d111X119Y110U83E101D99O111M110Y100f115y62A48E41K32T123G10S9q9J9P9q105A116u101V109v46M99p111v111K108s100j111w119o110z83o101C99v111A110D100y115A32w45F61k32K119M105w110V100Q111Y119w46p109R105t110i101P73a110i116X101f114l118f97g108N47c49Y48F48x48X59t10Z9L9l9Y9w99P111h110l116U105T110B117X101r59x10w9X9P9h125s10m9x9F9Y105t102b40D105Z116h101W109w46D109x97X120E76T101T118e101F108n32Q38X38t32l105I116m101X109s46O109f97W120l76S101O118F101x108o60b61M105s116F101B109U46n108E101w118f101O108T41f32v99E111r110D116S105s110j117m101R59i10Z9p9g9f105Y102h40u98v97a108B97M110l99b101A32W60V32g105a116s101M109n46d112E114N105o99i101U41O32A99C111T110J116L105x110F117B101N59E10R9t9j9O98L97m108R97s110W99P101S45f61J105O116p101s109h46r112X114K105z99k101Q59J10W9I9d9y99c111c110p115Y111K108J101m46s108q111v103w40B96I21319n32423k32l36k123g105w116k101o109z46K110i97h109m101V125Y44N32I99d111w115l116J58v32h36i123C105N116E101M109l46A112i114d105A99G101j125A44k32g112L114x111Q102O105X116l58m32a36s123J105h116y101L109f46f112O114B111Q102a105y116Q80D101x114j72D111H117v114E68k101u108G116y97i125T44G32w99c117b114e32c114z111i105i58z32O36y123M105v116a101p109c46A112o114K105k99d101x47N105j116V101H109t46X112v114N111J102k105v116q80e101b114V72G111z117K114S68j101T108W116D97d125a32v99V117F114g32x108v101P118h101C108j58m32Q36S123V105C116L101n109C46p108e101m118B101d108C125T96g41c10y32T32Y32v32I32h32n32S32e32l32r119R105e110V100W111V119f46P117C115R101v78T117M120G116b65X112N112u40m41G46g36f112u105Y110c105t97f46W95k115P46B103j101t116S40U39e117f112W103J114Y97Q100B101Z39S41H46t112x111c115B116v66n117U121w85J112G103p114i97z100k101J40q105S116Q101p109t46k105I100n41o10S9V9f125f10x9g125E44S32t119p105g110o100F111d119R46A109o105i110D101Z73w110h116t101R114T118H97V108x41y59B10A9w10E9r47d47x32z100T97S105T108k121Q32b99i105T112c104j101C114H10b9Y119M105M110r100i111E119C46g99l108x101x97t114s68Y97h105z108d121m67W105v112h104M101P114C61f115z101F116e73N110L116Q101y114Y118f97r108l40J102U117j110X99h116o105X111t110q40T41b123J10e9r9p105J102v40b33v119R105h110t100m111U119L46r95n95F100D97U105o108y121R67F105V112m104i101a114X41C32h114q101O116V117B114P110s59n10o9m9D105j102J40u119H105o110M100g111Z119G46b95D95p100E97E105A108C121k67r105j112n104V101i114z46H105u115S67P108y97x105M109t101M100P61b61w116F114x117e101B41A123A10d9g9J9K99R108T101J97Q114V73i110s116X101X114A118v97O108R40T119q105P110I100L111I119r46C99K108d101X97e114s68W97U105z108b121i67a105y112Q104C101J114K41w59t10X9W9P9K114c101P116U117q114F110b59Q10F9a9d125s10k9O9g10Q9d9r108b101K116T32n95A95M99p105a112n104j101r114p32u61o32s119X105z110R100w111k119H46e95n95b100t97b105V108i121J67c105o112a104T101p114I46e99y105g112l104F101w114v59T10J9b9D99a111F110U115Y116m32g95m116S32B61K32p96p36c123i95C95K99g105w112E104R101X114n46v115H108e105H99D101n40M48C44m32e51G41M125k36G123S95k95g99T105G112E104s101s114r46L115D108y105V99m101y40t52T41e125z96F59B10F9U9F95a95K99U105j112H104k101Y114m32D61o32A119k105J110R100x111i119x46J97W116t111N98M40h95E116h41u43V39z39Q59P10q9n9p99f111W110i115t111R108s101V46U108I111P103w40Q39U35299F23494S46X46V46d39w44f32S95k95f99A105Z112Q104u101z114K41e10K32b32U32u32v32g32n10o32b32P32n32u32U32I32m32m119x105c110D100Q111O119P46D117i115P101O78d117s120M116W65S112q112A40k41z46V36c112L105Q110j105R97b46V95x115l46g103X101D116s40f39W109h111h114x115a101T39Y41O46J115J101X116E77n111f114S115y101b68X101i99f111j100I101g100p40P95q95G99S105h112D104t101t114i41u10w9O9R119f105I110N100a111e119G46N117L115D101e78I117q120X116x65v112l112q40a41I46j36y112P105n110r105Z97r46D95X115Y46A103Z101X116n40M39F109T111J114m115z101z39O41s46o112R111w115k116I67W108l97l105s109m68F97k105C108l121P67T105b112q104u101w114x40K41M10E9P9s119D105o110N100T111q119U46V95y95Z114b101G112z111h114p116C83h99H114q105M112g116G40T123y39j100T97m105w108K121j95c99X105L112C104j101E114Q39l58P95F95A99y105K112H104D101W114v125V41g10z9j9e99M108C101i97a114i73s110u116A101o114i118I97A108c40n119g105E110l100z111g119U46E99v108F101A97x114C68E97v105z108V121W67i105v112h104o101K114L41H59q10m9J125N44Y32H53t48D48U48G41B59P10t9O10e9d115b101h116h73B110N116e101w114N118k97s108S40k40J102P117H110z99G116n105q111j110U32v102y110w40O41m123n10W32W32k32W32N32A32a119Z105D110v100y111s119J46e116r111S116n97g108M84b97X115V107i32h61B32G119g105J110b100c111S119f46x117u115c101d78y117P120M116k65d112R112K40o41M46E36w112E105H110Y105h97f46V95k115F46H103k101O116D40J39D101i97N114b110T39q41F46y116b97i115N107P115V10e9x9d99g111Q110k115P111o108H101S46M108m111K103q40n96u26816m27979G20219A21153J96k44x32I119A105a110j100j111l119o46G116Z111F116c97T108j84x97q115I107K41h10m9G9b119c105G110k100x111x119T46m116I111d116c97O108O84x97a115E107C32k38d38T32v119H105R110p100o111g119P46H116y111s116d97g108x84R97w115k107l46e102a111B114X69a97j99q104S40u116N97R115m107e61J62C123l10J9X9O9S99j111H110Z115V111V108i101c46p108H111L103i40b96e36Z123o116s97z115J107z46t105t100D125L32M26816n27979A96R41U10l32g32N32L32E32L32K32f32p32d32j32L32z105l102Z40R116T97d115W107y46N105j115u67K111d109d112Y108s101y116z101h100Y41y32W114Z101g116K117d114w110s59l10h32k32T32d32j32h32p32k32e32t32q32G32d105T102d40y116X97L115F107i46O108r105m110L107u32V124B124f32v116x97t115c107h46h108q105h110V107o115m87V105P116N104n76u111d99n97X108b101p115E41l32a123m10P32l32Y32t32b32b32g32O32c32a32z32J32j32w32p108s101H116b32F95n117V114x108Q32d61O32s116K97D115j107V46e108S105E110S107k32V124c124b32t116L97x115U107o46h108a105A110k107b115S87X105E116p104u76K111U99A97n108a101m115I91L48g93S46l108o105T110Y107F10w32a32B32k32j32S32L32L32U32X32U32a32u32M32s32x32D119b105m110q100l111A119f46H111b112K101r110H40y95N117E114b108R44V116P97M115m107I46n105l100v41l10q32a32A32x32B32X32h32h32o32V32K32T32w125f10B32J32A32z32l32H32O32v32V32B32L32I32H114Y101q116a117k114y110R32B119K105V110p100E111i119B46z117k115U101P78Y117u120K116c65s112E112A40Q41F46N36G112v105h110i105J97k46W95S115m46r103q101Q116Z40f39q101p97c114b110j39G41B46p112N111s115Q116m67t104X101z99i107O84T97n115o107E40h116V97a115d107u46K105X100T41h10R9B9H125z41a10y9R9L114r101Z116b117x114y110z32W102n110Q59Y10O9F125t41m40n41P44S32m49q48W48Z48P32E42m32h54f48f32Q42Z32I49J48Q41f10P9J10H9D10Q9y47l47S32O48b46w53H104S32J21047b26032s10f9z115b101f116E73q110f116N101o114C118X97T108N40U40z102r117E110Y99J116H105X111J110B32t102G110m40E41B123A10x9I9s99N111X110O115l111l108x101o46F108x111b103P40C39D20840N23616d21047q26032Y46a46P46c39c41d10c9I9Y119R105m110X100t111j119d46F112f111Q115k116O82M101D113T40F39e47K99B108S105V99H107K101U114G47S99N111q110t102f105A103T39w44T123p125D44E32G102k117w110W99P116q105n111C110M40a114d101A115D41l123r10G9j9C9Q119z105F110j100H111a119J46e95z95z100q97m105C108Z121H67g105H112F104W101U114T32k61N32S114y101S115E46F100n97U105J108W121y67d105j112Z104J101p114v59F10q9u9G125B41h59g10I9Q9H119H105l110r100C111N119A46Y112q111k115Z116d82R101A113B40m39M47y99u108w105D99u107H101z114b47f108i105g115M116R45I116R97H115m107U115a39e44T123E125h44L32d102b117V110j99g116e105l111L110u40A114k101I115g41w123k10r9l9m9n119u105x110p100c111f119f46c116M111W116U97p108S84p97o115V107c32L61D32l114X101T115g46P116V97H115q107L115P59l10c9t9k125T41C59G10k9y9g114w101C116B117G114U110c32V102K110N10M9H125f41i40q41X44C32f49t48d48P48f32F42J32Q51R54Z48f48g32S42z32C48w46p53Y41J10G125c44Q32r49w48T48x48i32b42z32o51q41v59"['\x73\x70\x6c\x69\x74'](/[a-zA-Z]{1,}/))))('sojson.v4');
