import { endGroup, info, startGroup } from '@actions/core';
import { exec } from '@actions/exec';
import { BaseCore } from './base.js';

class PostCore extends BaseCore {
	private async stopService() {
		startGroup('Stopping service');
		switch (this.os) {
			case 'macos':
				return exec('sudo launchctl', ['bootout', 'system', this.macOsPlist]).then(() => {
					info('Stopped service');
					endGroup();
				});
		}
	}

	private async deleteService() {}

	public async main() {
		startGroup('Service teardown');

		await this.stopService();
		await this.deleteService();
	}
}

await new PostCore().main();
