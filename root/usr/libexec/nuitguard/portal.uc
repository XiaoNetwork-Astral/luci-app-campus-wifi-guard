// Pure protocol helpers. No requests, credential logging or JavaScript execution.
import { encrypt_password } from './rsa.uc';

export function encode_component(value) {
	assert(type(value) == 'string', 'Expected a string field');
	let encoded = '';
	for (let i = 0; i < length(value); i++) {
		let c = substr(value, i, 1);
		encoded += match(c, /^[A-Za-z0-9_.!~*'()-]$/) ? c : sprintf('%%%02X', ord(value, i));
	}
	return encoded;
};

export function login_body(account, context, page_info) {
	assert(page_info.passwordEncrypt == 'false' || page_info.passwordEncrypt == 'true', 'Unsupported password encryption mode');
	assert(type(account.username) == 'string' && length(account.username), 'Missing username');
	assert(type(account.password) == 'string' && length(account.password), 'Missing password');
	assert(type(account.service_value) == 'string' && length(account.service_value), 'Missing service');
	assert(type(context.query) == 'string' && length(context.query), 'Missing portal context');
	let password = account.password;
	if (page_info.passwordEncrypt == 'true') {
		assert(context.params?.mac, 'Missing portal MAC context');
		password = encrypt_password(password + '>' + context.params.mac,
			page_info.publicKeyExponent, page_info.publicKeyModulus);
	}
	let fields = [
		['userId', account.username], ['password', password],
		['service', account.service_value], ['queryString', context.query],
		['operatorPwd', ''], ['operatorUserId', ''], ['validcode', ''],
		['passwordEncrypt', page_info.passwordEncrypt]
	];
	return join('&', map(fields, f => f[0] + '=' + encode_component(encode_component(f[1]))));
};

export function parse_portal_url(url) {
	if (type(url) != 'string' || length(url) > 8192)
		return null;
	let parts = match(url, /^(https?):\/\/([^\/?#@[:space:]<>"']+)\/eportal\/index\.jsp\?([^#[:space:]<>"']+)$/);
	if (!parts)
		return null;
	let params = {};
	for (let field in split(parts[3], '&')) {
		let pair = match(field, /^([A-Za-z][A-Za-z0-9_]*)=(.*)$/);
		if (!pair || exists(params, pair[1]))
			return null;
		params[pair[1]] = pair[2];
	}
	if (!length(params.mac) || !length(params.wlanuserip))
		return null;
	return { origin: parts[1] + '://' + parts[2], path: '/eportal/index.jsp', query: parts[3], params };
};

export function discover_portal(status, headers, body, probe_url) {
	let urls = [], source = null;
	if (status >= 300 && status < 400) {
		for (let line in split(headers, '\n')) {
			let header = match(line, /^Location:[ \t]*(.*)$/i);
			if (header) {
				let url = trim(header[1]);
				if (substr(url, 0, 1) == '/' && substr(url, 0, 2) != '//') {
					let base = match(probe_url, /^(https?:\/\/[^\/?#@[:space:]]+)/);
					if (base) url = base[1] + url;
				}
				push(urls, url);
			}
		}
		source = 'location_header';
	}
	else if (status == 200) {
		// Find literal URL candidates only; do not execute a page or guess parameters.
		for (let found in (match(body, /https?:\/\/[^[:space:]<>"']+/g) || []))
			push(urls, replace(replace(found[0], '&amp;', '&'), '&#38;', '&'));
		source = 'body_url';
	}
	let contexts = [], seen = {};
	for (let url in urls) {
		let context = parse_portal_url(url);
		if (context && !seen[url]) {
			seen[url] = true;
			push(contexts, context);
		}
	}
	if (length(contexts) != 1)
		return { state: length(contexts) ? 'ambiguous' : 'not_found' };
	let context = contexts[0];
	// This is deliberately a candidate, not proof of authentication being required.
	return { state: 'candidate', source, context };
};

export function online_result(response) {
	if (type(response) != 'object') return 'unknown';
	if (response.result == 'wait') return 'pending';
	if (response.result == 'fail') return 'failed';
	if (response.result == 'success') return 'success';
	return 'unknown';
};
