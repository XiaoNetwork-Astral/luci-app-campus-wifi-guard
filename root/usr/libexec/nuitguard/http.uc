import * as fs from 'fs';
import { write_private, remove_temporary } from './common.uc';

function quote_config(value) {
	assert(type(value) == 'string', 'Invalid HTTP option');
	for (let i = 0; i < length(value); i++)
		assert(ord(value, i) >= 32 && ord(value, i) != 127, 'Invalid HTTP option');
	return '"' + replace(replace(value, '\\', '\\\\'), '"', '\\"') + '"';
}

export function create_http(device, timeout, cookie_path, executor) {
	assert(type(device) == 'string' && match(device, /^[A-Za-z0-9_.:@-]{1,64}$/), 'Invalid uplink device');
	assert(timeout >= 1 && timeout <= 120, 'Invalid request timeout');
	let execute = executor || system;
	return function(url, body) {
		assert(type(url) == 'string' && match(url, /^https?:\/\/[^\/?#@[:space:]]+/), 'Invalid HTTP URL');
		let temporary = fs.mkdtemp('/tmp/nuitguard-http.XXXXXX');
		assert(temporary, 'Cannot create HTTP workspace');
		let response;
		try {
			let options = 'url = ' + quote_config(url) + '\n';
			let args = ['/usr/bin/curl', '-q', '--ipv4', '--noproxy', '*', '--interface', 'if!' + device,
				'--connect-timeout', '' + timeout, '--max-time', '' + timeout,
				'--max-filesize', '262144', '--proto', '=http,https', '--silent',
				'--output', temporary + '/body', '--dump-header', temporary + '/headers',
				'--config', temporary + '/request'];
			if (cookie_path) push(args, '--cookie', cookie_path, '--cookie-jar', cookie_path);
			if (body != null) {
				write_private(temporary + '/post', body);
				push(args, '--header', 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8',
					'--data-binary', '@' + temporary + '/post');
			}
			write_private(temporary + '/request', options);
			let rc = execute(args, (timeout + 2) * 1000);
			let headers = fs.readfile(temporary + '/headers') || '';
			let response_body = fs.readfile(temporary + '/body') || '';
			let status = 0;
			for (let line in split(headers, '\n')) {
				let found = match(line, /^HTTP\/[^ ]+ ([0-9]{3})/);
				if (found) status = int(found[1]);
			}
			if (cookie_path && fs.stat(cookie_path)) fs.chmod(cookie_path, 384);
			response = { curl_exit: rc, status, headers, body: response_body };
		}
		catch (error) { remove_temporary(temporary); die(error.message); }
		remove_temporary(temporary);
		return response;
	};
};
