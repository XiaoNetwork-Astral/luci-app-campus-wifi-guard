import { readfile } from 'fs';
import { discover_portal } from './portal.uc';
import { check_internet } from './internet-check.uc';

let dir = ARGV[0];
if (ARGV[1] == 'internet') {
	let verdict = check_internet({ curl_exit: int(ARGV[2]), status: int(ARGV[3]), body: readfile(dir + '/internet.body') || '', headers: readfile(dir + '/internet.headers') || '' },
		int(ARGV[4]), readfile(dir + '/internet.expected') || '', ARGV[5], ARGV[6]);
	print(verdict.reason); exit(0);
}
let result = json(readfile(dir + '/metadata.json'));
for (let name in ['internet', 'portal']) {
	let probe = result[name];
	if (!probe.configured) {
		probe.state = 'not_configured';
		continue;
	}
	if (probe.state == 'skipped_online')
		continue;
	if (name == 'internet') continue;
	if (probe.curl_exit != 0) {
		probe.state = 'transport_error';
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
