import { readfile } from 'fs';
import { discover_portal } from './portal.uc';

let dir = ARGV[0];
let result = json(readfile(dir + '/metadata.json'));
for (let name in ['internet', 'portal']) {
	let probe = result[name];
	if (!probe.configured) {
		probe.state = 'not_configured';
		continue;
	}
	if (probe.state == 'skipped_online')
		continue;
	if (probe.curl_exit != 0) {
		probe.state = 'transport_error';
		continue;
	}
	if (name == 'internet') {
		probe.state = probe.http_status == probe.expected_status ? 'expected_status' : 'unexpected_status';
		continue;
	}
	let discovery = discover_portal(probe.http_status,
		readfile(dir + '/portal.headers') || '', readfile(dir + '/portal.body') || '', result.portal_probe_url);
	probe.state = discovery.state;
	if (discovery.context) {
		probe.source = discovery.source;
		probe.origin = discovery.context.origin;
		probe.path = discovery.context.path;
		probe.query_fields = keys(discovery.context.params);
	}
}
delete result.portal_probe_url;
printf('%J\n', result);
