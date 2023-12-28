import { isFeatureAvailable, restoreCache } from '@actions/cache';
import { exportVariable, getInput } from '@actions/core';
import { hashFiles } from '@actions/glob';
import { createWriteStream } from 'node:fs';
import { format, join, parse } from 'node:path';
import type { HuggingFaceRepo } from './types.js';

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

	private findFilenameByQuantMethod(data: HuggingFaceRepo, quantMethod: string = getInput('quantMethod', { required: true })) {
		for (const sibling of data.siblings) {
			const filename = sibling.rfilename;

			// Check if the filename matches the desired pattern
			if (filename.toLowerCase().endsWith('.gguf')) {
				const parts = filename.split('.');
				// Ensure there are enough parts in the filename
				if (parts.length > 2) {
					// Get the second-to-last part for the quant method
					const fileQuantMethod = parts[parts.length - 2];
					if (fileQuantMethod?.toLowerCase() === quantMethod.toLowerCase()) {
						return filename; // Return the whole filename
					}
				}
			}
		}

		return null;
	}

	private downloadModelFromHf(modelDir: string, quantMethod: string = getInput('quantMethod', { required: true })) {
		return new Promise<void>((mainResolve, mainReject) => {
			// @ts-expect-error
			const modelPath = format({
				dir: modelDir,
				name: getInput('quantMethod', { required: true }),
				ext: '.gguf',
			});
			const jsonPath = format({
				dir: modelDir,
				name: 'repo',
				ext: '.json',
			});

			fetch(new URL(`https://huggingface.co/api/models/TheBloke/${this.cleanModelName}-GGUF`))
				.then((jsonResponse) => {
					if (jsonResponse.ok) {
						jsonResponse
							.json()
							.then((jsonContent) => {
								const json = jsonContent as HuggingFaceRepo;

								// Save JSON because it has hash and other important stuff
								const jsonWriteStream = createWriteStream(jsonPath);
								jsonWriteStream.write(JSON.stringify(json));
								jsonWriteStream.end();

								// Get the exact file name for the given quant method
								const filename = this.findFilenameByQuantMethod(json, quantMethod);

								if (filename) {
									const modelDownloadUrl = new URL(join(json.modelId, 'resolve', 'main', filename), 'https://huggingface.co');
									modelDownloadUrl.searchParams.set('download', true.toString());
									console.log(modelDownloadUrl.toString());
									mainResolve();
								} else {
									mainReject(quantMethod);
								}
							})
							.catch(mainReject);
					} else {
						mainReject(jsonResponse.status);
					}
				})
				.catch(mainReject);
		});
	}

	public async main() {
		// Do format(parse()) for input validation
		const modelDir = join(format(parse(getInput('modelDir', { required: true }))), 'ChainFuse', 'ColdFusion', 'models', this.cleanModelName);

		if (isFeatureAvailable()) {
			const baseCacheString = `coldfusion-core-${this.cleanModelName}-`;

			const cacheKey = await restoreCache([modelDir], baseCacheString + hashFiles(`${modelDir}/**`), [baseCacheString], { concurrentBlobDownloads: true }, true);

			if (cacheKey) {
				// TODO: Check if files actually exist
			} else {
				this.downloadModelFromHf(modelDir);
			}
		} else {
			this.downloadModelFromHf(modelDir);
		}

		exportVariable('COLDFUSION_CORE_PRE_EXECUTED', `${true}`);
	}
}

await new PreSetup().main();
