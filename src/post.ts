import { isFeatureAvailable, restoreCache, saveCache } from '@actions/cache';
import { error, getInput, info, warning } from '@actions/core';
import { Chalk } from 'chalk';
import { format, join, parse } from 'node:path';
import { FileHasher } from './fileHasher.js';

const chalk = new Chalk({ level: 3 });

class PostCore {
	protected cleanModelName: string;
	protected modelDir: string;
	protected modelPath: string;

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
		this.modelPath = format({
			dir: this.modelDir,
			name: getInput('quantMethod', { required: true }),
			ext: '.gguf',
		});
	}

	public async main() {
		if (isFeatureAvailable()) {
			const baseCacheString = `coldfusion-core-${this.cleanModelName}-`;

			const fileHashes = await FileHasher.hashFiles(this.modelPath);

			// Needs to match exact or else it should save exact
			const existingCacheKey = await restoreCache([this.modelPath], baseCacheString + fileHashes, undefined, { lookupOnly: true }, true);

			if (existingCacheKey) {
				warning(chalk.yellow("'Skipping cache due to it already existing'"));
			} else {
				const cacheKey = await saveCache([this.modelDir], baseCacheString + fileHashes, undefined, true);

				if (cacheKey) {
					info('Saved to cache successfully');
				} else {
					error('Unknown cache saving error');
				}
			}
		} else {
			warning(chalk.yellow('Skipping cache save due to unavailable cache service'));
		}
	}
}

await new PostCore().main();
