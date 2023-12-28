import { isFeatureAvailable, restoreCache, saveCache } from '@actions/cache';
import { error, getInput, info, warning } from '@actions/core';
import { Chalk } from 'chalk';
import { format, join, parse } from 'node:path';
import { FileHasher } from './fileHasher.js';

const chalk = new Chalk({ level: 3 });

class PostCore {
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
			info(`${this.modelDir}/**`);
			let fileHashes = '';
			try {
				fileHashes = await FileHasher.hashFiles(`${this.modelDir}/*`);
			} catch (err) {
				console.error(err);
			}

			const existingCacheKey = await restoreCache([this.modelDir], baseCacheString + fileHashes, [baseCacheString], { lookupOnly: true }, true);

			if (existingCacheKey) {
				warning(chalk.yellow("'Skipping cache due to it already existing'"));
			} else {
				try {
					const cacheKey = await saveCache([this.modelDir], baseCacheString + fileHashes, undefined, true);

					if (cacheKey) {
						info('Saved to cache successfully');
					} else {
						error('Unknown cache saving error');
					}
				} catch (err) {
					error((err as Error).toString());
				}
			}
		} else {
			warning(chalk.yellow('Skipping cache save due to unavailable cache service'));
		}
	}
}

await new PostCore().main();
