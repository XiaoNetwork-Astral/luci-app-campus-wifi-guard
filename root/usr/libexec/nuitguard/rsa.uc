import * as fs from 'fs';
import { write_private, remove_temporary } from './common.uc';

// Match the Portal's UTF-16 reversal and numeric block layout before native RSA.
function utf16(value) {
	let units = [];
	for (let i = 0; i < length(value);) {
		let first = ord(value, i++), cp = first, count = 0;
		if (first >= 240) { cp = first & 7; count = 3; }
		else if (first >= 224) { cp = first & 15; count = 2; }
		else if (first >= 192) { cp = first & 31; count = 1; }
		else assert(first < 128, 'Invalid UTF-8 password');
		for (let j = 0; j < count; j++) {
			let next = ord(value, i++);
			assert(next != null && (next & 192) == 128, 'Invalid UTF-8 password');
			cp = (cp << 6) | (next & 63);
		}
		assert(cp <= 1114111, 'Invalid UTF-8 password');
		if (cp > 65535) {
			cp -= 65536;
			push(units, 55296 + (cp >> 10), 56320 + (cp & 1023));
		}
		else push(units, cp);
	}
	return units;
}

function from_hex(hex) {
	if (length(hex) % 2) hex = '0' + hex;
	let result = '';
	for (let i = 0; i < length(hex); i += 2) result += chr(int(substr(hex, i, 2), 16));
	return result;
}

function der(tag, data) {
	let size = length(data), encoded_size;
	if (size < 128) encoded_size = chr(size);
	else {
		encoded_size = from_hex(sprintf('%x', size));
		encoded_size = chr(128 + length(encoded_size)) + encoded_size;
	}
	return chr(tag) + encoded_size + data;
}

function der_integer(hex) {
	let data = from_hex(hex);
	while (length(data) > 1 && ord(data) == 0) data = substr(data, 1);
	if (ord(data) & 128) data = chr(0) + data;
	return der(2, data);
}

export function encrypt_password(value, exponent_hex, modulus_hex) {
	assert(type(exponent_hex) == 'string' && match(exponent_hex, /^[0-9a-fA-F]{1,8}$/), 'Invalid RSA exponent');
	assert(type(modulus_hex) == 'string' && length(modulus_hex) >= 64 && length(modulus_hex) <= 1024 &&
		match(modulus_hex, /^[0-9a-fA-F]+$/), 'Invalid RSA modulus');
	modulus_hex = replace(modulus_hex, /^0+/, '');
	let exponent = int(exponent_hex, 16);
	assert(exponent > 1 && exponent <= 2147483647 && (exponent & 1), 'Invalid RSA exponent');
	let key_bytes = length(from_hex(modulus_hex));
	let chunk_size = 2 * (int((length(modulus_hex) + 3) / 4) - 1);
	assert(chunk_size > 0, 'Invalid RSA modulus');
	let public_der = der(48, from_hex('300d06092a864886f70d0101010500') +
		der(3, chr(0) + der(48, der_integer(modulus_hex) + der_integer(exponent_hex))));
	let encoded = b64enc(public_der), pem = '-----BEGIN PUBLIC KEY-----\n';
	for (let i = 0; i < length(encoded); i += 64) pem += substr(encoded, i, 64) + '\n';
	pem += '-----END PUBLIC KEY-----\n';
	let units = reverse(utf16(value)), blocks = [];
	// The legacy page uses byte arithmetic; larger code units overflow its RSA math.
	for (let unit in units) assert(unit <= 255, 'Unsupported Portal RSA password characters');
	while (length(units) % chunk_size) push(units, 0);
	let temporary = fs.mkdtemp('/tmp/nuitguard-rsa.XXXXXX');
	assert(temporary, 'Cannot create RSA workspace');
	try {
		write_private(temporary + '/public.pem', pem);
		for (let offset = 0; offset < length(units); offset += chunk_size) {
			let bytes = [], carry = 0;
			for (let i = 0; i < chunk_size; i += 2) {
				let n = units[offset + i] + (units[offset + i + 1] << 8) + carry;
				push(bytes, n & 255, (n >> 8) & 255);
				carry = n >> 16;
			}
			if (carry) push(bytes, carry & 255, (carry >> 8) & 255);
			while (length(bytes) > key_bytes && bytes[length(bytes) - 1] == 0) pop(bytes);
			assert(length(bytes) <= key_bytes, 'Invalid RSA plaintext block');
			while (length(bytes) < key_bytes) push(bytes, 0);
			write_private(temporary + '/plain', join('', map(reverse(bytes), n => chr(n))));
			let rc = system(['/usr/bin/openssl', 'pkeyutl', '-encrypt', '-pubin', '-inkey', temporary + '/public.pem',
				'-pkeyopt', 'rsa_padding_mode:none', '-in', temporary + '/plain', '-out', temporary + '/encrypted'], 5000);
			assert(rc == 0, 'RSA operation failed');
			let ciphertext = fs.readfile(temporary + '/encrypted'), hex = '';
			assert(length(ciphertext) == key_bytes, 'Invalid RSA output');
			for (let i = 0; i < length(ciphertext); i++) hex += sprintf('%02x', ord(ciphertext, i));
			while (length(hex) > 4 && substr(hex, 0, 4) == '0000') hex = substr(hex, 4);
			push(blocks, hex);
		}
	}
	catch (error) { remove_temporary(temporary); die(error.message); }
	remove_temporary(temporary);
	return join(' ', blocks);
};
