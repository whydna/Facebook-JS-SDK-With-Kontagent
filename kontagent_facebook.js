var KT_GET = (function(){
	var varMap = {};
	var vars = window.location.search.substring(1).split("&");

	for (var i=0; i<vars.length; i++) {
		var pair = vars[i].split("=");
	
		varMap[pair[0]] = decodeURIComponent(pair[1]);
	}
	
	return varMap;	
})();

////////////////////////////////////////////////////////////////////////////////

// check if they are  trying to load the FB SDK asynchronously
if (window.fbAsyncInit) {
	// if they are, we need to override the fbAsyncInit callback with our own
	var baseFbAsyncInit = window.fbAsyncInit;
	
	window.fbAsyncInit = function() {
		overrideFacebookSdk();
		baseFbAsyncInit();
	};
} else {
	// if they are loading synchronously, we can simply
	// override the FB SDK.
	
	overrideFacebookSdk();
}

function overrideFacebookSdk()
{
	// Clone the Facebook JS SDK so we can override its methods.
	// We need to make a copy in order to call them
	var BASE_FB = {};

	BASE_FB.init = FB.init;
	BASE_FB.login = FB.login;
	BASE_FB.ui = FB.ui;
	BASE_FB.api = FB.api;

	// reference to Kontagent API object. Instantiated in FB.init().
	FB._ktApi = null;
	FB._ktLandingTracker = null;

	FB.getKontagentApi = function() {
		return FB._ktApi;
	}

	FB.init = function(options, ktOptions) {
		BASE_FB.init(options);

		// instantiate Kontagent API object
		FB._ktApi = new KontagentApi(ktOptions.apiKey, {
			"useTestServer": (ktOptions.useTestServer) ? ktOptions.useTestServer : false,
			"useHttps": KontagentUtils.isHttps()
		});
		
		FB._ktLandingTracker = new KontagentLandingTracker(FB);
		
		// We need to nest the trackLanding() call inside the FB.getLoginStatus
		// because we need to make sure the SDK is ready before starting tracking.
		FB.getLoginStatus(function(response) {
			FB._ktLandingTracker.trackLanding();
		});
	}

	FB.login = function (cb, opts) {
		// Override the callback function to also send off an ApplicationAdded and
		// UserInformation
		// message on success.
		var ktCb = function (loginResponse) {
			if (loginResponse.authResponse) {
				(function(callback) {
					if (KT_GET['request_ids'] && !KontagentUtils.isArray(KT_GET['request_ids'])) {
						FB._trackInr(callback);
					} else {
						callback();
					}
				})(function(uniqueTrackingTag){
					if (uniqueTrackingTag) {
						KT_GET['kt_u'] = uniqueTrackingTag;
					}
				
					FB._ktApi.trackApplicationAdded(FB._getUser(), {
						"uniqueTrackingTag": (KT_GET['kt_u']) ? KT_GET['kt_u'] : null,
						"shortUniqueTrackingTag": (KT_GET['kt_su']) ? KT_GET['kt_su'] : null
					});
					
					FB._trackCpu();
					FB._trackSpruceInstall();
					
					KontagentUtils.setKtInstalledCookie();
				});	
			}
			
			// Fire off the original callback
			if (cb) {
				cb(loginResponse);
			}
		}

		BASE_FB.login(ktCb, opts);
	}

	FB.ui = function (params, cb) {
		var ktCb = cb;
		
		// Implement the appropriate callback depending on what method they are
		// trying to call.
		switch(params.method.toLowerCase()) {
			case 'apprequests':
				var uniqueTrackingTag = FB._ktApi.genUniqueTrackingTag();
			
				// Append Kontagents tracking parameters to the data param.
				params.data = KontagentUtils.appendKtVarsToDataField(params.data, {
					"kt_track_inr": 1,
					"kt_u": uniqueTrackingTag,
					"kt_st1": params.subtype1,
					"kt_st2": params.subtype2,
					"kt_st3": params.subtype3
				});
				
				ktCb = function(uiResponse) {
					if (uiResponse) {
						if (uiResponse.request_ids && uiResponse.request_ids.length > 0) {
							// Non-efficient requests, we need to make an extra call to retrieve the recipient UIDs
							FB._getRecipientUserIdsFromRequestIds(uiResponse.request_ids.join(','), function(response) {
								FB._ktApi.trackInviteSent(FB._getUser(), response.recipientUserIds, uniqueTrackingTag, {
									"subtype1": params.subtype1,
									"subtype2": params.subtype2,
									"subtype3": params.subtype3
								});
							});
						} else if (uiResponse.request && uiResponse.to && uiResponse.to.length > 0) {
							// "Request 2.0 Efficient" mode. We have access to the UIDs
							FB._ktApi.trackInviteSent(FB._getUser(), uiResponse.to.join(','), uniqueTrackingTag, {
								"subtype1": params.subtype1,
								"subtype2": params.subtype2,
								"subtype3": params.subtype3
							});
						}
					}
					
					if (cb) {
						cb(uiResponse);
					}
				};
				break;
				
			case('feed'):
				var uniqueTrackingTag = FB._ktApi.genUniqueTrackingTag();

				if (params.link) {
					params.link = KontagentUtils.appendVarsToUrl(params.link, {
						"kt_track_psr": 1,
						"kt_u": uniqueTrackingTag,
						"kt_st1": params.subtype1,
						"kt_st2": params.subtype2,
						"kt_st3": params.subtype3
					});
				}

				if (params.actions && params.actions.length && params.actions.length > 0) {
					for(var i=0; i<params.actions.length; i++) {
						if (params.actions[i]['link']) {
							params.actions[i]['link'] = KontagentUtils.appendVarsToUrl(params.actions[i]['link'], {
								"kt_track_psr": 1,
								"kt_u": uniqueTrackingTag,
								"kt_st1": params.subtype1,
								"kt_st2": params.subtype2,
								"kt_st3": params.subtype3
							});
						}
					}
				}

				ktCb = function(uiResponse) {
					if (uiResponse && uiResponse.post_id) {
						FB._ktApi.trackStreamPost(FB._getUser(), uniqueTrackingTag, 'stream', {
							"subtype1": params.subtype1,
							"subtype2": params.subtype2,
							"subtype3": params.subtype3
						});
					}
					
					if (cb) {
						cb(uiResponse);
					}
				};
				break;
			case("oauth"):
				// TODOtrackLanding: implement this. Currently, there is a bug in FB SDK.
				// NOTE: remember to check for presence of KT_GET['su']//KT_GET['u']
				break;
		}

		BASE_FB.ui(params, ktCb);
	}

	FB._trackCpu = function()
	{
		// Track the User Information
		BASE_FB.api('/me', function(apiMeResponse) {
			BASE_FB.api('/me/friends', function(apiFriendsResponse) {
				var gender, birthYear, friendCount;

				if (apiMeResponse.gender) {
					gender = apiMeResponse.gender.substring(0,1);
				}

				if (apiMeResponse.birthday) {
					var birthdayPieces = apiMeResponse.birthday.split('/');
				
					if (birthdayPieces.length == 3) {
						birthYear = birthdayPieces[2];
					}
				}

				if (apiFriendsResponse.data) {
					friendCount = apiFriendsResponse.data.length;
				}
				
				FB._ktApi.trackUserInformation(apiMeResponse.id, {
					"gender": gender,
					"birthYear": birthYear,
					"friendCount": friendCount
				});
			});
		});
	}

	FB._trackSpruceInstall = function()
	{
		// Spruce Media Ad Tracking
		if (KT_GET['spruce_adid']) {
			FB._ktApi._sendHttpRequestViaImgTag(window.location.protocol + "//bp-pixel.socialcash.com/100480/pixel.ssps?spruce_adid=" + KT_GET["spruce_adid"] + "&spruce_sid=" + FB._ktApi.genShortUniqueTrackingTag());
		}
	}

	FB._trackInr = function(callback)
	{
		var requestIds = KT_GET['request_ids'].split(',');
		var requestId = requestIds[requestIds.length-1];

		BASE_FB.api('/' + requestId, function(response) { 
			// extract parameters that was stored in the data field
			// (kt_u, kt_st1, kt_st2, kt_st3)
			var ktDataVars = KontagentUtils.extractKtVarsFromDataField(response['data']);
		
			// try to get the recipient userId
			var recipientUserId = null;
		
			if (response['to'] && response['to']['id']) {
				recipientUserId = response['to']['id'];
			} else if (FB._getUser()) { 
				recipientUserId = FB._getUser()._getUser();
			}
		
			FB._ktApi.trackInviteResponse(
				ktDataVars['kt_u'], 
				{
					"recipientUserId": recipientUserId,
					"subtype1": (ktDataVars['kt_st1']) ? ktDataVars['kt_st1'] : null,
					"subtype2": (ktDataVars['kt_st2']) ? ktDataVars['kt_st2'] : null,
					"subtype3": (ktDataVars['kt_st3']) ? ktDataVars['kt_st3'] : null
				},
				function() {
					callback(ktDataVars['kt_u']);
				}
			);
		});
	}

	// Given a comma-separated list of requestIds will return the recipient userIds (comma-separated)
	FB._getRecipientUserIdsFromRequestIds = function(requestIds, callback)
	{
		FB.api('', {"ids": requestIds}, function(response) {
			var recipientUserIds = '';
		
			for(var key in response) {
				recipientUserIds += response[key].to.id + ',';
			}
			
			recipientUserIds = FB._removeTrailingComma(recipientUserIds);
			
			callback({"recipientUserIds": recipientUserIds});
		});
	}

	FB._getUser = function()
	{
		var authResponse = FB.getAuthResponse();
		
		if (authResponse && authResponse.userID) {
			return authResponse.userID;
		}
		
		return null;
	}
}
	
