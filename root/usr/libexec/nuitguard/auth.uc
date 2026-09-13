import { encode_component, login_body, discover_portal, online_result } from './portal.uc';

function response_json(response) {
	if (response.curl_exit != 0 || response.status != 200) return null;
	try {
		let data = json(response.body);
		return type(data) == 'object' ? data : null;
	}
	catch (error) { return null; }
}

export function create_auth(http, settings) {
	return {
		discover: function() {
			let response = http(settings.portal_probe_url);
			if (response.curl_exit != 0) return { state: 'portal_unreachable' };
			let found = discover_portal(response.status, response.headers, response.body, settings.portal_probe_url);
			if (found.state != 'candidate') return { state: 'portal_' + found.state };
			if (found.context.origin != settings.portal_origin) return { state: 'unexpected_portal' };
			return { state: 'discovered', context: found.context };
		},

		page_info: function(context) {
			return response_json(http(context.origin + '/eportal/InterFace.do?method=pageInfo',
				'queryString=' + encode_component(context.query)));
		},

		login: function(context, account) {
			if (context.origin != settings.portal_origin) return { state: 'unexpected_portal' };
			let info = this.page_info(context);
			if (!info) return { state: 'portal_unreachable' };
			if (info.isCheckSmsAuth == 'true' || info.prefixName == 'true')
				return { state: 'additional_authentication_required' };
			let services = [];
			for (let key, service in (info.service || {}))
				if (type(service.serviceName) == 'string') push(services, service.serviceName);
			if (length(services) && index(services, account.service_value) == -1)
				return { state: 'invalid_service' };
			let body;
			try { body = login_body(account, context, info); }
			catch (error) {
				return { state: error.message == 'Unsupported Portal RSA password characters'
					? 'unsupported_password_encoding' : 'unsupported_authentication' };
			}
			let response = http(context.origin + '/eportal/InterFace.do?method=login', body);
			let data = response_json(response);
			if (!data) return { state: 'authentication_response_unavailable' };
			if (data.result == 'fail') return { state: 'authentication_rejected' };
			if (data.result != 'success' || type(data.userIndex) != 'string' || !length(data.userIndex))
				return { state: 'authentication_response_unknown' };
			let interval = int(data.keepaliveInterval);
			return {
				state: 'authenticated',
				session: { origin: context.origin, user_index: data.userIndex,
					keepalive_seconds: interval > 0 && interval <= 1440 ? interval * 60 : 0 }
			};
		},

		online: function(session) {
			if (!session || session.origin != settings.portal_origin) return 'unknown';
			return online_result(response_json(http(session.origin + '/eportal/InterFace.do?method=getOnlineUserInfo',
				'userIndex=' + encode_component(session.user_index))));
		},

		keepalive: function(session) {
			if (!session || session.origin != settings.portal_origin) return false;
			let data = response_json(http(session.origin + '/eportal/InterFace.do?method=keepalive',
				'userIndex=' + encode_component(session.user_index)));
			return data && data.result != 'fail';
		},

		logout: function(session) {
			if (!session || session.origin != settings.portal_origin) return { state: 'no_session' };
			let data = response_json(http(session.origin + '/eportal/InterFace.do?method=logout',
				'userIndex=' + encode_component(session.user_index)));
			return { state: data?.result == 'success' ? 'logged_out' : 'logout_unconfirmed' };
		}
	};
};
