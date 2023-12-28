import { isFeatureAvailable, saveCache } from '@actions/cache';
import { error, getInput, info, warning } from '@actions/core';
import { hashFiles } from '@actions/glob';
import { format, join, parse } from 'node:path';

class PostSetup {
	protected cleanModelName: string;
	protected modelDir: string;

	constructor() {
		let parts1 = getInput('model', { required: true }).split('/');

		// Remove "TheBloke" from the array if it exists
		parts1 = parts1.filter((part) => part.toLowerCase() !== 'TheBloke'.toLowerCase());

		let parts2 = parts1.join('/').split('-');

		// Remove "GGUF" from the array if it exists
		parts2 = parts2.filter((part) => part.toLowerCase() !== 'GGUF'.toLowerCase());

		this.cleanModelName = parts2.join('-');

		// Do format(parse()) for input validation
		this.modelDir = join(format(parse(getInput('modelDir', { required: true }))), 'ChainFuse', 'ColdFusion', 'models', this.cleanModelName);
	}

	public async main() {
		if (isFeatureAvailable()) {
			const baseCacheString = `coldfusion-core-${this.cleanModelName}-`;

			try {
				// 8 to match default download
				const cacheKey = await saveCache([this.modelDir], baseCacheString + hashFiles(`${this.modelDir}/**`), { uploadConcurrency: 8 }, true);

				if (cacheKey) {
					info('Saved to cache successfully');
				} else {
					error('Unknown cache saving error');
				}
			} catch (err) {
				error((err as Error).toString());
			}
		} else {
			warning('Skipping cache save due to unavailable cache service');
		}
	}
}

await new PostSetup().main();