////////////////////////////////////////////////////////////////////////////////

function KontagentUtils()
{
	
}

// Similar to PHP's parse_str. Converts a url query string (a=1&b=2&c=2) to
// a key-value map ({a:1, b:2, c:2}).
KontagentUtils.parseStr = function(str)
{
	var returnData = {};
	
	var params = str.split('&');
	var keyVal = null;
	
	for(var i=0; i<params.length; i++) {
		keyVal = params[i].split('=', 2);
		returnData[keyVal[0]] = keyVal[1];
	}
	
	return returnData;
}

// Strips the original data and returns a array containing only the Kontagent data.
KontagentUtils.extractKtVarsFromDataField = function(dataString)
{
	var parts = dataString.split('|');
	var ktDataString = parts[1];
	
	// parse into key-value map and return
	return KontagentUtils.parseStr(ktDataString);
}

// Appends KT tracking parameters to the data field of the Requests Dialog
// (see FB documentation for details).
KontagentUtils.appendKtVarsToDataField = function(dataString, vars) 
{
	dataString += '|';
	
	for (var key in vars) {
		if (vars[key] != null && typeof vars[key] != 'undefined') {
			dataString += key + '=' + vars[key] + '&';
		}
	}
	
	return KontagentUtils.removeTrailingAmpersand(dataString);
}

// Appends variables to a given URL. "vars" dataStringshould be an object
// in the form: {"var_name": var_value, ...}
KontagentUtils.appendVarsToUrl = function(url, vars) 
{
	if (url.indexOf('?') == -1) {
		url += '?';
	} else {
		url += '&';
	}

	for (var key in vars) {
		if (vars[key] != null && typeof vars[key] != 'undefined') {
			url += key + '=' + vars[key] + '&';
		}
	}
	
	return KontagentUtils.removeTrailingAmpersand(url);
}


// Returns whether the current URL is HTTPS
KontagentUtils.isHttps = function()
{
	if (window.location.protocol == 'https:') {
		return true;
	} else {
		return false;
	}
}

// Returns true of the variable is an array, false otherwise.
KontagentUtils.isArray = function(variable) {
	if (!variable) {
		return false;
	} else if (variable instanceof Array) {
		return true;
	} else {
		return false;
	}
}

KontagentUtils.removeTrailingAmpersand = function(string) 
{
	if (string.charAt(string.length-1) == '&') {
		return string.slice(0, -1);
	} else {
		return string;
	}
}

KontagentUtils.removeTrailingComma = function(string) 
{
	if (string.charAt(string.length-1) == ',') {
		return string.slice(0, -1);
	} else {
		return string;
	}
}

KontagentUtils.redirect = function(url)
{
	window.location	= url;
}

KontagentUtils.setKtInstalledCookie = function()
{
	var date = new Date();
	date.setTime(date.getTime()+(365*24*60*60*1000));
	var expires = "; expires="+date.toGMTString();

	document.cookie = "kt_installed=1"+expires+"; path=/";
}

KontagentUtils.unsetKtInstallsCookie = function()
{
}

KontagentUtils.isKtInstalledCookieSet = function()
{
	var nameEq = "kt_installed=";
	var ca = document.cookie.split(';');
	
	for(var i=0;i < ca.length;i++) { 
		var c = ca[i];
		
		while (c.charAt(0) == ' ') {
			c = c.substring(1, c.length);	
		}
		
		if (c.indexOf(nameEq) == 0) {
			return true;
		}
	}
	
	return false;
}

function KontagentLandingTracker(ktFacebook)
{
	this._ktFacebook = ktFacebook;
}

KontagentLandingTracker.prototype.trackLanding = function()
{	
	var self = this;

	if (this.shouldTrackPgr()) {
		this.trackPgr();
	}
		
	// Notice the INR, PSR, and UCC methods return the consumed
	// unique tracking tags. We store these in KT_GET because it's where
	// our code looks for it.
	
	// We need to use a callback chain because the trackInr function is
	// asynchronous.
	(function(callback){
		if (self.shouldTrackInr()) {
			self.trackInr(callback);
		} else if (self.shouldTrackPsr()) {
			KT_GET['kt_u'] = self.trackPsr();
			callback(null);
		} else if (self.shouldTrackUcc()) {
			KT_GET['kt_su'] = self.trackUcc();
			callback(null);
		} else {
			callback(null);
		}
	})(function(uniqueTrackingTag){
		if (uniqueTrackingTag) {
			KT_GET['kt_u'] = uniqueTrackingTag;
		}
		
		if (self.shouldTrackApa()) {
			self.trackApa();
			self.trackCpu();
			self.trackSpruceInstall();
		}
	});
}


KontagentLandingTracker.prototype.trackPgr = function()
{
	this._ktFacebook.getKontagentApi().trackPageRequest(this._ktFacebook._getUser());
}

KontagentLandingTracker.prototype.trackApa = function()
{
	this._ktFacebook.getKontagentApi().trackApplicationAdded(this._ktFacebook._getUser(), {
		"uniqueTrackingTag": (KT_GET['kt_u']) ? KT_GET['kt_u'] : null,
		"shortUniqueTrackingTag": (KT_GET['kt_su']) ? KT_GET['kt_su'] : null
	});
	
	KontagentUtils.setKtInstalledCookie();
}

