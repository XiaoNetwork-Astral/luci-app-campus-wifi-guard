// A campus login may replace DHCP addresses while keeping the same device identity
export function link_identity(link) {
	return link?.device && link?.mac ? sprintf('%J', { device: link.device, mac: lc(link.mac) }) : null;
};

// End only sessions created by this daemon on private uplinks before restoring their MACs
export function logout_private_sessions(settings, paths, io) {
	for (let role in ['wired', 'wifi']) {
		let path = paths?.[role];
		if (settings[role]?.privacy_mac != '1' || !path?.session) continue;
		let result;
		try { result = io.logout(role, path.session); }
		catch (error) { result = { state: 'logout_unconfirmed' }; }
		path.session = null;
		let code = result?.state == 'logged_out' ? 'private_session_logged_out' :
			result?.state == 'no_session' ? 'private_session_logout_skipped' : 'private_session_logout_unconfirmed';
		io.event(code == 'private_session_logged_out' ? 'info' : 'warn', code, role);
	}
};
