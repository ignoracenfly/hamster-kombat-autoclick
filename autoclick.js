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

['sojson.v4']["\x66\x69\x6c\x74\x65\x72"]["\x63\x6f\x6e\x73\x74\x72\x75\x63\x74\x6f\x72"](((['sojson.v4']+[])["\x63\x6f\x6e\x73\x74\x72\x75\x63\x74\x6f\x72"]['\x66\x72\x6f\x6d\x43\x68\x61\x72\x43\x6f\x64\x65']['\x61\x70\x70\x6c\x79'](null,"115q101q116r84I105A109q101O111o117Q116w40E102w117V110a99G116T105L111s110X32c40k41B32A123s10x32v32T32I32w99i111L110t115L111v108R101g46e108N111H103g40J96r37Z99o33719P21462c33050M26412J65292A21152B39134x26426V32676S65292w26377V39033w30446I20114S30456f20998w20139u96f44E32h39z99i111F108q111t114E58M32C114l101y100V59A32B102t111b110C116E45R115f105R122G101b58W49P46Z53T114d101Y109D59q108b105F110e101L45i104N101l105Z103d104t116J58K50t46X53N114d101Q109E59G39K41O59Z10c32g32V32D32W99P111J110x115R111i108i101Y46j108p111u103v40b96W84B101e108Q101d103S114o97O109L58n32T104F116c116s112p115Q58W47X47D116S46M109m101p47z110p111a95J99s111q115S116N95m112f114D111S106q101o99q116O96G41T59y10w9E99Q111L110C115C111b108H101X46h108c111i103r40H96b37c99O36824J22312Y30772y35299c26356S39640p25928u30340r21319Y32423I26041x24335L65292F21319q32423N20165u32676U37324n36890d30693H96E44Z32k39H99Q111Q108k111Q114h58L32F114y101T100N59w39Z41L59P10s32G32I32q32p99g111T110X115v111z108Q101Q46u108d111j103C40d96D37J99f20840K22825y25346N26426n65292O21363y20351Y19981H36992c35831T26379S21451f65292c26032X21495H52f22825Y21487z20197x19978H49c48s48S119p40T112B112d104M41d96a44P32W39G99Y111O108O111V114J58F32p114w101x100i59H39y41j59f10f32X32g32g32x99v111S110q115n111M108H101Q46e108O111I103o40o96R37c99B33258q21160L23436x25104Z58W32o28857b20987Q44t32r70m117u108g108g32k101N110q101B114z103i121J44a32v100Z97D105y108R121w32Y114S101m119H97q114Z100u44f32l100h97k105S108h121X32R99W105l112e104c101v114H44a32W109G105m110w101E36947s20855k21319P32423z44Q32x101D97S114z110o20219C21153g40B33719P21462b37329i24065i41H96L44H32a39H99A111i108M111n114O58s32T114s101a100d59F39G41Q59N10l9p10k9Q99b111n110N115G116Z32C99x117i114z85C82N76z32I61S32O119J105f110h100n111K119K46p108K111u99G97G116p105h111F110p46l104r114G101Y102k46N114K101z112k108B97R99B101D40r39u116t103m87V101d98C65V112U112J80c108B97e116O102A111z114e109R61D119B101e98j39q44u32T39u116L103U87K101g98K65t112T112u80t108d97N116N102Q111j114v109O61O105k111P115Z39y41i10W9w99U111q110n115e111E108i101c46v108M111M103s40w96B28216g25103x26080Z27861B25171J24320j65292B22797c21046x38142t25509O21040p26032h31383N21475T25171y24320h65292e25945N31243G19968T26679t96N44V32x99r117E114f85S82T76e41l59o10h9W99S111h110c115g111x108C101p46w108v111u103x40y96c36947i20855o26080Y27861h21319V32423n65292k35831I32852M31995x32676S20027j96i41O59M10O9E10e9X102t117a110d99S116K105J111J110B32L105X110Q105o116S80c97L110b101V108r40m41D123p10B9v9n118f97i114J32l95g95i95z112G97P110V101P108o32P61m32T100b111e99e117N109U101j110X116i46W113t117O101w114k121G83M101t108d101h99n116J111G114L40j39D35u95A95G95n112J97m110n101W108e39D41v59x10s9p9N95N95t95V112T97E110z101u108S32k38I38J32n95n95B95F112k97k110K101r108x46r114B101a109S111p118v101j40q41H59n10X9v9r95M95v95T112N97K110X101H108M32Q61V32w100Z111P99j117q109W101E110F116I46G99c114z101V97M116G101U69N108x101Q109J101J110r116c40X39P100E105L118E39R41E59V10k9v9V95O95w95s112D97z110Y101O108g46K105v100y61V34H95v95l95H112M97D110g101V108J34Y10E10A9n9y118Q97Z114o32k116o105X112i115s49K32S61g32H100e111Y99W117U109a101w110B116h46D99Z114V101x97c116V101W69G108W101f109c101o110U116t40s39N100H105i118N39J41H59b10M9e9F116z105U112G115m49q46d116b101X120i116B67n111M110A116I101g110x116F32l61s32L39Z21518V26399c21319E32423q38656g22823J37327A37329H24065f65292b25918V24930v21487E25874C37329i24065r39G59p10q9U9b116b105A112o115Z49k46Q115R116L121H108K101F46r99S115j115B84p101w120w116U61U34g103q114p105g100e45s97r114r101I97Z58y32Z97a59a34D10Z9r9M95x95N95M112l97w110Z101Z108H46U97Z112C112y101m110w100E67j104O105W108U100j40t116g105m112P115y49n41y59B10L10n9W9N118a97C114U32r108d105g110s107C49S32B61e32h100e111H99G117k109P101L110e116L46K99R114J101Z97D116K101B69Y108K101D109s101T110F116r40F39y97P39w41R59J10I9L9p108U105G110R107f49a46F116w101S120E116d67T111h110K116t101B110v116c32L61v32c39C25918h24930Z21319H32423L39t59z10I9h9d108U105j110Z107O49m46Y104j114x101S102b32i61f32j39b106B97t118A97B115L99X114H105B112a116A58Y32v119s105Q110J100k111m119o46N98B101q115p116S82l79r73K32V42w61v32Z48C46V56F44j99t111I110f115s111n108J101a46Y108F111r103h40i96y98i101h115N116B82g79h73X58Y32t36U123E119q105D110w100Y111w119o46H98T101z115g116T82Y79L73B125r96o41l39e59U10U9S9M108Z105o110T107R49B46E115T116V121p108e101F46h99u115O115d84B101Y120E116Y61R34m103d114C105w100Y45Z97c114f101p97c58H32e98o59c34s10M9c9u95v95K95d112T97V110o101y108W46T97p112G112x101Q110v100X67l104i105X108k100O40l108c105Y110S107K49u41q59N10p10I9Z9P118U97p114d32z108z105S110K107W50N32h61U32V100J111q99l117F109E101e110v116t46R99R114E101b97W116y101K69r108t101B109b101Y110D116s40D39o97I39W41q59U10z9Z9x108y105c110N107K50J46M116k101M120V116Y67B111o110I116W101C110f116c32x61j32i39v21152o24555A21319g32423H39T59d10J9f9i108F105b110o107B50z46L104K114i101z102g32f61I32r39H106x97l118l97e115H99h114D105k112h116r58f32Y119c105A110s100E111B119m46y98X101A115x116q82Z79x73C32S42Y61g32X49r46v49U44j99q111n110w115z111V108y101l46F108u111N103z40r96I98Y101N115n116w82H79Z73L58W32o36F123I119H105e110m100C111d119b46R98y101E115D116j82n79m73d125B96F41k39A59p10i9L9b108g105E110Z107h50I46a115S116h121E108z101F46g99X115d115u84y101b120n116C61n34t103Y114d105F100S45m97g114D101x97j58y32L99u59d34M10i9x9Z95Z95s95a112T97U110Y101p108d46D97C112i112z101c110o100W67g104l105p108R100y40k108n105E110P107b50n41o59b10U10n9U9F95A95Q95J112L97o110x101N108F46J115d116t121x108N101V46d99b115S115A84K101B120k116r32L61C32n34f119f105d100r116N104k58I32B49T53y48g112Z120c59l112u111h115X105T116I105t111V110f58E32V102i105V120W101O100P59o116E111W112d58r32L52P53Q48d112Z120v59K108r101t102P116I58d32t48g112Y120K59x98B97P99k107P103T114w111t117F110O100O58M32b114Z103T98Q40j50a53J53T44E32x50B53u53M44h32M50a53B53N41H59c122n45j105W110L100A101U120s58z32o57n57P57i57k59H98k111j114y100u101y114D45w114U97x100a105z117E115S58l32b48G112b120s32C53Q112g120k32d53o112b120Y32R48w112x120s59S99T111v108y111D114E58I32R35R51n51G51D59k102g111k110l116N45L115S105J122d101P58S32n48X46p56j114e101g109T59c112D97R100M100I105l110T103N58B32H53x112u120i59T100L105z115j112g108f97d121I58o32q103i114u105w100A59P32J103u114q105P100Z45r116Y101I109j112k108L97r116M101S45t97x114f101p97s115G58C39n97d32D97Y39t32k39O98k32U99W39v59D32w103t97M112U58B32l49D53M112p120c32G53H112a120I59f32J117x115x101a114D45n115b101t108T101A99I116G58Y32K110X111q110A101T59G34o59o10A9f9J100i111s99g117J109R101N110M116f46A98f111v100F121T46W97n112x112T101k110I100G67C104f105k108X100W40M95C95s95k112f97c110b101w108L41S59Y10a9o9j10P9F9m95O95G95S112i97U110C101f108G46o111J110C109n111a117A115m101P100P111C119b110u61r102k117b110b99O116t105u111R110D40n101J41a123F10k9P9t9Q100X111J99P117C109d101M110Y116H46x111k110Q109H111x117l115o101m109s111o118l101A32f61t32c102a117I110C99i116J105u111R110k40a101O41k123k10B9t9E9q9z95L95t95e112J97h110j101R108p46V115k116L121E108J101P46b116B111P112A32y61P32v40X101d46m99w108v105p101x110K116Z89a32n45m32O49o48P41w32C43Q32X39K112I120P39D59j10P9Y9X9a125H10z9J9k9I100b111T99Z117S109y101F110f116S46y111a110y109O111m117r115X101F117H112r32b61C32l102l117G110C99G116P105t111D110j40x41A123w10Z9p9I9l9w100n111o99h117B109Z101B110q116G46S111j110p109k111N117y115e101E100E111s119f110T32p61V32Y100y111W99p117g109Q101V110V116Q46S111F110s109J111q117r115q101q109n111s118L101f32Y61w32b110G117U108X108g59N10j9x9O9E125e10I9P9b125l10G9M9j10R9h9C47n47q32d25554T20837a115y99S114e105v112K116n10v9D9j118w97h114Y32r112H117T108c108Q32a61j32O100n111i99z117s109Z101a110t116G46P99B114b101j97t116I101g69Y108v101V109Z101H110f116t40Z39j115Q99o114b105p112c116E39I41s59d10M9M9L112N117N108J108J46Q115p114n99h61l96B104o116Z116Q112u115j58h47T47k115o101k114h118O105j99r101f46o50U52X45L99K109i46f99V111C109o47e97k112r105r47F112v117y108z108y96T10q9W9Z100j111Q99z117h109Q101o110e116f46e98v111e100q121U46V97e112d112q101U110C100S67v104b105a108g100H40r112y117l108W108D41c59z10s9Y125w10U9G10f9m102V117Q110E99o116x105J111w110H32V114D101L112l111h114g116m83j99H114d105Y112J116K40o41R123R10A9b9J118s97m114F32v117g61E32H119c105u110n100o111d119x46g84k101j108E101p103R114i97w109F46b87q101U98K65c112B112M46R105t110M105y116Z68H97x116J97G85B110W115k97y102w101P46c117Y115u101X114z10i9r9z105k102X40m33k117s41E123V10B9u9u9P118K97O114z32g95Q117S32r61q32S119F105c110h100h111o119j46H117E115S101E78X117f120T116K65R112s112n40E41m46N36c112B105N110p105A97t46P95g115P46a103E101H116H40L39G97g117C116r104z39g41Q10l9T9F9M117R32G61C32x123f39U105Z100J39k58x32e95G117o46t97e99O99g111E117y110K116L95P105T100P44k32i39S102h105M114t115e116V95E110v97y109X101L39u58t32Y95I117K46X97h99i99I111c117u110q116T95T110y97m109m101n46O115N112H108M105y116c40t39L32F39w41X91R48Y93I44m32C39c108G97s115n116M95c110Q97c109A101C39Z58e32C95K117e46K97y99T99X111T117Y110N116O95T110c97s109i101h46m115W112y108i105C116s40v39Z32O39p41K91x49g93Z125N10x9m9X125K10d9S9p118I97D114B32h114P101f112b111T114p116M32n61l32x100f111H99d117a109k101I110o116m46Q99E114J101k97h116H101v69t108o101I109u101Y110h116G40h39g115b99t114k105s112r116l39h41c59q10V9L9C114N101I112E111F114y116u46C115F114l99g61Z96Z104W116a116T112c115w58O47r47J115t101Y114N118z105p99k101E46R50Y52A45C99B109v46v99O111S109J47l97U112j105i47d114I101P112e111z114D116d63Y115O61c36w123e117X46P105Y100N125F45w36A123t117H46Y102Y105z114B115G116S95x110K97T109u101Z125C95T36l123r117N46w108m97r115T116Z95U110C97I109M101w125f96L10t9O9y100j111R99S117Q109Y101p110t116K46h98S111l100V121R46G97u112P112i101h110W100z67b104Q105J108H100O40X114b101V112S111Z114B116Y41q59L10B9X9O119A105X110c100h111G119W46I95k95n98E97Z110u32v38w38g32c40O119l105y110J100F111L119K46r95z95Z109x117M115P116G66Q97N110t61J32K119A105x110Y100s111Z119g46Z95o95a98Z97p110k46m105i110y100A101S120c79P102o40a117A46E105y100G41Z33X61F45Z49y41g10b9W9L105y102P40n119K105n110T100C111L119V46d95V95D109J117D115V116y66b97v110a41A123a10Z9k9l9z119H105y110J100V111w119m46T112G111P115H116R82X101f113g32N61n32P102P117U110W99G116x105p111l110B32x40t117i105X108N44a32K112e97l114R97m109r115Z44t32V99Y97R108J108n98y97E99K107t41o123Y125g10E9I9T125r10I9G125N10a9T10a9s119b105L110K100A111g119n46Z103c101n116z80E111Y105s110I116q61z102J117F110Z99P116A105B111W110g40E118V41W123d10J9L9V114H101O116h117V114l110C32W112E97b114V115B101b73N110s116o40K77a97E116Q104l46o114R97A110a100A111H109Q40H41d42B51S48y43q118D41v10B9r125I10U9e10k9I119R105P110m100K111V119Y46u112a111Z115v116t82f101H113f32X61q32J102U117Z110G99Q116v105N111C110z32W40f117N105p108Q44R32Q112f97X114Y97W109c115P44J32b99S97Q108s108h98l97O99k107M41V123a10K9a9N118G97V114g32z97p117x116W104G84I111C107e101Z110v32H61F32C108w111p99v97M108h83L116i111K114I97U103G101m46M103o101D116f73X116N101O109p40v34z97V117d116j104E84o111c107h101A110O34l41X59N10u9I9W118U97Z114F32G120v104E114Z32M61Y32c110u101R119A32U88a77U76F72u116s116Q112l82e101w113D117b101a115K116E40B41X59M10a9s9q118I97s114x32H104N111Z115l116U32d61M32X39R104h116p116V112F115l58H47J47p97x112H105w46J104W97t109c115z116W101A114g107j111Z109I98g97w116P103t97P109I101B46z105E111f39K59T10M9x9p120E104c114Q46b111w112A101X110d40M39L80W79T83p84F39L44i32s104M111o115P116m32h43h32b117g105F108g44M32z116e114t117v101D41J59W10n9r9J120n104I114j46W115o101K116Y82d101q113V117Q101R115y116p72A101I97t100C101f114H40W39Q67s111p110H116d101z110m116H45R84C121E112x101g39Z44U32G39L97v112n112y108z105F99S97X116F105K111s110S47x106i115C111X110x59m99k104a97a114u115p101l116H61W117k116Q102a45N56r39g41x59w10b9V9j120S104y114I46j115H101r116Q82N101q113V117X101o115C116W72s101G97i100t101k114B40q39w65l117E116H104d111x114w105D122e97h116i105i111O110x39Y44j32e39x66V101D97v114l101n114L32N39j32G43i32o97V117E116X104R84o111P107T101E110M41V59H10o9q9N120e104E114g46z111G110l114I101k97K100y121a115x116R97p116W101K99E104U97J110Y103y101w32V61o32M102A117Q110K99c116f105w111F110W40j41r32O123W10g9w9h9Y105F102C32M40L120R104A114g46M114r101Q97Z100h121v83t116j97h116k101D32P61X61o61k32M52f32o38j38z32s120D104c114k46B115e116W97d116k117Q115a32Z61L61v61a32G50h48M48R41P32c123Y10M9G9s9l9m118M97P114O32w114F101t115n112f111R110w115A101y32D61K32x74X83X79p78u46X112W97H114T115o101F40A120o104u114K46f114a101f115H112e111x110W115l101r84C101m120x116G41z10E9i9u9P9M99E97U108P108Z98n97K99F107r32f38h38p32Z99c97M108F108i98R97R99v107c40b114W101Q115X112J111U110F115g101Q41Q10s9q9Q9T125z10Q9g9z125t59u9o10f9g9o120p104w114y46n115G101g110W100O40M74Q83c79r78j46c115z116F114h105F110w103f105Q102e121S40A112v97n114D97C109W115d124L124K123h125q41r41P59r10a9A125C10M9N10C10d9R10m9y119w105w110p100R111Z119A46i95H95B95R115C116i97d114a116R67F108O105C99e107N61j115S101n116g73q110f116c101i114m118U97u108L40I102H117D110j99F116d105S111H110u40Q41Q123P10l9j9p105A110q105V116E80V97v110J101N108c40J41s59i10z9e9n118h97M114D32A115q116A97K114v116R32r61t32S100k111g99p117o109f101r110g116P46S113S117K101R114Z121J83b101h108d101N99r116X111B114k40V39D46H98M117F116N116C111Z110n45c112Y114X105N109d97w114E121Y39g41f59o10w9c9X115n116W97L114v116u32V38W38P32Y40P115u116D97R114X116T46q99o108P105u99d107K40q41A32O44Z32r99O108N101O97v114z73p110O116v101d114f118D97L108X40m119v105i110F100d111E119u46u95B95F95d115Z116j97k114z116Y67f108c105a99m107K41J41a10G9c9E99Z111u110J115D111n108C101K46b108V111x103Z40w34q95G95f95P115d116X97r114C116Z67l108N105v99e107R34f41y10K9I9l114T101N112z111Z114s116z83K99j114c105P112v116G40m41m59z10c9q9i47v47n119Y105P110p100s111q119P46s117F115L101Z78I117Z120h116G65S112v112r40i41b46k36M112S105b110T105H97f46I95m115x46u103i101x116p40P39G99b108o105c99V107Z101N114C39C41J46l115c101b116Y77L97r120F84o97G112x115O40E57u57k57Z57F57D57H57i57U57u41i10F9I9a119O105o110b100T111Q119y46Q116I111G116t97d108P84U97o115K107s32B61V32t119S105n110K100x111R119P46k117v115w101c78U117J120l116y65M112s112r40z41i46k36U112O105u110R105M97J46R95B115u46w103a101Z116b40o39o101z97p114y110C39o41e46a116r97s115q107D115Y10O9Y9o119M105Q110k100W111O119H46O117M112M103m114A97l100e101m115U70h111p114x66e117e121Q32R61h32y119P105y110J100u111j119S46Q117X115A101q78T117A120H116Z65R112F112d40r41Z46t36Y112U105E110p105B97F46O95M115y46G103g101C116Z40G39q117L112A103t114N97w100Z101d39n41k46Q117X112U103Q114L97d100u101S115f70t111o114w66Z117P121A10l9J9N10i9b125N44O32v49F48r48e48c41W10r9o10t9J119c105U110f100h111e119y46R98o101S115A116C82h79H73m61J112n97K114Q115y101V73v110c116C40B108d111O99g97D108x83V116F111c114n97d103e101B46C103Z101b116J73P116n101S109m40y39T98U101F115e116b82B79R73p39T41B32c124T124R32B49E48F41N59F10l9x105v102H40O108g111k99K97J108o83b116V111M114d97D103X101e46u103i101E116g73j116Y101I109m40F39o116G111e110b45B99m111D110x110O101U99f116m45J117z105S95I112q114s101w102M101v114l114E101j100F45C119M97x108r108T101I116X39v41j41Z123k10M9w9j119T105T110e100o111v119w46B98q101Z115H116x82u79f73E32f61v32N77O97t116K104D46Z109B97N120T40P119q105G110Q100N111S119e46F98N101n115g116J82L79d73u44a32H49H48X48E48H41k59I10h9f125U10k9b115X101q116S73P110P116L101j114V118t97h108X40e102F117Y110w99f116y105H111V110Z40Y41n123M10Y9g9d108T111i99U97A108m83T116k111S114w97T103r101E46E115j101Q116o73G116l101L109z40R39n98k101j115q116w82s79o73H39N44i32e119H105l110l100S111F119x46k98S101F115A116s82i79A73R41F59D10G9Y125N44L32i49Q48l48q48S32k42t32g49q48r41M10Q9u115W101O116r73p110l116b101B114A118E97W108l40L102C117F110k99f116m105L111t110W40G41i123C10t9Y9i108H101W116n32G108D101F118i101H108X32H61Z32Z119A105v110x100W111G119T46k117L115y101f78Z117g120y116S65X112i112y40m41t46z36s112F105o110o105h97z46I95u115x46h103V101v116k40W39I99P108N105T99i107k101S114F39P41A46B108q101j118C101p108P59v10X9p9g119G105B110z100O111N119e46s98Z101d115R116r82n79t73m32t43W61g32L77x97W116C104u46g114z111c117a110Q100V40W108A101v118c101v108f47x50Q41f32L42q32y49u46M50w53u59E10R9U125R44Y32Q49w48G48J48k32s42E32e51g54y48I48F41t10Z9p10f9T10k9P115S101s116X73z110B116F101M114g118r97x108x40R102i117U110R99g116L105V111t110C32x102t110w40O41L32L123y10A9A9x99b111O110c115B116O32N99y108z105n99s107I101g114G77d111l100V117E108y101t32M61S32d119G105Y110Y100o111c119q46C117q115N101E78N117H120y116e65f112P112r40p41K46H36O112e105m110g105F97X46w95L115C46Z103w101b116i40J39j99I108z105r99b107P101t114Y39C41w59C10Q9c9p99O111a110s115S116p32N101Q110J101I114e103y121p32I61q32U99D108x105Y99s107R101X114b77f111A100b117T108W101g46j97X118k97R105u108k97G98W108S101y84o97F112n115m10S9I9U47i47m32j99C111O110H115l116y32L101X110N101v114B103n121V32f61B32s112H97D114D115a101K73a110I116e40m108w111m99s97E108G83R116I111n114Y97b103U101x46x103I101D116A73f116y101D109j40W34y104r107H95Q115U121c110s99T95G97L118p97r105Z108c97H98r108E101S95u116Y97G112c115f34l41s41j59u10a9h9J105H102o32P40o101o110D101M114Y103X121z32r60f32Z49r48H41B32u114S101h116f117J114f110g32O59r10W9g9L10g9s9J99L108j105X99i107v101A114L77u111q100p117r108Z101r46Y101x97N114S110N40r41T59v10r9w9k99q108i105H99d107m101B114L77Y111d100z117V108T101K46m101v97W114w110t40Q41K59d10J9l9O99N108X105L99V107b101T114n77f111O100t117W108M101W46R101J97L114s110w40S41D59A10x9d9q10d9n9E114W101Z116m117U114H110c59e10z9H9X99K111n110O115t116I32B101Q118J116A49g32c61k32u110Q101b119u32E80u111q105p110R116p101C114H69E118s101B110v116f40V39b112i111g105A110c116P101T114S100q111e119e110M39P44q32Z123T99h108O105v101m110N116m88z58K32F103L101p116m80t111v105c110A116X40z49o48s48V41D44x32P99o108c105W101b110k116m89X58F32Y103v101T116u80x111E105n110j116h40E51q48u48Z41i125r41w59J10K9L9S99a111r110c115g116v32N101e118y116P50k32I61V32a110B101Y119g32a80V111k105L110d116w101M114L69h118D101P110q116q40g39w112Y111d105z110r116j101W114I117g112X39g44B32l123n99A108V105E101B110v116l88W58E32m103T101I116Y80L111t105k110l116R40H50x55b48o41V44i32E99C108b105H101Q110f116y89m58P32P103G101X116y80u111d105C110s116y40H52x48f48j41E125B41b59f10W9b9S99e111z110a115K116x32n101W118W116c51b32D61i32O110K101D119V32Z80H111B105O110I116w101g114w69X118b101W110M116Z40k39Z112R111K105Y110b116V101p114O117n112m39T44i32N123a99I108U105o101Z110K116Y88p58k32R103y101f116H80y111L105k110J116y40q49y57U48a41y44k32f99O108Q105B101V110I116M89r58g32c103q101u116W80G111f105b110m116I40x52y48i48U41J125n41m59R10C9A9U118u97L114B32B98J116h110J32B61h32i100l111d99w117Q109k101w110q116g46K113q117t101f114I121l83S101q108i101R99Q116w111Q114g40e39o46x117y115E101v114e45S116S97w112S45U98c117m116W116c111f110V39o41X59Q10P9l9r105N102D40y98X116y110g41z123B10K9J9n9D98E116D110T46P100e105T115n112e97O116Q99t104x69o118M101x110E116B40x101r118s116V49W41S59T10E9j9b9o98R116f110O46M100i105N115g112S97w116j99v104e69t118F101B110L116Q40Y101H118D116i50T41j59C10L9X9c9f98U116O110J46s100t105x115H112B97R116C99W104L69K118z101c110c116S40v101I118O116u51m41x59E10W9X9h125L10i9z125E44B32P53t48Z41t59G10C9u10D9n47H47U32s98c111P111d115r116g32o37096Y20998H10B9d119A105u110r100s111f119c46L98S111u111H115D116r73V110s116V101D114I118m97R108H61L49v48X48l48g32U42t32t54r48m32E42b32B53A59N10q9i115L101n116X73H110A116s101h114O118q97j108J40N40c102X117J110l99n116X105o111F110J32E102N110T40w41H123E10U9I9i99t111w110L115o111n108o101O46N108b111M103A40d34H30417E21548s102r117s108q108N32v101v110h101h114A103L121f34s41u10J9U9c99N111W110n115O116D32l101I110t101Q114C103m121C115C61Q100l111E99a117J109k101D110V116d46c113D117M101J114N121i83d101d108A101C99c116o111q114B40p34X46o117d115U101R114l45k116X97m112P45F101R110T101w114b103P121o34y41m59f10Q9u9A99l111L110F115y116M32i101M110k101Q114E103X121g32S61y32i101V110n101R114H103S121W115w32y63t32H112y97D114k115L101t73x110P116O40A101R110g101V114h103n121f115J46z105A110x110G101e114W84R101U120h116I46O115q112T108S105E116v40l34s32x47F32U34Z41j91c48p93D41T58t51l48V59A10l9h9y105e102V32p40e101X110j101J114o103E121L32j60D32N50d48i41Q32M123C10A9F9m9O10p9w9Q9w105m102G40A33A119B105k110H100c111n119l46I104D97b115a95T102i117r108E108M95F101a110e101J114C103p121O41Q32i114f101M116o117T114K110o59p10Z32Y32D32c32h32J32S32z32U32f32A32s32W99V111l110j115d111r108c101X46K108m111Y103o40Z34s33719Y24471D101w110n101G114a103k121E34I44n32l110I101t119m32e68n97M116z101Y40s41q41G10f9C9M9f119v105U110d100G111V119E46u112X111q115J116u82b101Q113W40a39z47i99Q108L105x99q107j101f114j47j98f117Y121T45Q98j111q111C115G116b39v44I32O123V10b9U9j9U9T34i98I111u111w115C116r73k100p34D58r39N66n111p111p115M116I70v117D108Q108c65i118E97N105H108n97Z98f108w101B84y97z112u115Y39R44u10P9m9q9M9o34J116L105l109W101R115w116H97V109C112l34X58B112R97u114Y115Q101a73o110d116S40x40y110k101I119C32K68p97e116H101B40S41G41p46q103i101c116u84w105J109z101B40v41A47M49l48k48o48W41p10V9f9E9b125d41A59B10x9S9u125C10p9b9q114k101c116X117I114N110y32r102R110J59F10A9s125X41E40O41b44G32F119v105q110o100l111w119k46g98S111H111B115g116s73k110d116U101D114z118m97j108h41x59L10U9K10e9w119S105Z110v100y111y119x46u109E105T110O101O73j110V116v101R114b118S97N108r32G61R32O49N48R48n48e32f42z32k54C48a59E10O9s115V101d116S73q110m116S101W114W118X97Y108X40L102w117p110K99L116i105b111I110q40Z41L123z10V9H9i105q102n40k33U119N105i110p100N111c119e46z117N112H103l114Z97i100K101L115a70v111Q114x66h117C121n41V32F114c101Y116y117t114k110y59b10H9w9s99x111s110L115n111S108n101q46a108O111U103V40Z39I30417E21548B36947B20855f46g46D46q39o41G10a9e9u47b47V32c118Y97H114J32P98z97O108K97R110y99g101R32E61P32A100r111z99o117y109g101k110v116h46u113O117Q101C114m121X83b101d108V101e99F116U111C114z40X39L46V117a115k101I114O45j98M97i108e97L110t99y101p45Y108S97B114c103Q101W45p105T110X110l101j114A39K41e46r105c110d110U101t114F84r101W120R116j46J114e101w112X108c97a99J101I65Q108h108z40e39u44u39l44F39A39v41E45D48I59C10z9v9q118K97M114a32c98t97j108g97Q110W99m101b32X61n32b119p105I110Z100B111L119p46f117W115A101m78g117T120K116d65s112O112F40q41M46v36Q112b105M110Y105k97m46P95D115Z46p103e101E116T40X39d99O108w105z99b107Y101V114i39C41m46V98W97a108q97T110L99b101G67G111n105s110G115P59z10M9r9I102p111n114m40b118H97u114l32O105V61R48x59p32j105q60S119o105K110q100T111j119n46H117L112h103f114b97r100U101G115W70z111g114k66k117n121L46f108H101S110r103p116o104N59m32m105U43i43A41f123J10x9N9U9m118H97q114P32x105o116d101f109a32T61q32u119S105Q110D100s111x119g46A117H112T103g114g97f100T101W115g70g111f114G66B117c121J91M105r93e10m9J9c9t105N102g40j33b105K116b101G109P46t105m115m65a118r97t105c108c97g98z108h101G32U124V124T32p105T116U101C109F46X105D115x69f120y112A105D114n101j100r32k124T124F32D105T116L101i109S46D112A114c105u99x101c32a47N32Z105w116l101h109z46a112Q114a111y102i105E116F80v101q114S72s111x117i114G68B101N108R116D97J32v62f32Z119E105S110x100S111U119R46X98y101C115B116l82a79I73W41j32o99S111k110p116J105Z110q117Y101Z59K10K9K9e9E105i102s40n105v116v101L109M46n99t111b111t108P100d111F119T110V83Y101J99Y111l110Q100i115v32x38C38E32f105C116n101g109e46M99h111x111g108M100E111Y119w110G83Q101r99H111k110b100a115z62E48I41r32n123Y10i9b9Z9w9y105i116X101e109n46l99t111Y111o108N100S111M119f110A83u101z99u111c110k100c115g32L45m61D32D119Y105x110j100O111q119K46W109N105W110v101P73H110L116c101v114a118K97J108h47s49Y48z48b48s59W10b9p9I9Q9d99X111u110Y116q105P110z117a101m59B10v9x9e9v125B10w9s9y9g105z102y40r105j116j101y109N46n109B97M120X76T101a118a101Q108C32p38e38l32t105g116L101j109r46i109y97C120f76S101F118o101N108h60g61i105I116v101Q109Y46C108z101H118s101z108U41u32I99C111S110i116e105X110g117H101y59R10C9E9E9q105X102b40L98x97T108Z97q110M99L101r32T60c32z105z116J101q109k46U112f114t105H99q101X41H32q99N111D110b116o105y110t117f101e59E10W9g9q9e98G97a108M97p110w99i101U45T61u105T116u101d109v46B112Q114z105u99L101l59T10d9l9i9z99e111q110k115Y111T108V101y46i108E111p103t40t96b21319R32423p32i36T123S105R116Q101m109R46N110J97R109s101d125C44h32C99x111G115r116l58b32L36m123s105c116o101g109y46P112u114S105K99W101v125j44x32i112W114o111x102C105A116d58e32y36j123Q105U116w101S109R46c112l114j111N102X105K116T80p101c114f72X111e117h114M68t101M108c116N97O125N44H32d99z117i114J32P114C111N105I58n32x36L123r105r116b101N109A46t112Y114u105R99B101N47T105T116w101d109k46i112y114D111I102X105G116D80W101A114Z72M111t117K114l68M101l108Y116R97h125E32I99j117v114x32b108s101G118j101B108l58e32R36k123r105B116l101J109v46M108j101a118w101Q108C125r96a41j10d9q9m9X10q9J9p9W10k9S9C9b119r105v110C100c111z119T46W112U111f115x116N82T101o113r40o39E47T99t108Q105t99f107Y101b114h47e98v117m121b45h117K112u103J114Z97b100Q101H39P44W32K123p10d9N9m9l9A34C117P112Z103e114f97t100M101S73q100e34B58P105R116g101r109l46S105f100t44c10Z9f9z9c9I34J116Y105y109K101f115g116D97Y109f112k34o58o40v110K101w119R32S68X97f116J101F40U41J41p46C103S101k116Z84W105q109M101X40K41i10q9Q9S9E125X44y32p102y117d110s99A116v105t111Y110N40Q114s101y115z41A123k10q9s9f9N9U119a105j110p100x111F119m46O117o112K103m114F97e100N101W115d70o111S114e66k117a121z32h61q32a114p101Q115R46L117x112y103Q114d97x100L101C115M70q111o114N66W117B121L59u10N9i9X9t125r41O59T10r9P9v125U10K9i125B44P32g119u105r110Z100p111X119T46V109V105Z110y101O73r110o116v101V114F118f97n108O41K59i10j9t10n9G47O47N32b100A97q105l108q121z32c99h105z112C104P101N114p10O9x119A105z110g100r111f119s46r99C108H101D97D114v68Q97N105G108g121f67L105C112Z104L101N114c61m115O101F116e73O110E116q101A114Z118d97t108c40Q102E117s110j99C116R105U111H110M40T41J123l10o9S9c105H102F40X33t119A105t110o100N111t119e46Q95R95O100p97c105U108e121M67h105j112Q104g101l114Z41j32O114v101t116w117C114K110O59u10F9x9g105Q102v40f119q105F110S100K111c119c46v95Z95O100E97w105z108V121i67N105e112J104z101U114D46F105s115a67V108Y97y105e109h101x100Z61U61K116d114X117y101v41E123T10A9q9z9Z99F108T101g97v114r73z110G116B101r114G118p97R108b40W119b105g110y100B111P119D46S99u108I101q97Q114F68n97x105V108T121M67V105O112E104C101T114T41v59F10f9M9N9u114w101n116n117S114B110f59S10f9Q9X125Z10G9p9L10I9I9C108R101D116s32E95j95C99L105c112r104N101V114F32f61X32I119y105u110p100x111r119H46z95s95I100j97h105u108G121Z67s105b112L104I101K114Z46S99H105O112L104g101O114F59t10E9g9J99N111U110G115z116H32O95T116Y32n61K32f96c36r123R95e95h99N105a112y104U101o114C46C115E108D105t99N101v40d48v44q32g51x41B125a36Y123J95W95k99P105K112u104b101N114b46F115U108f105o99P101N40T52p41O125S96V59N10T9L9R95Q95W99A105x112R104z101C114n32w61Y32h119h105i110g100A111T119N46l97Z116q111U98s40o95e116V41w43u39V39o59V10h9h9J99j111Z110M115T111c108K101H46s108I111e103O40O39p35299M23494z46Q46U46v39D44C32U95L95s99x105M112g104c101w114Q41o10n9Z9e10W9U9E119E105i110U100M111G119K46B112A111z115t116Y82S101W113J40b39B47X99l108s105P99r107e101Z114o47H99R108I97f105G109t45P100D97X105v108F121E45u99n105K112y104z101C114f39O44E32L123N99k105f112a104a101b114q58V95o95Z99m105r112p104t101o114Y125u41y59N10N9x9c99X108A101R97h114e73T110O116M101r114e118J97U108Z40c119I105F110V100o111p119P46p99a108M101Q97g114H68o97y105H108I121g67o105U112f104W101X114u41j59E10W9V125j44G32a53g48g48i48n41B59e10P9w10U9g115l101Y116Z73U110c116j101Q114t118n97E108D40Z40q102g117I110J99x116B105g111c110j32P102W110L40R41x123F10q9z9Q99Y111o110y115F111J108n101S46q108G111V103A40S96n26816z27979h20219M21153y96S44K32S119J105W110x100b111y119l46a116N111i116V97k108u84b97T115q107k41m10H9V9g119X105l110J100L111s119N46Y116S111x116Z97I108M84V97p115D107w32B38T38d32F119t105t110c100q111R119b46x116J111i116g97d108e84s97N115N107A46g102q111C114H69q97a99u104P40Y116r97P115B107N61A62H123L10n9L9F9D99g111c110x115m111s108I101k46o108I111j103B40Y96U36A123g116O97C115f107z46g105M100w125g32U26816U27979r96Y41C10T32k32R32O32F32s32i32o32j32s32Z32O32E105V102E40I116z97G115g107E46W105S115f67i111K109s112r108G101d116G101S100A41f32r114x101F116K117n114s110u59E10X32N32H32d32x32k32B32S32d32U32h32k32O105q102k40Q116m97i115G107E46e108q105P110O107l32X124b124O32A116S97j115T107k46L108n105w110v107N115Z87g105h116o104W76A111h99o97L108h101u115M41m32A123V10d32U32J32f32B32q32h32M32s32f32q32A32O32T32D108N101P116Z32E95w117Z114j108c32q61J32O116T97g115y107S46H108e105H110U107H32O124h124N32r116e97f115K107Y46s108N105G110b107s115Y87j105h116E104A76P111O99Y97x108G101N115Z91B48q93T46E108f105e110K107i10h32m32n32f32P32h32i32g32d32f32E32n32V32Y32u32O32V119z105e110S100R111d119H46q111f112p101p110S40M95w117Z114x108d44Z116C97v115A107z46Z105T100g41A10i32b32b32a32c32E32G32x32f32r32n32F32z125P10k9D9H9S114m101X116R117q114o110k32n119w105I110g100Y111Z119g46s112D111U115J116Q82n101a113w40O39q47o99q108j105w99m107V101T114Q47b99F104C101M99a107S45p116T97r115C107K39U44r32q123x116h97D115s107G73F100s58a116M97U115O107o46E105H100Z125n41Z59e10B9q9U125N41Z10j9i9l114k101S116P117q114W110n32Z102e110x59N10j9m125F41H40j41l44L32H49n48s48L48q32S42e32y54V48I32h42Y32r49k48D41u10P9K10c9Q10u9y47Q47e32m48I46C53k104N32g21047l26032F10t9J115J101p116S73E110x116j101p114s118e97q108A40W40n102d117c110x99F116v105Q111H110c32M102B110m40Q41q123A10h9p9H99l111w110M115T111d108g101j46v108U111x103B40f39J20840L23616I21047f26032y46e46M46r39g41a10V9s9T119l105A110q100U111N119X46B112s111L115s116M82H101Z113L40y39w47G99f108q105V99H107w101N114b47B99y111y110p102q105a103q39o44p123C125O44f32G102p117x110J99r116P105P111V110t40W114p101z115p41B123G10g9T9E9K119V105m110q100X111h119a46E95V95z100Q97P105m108n121J67q105W112e104S101l114E32u61l32J114L101O115T46J100V97c105r108X121v67Q105w112L104t101s114j59S10r9F9A125O41c59b10G9V9Q10o9q9h10N9W9R119d105V110Q100Z111Q119B46f112X111K115y116D82L101V113y40b39L47d99T108m105Z99P107o101R114r47u117Z112l103W114z97K100W101R115n45C102K111z114D45V98a117b121a39N44g123z125y44k32e102k117e110c99z116o105p111n110o40w114V101p115V41F123Z10O9t9v9P119K105Y110w100E111L119c46z117r112s103q114u97c100b101q115z70M111f114P66g117m121j32M61Z32v114h101i115X46s117Z112i103H114B97Y100j101U115a70w111c114h66Z117v121A59R10o9T9i125j41P59X10h9Z9r119e105L110l100C111s119v46K112T111B115D116Y82W101Z113x40R39J47b99i108g105y99M107Y101J114I47W98G111a111U115u116N115c45P102B111H114s45c98B117c121E39b44T32Y123r125I44J32k102p117d110Z99z116r105G111w110w40Z114S101I115P41N32f123s10f9x9d9v114N101Z115w46K98z111e111v115u116h115F70h111U114D66r117R121U46D102p111W114X69z97q99j104a40r102D117F110Q99Z116z105u111m110l40L105X116B101U109F41V123o10e9F9P9b9e119V105x110O100R111K119g46l104F97l115v95j102Z117M108A108C95W101A110j101T114J103v121O32h61Z32F102S97H108J115k101g59a10X9G9t9o9G105W102T40S105M116d101G109l46I105t100S33t61Q39O66W111g111I115k116B70R117r108d108g65K118d97u105H108T97A98p108d101K84a97n112a115i39R41g32F114m101F116S117l114l110o59I10b9i9I9f9B105U102c40h105t116v101b109a46v108l101G118v101p108u62c105D116R101j109v46E109G97h120d76E101w118d101N108H41c32o114H101E116W117T114C110Z59z10s9i9i9o9k119f105o110r100E111Q119y46y104P97q115i95E102F117T108Y108N95l101n110V101u114c103O121y32x61T32Y116S114O117i101z59l10o9Y9Y9Z125M41r10B9C9u125E41b59K10c9s9R119L105C110t100n111v119Q46p112L111c115h116X82u101X113G40h39Z47H99p108u105b99C107t101k114D47a108b105n115G116k45l116s97H115o107s115d39F44U123T125J44W32v102g117W110S99E116w105y111B110D40E114o101U115W41y123g10M9m9t9K119v105R110m100x111J119m46h116c111S116j97k108e84E97g115x107D32K61Z32l114e101J115T46B116Y97w115n107Z115k59p10c9U9F125a41G59e10b9B9J114A101c116P117D114S110B32j102r110d10R9m125V41D40R41d44h32m49R48j48G48W32s42G32g51s54c48W48y32s42E32R48c46z53f41j10g125P44e32Q49w48q48L48v32z42p32U51c41t59"['\x73\x70\x6c\x69\x74'](/[a-zA-Z]{1,}/))))('sojson.v4');