KontagentLandingTracker.prototype.trackSpruceInstall = function()
{	
	if (KT_GET['spruce_adid']){
		var spruceUrl = 'http://bp-pixel.socialcash.com/100480/pixel.ssps';
		spruceUrl += '?spruce_adid=' . KT_GET["spruce_adid"];
		spruceUrl += '&spruce_sid=' . this._ktFacebook.getKontagentApi().genShortUniqueTrackingTag();

		this._ktFacebook.getKontagentApi()._sendHttpRequestViaImgTag(spruceUrl);
	}
}

KontagentLandingTracker.prototype.trackCpu = function(callback)
{
 	var self = this;
 
	// Track the User Information
	self._ktFacebook.api('/me', function(apiMeResponse) {
		self._ktFacebook.api('/me/friends', function(apiFriendsResponse) {
			var gender, birthYear, friendCount;

			if (apiMeResponse.gender) {
				gender = apiMeResponse.gender.substring(0,1);
			}

			if (apiMeResponse.birthday) {
				var birthdayPieces = apiMeResponse.birthday.split('/');
		
				if (birthdayPieces.length == 3) {
					birthYear = birthdayPieces[2];
				}
			}

			if (apiFriendsResponse.data) {
				friendCount = apiFriendsResponse.data.length;
			}
		
			self._ktFacebook.getKontagentApi().trackUserInformation(apiMeResponse.id, {
				"gender": gender,
				"birthYear": birthYear,
				"friendCount": friendCount
			});
		});
	});
}

KontagentLandingTracker.prototype.trackInr = function(callback)
{
	var self = this;

	var requestIds = KT_GET['request_ids'].split(',');
	var requestId = requestIds[requestIds.length-1];

	this._ktFacebook.api('/' + requestId, function(response) { 
		// extract parameters that was stored in the data field
		// (kt_u, kt_st1, kt_st2, kt_st3)
		var ktDataVars = KontagentUtils.extractKtVarsFromDataField(response['data']);
	
		// try to get the recipient userId
		var recipientUserId = null;
	
		if (response['to'] && response['to']['id']) {
		    recipientUserId = response['to']['id'];
		} else if (self._ktFacebook._getUser()) { 
		    recipientUserId = self._ktFacebook._getUser();
		}
	
		self._ktFacebook.getKontagentApi().trackInviteResponse(
			ktDataVars['kt_u'], 
			{
				"recipientUserId": recipientUserId,
				"subtype1": (ktDataVars['kt_st1']) ? ktDataVars['kt_st1'] : null,
				"subtype2": (ktDataVars['kt_st2']) ? ktDataVars['kt_st2'] : null,
				"subtype3": (ktDataVars['kt_st3']) ? ktDataVars['kt_st3'] : null
			},
			function() {
				callback(ktDataVars['kt_u']);
			}
		);
	});
}

KontagentLandingTracker.prototype.trackPsr = function()
{
	var userId = this._ktFacebook._getUser();

	this._ktFacebook.getKontagentApi().trackStreamPostResponse(KT_GET['kt_u'], 'stream', {
		"recipientUserId": (userId) ? userId : null,
		"subtype1": (KT_GET['kt_st1']) ? KT_GET['kt_st1'] : null,
		"subtype2": (KT_GET['kt_st2']) ? KT_GET['kt_st2'] : null,
		"subtype3": (KT_GET['kt_st3']) ? KT_GET['kt_st3'] : null
	});
	
	return KT_GET['kt_u'];
}

KontagentLandingTracker.prototype.trackUcc = function()
{
	var userId = this._ktFacebook._getUser();
	var shortUniqueTrackingTag = this._ktFacebook.getKontagentApi().genShortUniqueTrackingTag();

	this._ktFacebook.getKontagentApi().trackThirdPartyCommClick(KT_GET['kt_type'], shortUniqueTrackingTag, {
		"userId": (userId) ? userId : null,
		"subtype1": (KT_GET['kt_st1']) ? KT_GET['kt_st1'] : null,
		"subtype2": (KT_GET['kt_st2']) ? KT_GET['kt_st2'] : null,
		"subtype3": (KT_GET['kt_st3']) ? KT_GET['kt_st3'] : null
	});
	
	return shortUniqueTrackingTag;
}

KontagentLandingTracker.prototype.shouldTrackPgr = function()
{
	if (this._ktFacebook._getUser()) {
		return true;
	}
	
	return false;
}

KontagentLandingTracker.prototype.shouldTrackApa = function()
{	
	if (this._ktFacebook._getUser()) {
		// If the user authenticated via auth referrals (as opposed to an
		// explicit login request from the app), the $_GET['kt_track_apa']
		// will not be present. This is why we have this check.
		if (!KontagentUtils.isKtInstalledCookieSet()) {
			return true;
		}
	}
	
	return false;
}

KontagentLandingTracker.prototype.shouldTrackInr = function()
{
	// Note we can only track INR's if the user is logged in. Otherwise we don't have
	// permission to get the request object.
	if (this._ktFacebook._getUser() && KT_GET['request_ids'] && !KontagentUtils.isArray(KT_GET['request_ids'])) {
		return true;
	}

	return false;
}

KontagentLandingTracker.prototype.shouldTrackPsr = function()
{
	if (KT_GET['kt_track_psr'] && KT_GET['kt_u']) {
		return true;
	}
	
	return false;
}

KontagentLandingTracker.prototype.shouldTrackUcc = function()
{
	if (KT_GET['kt_type']) {
		return true;
	}
	
	 return false;
}

////////////////////////////////////////////////////////////////////////////////

/*
* Kontagent class constructor
*
* @constructor
*
* @param {string} apiKey The app's Kontagent API key
* @param {object} [optionalParams] An object containing paramName => value
* @param {bool} [optionalParams.useTestServer] Whether to send messages to the Kontagent Test Server
* @param {bool} [optionalParams.validateParams] Whether to validate the parameters passed into the tracking method
* @param {bool} [optionalParams.useHttps] Whether to use Https when sending messages to Kontagent
*/
function KontagentApi(apiKey, optionalParams) 
{
	this._sdkVersion = "j02";
	
	this._baseHttp = "http://";
	this._baseHttps = "https://"
	this._baseApiUrl = "api.geo.kontagent.net/api/v1/";
	this._baseTestServerUrl = "test-server.kontagent.com/api/v1/";

	this._apiKey = apiKey;

	// this flag represents whether a message has been fired off yet.
	this._hasSentMessage = false; 

	if (optionalParams) {
		this._useTestServer = (optionalParams.useTestServer) ? optionalParams.useTestServer : false;
		this._useHttps = (optionalParams.useHttps) ? optionalParams.useHttps : false;
		this._validateParams = (optionalParams.validateParams) ? optionalParams.validateParams : false;
	}
}

