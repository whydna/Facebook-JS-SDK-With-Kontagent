
Getting Started
-----------------

The standard Facebook JS SDK with Kontagent fully integrated. Use this SDK as you would normally (see Facebook documentation) and analytics will automatically be reported to your Kontagent dashboard.

	<div id="fb-root"></div>

	<script src="http://connect.facebook.net/en_US/all.js"></script>

	<script src="./kontagent_facebook.js"></script>

	<script>
		FB.init(
			{
				appId	: '<FACEBOOK_APP_ID>',
				channelUrl: ‘<FACEBOOK_CHANNEl_FILE>’,
				status : true,
				cookie : true,
				xfbml	: true
			},
			{
				apiKey: '<KT_API_KEY>',
				useTestServer: false
			}
		);
	</script>