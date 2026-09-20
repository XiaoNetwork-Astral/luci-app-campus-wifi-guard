// The requested response must match; redirects and replacement pages are offline.
import { discover_portal } from './portal.uc';

export function check_internet(response, expected_status, expected_body, probe_url, portal_origin) {
	if (response.curl_exit != 0) return { online: false, reason: 'internet_transport_failure' };
	let body = response.body || '', expected = trim(expected_body || '');
	let valid = response.status == expected_status && response.status >= 200 && response.status < 300 &&
		(expected_status == 204 ? !length(body) : length(expected) && trim(body) == expected);
	if (valid) return { online: true, reason: 'internet_verified' };
	// A recognized login redirect is distinct from an unexplained replacement page.
	let portal = portal_origin ? discover_portal(response.status, response.headers || '', body, probe_url || '') : null;
	return { online: false, reason: portal?.state == 'candidate' && portal.context.origin == portal_origin
		? 'internet_login_required' : 'internet_response_mismatch' };
};