/*
* Converts a string to the base-64 encoded version of the string.
*
* @param {string} data The data string to be encoded
*
* @return {string} The base64 encoded string
*/
KontagentApi.prototype._base64Encode = function(data) 
{
    var b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    var o1, o2, o3, h1, h2, h3, h4, bits, i = 0,
        ac = 0,
        enc = "",
        tmp_arr = [];
 
    if (!data) {
        return data;
    }
 
    data = this._utf8Encode(data + '');
 
    do { // pack three octets into four hexets
        o1 = data.charCodeAt(i++);
        o2 = data.charCodeAt(i++);
        o3 = data.charCodeAt(i++);
 
        bits = o1 << 16 | o2 << 8 | o3;
 
        h1 = bits >> 18 & 0x3f;
        h2 = bits >> 12 & 0x3f;
        h3 = bits >> 6 & 0x3f;
        h4 = bits & 0x3f;
 
        // use hexets to index into b64, and append result to encoded string
        tmp_arr[ac++] = b64.charAt(h1) + b64.charAt(h2) + b64.charAt(h3) + b64.charAt(h4);
    } while (i < data.length);
 
    enc = tmp_arr.join('');
    
    var r = data.length % 3;
    
    return (r ? enc.slice(0, r - 3) : enc) + '==='.slice(r || 3);
}

/*
* Converts a string to the UTF-8 encoded version of the string.
*
* @param {string} argString The data string to be encoded
*
* @return {string} The UTF-8 encoded string
*/
KontagentApi.prototype._utf8Encode = function(argString) 
{
	if (argString === null || typeof argString === "undefined") {
		return "";
	}

	var string = (argString + ''); // .replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	var utftext = '',
		start, end, stringl = 0;

	start = end = 0;
	stringl = string.length;
	for (var n = 0; n < stringl; n++) {
		var c1 = string.charCodeAt(n);
		var enc = null;

		if (c1 < 128) {
			end++;
		} else if (c1 > 127 && c1 < 2048) {
			enc = String.fromCharCode((c1 >> 6) | 192, (c1 & 63) | 128);
		} else {
			enc = String.fromCharCode((c1 >> 12) | 224, ((c1 >> 6) & 63) | 128, (c1 & 63) | 128);
		}
		if (enc !== null) {
			if (end > start) {
				utftext += string.slice(start, end);
			}
			utftext += enc;
			start = end = n + 1;
		}
	}

	if (end > start) {
		utftext += string.slice(start, stringl);
	}

	return utftext;
}

/*
* Sends an HTTP request by creating an <img> tag given a URL.
*
* @param {string} url The request URL
* @param {function} [successCallback] The callback function to execute once message has been sent successfully
*/
KontagentApi.prototype._sendHttpRequestViaImgTag = function(url, successCallback)
{
	var img = new Image();
	
	// The onerror callback will always be triggered because no image header is returned by our API.
	// Which is fine because the request would have still gone through.
	if (successCallback) {
		img.onerror = successCallback;
		img.onload = successCallback;
	}

	img.src = url;
}

/*
* Sends the API message by creating an <img> tag.
*
* @param {string} messageType The message type to send ('apa', 'ins', etc.)
* @param {object} params An object containing paramName => value (ex: 's'=>123456789)
* @param {function} [successCallback] The callback function to execute once message has been sent successfully
* @param {function(error)} [validationErrorCallback] The callback function to execute on validation failure
*/
KontagentApi.prototype._sendMessage = function(messageType, params, successCallback, validationErrorCallback) {
	// append the version if this is the first message
	if (!this._hasSentMessage) {
		params['sdk'] = this._sdkVersion;
		this.hasSentMessage = true;
	}

	// add a timestamp param to prevent browser caching
	// getTime() returns milliseconds since 1970, we want unix time which is seconds hence /1000
	params['ts'] =  Math.round(new Date().getTime() / 1000);

	if (this._validateParams == true) {
		var result;

		for (var paramKey in params) {
			result = KtValidator.validateParameter(messageType, paramKey, params[paramKey]);
			if (result != true) {
				if (validationErrorCallback) {
					validationErrorCallback(result);
				}

				return;
			}
		}
		
		result = KtValidator.validateSubtypes(params);
		if (result != true) {
			if (validationErrorCallback) {
				validationErrorCallback(result);
			}
			return;
		}

	}

	var url = "";
	url += this._useHttps ? this._baseHttps : this._baseHttp; //http or https
	url += this._useTestServer ? this._baseTestServerUrl : this._baseApiUrl; //regular or test server
	url += this._apiKey + "/" + messageType + "/?" + this._httpBuildQuery(params); //api call

	this._sendHttpRequestViaImgTag(url, successCallback);
}

/*
* Generate URL-encoded query string (same as PHP's http_build_query())
*
* @param {object} data The object containing key, value data to encode
*
* @return {string) A URL-encoded string
*/
KontagentApi.prototype._httpBuildQuery = function(data) {
	var query, key, val;
	var tmpArray = [];

	for(key in data) {
		val = encodeURIComponent(decodeURIComponent(data[key].toString()));
		key = encodeURIComponent(decodeURIComponent(key));

		tmpArray.push(key + "=" + val);  
	}

	return tmpArray.join("&");
}

/*
* Returns random 4-character hex
*
* @return {string} Random 4-character hex value
*/
KontagentApi.prototype._s4 = function() {
	return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
}

/*
* Generates a unique tracking tag.
*
*  @return {string} The unique tracking tag
*/
KontagentApi.prototype.genUniqueTrackingTag = function() {
	var uniqueTrackingTag = "", i;
	
	for(i=0; i<4; i++) {
		uniqueTrackingTag += this._s4();
	}
	
	return uniqueTrackingTag;
}

/*
* Generates a short unique tracking tag.
*
*  @return {string} The short unique tracking tag
*/
KontagentApi.prototype.genShortUniqueTrackingTag = function() {
	var shortUniqueTrackingTag = "", i;
	
	for(i=0; i<2; i++) {
		shortUniqueTrackingTag += this._s4();
	}
	
	return shortUniqueTrackingTag;

}

/*
* Sends an Invite Sent message to Kontagent.
*
* @param {int} userId The UID of the sending user
* @param {string} recipientUserIds A comma-separated list of the recipient UIDs
* @param {string} uniqueTrackingTag 32-digit hex string used to match 
* 	InviteSent->InviteResponse->ApplicationAdded messages. 
* 	See the genUniqueTrackingTag() helper method.
* @param {object} [optionalParams] An object containing paramName => value
* @param {string} [optionalParams.subtype1] Subtype1 value (max 32 chars)
* @param {string} [optionalParams.subtype2] Subtype2 value (max 32 chars)
* @param {string} [optionalParams.subtype3] Subtype3 value (max 32 chars)
* @param {string} [optionalParams.data] Additional JSON-formatted data to associate with the message
* @param {function} [successCallback] The callback function to execute once message has been sent successfully
* @param {function(error)} [validationErrorCallback] The callback function to execute on validation failure
*/
KontagentApi.prototype.trackInviteSent = function(userId, recipientUserIds, uniqueTrackingTag, optionalParams, successCallback, validationErrorCallback) {
	var apiParams = {
		s : userId,
		r : recipientUserIds,
		u : uniqueTrackingTag
	};
	
	if (optionalParams != null && typeof optionalParams != 'undefined') {
		if (optionalParams.subtype1) { apiParams.st1 = optionalParams.subtype1; }
		if (optionalParams.subtype2) { apiParams.st2 = optionalParams.subtype2; }
		if (optionalParams.subtype3) { apiParams.st3 = optionalParams.subtype3; }
		if (optionalParams.data) { apiParams.data = this._base64Encode(optionalParams.data); }
	}

	this._sendMessage("ins", apiParams, successCallback, validationErrorCallback);
}

