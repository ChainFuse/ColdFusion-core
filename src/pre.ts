import { isFeatureAvailable } from '@actions/cache';
import { exportVariable, getInput } from '@actions/core';
import { join } from 'node:path';

export class PreSetup {
	protected cleanModelName: string;

	constructor() {
		let parts1 = getInput('model', { required: true }).split('/');

		// Remove "TheBloke" from the array if it exists
		parts1 = parts1.filter((part) => part.toLowerCase() !== 'TheBloke'.toLowerCase());

		let parts2 = parts1.join('/').split('-');

		// Remove "GGUF" from the array if it exists
		parts2 = parts2.filter((part) => part.toLowerCase() !== 'GGUF'.toLowerCase());

		this.cleanModelName = parts2.join('-');
	}

	public async main() {
		if (isFeatureAvailable()) {
			console.log(join(getInput('modelDir', { required: true }), this.cleanModelName, getInput('quantMethod', { required: true }), '.gguf'));
		} else {
			// TODO: Download
		}

		exportVariable('COLDFUSION_CORE_PRE_EXECUTED', `${true}`);
	}
}

await new PreSetup().main();
