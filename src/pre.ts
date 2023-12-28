import { isFeatureAvailable } from '@actions/cache';
import { exportVariable, getInput } from '@actions/core';
import { join } from 'node:path';

export class PreSetup {
	public async main() {
		if (isFeatureAvailable()) {
			console.log(getInput('model', { required: true }), getInput('quantMethod', { required: true }), getInput('modelDir', { required: true }));
			console.log(join(getInput('modelDir', { required: true }), getInput('model', { required: true })));
		} else {
			// TODO: Download
		}

		exportVariable('COLDFUSION_CORE_PRE_EXECUTED', `${true}`);
	}
}

await new PreSetup().main();