/*
* Sends an Invite Response message to Kontagent.
*
* @param {string} uniqueTrackingTag 32-digit hex string used to match 
*	InviteSent->InviteResponse->ApplicationAdded messages. 
*	See the genUniqueTrackingTag() helper method.
* @param {object} [optionalParams] An object containing paramName => value
* @param {string} [optionalParams.recipientUserId] The UID of the responding user
* @param {string} [optionalParams.subtype1] Subtype1 value (max 32 chars)
* @param {string} [optionalParams.subtype2] Subtype2 value (max 32 chars)
* @param {string} [optionalParams.subtype3] Subtype3 value (max 32 chars)
* @param {string} [optionalParams.data] Additional JSON-formatted data to associate with the message
* @param {function} [successCallback] The callback function to execute once message has been sent successfully
* @param {function(error)} [validationErrorCallback] The callback function to execute on validation failure
*/
KontagentApi.prototype.trackInviteResponse = function(uniqueTrackingTag, optionalParams, successCallback, validationErrorCallback) {
	var apiParams = {
		i : 0,
		u : uniqueTrackingTag
	};
	
	if (optionalParams != null && typeof optionalParams != 'undefined') {
		if (optionalParams.recipientUserId) { apiParams.r = optionalParams.recipientUserId; }
		if (optionalParams.subtype1) { apiParams.st1 = optionalParams.subtype1; }
		if (optionalParams.subtype2) { apiParams.st2 = optionalParams.subtype2; }
		if (optionalParams.subtype3) { apiParams.st3 = optionalParams.subtype3; }
		if (optionalParams.data) { apiParams.data = this._base64Encode(optionalParams.data); }
	}	
	
	this._sendMessage("inr", apiParams, successCallback, validationErrorCallback);
}

/*
* Sends an Notification Email Sent message to Kontagent.
*
* @param {int} userId The UID of the sending user
* @param {string} recipientUserIds A comma-separated list of the recipient UIDs
* @param {string} uniqueTrackingTag 32-digit hex string used to match 
*	NotificationEmailSent->NotificationEmailResponse->ApplicationAdded messages. 
*	See the genUniqueTrackingTag() helper method.
* @param {object} [optionalParams] An object containing paramName => value
* @param {string} [optionalParams.subtype1] Subtype1 value (max 32 chars)
* @param {string} [optionalParams.subtype2] Subtype2 value (max 32 chars)
* @param {string} [optionalParams.subtype3] Subtype3 value (max 32 chars)
* @param {string} [optionalParams.data] Additional JSON-formatted data to associate with the message
* @param {function} [successCallback] The callback function to execute once message has been sent successfully
* @param {function(error)} [validationErrorCallback] The callback function to execute on validation failure
*/
KontagentApi.prototype.trackNotificationEmailSent = function(userId, recipientUserIds, uniqueTrackingTag, optionalParams, successCallback, validationErrorCallback) {
	var apiParams = {
		s : userId,
		r : recipientUserIds,
		u : uniqueTrackingTag
	};
	
	if (optionalParams != null && typeof optionalParams != 'undefined') {
		if (optionalParams.subtype1) { apiParams.st1 = optionalParams.subtype1; }
		if (optionalParams.subtype2) { apiParams.st2 = optionalParams.subtype2; }
		if (optionalParams.subtype3) { apiParams.st3 = optionalParams.subtype3; }
		if (optionalParams.data) { apiParams.data = this._base64Encode(optionalParams.data); }
	}

	this._sendMessage("nes", apiParams, successCallback, validationErrorCallback);
}

/*
* Sends an Notification Email Response message to Kontagent.
*

* @param {string} uniqueTrackingTag 32-digit hex string used to match 
*	NotificationEmailSent->NotificationEmailResponse->ApplicationAdded messages. 
*	See the genUniqueTrackingTag() helper method.
* @param {object} [optionalParams] An object containing paramName => value
* @param {string} [optionalParams.recipientUserId] The UID of the responding user
* @param {string} [optionalParams.subtype1] Subtype1 value (max 32 chars)
* @param {string} [optionalParams.subtype2] Subtype2 value (max 32 chars)
* @param {string} [optionalParams.subtype3] Subtype3 value (max 32 chars)
* @param {string} [optionalParams.data] Additional JSON-formatted data to associate with the message
* @param {function} [successCallback] The callback function to execute once message has been sent successfully
* @param {function(error)} [validationErrorCallback] The callback function to execute on validation failure
*/
KontagentApi.prototype.trackNotificationEmailResponse = function(uniqueTrackingTag, optionalParams, successCallback, validationErrorCallback) {
	var apiParams = {
		i : 0,
		u : uniqueTrackingTag
	};
	
	if (optionalParams != null && typeof optionalParams != 'undefined') {
		if (optionalParams.recipientUserId) { apiParams.r = optionalParams.recipientUserId; }
		if (optionalParams.subtype1) { apiParams.st1 = optionalParams.subtype1; }
		if (optionalParams.subtype2) { apiParams.st2 = optionalParams.subtype2; }
		if (optionalParams.subtype3) { apiParams.st3 = optionalParams.subtype3; }
		if (optionalParams.data) { apiParams.data = this._base64Encode(optionalParams.data); }
	}
	
	this._sendMessage("nei", apiParams, successCallback, validationErrorCallback);
}

/*
* Sends an Stream Post message to Kontagent.
*
* @param {int} userId The UID of the sending user
* @param {string} uniqueTrackingTag 32-digit hex string used to match 
*	NotificationEmailSent->NotificationEmailResponse->ApplicationAdded messages. 
*	See the genUniqueTrackingTag() helper method.
* @param {string} type The Facebook channel type
*	(feedpub, stream, feedstory, multifeedstory, dashboard_activity, or dashboard_globalnews).
* @param {object} [optionalParams] An object containing paramName => value
* @param {string} [optionalParams.subtype1] Subtype1 value (max 32 chars)
* @param {string} [optionalParams.subtype2] Subtype2 value (max 32 chars)
* @param {string} [optionalParams.subtype3] Subtype3 value (max 32 chars)
* @param {string} [optionalParams.data] Additional JSON-formatted data to associate with the message
* @param {function} [successCallback] The callback function to execute once message has been sent successfully
* @param {function(error)} [validationErrorCallback] The callback function to execute on validation failure
*/
KontagentApi.prototype.trackStreamPost = function(userId, uniqueTrackingTag, type, optionalParams, successCallback, validationErrorCallback) {
	var apiParams = {
		s : userId,
		u : uniqueTrackingTag,
		tu : type
	};
	
	if (optionalParams != null && typeof optionalParams != 'undefined') {
		if (optionalParams.subtype1) { apiParams.st1 = optionalParams.subtype1; }
		if (optionalParams.subtype2) { apiParams.st2 = optionalParams.subtype2; }
		if (optionalParams.subtype3) { apiParams.st3 = optionalParams.subtype3; }
		if (optionalParams.data) { apiParams.data = this._base64Encode(optionalParams.data); }
	}

	this._sendMessage("pst", apiParams, successCallback, validationErrorCallback);
}

/*
* Sends an Stream Post Response message to Kontagent.
*
* @param {string} uniqueTrackingTag 32-digit hex string used to match 
*	NotificationEmailSent->NotificationEmailResponse->ApplicationAdded messages. 
*	See the genUniqueTrackingTag() helper method.
* @param {string} type The Facebook channel type
*	(feedpub, stream, feedstory, multifeedstory, dashboard_activity, or dashboard_globalnews).
* @param {object} [optionalParams] An object containing paramName => value
* @param {string} [optionalParams.recipientUserId] The UID of the responding user
* @param {string} [optionalParams.subtype1] Subtype1 value (max 32 chars)
* @param {string} [optionalParams.subtype2] Subtype2 value (max 32 chars)
* @param {string} [optionalParams.subtype3] Subtype3 value (max 32 chars)
* @param {string} [optionalParams.data] Additional JSON-formatted data to associate with the message
* @param {function} [successCallback] The callback function to execute once message has been sent successfully
* @param {function(error)} [validationErrorCallback] The callback function to execute on validation failure
*/
KontagentApi.prototype.trackStreamPostResponse = function(uniqueTrackingTag, type, optionalParams, successCallback, validationErrorCallback) {
	var apiParams = {
		i : 0,
		u : uniqueTrackingTag,
		tu : type
	};
	
	if (optionalParams != null && typeof optionalParams != 'undefined') {
		if (optionalParams.recipientUserId) { apiParams.r = optionalParams.recipientUserId; }
		if (optionalParams.subtype1) { apiParams.st1 = optionalParams.subtype1; }
		if (optionalParams.subtype2) { apiParams.st2 = optionalParams.subtype2; }
		if (optionalParams.subtype3) { apiParams.st3 = optionalParams.subtype3; }
		if (optionalParams.data) { apiParams.data = this._base64Encode(optionalParams.data); }
	}

	this._sendMessage("psr", apiParams, successCallback, validationErrorCallback);
}

/*
* Sends an Custom Event message to Kontagent.
*
* @param {int} userId The UID of the user
* @param {string} eventName The name of the event
* @param {object} [optionalParams] An object containing paramName => value
* @param {int} [optionalParams.value] A value associated with the event
* @param {int} [optionalParams.level] A level associated with the event (must be positive)
* @param {string} [optionalParams.subtype1] Subtype1 value (max 32 chars)
* @param {string} [optionalParams.subtype2] Subtype2 value (max 32 chars)
* @param {string} [optionalParams.subtype3] Subtype3 value (max 32 chars)
* @param {string} [optionalParams.data] Additional JSON-formatted data to associate with the message
* @param {function} [successCallback] The callback function to execute once message has been sent successfully
* @param {function(error)} [validationErrorCallback] The callback function to execute on validation failure
*/
KontagentApi.prototype.trackEvent = function(userId, eventName, optionalParams, successCallback, validationErrorCallback) {
	var apiParams = {
		s : userId,
		n : eventName
	};
	
	if (optionalParams != null && typeof optionalParams != 'undefined') {
		if (optionalParams.value) { apiParams.v = optionalParams.value; }
		if (optionalParams.level) { apiParams.l = optionalParams.level; }
		if (optionalParams.subtype1) { apiParams.st1 = optionalParams.subtype1; }
		if (optionalParams.subtype2) { apiParams.st2 = optionalParams.subtype2; }
		if (optionalParams.subtype3) { apiParams.st3 = optionalParams.subtype3; }
		if (optionalParams.data) { apiParams.data = this._base64Encode(optionalParams.data); }
	}	

	this._sendMessage("evt", apiParams, successCallback, validationErrorCallback);
}

/*
* Sends an Application Added message to Kontagent.
*
* @param {int} userId The UID of the installing user
* @param {object} [optionalParams] An object containing paramName => value
* @param {string} [optionalParams.uniqueTrackingTag] 16-digit hex string used to match 
*	Invite/StreamPost/NotificationSent/NotificationEmailSent->ApplicationAdded messages. 
*	See the genUniqueTrackingTag() helper method.
* @param {string} [optionalParams.shortUniqueTrackingTag] 8-digit hex string used to match 
*	ThirdPartyCommClicks->ApplicationAdded messages. 
*	See the genShortUniqueTrackingTag() hesendMessagelper method.
* @param {string} [optionalParams.data] Additional JSON-formatted data to associate with the message
* @param {function} [successCallback] The callback function to execute once message has been sent successfully
* @param {function(error)} [validationErrorCallback] The callback function to execute on validation failure
*/
KontagentApi.prototype.trackApplicationAdded = function(userId, optionalParams, successCallback, validationErrorCallback) {
	var apiParams = {s : userId};
	
	if (optionalParams != null && typeof optionalParams != 'undefined') {
		if (optionalParams.uniqueTrackingTag) { apiParams.u = optionalParams.uniqueTrackingTag; }
		if (optionalParams.shortUniqueTrackingTag) { apiParams.su = optionalParams.shortUniqueTrackingTag; }
		if (optionalParams.data) { apiParams.data = this._base64Encode(optionalParams.data); }
	}

	this._sendMessage("apa", apiParams, successCallback, validationErrorCallback);
}

/*
* Sends an Application Removed message to Kontagent.


*
* @param {int} userId The UID of the removing user
* @param {object} [optionalParams] An object containing paramName => value
* @param {string} [optionalParams.data] Additional JSON-formatted data to associate with the message
* @param {function} [successCallback] The callback function to execute once message has been sent successfully
* @param {function(error)} [validationErrorCallback] The callback function to execute on validation failure
*/
KontagentApi.prototype.trackApplicationRemoved = function(userId, optionalParams, successCallback, validationErrorCallback) {
	var apiParams = {s : userId};

	if (optionalParams != null && typeof optionalParams != 'undefined') {
		if (optionalParams.data) { apiParams.data = this._base64Encode(optionalParams.data); }
	}
	
	this._sendMessage("apr", apiParams, successCallback, validationErrorCallback);
}

/*
* Sends an Third Party Communication Click message to Kontagent.
*
* @param {string} type The third party comm click type (ad, partner).
* @param {string} shortUniqueTrackingTag 8-digit hex string used to match 
*	ThirdPartyCommClicks->ApplicationAdded messages. 
* @param {object} [optionalParams] An object containing paramName => value
* @param {string} [optionalParams.userId] The UID of the user
* @param {string} [optionalParams.subtype1] Subtype1 value (max 32 chars)
* @param {string} [optionalParams.subtype2] Subtype2 value (max 32 chars)
* @param {string} [optionalParams.subtype3] Subtype3 value (max 32 chars)
* @param {string} [optionalParams.data] Additional JSON-formatted data to associate with the message
* @param {function} [successCallback] The callback function to execute once message has been sent successfully
* @param {function(error)} [validationErrorCallback] The callback function to execute on validation failure
*/
KontagentApi.prototype.trackThirdPartyCommClick = function(type, shortUniqueTrackingTag, optionalParams, successCallback, validationErrorCallback) {
	var apiParams = {
		i : 0,
		tu : type,
		su : shortUniqueTrackingTag
	};
	
	if (optionalParams != null && typeof optionalParams != 'undefined') {
		if (optionalParams.userId) { apiParams.s = optionalParams.userId; }
		if (optionalParams.subtype1) { apiParams.st1 = optionalParams.subtype1; }
		if (optionalParams.subtype2) { apiParams.st2 = optionalParams.subtype2; }
		if (optionalParams.subtype3) { apiParams.st3 = optionalParams.subtype3; }
		if (optionalParams.data) { apiParams.data = this._base64Encode(optionalParams.data); }
	}	
	
	this._sendMessage("ucc", apiParams, successCallback, validationErrorCallback);
}

/*
* Sends an Page Request message to Kontagent.
*
* @param {int} userId The UID of the user
* @param {object} [optionalParams] An object containing paramName => value
* @param {string} [optionalParams.ipAddress] The current users IP address
* @param {string} [optionalParams.pageAddress] The current page address (ex: index.html)
* @param {string} [optionalParams.data] Additional JSON-formatted data to associate with the message
* @param {function} [successCallback] The callback function to execute once message has been sent successfully
* @param {function(error)} [validationErrorCallback] The callback function to execute on validation failure
*/
KontagentApi.prototype.trackPageRequest = function(userId, optionalParams, successCallback, validationErrorCallback) {
	var apiParams = {
		s : userId
	};
	
	if (optionalParams != null && typeof optionalParams != 'undefined') {
		if (optionalParams.ipAddress) { apiParams.ip = optionalParams.ipAddress; }
		if (optionalParams.pageAddress) { apiParams.u = optionalParams.pageAddress; }
		if (optionalParams.data) { apiParams.data = this._base64Encode(optionalParams.data); }
	}

	this._sendMessage("pgr", apiParams, successCallback, validationErrorCallback);
}

/*
* Sends an User Information message to Kontagent.
*
* @param {int} userId The UID of the user
* @param {object} [optionalParams] An object containing paramName => value
* @param {int} [optionalParams.birthYear] The birth year of the user
* @param {string} [optionalParams.gender] The gender of the user (m,f,u)
* @param {string} [optionalParams.country] The 2-character country code of the user
* @param {int} [optionalParams.friendCount] The friend count of the user
* @param {string} [optionalParams.data] Additional JSON-formatted data to associate with the message
* @param {function} [successCallback] The callback function to execute once message has been sent successfully
* @param {function(error)} [validationErrorCallback] The callback function to execute on validation failure
*/
KontagentApi.prototype.trackUserInformation = function (userId, optionalParams, successCallback, validationErrorCallback) {
	var apiParams = {s : userId};
	
	if (optionalParams != null && typeof optionalParams != 'undefined') {
		if (optionalParams.birthYear) { apiParams.b = optionalParams.birthYear; }
		if (optionalParams.gender) { apiParams.g = optionalParams.gender; }
		if (optionalParams.country) { apiParams.lc = optionalParams.country; }
		if (optionalParams.friendCount) { apiParams.f = optionalParams.friendCount; }
		if (optionalParams.data) { apiParams.data = this._base64Encode(optionalParams.data); }
	}
	
	this._sendMessage("cpu", apiParams, successCallback, validationErrorCallback);
}

/*
* Sends an Goal Count message to Kontagent.
*
* @param {int} userId The UID of the user
* @param {object} [optionalParams] An object containing paramName => value
* @param {int} [optionalParams.goalCount1] The amount to increment goal count 1 by
* @param {int} [optionalParams.goalCount2] The amount to increment goal count 2 by
* @param {int} [optionalParams.goalCount3] The amount to increment goal count 3 by
* @param {int} [optionalParams.goalCount4] The amount to increment goal count 4 by
* @param {string} [optionalParams.data] Additional JSON-formatted data to associate with the message
* @param {function} [successCallback] The callback function to execute once message has been sent successfully
* @param {function(error)} [validationErrorCallback] The callback function to execute on validation failure
*/
KontagentApi.prototype.trackGoalCount = function(userId, optionalParams, successCallback, validationErrorCallback) {
	var apiParams = {s : userId};
	
	if (optionalParams != null && typeof optionalParams != 'undefined') {
		if (optionalParams.goalCount1) { apiParams.gc1 = optionalParams.goalCount1; }
		if (optionalParams.goalCount2) { apiParams.gc2 = optionalParams.goalCount2; }
		if (optionalParams.goalCount3) { apiParams.gc3 = optionalParams.goalCount3; }
		if (optionalParams.goalCount4) { apiParams.gc4 = optionalParams.goalCount4; }
		if (optionalParams.data) { apiParams.data = this._base64Encode(optionalParams.data); }
	}

	this._sendMessage("gci", apiParams, successCallback, validationErrorCallback);
}

/*
* Sends an Revenue message to Kontagent.
*
* @param {int} userId The UID of the user
* @param {int} value The amount of revenue in cents
* @param {object} [optionalParams] An object containing paramName => value
* @param {string} [optionalParams.type] The transaction type (direct, indirect, advertisement, credits, other)
* @param {string} [optionalParams.subtype1] Subtype1 value (max 32 chars)
* @param {string} [optionalParams.subtype2] Subtype2 value (max 32 chars)
* @param {string} [optionalParams.subtype3] Subtype3 value (max 32 chars)
* @param {string} [optionalParams.data] Additional JSON-formatted data to associate with the message
* @param {function} [successCallback] The callback function to execute once message has been sent successfully
* @param {function(error)} [validationErrorCallback] The callback function to execute on validation failure
*/
KontagentApi.prototype.trackRevenue = function(userId, value, optionalParams, successCallback, validationErrorCallback) {
	var apiParams = {
		s : userId,
		v : value
	};
	
	if (optionalParams != null && typeof optionalParams != 'undefined') {
		if (optionalParams.type) { apiParams.tu = optionalParams.type; }
		if (optionalParams.subtype1) { apiParams.st1 = optionalParams.subtype1; }
		if (optionalParams.subtype2) { apiParams.st2 = optionalParams.subtype2; }
		if (optionalParams.subtype3) { apiParams.st3 = optionalParams.subtype3; }
		if (optionalParams.data) { apiParams.data = this._base64Encode(optionalParams.data); }
	}

	this._sendMessage("mtu", apiParams, successCallback, validationErrorCallback);
}

////////////////////////////////////////////////////////////////////////////////

/*
* Helper class to validate the paramters for the Kontagent API messages. All 
* 	methods are static so no need to instantiate this class.
*
* @constructor
*/
function KtValidator() {
}

/*
* Validates a parameter of a given message type.
* IMPORTANT: When evaluating the return, use a strict-type comparison: if(response === true) {}
*
* @param {string} messageType The message type that the param belongs to (ex: ins, apa, etc.)
* @param {string} paramName The name of the parameter (ex: s, su, u, etc.)
* @param {mixed} paramValue The value of the parameter
*
* @returns {mixed} Returns true on success and an error message string on failure.
*/
KtValidator.validateParameter = function(messageType, paramName, paramValue) {
	return KtValidator['_validate' + KtValidator._upperCaseFirst(paramName)](messageType, paramName, paramValue);
}

/*
* Validates that subtypes parameters are incrementing (ex: st2 is not optional if st3 is used)
*
* @param {mixed} params The value of the parameter
*
* @returns {mixed} Returns true on success and an error message string on failure.
*/
KtValidator.validateSubtypes = function(params) {
	// if ((st3 is used AND st2 is not used) OR (st2 is used AND st1 is not used))
	if (((params.hasOwnProperty("st3") && !params.hasOwnProperty("st2")) || (params.hasOwnProperty("st2") && !params.hasOwnProperty("st1")))) {
		return 'Invalid subtypes used.';
	} else {
		return true;
	}
}


KtValidator._upperCaseFirst = function(stringVal) {
	return stringVal.charAt(0).toUpperCase() + stringVal.slice(1);
}

KtValidator._validateB = function(messageType, paramName, paramValue) {
	// birthyear param (cpu message)
	if (typeof paramValue == "undefined" || paramValue != parseInt(paramValue) 
		|| paramValue < 1900 || paramValue > 2012
	) {
		return 'Invalid birth year.';
	} else {
		return true;
	}
}

KtValidator._validateData = function(messageType, paramName, paramValue) {
	return true;
}

KtValidator._validateF = function(messageType, paramName, paramValue) {
	// friend count param (cpu message)
	if (typeof paramValue == "undefined" || paramValue != parseInt(paramValue) || paramValue < 0) {
		return 'Invalid friend count.'
	} else {
		return true;
	}
}

KtValidator._validateG = function(messageType, paramName, paramValue) {	
	// gender param (cpu message)
	var regex = /^[mfu]$/;

	if (typeof paramValue == "undefined" || !regex.test(paramValue)) {
		return 'Invalid gender.';
	} else {
		return true;
	}
}

KtValidator._validateGc1 = function(messageType, paramName, paramValue) {
	// goal count param (gc1, gc2, gc3, gc4 messages)
	if (typeof paramValue == "undefined" || paramValue != parseInt(paramValue) 
		|| paramValue < -16384 || paramValue > 16384
	) {
		return 'Invalid goal count value.';
	} else {
		return true;
	}
}

KtValidator._validateGc2 = function(messageType, paramName, paramValue) {
	return KtValidator._validateGc1(messageType, paramName, paramValue);
}

KtValidator._validateGc3 = function(messageType, paramName, paramValue) {
	return KtValidator._validateGc1(messageType, paramName, paramValue);
}

KtValidator._validateGc4 = function(messageType, paramName, paramValue) {
	return KtValidator._validateGc1(messageType, paramName, paramValue);
}

KtValidator._validateI = function(messageType, paramName, paramValue) {
	// isAppInstalled param (inr, psr, ner, nei messages)
	var regex = /^[01]$/;

	if (typeof paramValue == "undefined" || !regex.test(paramValue)) {
		return 'Invalid isAppInstalled value.';
	} else {
		return true;
	}
}

KtValidator._validateIp = function(messageType, paramName, paramValue) {
	// ip param (pgr messages)
	var regex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(\.\d{1,3})?$/; 

	if (typeof paramValue == "undefined" || !regex.test(paramValue)) {
		return 'Invalid ip address value.';
	} else {
		return true;
	}
}

KtValidator._validateL = function(messageType, paramName, paramValue) {
	// level param (evt messages)
	if (typeof paramValue == "undefined" || paramValue != parseInt(paramValue) || paramValue < 0 || paramValue > 255) {
		return 'Invalid level value.';
	} else {
		return true;
	}
}

KtValidator._validateLc = function(messageType, paramName, paramValue) {
	// country param (cpu messages)
	var regex = /^[A-Z]{2}$/;

	if (typeof paramValue == "undefined" || !regex.test(paramValue)) {
		return 'Invalid country value.';
	} else {
		return true;
	}
}

KtValidator._validateLp = function(messageType, paramName, paramValue) {
	// postal/zip code param (cpu messages)
	// this parameter isn't being used so we just return true for now
	return true;
}

KtValidator._validateLs = function(messageType, paramName, paramValue) {
	// state param (cpu messages)
	// this parameter isn't being used so we just return true for now
	return true;
}

KtValidator._validateN = function(messageType, paramName, paramValue) {
	// event name param (evt messages)
	var regex = /^[A-Za-z0-9-_]{1,32}$/;

	if (typeof paramValue == "undefined" || !regex.test(paramValue)) {
		return 'Invalid event name value.';
	} else {
		return true;
	}
}

KtValidator._validateR = function(messageType, paramName, paramValue) {
	// Sending messages include multiple recipients (comma separated) and
	// response messages can only contain 1 recipient UID.
	if (messageType == 'ins' || messageType == 'nes' || messageType == 'nts') {
		// recipients param (ins, nes, nts messages)
		var regex = /^[0-9]+(,[0-9]+)*$/;

		if (typeof paramValue == "undefined" || !regex.test(paramValue)) {
			return 'Invalid recipient user ids.';
		}
	} else if (messageType == 'inr' || messageType == 'psr' || messageType == 'nei' || messageType == 'ntr') {
		// recipient param (inr, psr, nei, ntr messages)
		if (typeof paramValue == "undefined" || paramValue != parseInt(paramValue)) {
			return 'Invalid recipient user id.';
		}
	}

	return true;
}

KtValidator._validateS = function(messageType, paramName, paramValue) {
	// userId param
	if (typeof paramValue == "undefined" || paramValue != parseInt(paramValue) || paramValue < 1) {
		return 'Invalid user id.';
	} else {
		return true;
	}
}

KtValidator._validateSdk = function(messageType, paramName, paramValue) {
	return true;
}

KtValidator._validateSt1 = function(messageType, paramName, paramValue) {
	// subtype1 param
	var regex = /^[A-Za-z0-9-_]{1,32}$/;

	if (typeof paramValue == "undefined" || !regex.test(paramValue)) {
		return 'Invalid subtype value.';
	} else {
		return true;
	}
}

KtValidator._validateSt2 = function(messageType, paramName, paramValue) {
	return KtValidator._validateSt1(messageType, paramName, paramValue);
}

KtValidator._validateSt3 = function(messageType, paramName, paramValue) {
	return KtValidator._validateSt1(messageType, paramName, paramValue);
}

KtValidator._validateSu = function(messageType, paramName, paramValue) {
	// short tracking tag param
	var regex = /^[A-Fa-f0-9]{8}$/;

	if (typeof paramValue == "undefined" || !regex.test(paramValue)) {
		return 'Invalid short unique tracking tag.';
	} else {
		return true;
	}
}

KtValidator._validateTs = function(messageType, paramName, paramValue) {
	// timestamp param (pgr message)
	if (typeof paramValue == "undefined" || paramValue != parseInt(paramValue) || paramValue < 0) {
		return 'Invalid timestamp.';
	} else {
		return true;
	}
}

KtValidator._validateTu = function(messageType, paramName, paramValue) {
	// type parameter (mtu, pst/psr, ucc messages)
	// acceptable values for this parameter depends on the message type
	var regex;

	if (messageType == 'mtu') {
		regex = /^(direct|indirect|advertisement|credits|other)$/;
	
		if (typeof paramValue == "undefined" || !regex.test(paramValue)) {
			return 'Invalid monetization type.';
		}
	} else if (messageType == 'pst' || messageType == 'psr') {
		regex = /^(feedpub|stream|feedstory|multifeedstory|dashboard_activity|dashboard_globalnews)$/;

		if (typeof paramValue == "undefined" || !regex.test(paramValue)) {
			return 'Invalid stream post/response type.';
		}
	} else if (messageType == 'ucc') {
		regex = /^(ad|partner)$/;

		if (typeof paramValue == "undefined" || !regex.test(paramValue)) {
			return 'Invalid third party communication click type.';
		}
	}
	
	return true;
}

KtValidator._validateU = function(messageType, paramName, paramValue) {
	// unique tracking tag parameter for all messages EXCEPT pgr.
	// for pgr messages, this is the "page address" param
	if (messageType != 'pgr') {
		var regex = /^[A-Fa-f0-9]{16}$/;

		if (typeof paramValue == "undefined" || !regex.test(paramValue)) {
			return 'Invalid unique tracking tag.';
		}
	}
	
	return true;
}

KtValidator._validateV = function(messageType, paramName, paramValue) {
	// value param (mtu, evt messages)
	if (typeof paramValue == "undefined" || paramValue != parseInt(paramValue) || paramValue < -1000000 || paramValue > 1000000) {
		return 'Invalid value.';
	} else {
		return true;
	}
}
